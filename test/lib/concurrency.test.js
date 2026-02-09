import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSemaphore, gate } from '../../src/lib/concurrency.js';

describe('createSemaphore', () => {
  it('allows up to max concurrent acquisitions', async () => {
    const sem = createSemaphore(2);
    let active = 0;
    let maxActive = 0;

    const task = async () => {
      await sem.acquire();
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 10));
      active--;
      sem.release();
    };

    await Promise.all([task(), task(), task(), task()]);
    assert.equal(maxActive, 2);
  });

  it('semaphore(1) serializes', async () => {
    const sem = createSemaphore(1);
    const order = [];

    const task = async (id) => {
      await sem.acquire();
      order.push(`start-${id}`);
      await new Promise(r => setTimeout(r, 5));
      order.push(`end-${id}`);
      sem.release();
    };

    await Promise.all([task('a'), task('b')]);
    assert.deepEqual(order, ['start-a', 'end-a', 'start-b', 'end-b']);
  });
});

describe('gate', () => {
  it('gates a transform with concurrency limit', async () => {
    const gated = gate(1);
    const order = [];

    const transform = async (send, packet) => {
      order.push(`start-${packet.id}`);
      await new Promise(r => setTimeout(r, 5));
      order.push(`end-${packet.id}`);
      send(packet);
    };

    const wrapped = gated(transform);

    const results = [];
    const send = (p) => results.push(p);

    await Promise.all([
      wrapped(send, { id: 1 }),
      wrapped(send, { id: 2 }),
    ]);

    assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
    assert.equal(results.length, 2);
  });

  it('releases slot on error', async () => {
    const gated = gate(1);

    const failing = async () => { throw new Error('fail'); };
    const wrapped = gated(failing);

    await assert.rejects(() => wrapped(() => {}, {}), /fail/);

    // Should be able to acquire again
    let ran = false;
    const ok = gated(async (send, packet) => { ran = true; send(packet); });
    await ok(() => {}, {});
    assert.ok(ran);
  });
});
