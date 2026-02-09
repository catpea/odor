import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { accumulate, batch, dedupe, retry } from '../../src/kit/index.js';

describe('accumulate', () => {
  it('collects packets and sends aggregate when count reached', () => {
    const acc = accumulate();
    const sent = [];
    const send = p => sent.push(p);

    acc(send, { _totalPosts: 3, id: 1 });
    assert.equal(sent.length, 0);

    acc(send, { _totalPosts: 3, id: 2 });
    assert.equal(sent.length, 0);

    acc(send, { _totalPosts: 3, id: 3 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]._collected.length, 3);
    assert.equal(sent[0]._total, 3);
  });

  it('uses custom count key', () => {
    const acc = accumulate('_count');
    const sent = [];
    const send = p => sent.push(p);

    acc(send, { _count: 2, id: 1 });
    acc(send, { _count: 2, id: 2 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]._total, 2);
  });

  it('does not send if count is undefined', () => {
    const acc = accumulate();
    const sent = [];
    acc(p => sent.push(p), { id: 1 });
    acc(p => sent.push(p), { id: 2 });
    assert.equal(sent.length, 0);
  });
});

describe('batch', () => {
  it('batches packets by size', () => {
    const b = batch(2);
    const sent = [];
    const send = p => sent.push(p);

    b(send, { id: 1 });
    assert.equal(sent.length, 0);

    b(send, { id: 2 });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]._batch.map(p => p.id), [1, 2]);
  });

  it('handles remainder (does not flush partial batch)', () => {
    const b = batch(3);
    const sent = [];
    const send = p => sent.push(p);

    b(send, { id: 1 });
    b(send, { id: 2 });
    assert.equal(sent.length, 0);
  });
});

describe('dedupe', () => {
  it('drops duplicate keys', () => {
    const d = dedupe(p => p.id);
    const sent = [];
    const send = p => sent.push(p);

    d(send, { id: 'a' });
    d(send, { id: 'a' });
    d(send, { id: 'b' });
    assert.equal(sent.length, 2);
  });

  it('allows duplicates after TTL expires', async () => {
    const d = dedupe(p => p.id, { ttl: 10 });
    const sent = [];
    const send = p => sent.push(p);

    d(send, { id: 'a' });
    await new Promise(r => setTimeout(r, 20));
    d(send, { id: 'a' });
    assert.equal(sent.length, 2);
  });
});

describe('retry', () => {
  it('retries on failure', async () => {
    let attempts = 0;
    const transform = async (send, packet) => {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      send(packet);
    };

    const retried = retry(3)(transform);
    const sent = [];
    await retried(p => sent.push(p), { id: 1 });
    assert.equal(attempts, 3);
    assert.equal(sent.length, 1);
  });

  it('throws after exhausting retries', async () => {
    const transform = async () => { throw new Error('always fails'); };
    const retried = retry(2)(transform);
    await assert.rejects(() => retried(() => {}, {}), /always fails/);
  });

  it('respects when predicate', async () => {
    let attempts = 0;
    const transform = async () => {
      attempts++;
      throw new Error('wrong');
    };
    const retried = retry(3, { when: e => e.message === 'right' })(transform);
    await assert.rejects(() => retried(() => {}, {}), /wrong/);
    assert.equal(attempts, 1); // no retries since predicate doesn't match
  });

  it('applies backoff delay', async () => {
    let attempts = 0;
    const start = Date.now();
    const transform = async (send, packet) => {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      send(packet);
    };

    const retried = retry(3, { backoff: 10 })(transform);
    await retried(() => {}, {});
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 20, `Expected >= 20ms, got ${elapsed}ms`); // 10*1 + 10*2 = 30 minimum
  });
});
