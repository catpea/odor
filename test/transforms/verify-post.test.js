import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import verifyPost from '../../src/transforms/verify-post/index.js';

describe('verifyPost', () => {
  it('marks post as valid when no errors', () => {
    const transform = verifyPost();
    const sent = [];

    transform(p => sent.push(p), {
      postId: 'poem-0001',
      textResult: { success: true },
      branches: [
        { coverResult: { success: true } },
        { audioResult: { success: true } },
        { filesResult: { success: true } },
      ],
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].valid, true);
    assert.deepEqual(sent[0].errors, []);
  });

  it('reports errors from results', () => {
    const transform = verifyPost();
    const sent = [];

    transform(p => sent.push(p), {
      postId: 'poem-0001',
      textResult: { error: 'text failed' },
      branches: [
        { coverResult: { error: 'cover failed' } },
        { audioResult: { success: true } },
        { filesResult: { success: true } },
      ],
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].valid, false);
    assert.equal(sent[0].errors.length, 2);
    assert.ok(sent[0].errors.some(e => e.includes('cover')));
    assert.ok(sent[0].errors.some(e => e.includes('text')));
  });

  it('passes through cached posts as valid', () => {
    const transform = verifyPost();
    const sent = [];

    transform(p => sent.push(p), {
      _cached: true,
      postId: 'poem-0001',
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].valid, true);
    assert.deepEqual(sent[0].errors, []);
  });

  it('handles missing branches gracefully', () => {
    const transform = verifyPost();
    const sent = [];

    transform(p => sent.push(p), {
      postId: 'poem-0001',
      textResult: { success: true },
      branches: [],
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].valid, true);
  });
});
