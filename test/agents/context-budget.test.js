import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, trimToContextBudget } from '../../src/agents/context-budget.js';

describe('estimateTokens', () => {
  it('estimates ~1 token per 4 chars', () => {
    assert.equal(estimateTokens('hello world!'), 3); // 12 chars / 4 = 3
  });

  it('rounds up', () => {
    assert.equal(estimateTokens('hi'), 1); // 2 chars / 4 = 0.5 → 1
  });

  it('returns 0 for empty string', () => {
    assert.equal(estimateTokens(''), 0);
  });
});

describe('trimToContextBudget', () => {
  it('passes through when no contextSize', () => {
    const text = 'hello world';
    assert.equal(trimToContextBudget(text), text);
  });

  it('passes through when text fits', () => {
    const text = 'short';
    const result = trimToContextBudget(text, { contextSize: 1000, systemPrompt: 'sys', userPrompt: 'prompt' });
    assert.equal(result, text);
  });

  it('trims long text with marker', () => {
    const text = 'a'.repeat(10000);
    const result = trimToContextBudget(text, { contextSize: 500, systemPrompt: '', userPrompt: '', responseReserve: 0 });
    assert.ok(result.includes('[...trimmed...]'));
    assert.ok(result.length < text.length);
  });

  it('keeps beginning and ending', () => {
    const text = 'BEGIN' + 'x'.repeat(10000) + 'END';
    const result = trimToContextBudget(text, { contextSize: 500, systemPrompt: '', userPrompt: '', responseReserve: 0 });
    assert.ok(result.startsWith('BEGIN'));
    assert.ok(result.endsWith('END'));
    assert.ok(result.includes('[...trimmed...]'));
  });

  it('returns empty when overhead exceeds budget', () => {
    const text = 'hello';
    const result = trimToContextBudget(text, { contextSize: 10, systemPrompt: 'a'.repeat(100), userPrompt: '' });
    assert.equal(result, '');
  });
});
