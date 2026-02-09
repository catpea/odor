# Odor

A static blog generator built on the [muriel](https://www.npmjs.com/package/muriel) filtergraph flow engine. Processes thousands of posts with parallel encoding, incremental builds, and atomic writes.

## Quick Start

```bash
npm install odor
odor profile.json
```

## System Requirements

- **Node.js** >= 22.0.0
- **ffmpeg** (system dependency, for audio encoding)

## CLI Flags

### `--dry-run`

Preview what the build would write without touching disk:

```bash
odor --dry-run profile.json
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

### Debug Options

| Field | Effect |
|-------|--------|
| `mostRecent` | Process only the N most recent posts |
| `processOnly` | Array of post IDs to process exclusively |
| `skipCovers` | Skip all cover image encoding |
| `skipAudio` | Skip all audio encoding |

## Post Directory Structure

Each post lives in its own directory under `src`:

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

| Transform | Input | Output | Description |
|-----------|-------|--------|-------------|
| **post-scanner** | filesystem | packets | Reads post directories, emits one packet per post |
| **skip-unchanged** | packet | packet | Compares against manifest; cached posts bypass encoding |
| **process-cover** | packet | `coverResult` | Encodes cover to AVIF via sharp. Copies AVIF sources as-is. Falls back to copy on unsupported formats |
| **process-audio** | packet | `audioResult` | Encodes audio to MP3 via ffmpeg with configurable presets |
| **copy-files** | packet | `filesResult` | Copies `files/` subdirectory contents to permalink |
| **process-text** | joined packet | `textResult` | Renders markdown to HTML permalink page |
| **verify-post** | packet | `valid`, `errors` | Checks all results for errors |
| **collect-post** | packet | collected post | Extracts and flattens results from branches |
| **accumulate** | packets | aggregate | Collects all post packets, sends one aggregate when count is reached |

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

Cached posts emit stored results directly, bypassing all encoding. Aggregators receive identical data regardless of cache status.

Profile changes (detected via config hash) trigger a full rebuild. Already-encoded cover images and audio files are preserved -- only delete the output file to force re-encoding.

## Atomic Writes

All file writes use a write-to-tmp-then-rename pattern. If the process is killed mid-write, output files are either fully old or fully new, never corrupt. Stale `.tmp` files are overwritten on the next build.

## Higher Order Functions

Odor provides higher-order functions that wrap transforms at the flow level, keeping transforms pure and concurrency visible in the flow graph.

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

A `gate(1)` serializes packets through a transform, useful when the transform holds a shared resource like a readline interface or a single-connection API:

```js
const apiGate = gate(1);

const blog = flow([
  [ postScanner(...), 'post' ],
  ['post', apiGate(agentTask(config)), 'done'],
]);
```

## Concurrency

Cover encoding (sharp) and audio encoding (ffmpeg) are gated by a shared `queue('encoding', { capacity: os.cpus().length })` at the flow level. Sharp's internal thread pool is set to 1 (`sharp.concurrency(1)`) -- parallelism comes from the queue running multiple single-threaded sharp calls. FFmpeg uses `-threads 0` (auto). The transforms themselves contain no concurrency logic.

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

## Odor Complaint

A sanity checker that scans your post database for common problems without building anything.

```bash
odor-complaint profile.json
```

The complaint desk runs each post through a series of checks and prints any issues found. It uses the same `src` and `debug` fields from your profile (including `mostRecent` and `processOnly` for scoping).

### Checks

| Check | What it catches |
|-------|----------------|
| **check-post-json** | Missing or empty required fields (`guid`, `id`, `title`, `date`, `chapter`), invalid dates, malformed UUIDs |
| **check-cover-image** | Missing cover image, wrong aspect ratio (expects 1:1), resolution below 1024x1024 |
| **check-too-many-files** | More than 3 files in the `files/` subdirectory |

### Output

```
Odor Complaint Desk
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

### Flow Graph

```
postScanner -> 'post'

'post' -> gracefulShutdown -> checkPostJson -> checkCoverImage -> checkTooManyFiles -> 'done'
```

Supports CTRL-C for graceful shutdown -- in-flight checks complete, remaining posts are skipped.

## Odor Agent

An interactive CLI that sends each post to a local OpenAI-compatible API for tasks like spellcheck, grammar correction, tagging, and description generation.

```bash
odor-agent profile.json            # run all tasks
odor-agent profile.json spellcheck  # run a single task
```

### Agent Configuration

Add an `agent` section to your profile:

```json
{
  "agent": {
    "url": "http://localhost:11434/v1/chat/completions",
    "model": "llama3",
    "system": "You are a careful editor. Return only the corrected text.",
    "yolo": false,
    "tasks": [
      {
        "name": "spellcheck",
        "prompt": "Fix spelling and grammar in the following text.",
        "target": "text.md"
      },
      {
        "name": "tags",
        "prompt": "Choose relevant tags for this post. Return a JSON array of strings.",
        "target": "post.json:tags"
      },
      {
        "name": "description",
        "prompt": "Write a one-sentence summary of this post.",
        "target": "post.json:description"
      }
    ]
  }
}
```

| Field | Description |
|-------|-------------|
| `url` | OpenAI-compatible chat completions endpoint |
| `model` | Model name to pass in the API request |
| `system` | System prompt sent with every request |
| `yolo` | When `true`, auto-accepts all passing results without prompting |
| `tasks` | Array of tasks to run sequentially |

### Target Format

Each task specifies a `target` that controls where the result is written:

| Target | Behavior |
|--------|----------|
| `"text.md"` | Whole-file replacement -- the API response overwrites `text.md` |
| `"post.json:tags"` | JSON field update -- parses the response and sets the `tags` field in `post.json` |
| `"post.json:description"` | JSON field update -- sets the `description` field in `post.json` |

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

### Sanity Checks

Every API response is validated before display:

- **Empty response** -- rejected
- **Garbled characters** -- control characters, mojibake, or U+FFFD detected -- rejected
- **Length ratio** -- for text targets, the response must be 50%-200% of the original length (skipped for JSON field targets)

### Task Sequencing

Tasks run as separate flows sequentially. If spellcheck modifies `text.md`, the tagging task reads the corrected version on its fresh scan. Each task re-scans the post directory from disk.

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

### Flow Graph

```
postScanner -> 'post'

'post' -> gracefulShutdown -> apiGate(agentTask) -> 'done'
```

The agent task is wrapped in a `gate(1)` to serialize API calls and prevent readline prompts from interleaving.

## Programmatic API

Odor exports its library, queue, and kit modules for programmatic use:

```js
// Core library — paths, atomic writes, manifest, concurrency, HTML helpers
import { setup, resolvePath, interpolatePath, gate, chunk } from 'odor';

// Queue — capacity-limited work queue with lifecycle events
import { queue, Queue } from 'odor/queue';

// Kit — flow-control primitives (debounce, throttle, dedupe, batch, accumulate, retry)
import { accumulate, batch, dedupe, retry } from 'odor/kit';
```

## Development

### Project Structure

```
bin/                    # Thin CLI wrappers (shebang + run())
src/
  cli/                  # CLI orchestration (build, complaint, agent)
  lib/                  # Core library (paths, atomic, manifest, concurrency, html, audio-presets, chunk)
  transforms/           # 14 muriel transform modules
  checks/               # 3 complaint desk checks
  agents/               # Agent task + sanity check
  queue/                # Queue class + README
  kit/                  # Flow-control primitives (debounce, throttle, etc.)
test/                   # Tests (node:test)
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
