export class LockManager {
  constructor() {
    this.locks = new Map();
  }

  async withLock(name, key, fn) {
    const id = `${name}:${key}`;
    const previous = this.locks.get(id) ?? Promise.resolve();

    let release;
    const current = new Promise(resolve => {
      release = resolve;
    });

    this.locks.set(id, previous.then(() => current));

    await previous;

    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(id) === current) {
        this.locks.delete(id);
      }
    }
  }
}
