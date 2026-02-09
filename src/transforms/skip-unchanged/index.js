import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolvePath, interpolatePath, hashFileContent } from '../../lib/index.js';

export default function skipUnchanged({ fastModificationCheck = true, manifest }) {

  return async (send, packet) => {

    const { postId, postDir, guid, profile } = packet;
    const vars = { ...packet, ...packet.postData };
    const entry = manifest.posts[postId];

    // Check if output index.html exists
    const outputPath = path.join(resolvePath(interpolatePath(`${profile.dest}/permalink/${guid}`, vars)), 'index.html');
    const outputExists = fs.existsSync(outputPath);

    if (!entry || !outputExists) {
      const fingerprint = await computeFingerprint(postDir);
      send({ ...packet, _manifestUpdate: { fingerprint }, _inputFingerprint: fingerprint });
      return;
    }

    // Get current file list
    const currentFiles = await getFileList(postDir);
    const currentSubFiles = await getSubdirFiles(path.join(postDir, 'files'));
    const allCurrentKeys = [...currentFiles, ...currentSubFiles.map(f => `files/${f}`)];
    const cachedFileNames = Object.keys(entry.files);

    // Check if file list changed (new/removed files)
    if (allCurrentKeys.length !== cachedFileNames.length ||
        !allCurrentKeys.every(f => cachedFileNames.includes(f))) {
      const fingerprint = await computeFingerprint(postDir);
      send({ ...packet, _manifestUpdate: { fingerprint }, _inputFingerprint: fingerprint });
      return;
    }

    // Fast path: check mtime+size for all files
    let allMtimeMatch = true;
    const fileStats = {};
    for (const fileName of currentFiles) {
      const filePath = path.join(postDir, fileName);
      const s = await stat(filePath);
      fileStats[fileName] = { mtime: s.mtimeMs, size: s.size };
      const cached = entry.files[fileName];
      if (cached.mtime !== s.mtimeMs || cached.size !== s.size) {
        allMtimeMatch = false;
      }
    }

    const filesDir = path.join(postDir, 'files');
    for (const subFile of currentSubFiles) {
      const fullPath = path.join(filesDir, subFile);
      const s = await stat(fullPath);
      const key = `files/${subFile}`;
      fileStats[key] = { mtime: s.mtimeMs, size: s.size };
      const cached = entry.files[key];
      if (!cached || cached.mtime !== s.mtimeMs || cached.size !== s.size) {
        allMtimeMatch = false;
      }
    }

    if (fastModificationCheck && allMtimeMatch) {
      // All mtime+size match — skip (fastest path, zero hashing)
      console.log(`  [skip] ${postId}: unchanged (mtime)`);
      send({ ...packet, _cached: true, _cachedResults: entry.results, _manifestUpdate: { fingerprint: entry, results: entry.results } });
      return;
    }

    // Some differ — re-hash only changed files, reuse cached hashes for unchanged
    const newFiles = {};
    for (const [fileName, stats] of Object.entries(fileStats)) {
      const cached = entry.files[fileName];
      if (cached && cached.mtime === stats.mtime && cached.size === stats.size) {
        newFiles[fileName] = cached;
      } else {
        const isSubdir = fileName.startsWith('files/');
        const fullPath = isSubdir ? path.join(filesDir, fileName.slice(6)) : path.join(postDir, fileName);
        const content = await readFile(fullPath);
        const hash = hashFileContent(content);
        newFiles[fileName] = { mtime: stats.mtime, size: stats.size, hash };
      }
    }

    const compositeHash = computeCompositeHash(newFiles);

    if (compositeHash === entry.compositeHash) {
      // Content unchanged despite mtime change — update mtime in manifest, skip
      const fingerprint = { compositeHash, files: newFiles };
      console.log(`  [skip] ${postId}: unchanged (hash)`);
      send({ ...packet, _cached: true, _cachedResults: entry.results, _manifestUpdate: { fingerprint, results: entry.results } });
      return;
    }

    // Content changed — rebuild
    const fingerprint = { compositeHash, files: newFiles };
    send({ ...packet, _manifestUpdate: { fingerprint }, _inputFingerprint: fingerprint });
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
  const filesDir = path.join(postDir, 'files');
  const subFiles = await getSubdirFiles(filesDir);

  const files = {};

  for (const fileName of fileNames) {
    const filePath = path.join(postDir, fileName);
    const s = await stat(filePath);
    const content = await readFile(filePath);
    const hash = hashFileContent(content);
    files[fileName] = { mtime: s.mtimeMs, size: s.size, hash };
  }

  for (const subFile of subFiles) {
    const fullPath = path.join(filesDir, subFile);
    const s = await stat(fullPath);
    const content = await readFile(fullPath);
    const hash = hashFileContent(content);
    files[`files/${subFile}`] = { mtime: s.mtimeMs, size: s.size, hash };
  }

  const compositeHash = computeCompositeHash(files);
  return { compositeHash, files };
}

function computeCompositeHash(files) {
  const sorted = Object.keys(files).sort().map(k => files[k].hash).join('');
  return createHash('sha256').update(sorted).digest('hex');
}
