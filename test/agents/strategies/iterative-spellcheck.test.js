import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWordList } from '../../../src/agents/strategies/iterative-spellcheck.js';

describe('parseWordList', () => {
  it('parses JSON array of pairs', () => {
    const result = parseWordList('[["teh","the"],["recieve","receive"]]');
    assert.deepEqual(result, [['teh', 'the'], ['recieve', 'receive']]);
  });

  it('parses code-fenced JSON', () => {
    const result = parseWordList('```json\n[["teh","the"]]\n```');
    assert.deepEqual(result, [['teh', 'the']]);
  });

  it('parses embedded array from text', () => {
    const result = parseWordList('Here are corrections: [["teh","the"]]');
    assert.deepEqual(result, [['teh', 'the']]);
  });

  it('returns empty array for empty JSON array', () => {
    assert.deepEqual(parseWordList('[]'), []);
  });

  it('returns empty for "no errors" phrase', () => {
    assert.deepEqual(parseWordList('No errors found.'), []);
  });

  it('returns empty for "no more corrections"', () => {
    assert.deepEqual(parseWordList('There are no more corrections needed.'), []);
  });

  it('returns empty for "looks good"', () => {
    assert.deepEqual(parseWordList('The text looks good.'), []);
  });

  it('returns empty for "looks correct"', () => {
    assert.deepEqual(parseWordList('Everything looks correct.'), []);
  });

  it('returns empty for unparseable input', () => {
    assert.deepEqual(parseWordList('random text without arrays'), []);
  });

  it('returns empty for code-fenced empty array', () => {
    assert.deepEqual(parseWordList('```json\n[]\n```'), []);
  });
});
