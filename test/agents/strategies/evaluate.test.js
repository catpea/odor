import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvaluation } from '../../../src/agents/strategies/evaluate.js';

describe('parseEvaluation', () => {
  it('parses JSON object', () => {
    const result = parseEvaluation('{"spelling": 9, "tags": 7, "suggestions": "Add more tags"}');
    assert.deepEqual(result, { spelling: 9, tags: 7, suggestions: 'Add more tags' });
  });

  it('parses code-fenced JSON', () => {
    const result = parseEvaluation('```json\n{"spelling": 8}\n```');
    assert.deepEqual(result, { spelling: 8 });
  });

  it('extracts embedded JSON object', () => {
    const result = parseEvaluation('Here is my evaluation: {"spelling": 9, "tags": 6}');
    assert.deepEqual(result, { spelling: 9, tags: 6 });
  });

  it('returns null for unparseable input', () => {
    assert.equal(parseEvaluation('just some text'), null);
  });

  it('returns null for arrays', () => {
    assert.equal(parseEvaluation('[1, 2, 3]'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseEvaluation(''), null);
  });

  it('handles nested suggestions', () => {
    const input = '{"spelling": 9, "tags": 5, "description": 8, "suggestions": "Consider adding more specific tags"}';
    const result = parseEvaluation(input);
    assert.equal(result.spelling, 9);
    assert.equal(result.tags, 5);
    assert.equal(result.description, 8);
    assert.ok(result.suggestions.includes('tags'));
  });
});
