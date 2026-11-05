import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.join(here, '..', 'python', 'decision_engine.py');
const REQUIRED_MODULES = ['landPower', 'recommendations', 'waterBudget', 'irrigation', 'risks', 'profit', 'farmMemory'];
const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

function isConfidence(value) {
  return value && typeof value === 'object'
    && ['low', 'medium', 'high'].includes(value.level)
    && Number.isFinite(value.score) && value.score >= 0 && value.score <= 100
    && typeof value.explanation === 'string'
    && typeof value.scoreMeaning === 'string';
}

function isModule(value) {
  return value && typeof value === 'object'
    && value.status === 'success'
    && value.result && typeof value.result === 'object'
    && isConfidence(value.confidence)
    && isStringArray(value.reasons)
    && isStringArray(value.assumptions)
    && isStringArray(value.missingInputs)
    && Array.isArray(value.dataSources)
    && typeof value.calculationVersion === 'string'
    && typeof value.generatedAt === 'string';
}

export class DecisionEngineError extends Error {
  constructor(message = 'Agriculture decision service is temporarily unavailable') {
    super(message);
    this.name = 'DecisionEngineError';
    this.status = 503;
    this.code = 'decision_engine_unavailable';
  }
}

function assertContract(value) {
  if (!value || typeof value !== 'object' || value.status !== 'success'
    || !value.result || typeof value.result !== 'object'
    || !isStringArray(value.reasons)
    || !isStringArray(value.assumptions)
    || !isStringArray(value.missingInputs)
    || !isConfidence(value.confidence)
    || !Array.isArray(value.dataSources)
    || typeof value.calculationVersion !== 'string'
    || typeof value.generatedAt !== 'string') {
    throw new DecisionEngineError();
  }
  for (const key of REQUIRED_MODULES) {
    if (!(key in value.result) || !(key in value)) throw new DecisionEngineError();
  }
  for (const key of ['landPower', 'waterBudget', 'irrigation', 'profit', 'farmMemory']) {
    if (!isModule(value.result[key])) throw new DecisionEngineError();
  }
  if (!Array.isArray(value.result.recommendations) || !Array.isArray(value.result.risks)) {
    throw new DecisionEngineError();
  }
  if (value.result.recommendations.some((item) => !isModule(item))
    || value.result.risks.some((item) => !isModule(item))) {
    throw new DecisionEngineError();
  }
  return value;
}

export function calculateDecisionEngine(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    const error = new Error('Decision input must be an object');
    error.status = 422;
    error.code = 'decision_input_invalid';
    throw error;
  }

  let serialized;
  try {
    serialized = JSON.stringify(input);
  } catch {
    const error = new Error('Decision input is not valid JSON data');
    error.status = 422;
    error.code = 'decision_input_invalid';
    throw error;
  }
  if (Buffer.byteLength(serialized, 'utf8') > 1_000_000) {
    const error = new Error('Decision input exceeds the supported size');
    error.status = 422;
    error.code = 'decision_input_invalid';
    throw error;
  }

  const timeout = Number(process.env.AGCRO_DECISION_TIMEOUT_MS || 4000);
  const runner = options.spawnSync || spawnSync;
  const child = runner(process.env.AGCRO_PYTHON || 'python', [enginePath], {
    input: serialized,
    encoding: 'utf8',
    timeout: Number.isInteger(timeout) && timeout >= 100 && timeout <= 10000 ? timeout : 4000,
    maxBuffer: 1_000_000,
    windowsHide: true,
    shell: false,
  });
  if (!child.error && !child.signal && child.status === 2) {
    const error = new Error('Decision input failed validation');
    error.status = 422;
    error.code = 'decision_input_invalid';
    throw error;
  }
  if (child.error || child.signal || child.status !== 0 || !child.stdout) {
    const errorCode = child.error?.code || (child.signal ? 'PROCESS_TERMINATED' : 'PROCESS_FAILED');
    console.error('Decision engine process failed:', errorCode);
    throw new DecisionEngineError();
  }

  let output;
  try {
    output = JSON.parse(child.stdout);
  } catch {
    console.error('Decision engine returned invalid JSON');
    throw new DecisionEngineError();
  }
  return assertContract(output);
}
