# Agents Guide

This document explains how the odor codebase works at a source-code level. It is written for AI coding assistants and human contributors who need to understand, modify, or extend the project.

## What Odor Does

Odor is a static blog generator. It reads a directory of blog posts (each with a `post.json`, `text.md`, optional cover image, and optional audio file), processes them in parallel, and produces a complete static site with HTML pages, paginated archives, an RSS feed, and M3U playlists. It also includes an AI agent that can spellcheck, tag, summarize, and evaluate posts using any OpenAI-compatible API.

## Engine: Muriel

Odor is built on [muriel](https://www.npmjs.com/package/muriel), a filtergraph flow engine. The `flow()` function accepts an array of edges. Each edge connects an input pipe through stages to an output pipe.

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
bin/
  odor.js                          # Help command — lists all subcommands
  odor-build.js                    # CLI wrapper → src/cli/build.js
  odor-status.js                   # CLI wrapper → src/cli/status.js
  odor-agent.js                    # CLI wrapper → src/cli/agent.js
  odor-server.js                   # CLI wrapper → src/cli/server.js

src/
  cli/
    build.js                       # Main build orchestration (flow graph + completion)
    status.js                      # Sanity-check orchestration
    agent.js                       # AI agent orchestration (server wait, SIGINT, lessons, task loop)
    server.js                      # HTTP/HTTPS dev server (serveStatic, compose, safePath, MIME_TYPES)

  lib/
    index.js                       # Barrel re-export of all lib modules
    paths.js                       # setup, resolvePath, interpolatePath
    atomic.js                      # atomicWriteFile, atomicCopyFile, setDryRun
    manifest.js                    # loadManifest, saveManifest, computeConfigHash, hashFileContent
    concurrency.js                 # createSemaphore, gate, isShutdownRequested, requestShutdown
    html.js                        # renderPostCard, buildPager, escapeXml
    audio-presets.js               # mp3Presets
    chunk.js                       # chunk()

  transforms/
    post-scanner/index.js          # Producer: scans source dirs, emits one packet per post
    skip-unchanged/index.js        # Filter: manifest-based incremental build detection
    process-cover/index.js         # Parallel: encodes cover images to AVIF via sharp
    process-audio/index.js         # Parallel: encodes audio to MP3 via ffmpeg
    copy-files/index.js            # Parallel: copies files/ subdirectory to permalink
    process-text/index.js          # Series: renders markdown to HTML permalink page
    verify-post/index.js           # Series: checks all results for errors
    collect-post/index.js          # Series: extracts and flattens results from branches
    graceful-shutdown/index.js     # Guard: skips packets when shutdown requested
    homepage/index.js              # Aggregator: generates index.html with latest posts
    pagerizer/index.js             # Aggregator: generates numbered archive pages
    rss-feed/index.js              # Aggregator: generates feed.xml
    playlist/index.js              # Aggregator: generates M3U playlists
    use-theme/index.js             # Series: copies theme directory to dest

  checks/
    check-post-json.js             # Validates required post.json fields
    check-cover-image.js           # Validates cover image dimensions
    check-too-many-files.js        # Warns on large files/ directory

  agents/
    agent-task.js                  # Strategy dispatch, skipExisting, context trim, lessons, write-back
    api.js                         # callApi() with auto-retry on empty (3 attempts), abort signal
    context-budget.js              # estimateTokens(), trimToContextBudget()
    lessons.js                     # loadLessons(), saveLessons(), appendLesson(), buildSystemWithLessons()
    sanity-check.js                # isFieldEmpty(), hasGarbledCharacters(), sanityCheck(), parseJsonFieldResponse()
    strategies/
      default.js                   # One-shot: call API → display diff → prompt user
      iterative-spellcheck.js      # Multi-pass: word-list loop → apply → re-check → cumulative diff
      evaluate.js                  # Meta: rate post → run sub-tasks for low scores

  queue/
    index.js                       # Queue class (capacity, wrap, seal, drain, pause)

  kit/
    index.js                       # Flow-control primitives (debounce, throttle, dedupe, batch, accumulate, retry)

test/
  lib/                             # paths, html, chunk, concurrency tests
  kit/                             # kit.test.js
  queue/                           # queue.test.js
  transforms/                      # collect-post, verify-post tests
  agents/                          # api, context-budget, lessons, sanity-check tests
    strategies/                    # iterative-spellcheck, evaluate parser tests

docs/
  example-profile.json             # Complete example profile with agent config
```

## Flow Graphs

### Build Flow (`src/cli/build.js`)

```
postScanner -> skipUnchanged -> 'post'

'post' -> [ processCover, processAudio, copyFiles ] -> processText -> verifyPost -> collectPost -> accumulate() -> 'build'

'build' -> [ homepage, pagerizer, rssFeed, playlist ] -> useTheme -> 'finished'
```

**Edge 1** is a producer edge: `postScanner` scans the filesystem and emits packets. `skipUnchanged` compares each packet against the manifest and either passes it through for processing or marks it as `_cached` with stored results.

**Edge 2** has a parallel stage (`[processCover, processAudio, copyFiles]`) followed by series stages. The three parallel transforms run concurrently per-post. After all three complete, their outputs are auto-joined into `packet.branches`. Downstream stages find results via `branches.find(b => b.coverResult)`. `accumulate()` collects all post packets and sends a single aggregate when the expected count is reached.

**Edge 3** generates site-wide output: `homepage`, `pagerizer`, `rssFeed`, and `playlist` run in parallel. After joining, `useTheme` copies theme files.

### Status Flow (`src/cli/status.js`)

```
postScanner -> 'post'

'post' -> gracefulShutdown -> checkPostJson -> checkCoverImage -> checkTooManyFiles -> 'done'
```

### Agent Flow (`src/cli/agent.js`)

```
postScanner -> 'post'

'post' -> gracefulShutdown -> apiGate(agentTask) -> 'done'
```

The agent task is wrapped in a `gate(1)` to serialize API calls and prevent readline prompts from interleaving.

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

In `src/cli/build.js`, factories are called with profile sections: `processCover(profile.cover, profile.debug)`.

### Cache Bypass

Cached posts carry `packet._cached = true` and `packet._cachedResults = { coverResult, audioResult, ... }`. Every per-post transform has a guard at the top:

```js
if (packet._cached) {
  send({ ...packet, coverResult: packet._cachedResults.coverResult });
  return;
}
```

### Aggregator Collection Pattern

Aggregators receive a single aggregate packet from `accumulate()` with `packet._collected` containing all post packets:

```js
const posts = packet._collected;
if (!posts) { send(packet); return; }

const validPosts = posts.filter(p => p.valid);
// generate output...
send({ _complete: true });
```

### Parallel Branch Results

After auto-join, results from parallel stages live in `packet.branches`:

```js
const coverBranch = branches?.find(b => b.coverResult);
const audioBranch = branches?.find(b => b.audioResult);
const filesBranch = branches?.find(b => b.filesResult);
```

### Atomic Writes

All file operations use `atomicWriteFile(path, data)` or `atomicCopyFile(src, dest)` from `src/lib/atomic.js`. These write to a `.tmp` file then rename, ensuring no corrupt output on crash. When `setDryRun(true)` is called, these functions log but don't write.

### Path Resolution

`resolvePath(template)` resolves paths relative to the base directory (profile's parent) and interpolates `{profile}`. Other variables (`{guid}`, `{chapter}`, `{id}`) are replaced in individual transforms.

## Higher-Order Functions

Odor uses higher-order functions extensively. These are functions that accept a transform (or config) and return a new transform, keeping concurrency and failure logic separate from business logic.

### `gate(concurrency)` — Concurrency Limiter

Located in `src/lib/concurrency.js`. Creates a semaphore-backed wrapper.

```js
const encodingGate = gate(os.cpus().length);

// Both share the same semaphore — max os.cpus().length concurrent
encodingGate(processCover(config))
encodingGate(processAudio(config))
```

`gate(1)` serializes a transform — used in the agent to prevent readline interleaving.

### `retry(n, { backoff, when })` — Retry Wrapper

Located in `src/kit/index.js`. Two-level higher-order function: configure retries, then wrap a transform.

```js
retry(3, { backoff: 1000 })(myTransform)
// Produces a new (send, packet) => {} that retries myTransform up to 3 times
// with 1s, 2s, 3s linear backoff
```

`backoff` can be a number (linear: `backoff * (attempt + 1)`) or a function `(attempt) => ms`. `when` is an optional error predicate — non-matching errors are thrown immediately.

### `debounce(ms)` — Last-Packet-Wins

Located in `src/kit/index.js`. Returns a transform that only forwards the last packet within a quiet window. Intermediate packets resolve without calling `send()`.

### `throttle(perSecond)` — Rate Limiter

Located in `src/kit/index.js`. Returns a transform that spaces packets evenly at the given rate. Packets are delayed, not dropped.

### `dedupe(keyFn, { ttl })` — Deduplication

Located in `src/kit/index.js`. Returns a transform that drops packets with previously-seen keys. Keys expire after `ttl` milliseconds (default: `Infinity`).

### `batch(size)` — Grouping

Located in `src/kit/index.js`. Returns a transform that collects `size` packets, then sends them as `{ _batch: [...] }`.

### `accumulate(countKey)` — Aggregation

Located in `src/kit/index.js`. Collects all packets until `packet[countKey]` is reached, then sends one aggregate with `_collected` and `_total`.

## Agent Architecture

The agent system (`src/agents/` + `src/cli/agent.js`) lets you run AI tasks on every post in your database. Here's how the pieces fit together:

### Orchestration Layer (`src/cli/agent.js`)

The CLI entry point handles:

1. **Profile loading** — reads and validates the JSON profile
2. **Lessons preload** — loads `.odor-lessons.json` once at startup
3. **Triple CTRL-C** — progressive shutdown via `AbortController` + timestamp tracking:
   - 1st press: abort in-flight API calls, skip remaining posts
   - 2nd press: warning
   - 3rd press: `process.exit(1)`
4. **Task loop** — runs each selected task as a separate muriel flow, collecting stats
5. **Summary + commit** — prints results, offers git commit in interactive mode

Key data passed to `agentTask()`:

```js
agentTask({
  name, prompt, target,           // from task config
  url, model, system,             // API connection (system = task.system ?? agent.system)
  yolo, rl,                       // interaction mode
  strategy, skipExisting,         // task behavior
  autoAccept, reflect, evaluate,  // task behavior (cont.)
  contextSize,                    // from agent config
  lessons,                        // loaded once at startup
  profileDir,                     // for saving lessons
  allTasks,                       // full task list (for evaluate sub-tasks)
  signal, aborted,                // AbortController
})
```

### Strategy Dispatch (`src/agents/agent-task.js`)

`agentTask()` is a transform factory. It:

1. Parses the target (`"post.json:tags"` → `{ file: "post.json", key: "tags" }`)
2. Builds the effective system prompt (base + lessons)
3. Resolves the strategy function from a `STRATEGIES` map
4. Returns a `(send, packet) =>` transform that:
   - Reads input content (`text.md` and/or `post.json`)
   - Checks `skipExisting` — skips if field already has a value
   - Trims text to context budget if `contextSize` is set
   - Dispatches to the strategy function
   - Handles write-back to disk (strategies are pure — they return results, never write)
   - Runs self-reflection if `reflect` is true
   - Propagates abort state via `packet._abort`

The `STRATEGIES` map:

```js
const STRATEGIES = {
  'default': defaultStrategy,
  'iterative-spellcheck': iterativeSpellcheckStrategy,
  'evaluate': evaluateStrategy,
};
```

### Strategies

Strategies are pure async functions that receive everything they need as parameters and return a result object:

```js
{ accepted, rejected, retries, error, response, newFieldValue, abort }
```

They never write to disk — `agent-task.js` handles all I/O after the strategy returns. This separation lets the evaluate strategy chain sub-strategies without double-writes.

#### Default Strategy (`src/agents/strategies/default.js`)

The original behavior, extracted into a strategy:

1. Build user message (prompt + text + optional current field value)
2. Call API via `callApi()`
3. Parse response (for JSON field targets)
4. Run sanity check
5. Display diff or field change
6. Prompt user (unless `yolo` or `autoAccept`)
7. Return result

#### Iterative Spellcheck (`src/agents/strategies/iterative-spellcheck.js`)

Multi-pass correction loop:

1. Ask AI for `[["wrong", "right"], ...]` JSON array
2. Parse with `parseWordList()` (handles code fences, embedded arrays, "no errors" phrases)
3. Apply regex replacements to text
4. Repeat (up to 5 iterations) until AI returns empty list
5. Show cumulative diff, prompt for approval

#### Evaluate (`src/agents/strategies/evaluate.js`)

Meta-strategy that chains other strategies:

1. Ask AI to rate post across configured dimensions (1-10 scale)
2. Parse with `parseEvaluation()` (handles code fences, embedded objects)
3. Compare against thresholds
4. For each dimension below threshold, find the sub-task definition in `allTasks`
5. Call `runSubTask()` — a callback from `agent-task.js` that invokes the sub-task's strategy directly and handles write-back

### Supporting Modules

#### `api.js` — API Caller

`callApi(url, model, system, userMessage, { signal })` — sends a chat completion request. Auto-retries up to 3 times on empty responses. Respects `AbortController` signal.

#### `context-budget.js` — Token Budgeting

- `estimateTokens(text)` — rough estimate: `ceil(text.length / 4)`
- `trimToContextBudget(text, { contextSize, systemPrompt, userPrompt, responseReserve })` — if text exceeds budget, keep beginning + `[...trimmed...]` + ending (50/50 split)

#### `lessons.js` — Self-Reflection

- `lessonsPath(profileDir)` → `<profileDir>/.odor-lessons.json`
- `loadLessons(profileDir)` → `{ taskName: ["lesson1", ...], ... }`
- `saveLessons(profileDir, lessons)` — atomic write (tmp + rename)
- `appendLesson(profileDir, taskName, lesson)` — dedup, append, save
- `buildSystemWithLessons(baseSystem, taskName, lessons)` — appends a numbered lessons block to the system prompt

Lessons are loaded once at startup. New lessons from reflection are saved to disk but don't affect the current run.

#### `sanity-check.js` — Response Validation

- `isFieldEmpty(value)` — checks null, undefined, empty string, whitespace-only string, empty array
- `hasGarbledCharacters(text)` — detects control characters, mojibake, U+FFFD
- `sanityCheck(response, original, targetKey)` — empty check, garbled check, length ratio (50%-200% for text targets)
- `parseJsonFieldResponse(response, key)` — strips code fences, parses JSON arrays (tags), strips quotes (description), generic JSON fallback

## Manifest

`.odor-manifest.json` in the dest directory:

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

## Adding a New Transform

1. Create `src/transforms/your-transform/index.js` with the factory pattern
2. Add cache bypass guard if it's a per-post transform
3. Import in `src/cli/build.js` and add to the appropriate edge
4. If it produces a result, update `collectPost` to store it and `verifyPost` to check it

## Adding a New Aggregator

1. Create the transform that checks `packet._collected`
2. Filter valid posts and generate output
3. Add to the parallel array in the aggregation edge: `['build', [homepage, pagerizer, rssFeed, playlist, yourAggregator], useTheme, 'finished']`
4. It must send `{ _complete: true }` so `useTheme` knows when all aggregators finish

## Adding a New Agent Strategy

1. Create `src/agents/strategies/your-strategy.js`
2. Export a default async function with the standard strategy signature (see `default.js` for the full parameter list)
3. Return `{ accepted, rejected, retries, error, response, newFieldValue, abort }`
4. Never write to disk — return data and let `agent-task.js` handle I/O
5. Import and add to the `STRATEGIES` map in `agent-task.js`
6. Add tests in `test/agents/strategies/your-strategy.test.js`

## Debug Configuration

The `debug` object in the profile controls test runs:

- `mostRecent: N` — Only process the N most recent posts
- `processOnly: ["id1", "id2"]` — Only process specific post IDs (takes priority over `mostRecent`)
- `skipCovers: true` — Skip all cover image encoding
- `skipAudio: true` — Skip all audio encoding

Prefix any debug key with `_` (e.g., `"_mostRecent"`) to disable it without deleting.

## Common Modifications

**Change cover format**: Modify `src/transforms/process-cover/index.js` — replace `.avif({ quality, effort })` with `.webp()`, `.png()`, etc. Update the dest template extension in the profile.

**Change HTML templates**: Modify `src/transforms/process-text/index.js` for permalink pages, `src/transforms/homepage/index.js` for the landing page, `src/transforms/pagerizer/index.js` for archive pages. All use template literals.

**Add metadata to posts**: Extend `post.json` fields, access via `packet.postData` in any transform.

**Change pagination**: Adjust `pp` in the profile's `pagerizer` section.

**Add a new agent task type**: Define it in the profile's `agent.tasks` array with a custom `system` prompt. If the default strategy doesn't fit, create a new strategy (see Adding a New Agent Strategy above).
