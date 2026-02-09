import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import collectPost from '../../src/transforms/collect-post/index.js';

describe('collectPost', () => {
  it('collects results from branches for fresh post', () => {
    const transform = collectPost();
    const sent = [];

    transform(p => sent.push(p), {
      postId: 'poem-0001',
      postData: { title: 'Test' },
      guid: 'abc-123',
      valid: true,
      errors: [],
      textResult: { success: true },
      branches: [
        { coverResult: { success: true, url: '/cover.avif' } },
        { audioResult: { success: true, url: '/audio.mp3' } },
        { filesResult: { success: true, count: 1 } },
      ],
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].coverUrl, '/cover.avif');
    assert.equal(sent[0].audioUrl, '/audio.mp3');
    assert.equal(sent[0].permalinkUrl, '/permalink/abc-123/');
    assert.deepEqual(sent[0]._coverResult, { success: true, url: '/cover.avif' });
  });

  it('handles cached post', () => {
    const transform = collectPost();
    const sent = [];

    transform(p => sent.push(p), {
      _cached: true,
      _cachedResults: {
        collectedPost: { postId: 'poem-0001', coverUrl: '/cached.avif' },
        coverResult: { success: true },
        audioResult: { skipped: true },
        textResult: { success: true },
        filesResult: { skipped: true },
      },
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].coverUrl, '/cached.avif');
  });

  it('handles missing branches', () => {
    const transform = collectPost();
    const sent = [];

    transform(p => sent.push(p), {
      postId: 'poem-0001',
      postData: { title: 'Test' },
      guid: 'abc-123',
      valid: true,
      errors: [],
      branches: [],
    });

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]._coverResult, { skipped: true });
    assert.deepEqual(sent[0]._audioResult, { skipped: true });
  });
});
