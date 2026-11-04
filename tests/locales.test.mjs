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
