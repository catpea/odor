import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanityCheck, hasGarbledCharacters, parseJsonFieldResponse, isFieldEmpty } from '../../src/agents/sanity-check.js';

describe('hasGarbledCharacters', () => {
  it('returns false for normal text', () => {
    assert.equal(hasGarbledCharacters('Hello world'), false);
  });

  it('returns false for text with newlines and tabs', () => {
    assert.equal(hasGarbledCharacters('line1\nline2\ttab'), false);
  });

  it('returns true for control characters', () => {
    assert.equal(hasGarbledCharacters('hello\x00world'), true);
  });

  it('returns true for U+FFFD', () => {
    assert.equal(hasGarbledCharacters('hello\uFFFDworld'), true);
  });
});

describe('sanityCheck', () => {
  it('rejects empty response', () => {
    const result = sanityCheck('', 'original', null);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('Empty'));
  });

  it('rejects whitespace-only response', () => {
    const result = sanityCheck('   ', 'original', null);
    assert.equal(result.ok, false);
  });

  it('accepts normal response within length bounds', () => {
    const result = sanityCheck('corrected text here', 'original text here', null);
    assert.equal(result.ok, true);
  });

  it('rejects response too short (< 50%)', () => {
    const result = sanityCheck('x', 'a very long original text that is much longer', null);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('too short'));
  });

  it('rejects response too long (> 200%)', () => {
    const original = 'short';
    const response = 'a'.repeat(original.length * 3);
    const result = sanityCheck(response, original, null);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('too long'));
  });

  it('skips length check for field targets', () => {
    const result = sanityCheck('x', 'a very long original text', 'tags');
    assert.equal(result.ok, true);
  });
});

describe('parseJsonFieldResponse', () => {
  it('parses JSON array for tags', () => {
    const result = parseJsonFieldResponse('["a", "b", "c"]', 'tags');
    assert.deepEqual(result, ['a', 'b', 'c']);
  });

  it('parses tags from markdown code fence', () => {
    const result = parseJsonFieldResponse('```json\n["a", "b"]\n```', 'tags');
    assert.deepEqual(result, ['a', 'b']);
  });

  it('falls back to comma split for tags', () => {
    const result = parseJsonFieldResponse('nature, poetry, life', 'tags');
    assert.deepEqual(result, ['nature', 'poetry', 'life']);
  });

  it('extracts array from text for tags', () => {
    const result = parseJsonFieldResponse('Here are tags: ["a", "b"]', 'tags');
    assert.deepEqual(result, ['a', 'b']);
  });

  it('strips quotes for description', () => {
    const result = parseJsonFieldResponse('"A nice post about stuff"', 'description');
    assert.equal(result, 'A nice post about stuff');
  });

  it('returns plain string for description', () => {
    const result = parseJsonFieldResponse('A nice post about stuff', 'description');
    assert.equal(result, 'A nice post about stuff');
  });

  it('parses JSON for generic fields', () => {
    const result = parseJsonFieldResponse('42', 'score');
    assert.equal(result, 42);
  });

  it('returns string for unparseable generic fields', () => {
    const result = parseJsonFieldResponse('not json', 'field');
    assert.equal(result, 'not json');
  });
});

describe('isFieldEmpty', () => {
  it('returns true for null', () => {
    assert.equal(isFieldEmpty(null), true);
  });

  it('returns true for undefined', () => {
    assert.equal(isFieldEmpty(undefined), true);
  });

  it('returns true for empty string', () => {
    assert.equal(isFieldEmpty(''), true);
  });

  it('returns true for whitespace-only string', () => {
    assert.equal(isFieldEmpty('   '), true);
  });

  it('returns true for empty array', () => {
    assert.equal(isFieldEmpty([]), true);
  });

  it('returns false for non-empty string', () => {
    assert.equal(isFieldEmpty('hello'), false);
  });

  it('returns false for non-empty array', () => {
    assert.equal(isFieldEmpty(['a']), false);
  });

  it('returns false for number', () => {
    assert.equal(isFieldEmpty(42), false);
  });

  it('returns false for zero', () => {
    assert.equal(isFieldEmpty(0), false);
  });

  it('returns false for boolean false', () => {
    assert.equal(isFieldEmpty(false), false);
  });
});
