# Odor

A static blog generator built on the [muriel](https://www.npmjs.com/package/muriel) filtergraph flow engine. Processes thousands of posts with parallel encoding, incremental builds, and atomic writes. Includes an AI agent that can spellcheck, tag, summarize, and evaluate your posts using any local or remote OpenAI-compatible API.

## Quick Start

```bash
npm install odor
```

**See all commands:**

```bash
odor
```

**Build your blog:**

```bash
odor-build profile.json
odor-build profile.json --dry-run
```

**Check for problems without building:**

```bash
odor-status profile.json
```

**Run AI tasks on your posts:**

```bash
odor-agent profile.json            # run all tasks
odor-agent profile.json spellcheck  # run one task
```

**Preview the built site:**

```bash
odor-server profile.json           # HTTP on port 8590
odor-server profile.json --https   # HTTPS with auto-generated self-signed cert
```

## System Requirements

- **Node.js** >= 22.0.0
- **ffmpeg** (system dependency, for audio encoding)

## How It Works

Odor reads a JSON profile that tells it where your posts live and where to put the output. Each post is a directory containing a `post.json`, a `text.md`, and optionally a cover image and audio file. Odor processes them all in parallel — encoding covers to AVIF, audio to MP3, rendering Markdown to HTML — then generates a homepage, paginated archives, an RSS feed, and M3U playlists.

### Post Directory Structure

Each post lives in its own directory under the `src` path from your profile:

```
database/posts/
  poem-0001/
    post.json       # Required: { guid, id, chapter, title, date, ... }
    text.md         # Markdown content
    cover.jpg       # Cover image (jpg, png, webp, or avif)
    audio.m4a       # Audio file (any ffmpeg-supported format)
    files/          # Optional: additional files copied to permalink
      diagram.svg
      data.csv
```

## CLI Flags

### `--dry-run`

Preview what the build would write without touching disk:

```bash
odor-build --dry-run profile.json
```

All `atomicWriteFile` and `atomicCopyFile` calls are intercepted — the build runs to completion but no files are created, modified, or copied. A summary at the end shows the file count that would have been written.

## Profile Configuration

Odor is driven by a JSON profile. All paths are relative to the profile's parent directory. See `docs/example-profile.json` for a complete example.

```json
{
  "profile": "my_blog",
  "title": "My Blog",
  "src": "database/posts",
  "dest": "dist/{profile}",

  "theme": {
    "src": "themes/my-theme",
    "dest": "dist/{profile}"
  },

  "pagerizer": {
    "pp": 24,
    "dest": "dist/{profile}"
  },

  "feed": {
    "dest": "dist/{profile}/feed.xml"
  },

  "cover": {
    "dest": "dist/{profile}/permalink/{guid}/cover.avif",
    "url": "/permalink/{guid}/cover.avif",
    "width": 1024,
    "height": 1024,
    "quality": 80,
    "effort": 4,
    "exif": {
      "IFD0": {
        "Copyright": "Author Name",
        "ImageDescription": "Blog Post Cover"
      }
    }
  },

  "audio": {
    "dest": "dist/audio/chapter-{chapter}/docs/{id}.mp3",
    "url": "https://example.com/chapter-{chapter}/{id}.mp3",
    "preset": "balanced",
    "id3": {
      "artist": "Author Name",
      "album_artist": "Author Name",
      "publisher": "example.com"
    }
  },

  "debug": {
    "mostRecent": 32,
    "processOnly": ["poem-0001", "poem-0002"],
    "skipCovers": false,
    "skipAudio": false
  }
}
```

### Path Variables

| Variable | Expanded from |
|----------|--------------|
| `{profile}` | `profile` field in config |
| `{guid}` | `postData.guid` from each post's `post.json` |
| `{chapter}` | `postData.chapter` from each post's `post.json` |
| `{id}` | `postData.id` from each post's `post.json` |

### `respectExisting`

When upgrading a site, you may want to preserve already-encoded AVIF and MP3 files in the destination so they are not re-encoded. Set `respectExisting` at the top level of your profile:

```json
{
  "respectExisting": {
    "cover": true,
    "audio": true
  }
}
```

| Field | Default | Effect |
|-------|---------|--------|
| `cover` | `true` | If the destination AVIF already exists, skip encoding and use it as-is |
| `audio` | `true` | If the destination MP3 already exists, skip encoding and use it as-is |

Both default to `true` — existing output files are preserved. Set to `false` to force re-encoding even when the output already exists.

### Debug Options

| Field | Effect |
|-------|--------|
| `mostRecent` | Process only the N most recent posts |
| `processOnly` | Array of post IDs to process exclusively |
| `skipCovers` | Skip all cover image encoding |
| `skipAudio` | Skip all audio encoding |

## Flow Graph

```
postScanner -> skipUnchanged -> 'post'

'post' -> [ processCover, processAudio, copyFiles ] -> processText -> verifyPost -> collectPost -> accumulate() -> 'build'

'build' -> [ homepage, pagerizer, rssFeed, playlist ] -> useTheme -> 'finished'
```

The first edge scans source directories and filters unchanged posts via manifest comparison. The second edge processes each post through parallel encoding (cover + audio + file copy), then series stages for text rendering, verification, collection, and accumulation into a single aggregate packet. The third edge fans out to aggregators (homepage, archive pages, RSS feed, M3U playlists) then installs theme files.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success, all posts valid |
| 1 | Build completed but some posts failed |
| 2 | Fatal error (bad profile, missing config) |

## Transforms

### Per-Post Pipeline

| Transform | Description |
|-----------|-------------|
| **post-scanner** | Reads post directories, emits one packet per post |
| **skip-unchanged** | Compares against manifest; cached posts bypass encoding |
| **process-cover** | Encodes cover to AVIF via sharp. Copies AVIF sources as-is |
| **process-audio** | Encodes audio to MP3 via ffmpeg with configurable presets |
| **copy-files** | Copies `files/` subdirectory contents to permalink |
| **process-text** | Renders markdown to HTML permalink page |
| **verify-post** | Checks all results for errors |
| **collect-post** | Extracts and flattens results from branches |
| **accumulate** | Collects all post packets, sends one aggregate when count is reached |

### Aggregators

| Transform | Description |
|-----------|-------------|
| **homepage** | Generates `index.html` with the latest posts |
| **pagerizer** | Generates numbered archive pages (`page-1.html`, `page-2.html`, ...) |
| **rss-feed** | Generates `feed.xml` with the 50 most recent posts |
| **playlist** | Generates M3U playlists from audio posts |
| **use-theme** | Recursively copies theme directory (CSS, assets) to dest |

## Incremental Builds

The builder maintains `.odor-manifest.json` in the dest directory. Each post is fingerprinted with a hybrid mtime+hash strategy:

1. **Fast path**: All file mtimes and sizes match cached values -- skip instantly (zero I/O)
2. **Hash fallback**: Some mtimes differ -- re-hash only changed files, compare composite hash
3. **Rebuild**: Composite hash differs or no manifest entry -- full processing

Profile changes (detected via config hash) trigger a full rebuild.

## Atomic Writes

All file writes use a write-to-tmp-then-rename pattern. If the process is killed mid-write, output files are either fully old or fully new, never corrupt.

## Higher-Order Functions

Odor provides higher-order functions that wrap transforms at the flow level, keeping transforms pure and concurrency concerns visible in the flow graph.

### `gate(concurrency)`

Creates a concurrency gate that limits how many packets can execute a transform simultaneously. Returns a wrapper function: call it with a transform to produce a gated version.

```js
import { gate } from 'odor';

const encodingGate = gate(os.cpus().length);

const blog = flow([
  [ postScanner(...), skipUnchanged(...), 'post' ],

  ['post',
    gracefulShutdown(),
    [
      encodingGate(processCover(config)),   // gated
      encodingGate(processAudio(config)),   // gated — shares slots with cover
      copyFiles()                           // ungated
    ],
    processText(), verifyPost(), collectPost(),
  'done'],
]);
```

Transforms wrapped by the same gate instance share a single semaphore. In the example above, `processCover` and `processAudio` run in parallel branches but compete for the same pool of `os.cpus().length` slots, preventing CPU oversubscription. `copyFiles` is I/O-bound and runs without a gate.

A `gate(1)` serializes packets through a transform — useful when the transform holds a shared resource like a readline interface or a single-connection API:

```js
const apiGate = gate(1);

const blog = flow([
  [ postScanner(...), 'post' ],
  ['post', apiGate(agentTask(config)), 'done'],
]);
```

### `retry(n, options)`

Wraps a transform with automatic retry logic. This is a **two-level** higher-order function: first you configure retries, then you wrap a transform.

```js
import { retry } from 'odor/kit';

// Retry up to 3 times with linear backoff (1s, 2s, 3s)
const resilientTransform = retry(3, { backoff: 1000 })(myTransform);

// Custom backoff function
const customRetry = retry(5, {
  backoff: attempt => Math.pow(2, attempt) * 100,  // exponential
  when: err => err.code === 'ECONNRESET',           // only retry network errors
})(myTransform);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `backoff` | `number` or `(attempt) => ms` | `0` | Linear: `backoff * (attempt + 1)`. Function: called with attempt index |
| `when` | `(error) => boolean` | all errors | Only retry when predicate returns true |

### `debounce(ms)`

Only forwards the last packet within a quiet window. Previous packets are silently dropped. Useful for filesystem watchers that fire multiple events for a single change.

```js
import { debounce } from 'odor/kit';

const blog = flow([
  [fileWatcher, 'change'],
  ['change', debounce(300), rebuildSite, 'done'],
]);
```

### `throttle(perSecond)`

Rate-limits packets to N per second with even spacing. Packets are delayed, not dropped.

```js
import { throttle } from 'odor/kit';

const blog = flow([
  [producer, 'item'],
  ['item', throttle(10), processItem, 'done'],  // max 10 per second
]);
```

### `dedupe(keyFn, options)`

Drops packets with previously-seen keys. Optionally expire entries after a TTL.

```js
import { dedupe } from 'odor/kit';

const blog = flow([
  [producer, 'item'],
  ['item', dedupe(p => p.id, { ttl: 60000 }), processItem, 'done'],
]);
```

### `batch(size)`

Collects packets into groups of `size`. Each group is sent as `{ _batch: [...] }`. Useful for bulk API calls or database inserts.

```js
import { batch } from 'odor/kit';

const blog = flow([
  [producer, 'item'],
  ['item', batch(50), bulkInsert, 'done'],
]);
```

### `accumulate(countKey)`

Collects all packets until the expected count is reached, then sends one aggregate packet with `_collected` (array of all packets) and `_total` (count). Each incoming packet must carry the expected total under the given key.

```js
import { accumulate } from 'odor/kit';

const blog = flow([
  [producer, 'item'],
  ['item', processItem, accumulate('_totalItems'), 'all'],
]);

blog.on('all', packet => {
  const items = packet._collected;  // array of all processed items
});
```

## Audio Presets

| Preset | Quality | Bitrate | Sample Rate | Use Case |
|--------|---------|---------|-------------|----------|
| `highQuality` | q5 | VBR | 48000 | Archival |
| `quality` | q6 | 192k | 44100 | High quality |
| `balanced` | q7 | VBR | 44100 | Default |
| `speed` | q7 | 128k | 44100 | Smaller files |
| `fast` | q8 | 96k | 22050 | Minimum size |

## Theme

The theme is a directory of static files copied to the dest root. At minimum it should contain a `style.css`. The HTML templates reference `/style.css` via a `<link>` tag.

## Odor Status

A sanity checker that scans your post database for common problems without building anything.

```bash
odor-status profile.json
```

### Checks

| Check | What it catches |
|-------|----------------|
| **check-post-json** | Missing or empty required fields (`guid`, `id`, `title`, `date`, `chapter`), invalid dates, malformed UUIDs |
| **check-cover-image** | Missing cover image, wrong aspect ratio (expects 1:1), resolution below 1024x1024 |
| **check-too-many-files** | More than 3 files in the `files/` subdirectory |

### Output

```
Odor Status
Profile: my_blog
─────────────────────────────────────────────

poem-0042:
  [post.json] missing or empty "description"
  [cover] 800x600 is not 1:1 (ratio: 1.33)
poem-0099:
  [cover] missing cover image

─────────────────────────────────────────────
3 complaint(s) in 2 of 150 posts
─────────────────────────────────────────────
```

## Odor Agent

An interactive AI assistant that processes each blog post through configurable tasks — spellchecking, tagging, summarization, quality evaluation, and anything else you can describe in a prompt. It works with any OpenAI-compatible API (Ollama, LM Studio, OpenAI, etc.).

```bash
odor-agent profile.json            # run all tasks
odor-agent profile.json spellcheck  # run a single task
odor-agent profile.json evaluate    # evaluate and auto-fix
```

### Getting Started with the Agent

The simplest setup needs just a local Ollama server:

1. Install [Ollama](https://ollama.ai) and pull a model: `ollama pull llama3`
2. Add an `agent` section to your profile (see below)
3. Run `odor-agent profile.json`

### Agent Configuration

Add an `agent` section to your profile:

```json
{
  "agent": {
    "url": "http://localhost:11434/v1/chat/completions",
    "model": "llama3",
    "system": "You are an AI assistant helping improve blog posts.",
    "yolo": false,
    "contextSize": 2480,
    "tasks": [
      {
        "name": "spellcheck",
        "prompt": "Fix spelling and grammar in the following text.",
        "target": "text.md",
        "system": "You are a careful proofreader. Return ONLY JSON arrays of corrections.",
        "strategy": "iterative-spellcheck",
        "reflect": true
      },
      {
        "name": "tags",
        "prompt": "Choose relevant tags for this post. Return a JSON array of strings.",
        "target": "post.json:tags",
        "system": "You are a content tagger. Return only a JSON array of lowercase tag strings.",
        "skipExisting": true,
        "autoAccept": true
      },
      {
        "name": "description",
        "prompt": "Write a one-sentence summary of this post.",
        "target": "post.json:description",
        "system": "You are a content summarizer. Return only the summary sentence.",
        "skipExisting": true,
        "autoAccept": true
      },
      {
        "name": "evaluate",
        "prompt": "Evaluate this post's quality.",
        "target": "post.json",
        "strategy": "evaluate",
        "autoAccept": true,
        "evaluate": {
          "thresholds": { "spelling": 8, "tags": 8, "description": 8 },
          "subTasks": { "spelling": "spellcheck", "tags": "tags", "description": "description" }
        }
      }
    ]
  }
}
```

### Agent-Level Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | *required* | OpenAI-compatible chat completions endpoint |
| `model` | string | *required* | Model name to pass in the API request |
| `system` | string | `""` | Default system prompt sent with every request (tasks can override) |
| `yolo` | boolean | `false` | Auto-accept all passing results without prompting |
| `contextSize` | number | *none* | Token budget for the model's context window (enables automatic trimming) |
| `tasks` | array | *required* | Array of task definitions to run sequentially |

### Per-Task Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | *required* | Task identifier (used in CLI filter and logs) |
| `prompt` | string | *required* | The instruction sent to the AI |
| `target` | string | *required* | Where to write the result (see Target Format below) |
| `system` | string | agent `system` | Override the system prompt for this task |
| `strategy` | string | `"default"` | Which strategy to use: `"default"`, `"iterative-spellcheck"`, or `"evaluate"` |
| `skipExisting` | boolean | `false` | Skip posts where the target field already has a value |
| `autoAccept` | boolean | `false` | Accept results automatically when sanity checks pass (still shows diff) |
| `reflect` | boolean | `false` | After accepting, ask the AI what could be improved and save the lesson |
| `evaluate` | object | *none* | Configuration for the evaluate strategy (see Evaluate Strategy) |

### Target Format

Each task specifies a `target` that controls where the result is written:

| Target | Behavior |
|--------|----------|
| `"text.md"` | Whole-file replacement — the AI response overwrites `text.md` |
| `"post.json:tags"` | JSON field update — parses the response and sets the `tags` field in `post.json` |
| `"post.json:description"` | JSON field update — sets the `description` field |

### Interactive Mode

For each post, the agent displays the proposed change as a diff (for text targets) or old/new values (for JSON fields), then prompts:

```
  [spellcheck] poem-0001:
  - Ths is a sentance with erors.
  + This is a sentence with errors.
  [1] Yes  [2] No  [3] Retry  [4] Abort >
```

| Choice | Effect |
|--------|--------|
| **Yes** | Accept the change and write it to disk |
| **No** | Skip this post, move to the next |
| **Retry** | Re-call the API for a fresh result |
| **Abort** | Stop processing the current task entirely |

### Yolo Mode

Set `"yolo": true` to auto-accept all results that pass sanity checks. Failed checks are automatically skipped. No interactive prompts are shown.

### Strategies

Strategies control *how* the agent interacts with the AI for each task. You pick a strategy per task via the `strategy` field.

#### `default` — Ask, Review, Accept

The default strategy sends the post content to the AI, displays the result, and asks you to accept/reject/retry. This is the classic one-shot approach.

Good for: tags, descriptions, any single-response task.

#### `iterative-spellcheck` — Multi-Pass Correction

Instead of asking the AI to rewrite the entire text, this strategy asks for a list of `[wrong, right]` correction pairs, applies them, then re-checks. It loops up to 5 times until the AI reports no more errors.

```
  [spellcheck] poem-0001: iterative spellcheck
  iteration 1: 3 correction(s)
  iteration 2: 1 correction(s)
  iteration 3: no more corrections
  4 total correction(s):
  - Ths is a sentance with erors.
  + This is a sentence with errors.
  [1] Yes  [2] No  [3] Abort >
```

Good for: spelling and grammar correction on long texts, where you want precise word-level changes rather than a full rewrite.

#### `evaluate` — Rate and Auto-Fix

The evaluate strategy asks the AI to rate the post across multiple dimensions (e.g., spelling, tags, description) on a 1-10 scale. For any dimension that scores below your configured threshold, it automatically runs the corresponding sub-task to fix it.

```json
{
  "name": "evaluate",
  "prompt": "Evaluate this post's quality.",
  "target": "post.json",
  "strategy": "evaluate",
  "autoAccept": true,
  "evaluate": {
    "thresholds": { "spelling": 8, "tags": 8, "description": 8 },
    "subTasks": { "spelling": "spellcheck", "tags": "tags", "description": "description" }
  }
}
```

Output looks like:

```
  [evaluate] poem-0001: evaluating post quality
  Ratings:
    spelling: 6/8
    tags: 9/8
    description: 5/8
  Running sub-tasks for: spelling, description
  → sub-task: spellcheck
  → sub-task: description
```

Good for: automated quality gates that check everything at once and only fix what needs fixing.

### Context Budgeting

Small models have small context windows. Set `contextSize` at the agent level to automatically trim long posts to fit. The trimmer keeps the beginning and ending of the text (where important content tends to be) and replaces the middle with `[...trimmed...]`.

```json
{
  "agent": {
    "contextSize": 2480,
    ...
  }
}
```

The budget accounts for the system prompt, user prompt, and a 400-token reserve for the AI's response. If your post fits, nothing is trimmed.

### Self-Reflection and Lessons

When `reflect` is set to `true` on a task, the agent asks the AI a follow-up question after each accepted result: *"What could be done better next time?"* The answer is saved as a **lesson** in `.odor-lessons.json` next to your profile.

On the next run, accumulated lessons are appended to the system prompt, so the AI gradually improves at your specific content. Lessons from the current run are saved to disk but only take effect on the *next* run (keeping behavior predictable within a single session).

### Auto-Retry on Empty Responses

If the AI returns an empty response (which happens occasionally with local models), the agent automatically retries up to 3 times before giving up. No user interaction needed.

### skipExisting

Set `"skipExisting": true` on a task to skip posts where the target field already has a value. This is handy for backfilling — run the agent on your entire database and it will only process posts that are missing the field.

```json
{ "name": "tags", "target": "post.json:tags", "skipExisting": true }
```

### autoAccept

Set `"autoAccept": true` to automatically accept results that pass sanity checks, without prompting. Unlike `yolo` (which is agent-wide), `autoAccept` is per-task — you can auto-accept tags but manually review spellcheck changes.

### Sanity Checks

Every API response is validated before display:

- **Empty response** — rejected (after 3 auto-retries)
- **Garbled characters** — control characters, mojibake, or U+FFFD detected — rejected
- **Length ratio** — for text targets, the response must be 50%-200% of the original length (skipped for JSON field targets)

### CTRL-C Handling

The agent uses a progressive shutdown:

- **1st press**: "Shutdown requested — press two more times to terminate" — finishes the current post, skips remaining
- **2nd press**: "Press one more time to terminate"
- **3rd press**: Immediate exit

### Summary and Commit

After all tasks complete, a summary is printed:

```
─────────────────────────────────────────────
Agent Summary
─────────────────────────────────────────────
  spellcheck: 12 accepted, 3 rejected, 1 retries, 0 errors (15 posts)
  tags: 15 accepted, 0 rejected, 0 retries, 0 errors (15 posts)
─────────────────────────────────────────────

Commit changes? (y/n) >
```

In interactive mode, if any changes were accepted, you are offered a git commit. In yolo mode the commit prompt is skipped.

## Odor Server

A dev server for previewing your built site locally.

```bash
odor-server profile.json           # HTTP on port 8590
odor-server profile.json --https   # HTTPS with self-signed cert
```

Add a `server` section to your profile to configure port and static directories:

```json
{
  "server": {
    "port": 8590,
    "static": [
      "dist/{profile}/docs",
      "dist/chapters/"
    ]
  }
}
```

Static directories are stacked in order — when a request comes in, the server tries each directory until it finds the file. This lets you serve HTML pages from one directory and media assets from another. Without a `server` section, the server falls back to serving `dest` on port 8590.

The server listens on `0.0.0.0`, making it accessible from the local network (useful for XR headset testing). The `--https` flag auto-generates a self-signed certificate in `.odor-certs/` next to your profile (requires `openssl`). Certificates are regenerated when expired.

### Server API

The server exports an Express-inspired API for building custom handlers:

```js
import { serveStatic, compose, safePath, MIME_TYPES } from './src/cli/server.js';

// Serve files from a directory — calls next() if not found
const handler = serveStatic('/path/to/files');

// Stack multiple static roots — first match wins, 404 if none match
const app = compose([
  serveStatic('/path/to/html'),
  serveStatic('/path/to/assets'),
]);

http.createServer(app).listen(8590);
```

## Programmatic API

Odor exports its library, queue, and kit modules for programmatic use:

```js
// Core library — paths, atomic writes, manifest, concurrency, HTML helpers
import { setup, resolvePath, interpolatePath, gate, chunk } from 'odor';

// Queue — capacity-limited work queue with lifecycle events
import { queue, Queue } from 'odor/queue';

// Kit — flow-control primitives
import { accumulate, batch, dedupe, debounce, throttle, retry } from 'odor/kit';
```

## Development

### Project Structure

```
bin/                    # Thin CLI wrappers (shebang + run())
src/
  cli/                  # CLI orchestration (build, status, agent, server)
  lib/                  # Core library (paths, atomic, manifest, concurrency, html, audio-presets, chunk)
  transforms/           # 14 muriel transform modules
  checks/               # 3 complaint desk checks
  agents/               # Agent core + strategies + supporting modules
    agent-task.js       # Strategy dispatch, skipExisting, context trim, write-back
    api.js              # API caller with auto-retry on empty responses
    context-budget.js   # Token estimation and text trimming
    lessons.js          # Persistent self-reflection lessons
    sanity-check.js     # Response validation (empty, garbled, length ratio)
    strategies/
      default.js        # One-shot ask/review/accept
      iterative-spellcheck.js  # Multi-pass word-list correction
      evaluate.js       # Rate post + auto-fix low dimensions
  queue/                # Queue class
  kit/                  # Flow-control primitives (debounce, throttle, dedupe, batch, accumulate, retry)
test/                   # Tests (node:test, 113 tests)
docs/                   # Example profile
```

### Running Tests

```bash
npm test                # run all tests
npm run test:watch      # watch mode
```

## Dependencies

- **[muriel](https://www.npmjs.com/package/muriel)** -- Filtergraph flow engine
- **[sharp](https://sharp.pixelplumbing.com/)** -- Image encoding (AVIF)
- **[marked](https://marked.js.org/)** -- Markdown to HTML
- **ffmpeg** -- Audio encoding (system dependency)
