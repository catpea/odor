# Queue

Capacity-limited work queue with lifecycle events for muriel flows.

## Usage

```js
import { queue, Queue } from './queue/index.js';

const encoding = queue('encoding', { capacity: os.cpus().length });
```

### `queue.wrap(transform)`

Gates a transform through the queue. Returns a new transform with the same signature `(send, packet) => {}` that acquires a slot before executing and releases it after.

```js
const blog = flow([
  [ postScanner(...), 'post' ],
  ['post',
    [
      encoding.wrap(processCover(config)),
      encoding.wrap(processAudio(config)),
      copyFiles()
    ],
  'done'],
]);
```

Wrapped transforms from the same queue share capacity. Cover and audio compete for the same pool of slots.

### `queue.seal()`

Declares that no more items will be enqueued. Once all active work completes, the queue emits `'drained'`.

```js
encoding.seal();
```

### `queue.pause()` / `queue.resume()`

Suspends and resumes the queue. Paused queues accept new items but hold them until resumed.

### `Queue.drain(queue)`

Static method. Returns a transform that collects all packets until the queue drains, then sends one aggregate as `{ _collected: [...], _total: N }`. Use as the **sole transform** in an edge.

```js
const encoding = queue('encoding', { capacity: 4 });

const blog = flow([
  [ postScanner(...), 'post' ],
  ['post', encoding.wrap(processPost()), 'processed'],
  ['processed', Queue.drain(encoding), 'aggregated'],
]);

blog.on('aggregated', packet => {
  if (!packet?._collected) return;
  const posts = packet._collected;
  // ... build homepage, RSS, playlists from posts
});
```

Each packet's pipeline blocks (via Promise) until the queue's `'drained'` event fires. Only the last packet to arrive sends the aggregate; the rest resolve without sending.

### Events

| Event | When |
|-------|------|
| `enqueued` | A packet enters `wrap()` |
| `started` | A packet acquires a slot and begins work |
| `completed` | A wrapped transform finishes successfully |
| `failed` | A wrapped transform throws |
| `idle` | Active count reaches zero (may refill) |
| `drained` | Sealed + idle (terminal — no more work) |
| `paused` | `pause()` called |
| `resumed` | `resume()` called |

### Stats

| Property | Type | Description |
|----------|------|-------------|
| `active` | number | Currently executing |
| `waiting` | number | Queued for a slot |
| `completed` | number | Finished successfully |
| `failed` | number | Threw an error |
| `processed` | number | completed + failed |
| `sealed` | boolean | `seal()` was called |
| `drained` | boolean | sealed + idle |
| `idle` | boolean | active === 0 && waiting === 0 |

### Relationship to `gate()`

`gate(concurrency)` in `lib.js` is a lightweight concurrency limiter — no events, no stats, no seal/drain. Use it when you just need a capacity cap. Use `queue()` when you need lifecycle awareness.

| Feature | `gate()` | `queue()` |
|---------|----------|-----------|
| Capacity limiting | Yes | Yes |
| Events | No | Yes |
| Seal / drain | No | Yes |
| Pause / resume | No | Yes |
| Stats | No | Yes |

## To Research

### Scheduling & Routing
- **`route(predicate -> queue)`** — fan-out based on packet properties
- **`prioritize(level)`** — urgent packets skip the line
- **`affinity(workerId)`** — sticky routing for cache warmth
- **`partition(key)`** — ordering guarantees per key

### Advanced Backpressure
- **`spillover(queue)`** — overflow to a secondary queue
- **`reject(reason)`** — explicit refusal with reason
- **Circuit breakers** — open/half-open/closed state machine
- **Load shedding** — drop work under extreme pressure

### Failure Semantics
- **`deadLetter(queue)`** — route failed items to a dead-letter queue
- **`quarantine(queue)`** — isolate suspicious items for inspection
- **`compensate(job -> undo)`** — saga-style rollback

### Architecture
- **Pub/Sub** — decouple producers and consumers
- **Internal task graphs** — dependencies between queued items
- **Named worker pools** — `queue.assign(worker('cover'))` syntax
- **Global "drain & freeze"** — quiesce all queues for shutdown
- **Idempotency** — dedup at the queue level with delivery guarantees
- **Event Emitter Networks (EEN)** — third-generation pure EventEmitter topology (separate project)
