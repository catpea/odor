import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolvePath, interpolatePath } from '../../lib/paths.js';
import { hashFileContent } from '../../lib/manifest.js';

export const manifest = {
  name: 'skip-unchanged',
  title: 'Skip Unchanged Posts',
  category: 'posts',
  reads: ['posts.emitted', 'manifest'],
  writes: ['posts.changed', 'posts.cached'],
  idempotent: true,
  retries: 0,
};

export async function handle({ ctx, store, input, signal, log }) {
  signal.throwIfAborted();

  const posts      = input.from ?? [];
  const manifest   = store.get('manifest') ?? { posts: {} };
  const profile    = ctx.context;
  const vars       = { ...profile, profile: profile.profile };

  const changed = [];
  const cached  = [];

  for (const post of posts) {
    signal.throwIfAborted();

    const entry = manifest.posts[post.postId];
    const postVars = { ...vars, ...post.postData, id: post.postId, guid: post.guid, chapter: post.chapter };

    // Check if the output HTML already exists
    const outputPath = path.join(
      resolvePath(ctx.context.baseDir, `${profile.dest}/permalink/${post.guid}`, postVars),
      'index.html'
    );
    const outputExists = fs.existsSync(outputPath);

    if (!entry || !outputExists) {
      const fingerprint = await computeFingerprint(post.postDir);
      changed.push({ ...post, _manifestUpdate: { fingerprint }, _inputFingerprint: fingerprint });
      continue;
    }

    const currentFiles    = await getFileList(post.postDir);
    const currentSubFiles = await getSubdirFiles(path.join(post.postDir, 'files'));
    const allCurrentKeys  = [...currentFiles, ...currentSubFiles.map(f => `files/${f}`)];
    const cachedFileNames = Object.keys(entry.files ?? {});

    if (
      allCurrentKeys.length !== cachedFileNames.length ||
      !allCurrentKeys.every(f => cachedFileNames.includes(f))
    ) {
      const fingerprint = await computeFingerprint(post.postDir);
      changed.push({ ...post, _manifestUpdate: { fingerprint }, _inputFingerprint: fingerprint });
      continue;
    }

    // Fast mtime check
    const fastCheck = String(profile.skip?.fastModificationCheck) !== 'false';
    let allMtimeMatch = true;
    const fileStats = {};

    for (const fileName of currentFiles) {
      const s = await stat(path.join(post.postDir, fileName));
      fileStats[fileName] = { mtime: s.mtimeMs, size: s.size };
      const c = entry.files[fileName];
      if (!c || c.mtime !== s.mtimeMs || c.size !== s.size) allMtimeMatch = false;
    }

    const filesDir = path.join(post.postDir, 'files');
    for (const subFile of currentSubFiles) {
      const s = await stat(path.join(filesDir, subFile));
      const key = `files/${subFile}`;
      fileStats[key] = { mtime: s.mtimeMs, size: s.size };
      const c = entry.files[key];
      if (!c || c.mtime !== s.mtimeMs || c.size !== s.size) allMtimeMatch = false;
    }

    if (fastCheck && allMtimeMatch) {
      console.log(`  [skip] ${post.postId}: unchanged (mtime)`);
      cached.push(buildCachedPost(post, entry));
      continue;
    }

    // Hash check
    const newFiles = {};
    for (const [fileName, stats] of Object.entries(fileStats)) {
      const c = entry.files[fileName];
      if (c && c.mtime === stats.mtime && c.size === stats.size) {
        newFiles[fileName] = c;
        continue;
      }
      const isSubdir = fileName.startsWith('files/');
      const fullPath = isSubdir
        ? path.join(filesDir, fileName.slice(6))
        : path.join(post.postDir, fileName);
      const content = await readFile(fullPath);
      newFiles[fileName] = { mtime: stats.mtime, size: stats.size, hash: hashFileContent(content) };
    }

    const compositeHash = computeCompositeHash(newFiles);
    if (compositeHash === entry.compositeHash) {
      const fingerprint = { compositeHash, files: newFiles };
      console.log(`  [skip] ${post.postId}: unchanged (hash)`);
      cached.push(buildCachedPost(post, { ...entry, files: newFiles, compositeHash }));
      continue;
    }

    const fingerprint = { compositeHash, files: newFiles };
    changed.push({ ...post, _manifestUpdate: { fingerprint }, _inputFingerprint: fingerprint });
  }

  store.set('posts.cached', cached);

  console.log(`  ${changed.length} changed, ${cached.length} cached`);
  return changed;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCachedPost(post, entry) {
  const results = entry.results ?? {};
  return {
    ...post,
    _cached: true,
    valid:         true,
    errors:        [],
    coverUrl:      results.collectedPost?.coverUrl   ?? null,
    audioUrl:      results.collectedPost?.audioUrl   ?? null,
    permalinkUrl:  results.collectedPost?.permalinkUrl ?? `/permalink/${post.guid}/`,
    _coverResult:  results.coverResult  ?? { skipped: true },
    _audioResult:  results.audioResult  ?? { skipped: true },
    _textResult:   results.textResult   ?? { skipped: true },
    _filesResult:  results.filesResult  ?? { skipped: true },
    _manifestUpdate: { fingerprint: entry, results },
  };
}

async function getFileList(postDir) {
  const entries = await readdir(postDir, { withFileTypes: true });
  return entries.filter(e => e.isFile()).map(e => e.name);
}

async function getSubdirFiles(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => e.name);
  } catch {
    return [];
  }
}

async function computeFingerprint(postDir) {
  const fileNames = await getFileList(postDir);
  const filesDir  = path.join(postDir, 'files');
  const subFiles  = await getSubdirFiles(filesDir);
  const files = {};

  for (const fileName of fileNames) {
    const filePath = path.join(postDir, fileName);
    const s = await stat(filePath);
    const content = await readFile(filePath);
    files[fileName] = { mtime: s.mtimeMs, size: s.size, hash: hashFileContent(content) };
  }

  for (const subFile of subFiles) {
    const fullPath = path.join(filesDir, subFile);
    const s = await stat(fullPath);
    const content = await readFile(fullPath);
    files[`files/${subFile}`] = { mtime: s.mtimeMs, size: s.size, hash: hashFileContent(content) };
  }

  return { compositeHash: computeCompositeHash(files), files };
}

function computeCompositeHash(files) {
  const sorted = Object.keys(files).sort().map(k => files[k].hash).join('');
  return createHash('sha256').update(sorted).digest('hex');
}
