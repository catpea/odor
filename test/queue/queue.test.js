import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { queue, Queue } from '../../src/queue/index.js';

describe('Queue', () => {
  it('creates a queue with given name', () => {
    const q = queue('test');
    assert.equal(q.name, 'test');
  });

  it('limits concurrent wraps to capacity', async () => {
    const q = queue('test', { capacity: 2 });
    let active = 0;
    let maxActive = 0;

    const transform = async (send, packet) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 10));
      active--;
      send(packet);
    };

    const wrapped = q.wrap(transform);
    const send = () => {};
    await Promise.all([
      wrapped(send, { id: 1 }),
      wrapped(send, { id: 2 }),
      wrapped(send, { id: 3 }),
      wrapped(send, { id: 4 }),
    ]);

    assert.equal(maxActive, 2);
  });

  it('tracks completed and failed counts', async () => {
    const q = queue('test', { capacity: 2 });

    const ok = q.wrap(async (send, packet) => send(packet));
    const fail = q.wrap(async () => { throw new Error('fail'); });

    await ok(() => {}, {});
    await ok(() => {}, {});
    try { await fail(() => {}, {}); } catch {}

    assert.equal(q.completed, 2);
    assert.equal(q.failed, 1);
    assert.equal(q.processed, 3);
  });

  it('emits events', async () => {
    const q = queue('test', { capacity: 1 });
    const events = [];

    q.on('enqueued', () => events.push('enqueued'));
    q.on('started', () => events.push('started'));
    q.on('completed', () => events.push('completed'));

    const wrapped = q.wrap(async (send, packet) => send(packet));
    await wrapped(() => {}, {});

    assert.deepEqual(events, ['enqueued', 'started', 'completed']);
  });

  it('seal and drain lifecycle', async () => {
    const q = queue('test', { capacity: 2 });
    let drained = false;
    q.on('drained', () => { drained = true; });

    const wrapped = q.wrap(async (send, packet) => {
      await new Promise(r => setTimeout(r, 5));
      send(packet);
    });

    const p1 = wrapped(() => {}, { id: 1 });
    const p2 = wrapped(() => {}, { id: 2 });
    q.seal();

    await Promise.all([p1, p2]);
    assert.ok(drained);
    assert.ok(q.drained);
  });

  it('pause and resume', async () => {
    const q = queue('test', { capacity: 1 });
    const order = [];

    const wrapped = q.wrap(async (send, packet) => {
      order.push(packet.id);
      send(packet);
    });

    q.pause();
    const p1 = wrapped(() => {}, { id: 'a' });

    // Should not have started yet
    await new Promise(r => setTimeout(r, 10));
    assert.equal(order.length, 0);

    q.resume();
    await p1;
    assert.deepEqual(order, ['a']);
  });

  it('idle and drained properties', () => {
    const q = queue('test');
    assert.ok(q.idle);
    assert.ok(!q.drained); // not sealed
    q.seal();
    assert.ok(q.drained); // sealed + idle
  });
});

describe('Queue.drain', () => {
  it('collects all packets then sends aggregate', async () => {
    const q = queue('test', { capacity: 2 });
    const sent = [];

    const wrapped = q.wrap(async (send, packet) => {
      await new Promise(r => setTimeout(r, 5));
      send(packet);
    });

    const drain = Queue.drain(q);

    // Process 3 items
    const p1 = wrapped((p) => drain(p2 => sent.push(p2), p), { id: 1 });
    const p2 = wrapped((p) => drain(p2 => sent.push(p2), p), { id: 2 });
    const p3 = wrapped((p) => drain(p2 => sent.push(p2), p), { id: 3 });

    q.seal();
    await Promise.all([p1, p2, p3]);

    // Wait for drain to process
    await new Promise(r => setTimeout(r, 20));

    // At least one aggregate should have been sent
    const aggregates = sent.filter(s => s._collected);
    assert.ok(aggregates.length >= 1);
    assert.equal(aggregates[0]._collected.length, 3);
  });
});
