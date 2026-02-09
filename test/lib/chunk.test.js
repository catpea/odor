import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunk } from '../../src/lib/chunk.js';

describe('chunk', () => {
  it('chunks array evenly', () => {
    assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
  });

  it('handles remainder', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(chunk([], 3), []);
  });

  it('returns single chunk when size >= length', () => {
    assert.deepEqual(chunk([1, 2], 5), [[1, 2]]);
  });

  it('returns individual elements when size is 1', () => {
    assert.deepEqual(chunk([1, 2, 3], 1), [[1], [2], [3]]);
  });

  it('handles size equal to length', () => {
    assert.deepEqual(chunk([1, 2, 3], 3), [[1, 2, 3]]);
  });
});
