# Odor

A static blog generator built on the [muriel](https://www.npmjs.com/package/muriel) filtergraph flow engine. Processes thousands of posts with parallel encoding, incremental builds, and atomic writes.

## Quick Start

```bash
npm install odor
odor profile.json
```

## Profile Configuration

Odor is driven by a JSON profile. All paths are relative to the profile's parent directory.

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

'post' -> [ processCover, processAudio, copyFiles ] -> processText -> verifyPost -> collectPost -> 'done'

'done' -> [ homepage, pagerizer, rssFeed ] -> useTheme -> 'finished'
```

The first edge scans source directories and filters unchanged posts via manifest comparison. The second edge processes each post through parallel encoding (cover + audio + file copy), then series stages for text rendering, verification, and collection. The third edge aggregates all posts into paginated HTML, an RSS feed, and installs theme files.

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
| **collect-post** | packet | side-effect | Pushes to shared `processedPosts` array for aggregators |

### Aggregators

| Transform | Description |
|-----------|-------------|
| **homepage** | Generates `index.html` with the latest posts |
| **pagerizer** | Generates numbered archive pages (`page-1.html`, `page-2.html`, ...) |
| **rss-feed** | Generates `feed.xml` with the 50 most recent posts |
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

## Concurrency

Cover encoding (sharp) and audio encoding (ffmpeg) are gated by a shared semaphore limited to `os.cpus().length` concurrent operations. Sharp's internal thread pool is set to 1 (`sharp.concurrency(1)`) -- parallelism comes from the semaphore running multiple single-threaded sharp calls. FFmpeg uses `-threads 0` (auto).

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

## Dependencies

- **[muriel](https://www.npmjs.com/package/muriel)** -- Filtergraph flow engine
- **[sharp](https://sharp.pixelplumbing.com/)** -- Image encoding (AVIF)
- **[marked](https://marked.js.org/)** -- Markdown to HTML
- **ffmpeg** -- Audio encoding (system dependency)
