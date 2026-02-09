let _shutdownRequested = false;
export function isShutdownRequested() { return _shutdownRequested; }
export function requestShutdown() { _shutdownRequested = true; }

export function createSemaphore(max) {
  let active = 0;
  const queue = [];
  return {
    acquire() {
      return new Promise(resolve => {
        if (active < max) { active++; resolve(); }
        else queue.push(resolve);
      });
    },
    release() {
      if (queue.length > 0) { queue.shift()(); }
      else active--;
    }
  };
}

export function gate(concurrency) {
  const sem = createSemaphore(concurrency);
  return (transform) => {
    return async (send, packet) => {
      await sem.acquire();
      try {
        await transform(send, packet);
      } finally {
        sem.release();
      }
    };
  };
}
