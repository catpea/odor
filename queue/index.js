// Queue — capacity-limited work queue with lifecycle events
import { EventEmitter } from 'node:events';

class Queue extends EventEmitter {
  constructor(name, { capacity = Infinity } = {}) {
    super();
    this.name = name;
    this._capacity = capacity;
    this._active = 0;
    this._completed = 0;
    this._failed = 0;
    this._sealed = false;
    this._paused = false;
    this._waiting = [];
  }

  get active()    { return this._active; }
  get waiting()   { return this._waiting.length; }
  get completed() { return this._completed; }
  get failed()    { return this._failed; }
  get processed() { return this._completed + this._failed; }
  get sealed()    { return this._sealed; }
  get drained()   { return this._sealed && this._active === 0 && this._waiting.length === 0; }
  get idle()      { return this._active === 0 && this._waiting.length === 0; }

  seal() {
    this._sealed = true;
    this._check();
    return this;
  }

  pause() {
    this._paused = true;
    this.emit('paused');
    return this;
  }

  resume() {
    this._paused = false;
    this.emit('resumed');
    while (this._waiting.length > 0 && this._active < this._capacity) {
      this._active++;
      this._waiting.shift()();
    }
    return this;
  }

  // Gate a transform through this queue (capacity-limited, event-emitting)
  wrap(transform) {
    return async (send, packet) => {
      this.emit('enqueued', this.name);

      // Semaphore acquire — active++ happens synchronously when a slot opens
      await new Promise(resolve => {
        if (!this._paused && this._active < this._capacity) {
          this._active++;
          resolve();
        } else {
          this._waiting.push(resolve);
        }
      });

      this.emit('started', this.name);

      try {
        await transform(send, packet);
        this._completed++;
        this.emit('completed', this.name);
      } catch (err) {
        this._failed++;
        this.emit('failed', this.name, err);
        throw err;
      } finally {
        // Semaphore release — transfer slot or free it
        if (this._waiting.length > 0 && !this._paused) {
          this._waiting.shift()(); // slot transfers (active unchanged)
        } else {
          this._active--;
        }
        this._check();
      }
    };
  }

  // Collects all packets until this queue drains, then sends one aggregate.
  // Returns a transform. Use as the SOLE transform in an edge.
  // Non-final packets resolve without sending — filter downstream with:
  //   if (!packet?._collected) return;
  static drain(q) {
    const items = [];

    return async (send, packet) => {
      items.push(packet);

      if (q.drained) {
        send({ _collected: [...items], _total: items.length });
        return;
      }

      // Wait for the drain event
      await new Promise(resolve => {
        const onDrain = () => resolve();
        q.once('drained', onDrain);
        // Guard against race
        if (q.drained) {
          q.removeListener('drained', onDrain);
          resolve();
        }
      });

      // Only the last packet to arrive sends the aggregate
      if (packet === items[items.length - 1]) {
        send({ _collected: [...items], _total: items.length });
      }
    };
  }

  _check() {
    if (this.idle) this.emit('idle');
    if (this.drained) this.emit('drained');
  }
}

export { Queue };

export function queue(name, options) {
  return new Queue(name, options);
}
