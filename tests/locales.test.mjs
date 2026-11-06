import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const localeDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'locales');
const readLocale = (language) => JSON.parse(fs.readFileSync(path.join(localeDirectory, `${language}.json`), 'utf8'));

function assertSameShape(reference, candidate, language, key = 'locale') {
  if (Array.isArray(reference)) {
    assert.ok(Array.isArray(candidate), `${language}.${key} must be an array`);
    assert.equal(candidate.length, reference.length, `${language}.${key} must have the same number of entries`);
    reference.forEach((value, index) => assertSameShape(value, candidate[index], language, `${key}[${index}]`));
    return;
  }
  if (reference && typeof reference === 'object') {
    assert.ok(candidate && typeof candidate === 'object' && !Array.isArray(candidate), `${language}.${key} must be an object`);
    assert.deepEqual(Object.keys(candidate).sort(), Object.keys(reference).sort(), `${language}.${key} must define every translation key`);
    for (const [childKey, value] of Object.entries(reference)) {
      assertSameShape(value, candidate[childKey], language, `${key}.${childKey}`);
    }
    return;
  }
  assert.equal(typeof candidate, typeof reference, `${language}.${key} must use a matching translation value type`);
}

test('English, Marathi, and Hindi locales expose the same translation structure', () => {
  const english = readLocale('en');
  for (const language of ['mr', 'hi']) {
    assertSameShape(english, readLocale(language), language);
  }
});

test('engine message templates preserve code and parameter contracts in every language', () => {
  const english = readLocale('en').engineMessages;
  const placeholderNames = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const language of ['mr', 'hi']) {
    const translated = readLocale(language).engineMessages;
    assert.deepEqual(Object.keys(translated).sort(), Object.keys(english).sort(), `${language} engine message codes`);
    for (const [code, template] of Object.entries(english)) {
      assert.deepEqual(placeholderNames(translated[code]), placeholderNames(template), `${language}.${code} placeholders`);
      assert.notEqual(translated[code], template, `${language}.${code} must be translated`);
    }
  }
  assert.deepEqual(placeholderNames(english['engine.sensor.moisture_recorded']), ['moisturePct', 'source']);
});

test('admin dashboard copy is translated and its language preference is independent', () => {
  const english = readLocale('en');
  const adminScript = fs.readFileSync(path.join(localeDirectory, '..', 'admin.js'), 'utf8');
  const requiredAdminCopy = [
    'Farm network overview',
    'Farmer management',
    'Farm and zone inventory',
    'IoT device inventory',
    'Sensor monitoring',
    'Alert management centre',
    'Agriculture decision review',
    'Weather and climate risk',
    'Administrative reports',
    'System health and integrations',
    'Apply filters',
    'Download CSV',
    'Review stored alerts and acknowledge them through the existing authenticated alert API. This module does not generate alerts.',
    'Acknowledge this alert?',
    'Something went wrong. Please try again.'
  ];

  for (const language of ['mr', 'hi']) {
    const adminCopy = readLocale(language).adminUi;
    for (const phrase of requiredAdminCopy) {
      assert.ok(adminCopy[phrase], `${language} is missing admin translation: ${phrase}`);
      assert.notEqual(adminCopy[phrase], english.adminUi[phrase], `${language} did not translate: ${phrase}`);
    }
  }

  assert.match(adminScript, /const LOCALE_KEY = 'agcro-admin-language'/);
  assert.doesNotMatch(adminScript, /'agcro-language'/);
  assert.match(adminScript, /localStorage\.setItem\(LOCALE_KEY, next\)/);
  assert.match(adminScript, /localStorage\.getItem\(LOCALE_KEY\)/);
});
