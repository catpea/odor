# Agents Guide: Muriel Blog Maker

## Overview

This is a static blog generator built on [muriel](https://www.npmjs.com/package/muriel), a filtergraph flow engine. The engine wires transforms together using named pipes, parallel fan-out with auto-join, and series stages. The blog maker processes post directories into a complete static site with cover images, audio, paginated archives, and RSS.

## Engine Concepts (odor)

The `flow()` function accepts an array of edges. Each edge connects an input pipe through stages to an output pipe.

```js
import { flow } from 'muriel';

const graph = flow([
  // Producer edge: function emits packets into a named pipe
  [producerFn, 'pipeName'],

  // Transform edge: pipe -> stages -> pipe
  ['input', transformFn, 'output'],

  // Parallel stages: array of functions run concurrently, auto-joined
  ['input', [fn1, fn2, fn3], seriesFn, 'output'],
], { context: { profile } });

graph.on('output', packet => { /* completion handler */ });
graph.dispose(); // cleanup
```

**Transform signature**: `(send, packet) => { send({...packet, result}) }`
**Producer signature**: `send => { send(packet) }` (auto-started via microtask)
**Parallel auto-join**: When stages include an array like `[fn1, fn2, fn3]`, each function receives the same input packet. Results are collected and joined into `packet.branches` (array of outputs). Subsequent series stages receive the joined packet.
**Context**: The `context` object is merged into every packet at pipe boundaries.

## Project Structure

```
index.js                          # Entry point: loads profile, builds flow graph, saves manifest
lib.js                           # Shared utilities: paths, atomics, semaphore, manifest, helpers
transforms/
  post-scanner/index.js          # Producer: scans source dirs, emits one packet per post
  skip-unchanged/index.js        # Filter: manifest-based incremental build detection
  process-cover/index.js         # Parallel: encodes cover images to AVIF via sharp
  process-audio/index.js         # Parallel: encodes audio to MP3 via ffmpeg
  copy-files/index.js            # Parallel: copies files/ subdirectory to permalink
  process-text/index.js          # Series: renders markdown to HTML permalink page
  verify-post/index.js           # Series: checks all results for errors
  collect-post/index.js          # Series: pushes to shared processedPosts array
  homepage/index.js              # Aggregator: generates index.html with latest posts
  pagerizer/index.js             # Aggregator: generates numbered archive pages
  rss-feed/index.js              # Aggregator: generates feed.xml
  use-theme/index.js             # Series: copies theme directory to dest
```

## Flow Graph

```
postScanner -> skipUnchanged -> 'post'

'post' -> [ processCover, processAudio, copyFiles ] -> processText -> verifyPost -> collectPost -> 'done'

'done' -> [ homepage, pagerizer, rssFeed ] -> useTheme -> 'finished'
```

Edge 1 is a producer edge: `postScanner` scans the filesystem and emits packets. `skipUnchanged` compares each packet against the manifest and either passes it through for processing or marks it as `_cached` with stored results.

Edge 2 has a parallel stage (`[processCover, processAudio, copyFiles]`) followed by series stages. The three parallel transforms run concurrently per-post. After all three complete, their outputs are auto-joined into `packet.branches`. Downstream stages (`processText`, `verifyPost`, `collectPost`) find results via `branches.find(b => b.coverResult)` etc.

Edge 3 aggregates: `homepage`, `pagerizer`, and `rssFeed` each collect all post packets (counting via `_totalPosts`), then generate site-wide output when the last packet arrives. After joining, `useTheme` copies theme files.

## Key Patterns

### Transform Factory Pattern

Every transform is a factory function that accepts config and returns the actual `(send, packet) =>` transform:

```js
export default function processCover(config, debug) {
  const { width, height, quality } = config;
  return async (send, packet) => {
    // ... use config, call send() with result
  };
}
```

In `index.js`, factories are called with profile sections: `processCover(profile.cover, profile.debug)`.

### Cache Bypass

Cached posts carry `packet._cached = true` and `packet._cachedResults = { coverResult, audioResult, ... }`. Every per-post transform has a guard at the top:

```js
if (packet._cached) {
  send({ ...packet, coverResult: packet._cachedResults.coverResult });
  return;
}
```

This passes cached results through the pipeline so auto-join and downstream transforms work identically for cached and fresh posts.

### Aggregator Collection Pattern

Aggregators (`homepage`, `pagerizer`, `rssFeed`) count incoming packets against `_totalPosts`. They buffer packets and only generate output when `collected.length >= expectedTotal`. They read from the shared `processedPosts` array (populated by `collectPost`) rather than from individual packets.

```js
collected.push(packet);
if (expectedTotal !== null && collected.length >= expectedTotal) {
  const validPosts = processedPosts.filter(p => p.valid);
  // generate output...
  send({ _complete: true });
} else {
  send({ _complete: false });
}
```

The `_complete` flag is used by `useTheme` to only run after all aggregators finish: `packet.branches?.every(b => b._complete)`.

### Parallel Branch Results

After auto-join, results from parallel stages live in `packet.branches`:

```js
const coverBranch = branches?.find(b => b.coverResult);
const audioBranch = branches?.find(b => b.audioResult);
const filesBranch = branches?.find(b => b.filesResult);
```

### Atomic Writes

All file operations use `atomicWriteFile(path, data)` or `atomicCopyFile(src, dest)` from `lib.js`. These write to a `.tmp` file then rename, ensuring no corrupt output on crash.

### Path Resolution

`resolvePath(template)` in `lib.js` resolves paths relative to the base directory (profile's parent) and interpolates `{profile}`. Other variables (`{guid}`, `{chapter}`, `{id}`) are replaced in individual transforms.

### Concurrency Control

`encodingSemaphore` in `lib.js` limits concurrent sharp/ffmpeg operations to `os.cpus().length`. Transforms acquire before encoding and release in a `finally` block.

## Manifest

`.odor-manifest.json` in the dest directory. Structure:

```json
{
  "version": 1,
  "configHash": "sha256-of-profile-json",
  "posts": {
    "poem-0042": {
      "compositeHash": "sha256-of-all-file-hashes",
      "files": {
        "post.json": { "mtime": 1738766160000, "size": 255, "hash": "sha256..." },
        "cover.jpg": { "mtime": 1738766160000, "size": 79906, "hash": "sha256..." }
      },
      "results": {
        "coverResult": { "success": true, "url": "...", "size": 34567 },
        "audioResult": { "skipped": true },
        "textResult": { "success": true, "htmlLength": 5432 },
        "filesResult": { "skipped": true },
        "valid": true,
        "errors": [],
        "collectedPost": { "postId": "...", "guid": "...", "postData": {}, "coverUrl": "...", "audioUrl": "...", "permalinkUrl": "..." }
      }
    }
  }
}
```

The manifest is built in the `blog.on('finished')` handler by merging `manifestUpdates` (populated by `skipUnchanged`) with results from `processedPosts` (populated by `collectPost`).

## Shared State

Two shared mutable structures in `lib.js`:

- **`processedPosts`** (array): Populated by `collectPost`. Read by aggregators (`homepage`, `pagerizer`, `rssFeed`) and the completion handler.
- **`manifestUpdates`** (Map): Populated by `skipUnchanged` for every post (cached and fresh). Read by the completion handler to build the new manifest.

## Adding a New Transform

1. Create `transforms/your-transform/index.js` with the factory pattern
2. Add cache bypass guard if it's a per-post transform
3. Import in `blog.js` and add to the appropriate edge
4. If it produces a result, update `collectPost` to store it and `verifyPost` to check it

## Adding a New Aggregator

1. Create the transform with the collection pattern (buffer packets, act on `collected.length >= expectedTotal`)
2. Read from `processedPosts` for post data
3. Add to the parallel array in the aggregation edge: `['done', [homepage, pagerizer, rssFeed, yourAggregator], useTheme, 'finished']`
4. It must send `{ _complete: true }` or `{ _complete: false }` so `useTheme` knows when all aggregators finish

## Debug Configuration

The `debug` object in the profile controls test runs:

- `mostRecent: N` -- Only process the N most recent posts
- `processOnly: ["id1", "id2"]` -- Only process specific post IDs (takes priority over `mostRecent`)
- `skipCovers: true` -- Skip all cover image encoding
- `skipAudio: true` -- Skip all audio encoding

## Common Modifications

**Change cover format**: Modify `process-cover/index.js` -- replace `.avif({ quality, effort })` with `.webp()`, `.png()`, etc. Update the dest template extension in the profile.

**Change HTML templates**: Modify `process-text/index.js` for permalink pages, `homepage/index.js` for the landing page, `pagerizer/index.js` for archive pages. All use template literals.

**Add metadata to posts**: Extend `post.json` fields, access via `packet.postData` in any transform.

**Change pagination**: Adjust `pp` in the profile's `pagerizer` section. Homepage shows the latest `pp` posts from the homepage config.
