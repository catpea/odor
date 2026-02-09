// Generic higher-order transform factories for muriel flows.
// These are flow-control primitives — they do not depend on Queue.

// ─────────────────────────────────────────────
// Intake & Shaping
// ─────────────────────────────────────────────

// Only forwards the last packet within a quiet window.
// Previous packets resolve without sending (dropped from pipeline).
export function debounce(ms) {
  let timer = null;
  let pending = null;

  return (send, packet) => {
    if (pending) {
      clearTimeout(timer);
      pending.resolve();
      pending = null;
    }

    return new Promise(resolve => {
      pending = { resolve };
      timer = setTimeout(() => {
        pending = null;
        send(packet);
        resolve();
      }, ms);
    });
  };
}

// Rate-limits packets to N per second (even spacing).
export function throttle(perSecond) {
  const interval = 1000 / perSecond;
  let lastSent = 0;

  return async (send, packet) => {
    const now = Date.now();
    const wait = Math.max(0, lastSent + interval - now);
    if (wait > 0) {
      await new Promise(resolve => setTimeout(resolve, wait));
    }
    lastSent = Date.now();
    send(packet);
  };
}

// Drops packets with previously-seen keys. Optional TTL (ms) for expiry.
export function dedupe(keyFn, { ttl = Infinity } = {}) {
  const seen = new Map();

  return (send, packet) => {
    const key = keyFn(packet);
    const now = Date.now();

    if (seen.has(key)) {
      if (ttl === Infinity || now - seen.get(key) < ttl) return;
    }

    seen.set(key, now);
    send(packet);
  };
}

// Collects packets into groups of `size`, sends each as { _batch: [...] }.
export function batch(size) {
  const buffer = [];

  return (send, packet) => {
    buffer.push(packet);
    if (buffer.length >= size) {
      send({ _batch: buffer.splice(0) });
    }
  };
}

// ─────────────────────────────────────────────
// Failure Handling
// ─────────────────────────────────────────────

// Higher-order: wraps a transform with retry logic.
//   retry(3, { backoff: 1000 })(myTransform)
// `backoff`: number (linear: backoff * attempt) or function (attempt => ms).
// `when`: optional predicate (error => boolean) — only retry matching errors.
export function retry(n, { backoff = 0, when } = {}) {
  return (transform) => {
    return async (send, packet) => {
      let lastErr;
      for (let attempt = 0; attempt <= n; attempt++) {
        try {
          await transform(send, packet);
          return;
        } catch (err) {
          lastErr = err;
          if (when && !when(err)) throw err;
          if (attempt < n) {
            const delay = typeof backoff === 'function'
              ? backoff(attempt)
              : backoff * (attempt + 1);
            if (delay > 0) await new Promise(r => setTimeout(r, delay));
          }
        }
      }
      throw lastErr;
    };
  };
}
