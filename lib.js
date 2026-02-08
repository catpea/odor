import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { writeFile, rename, copyFile, readFile, mkdir } from 'node:fs/promises';

let _shutdownRequested = false;
export function isShutdownRequested() { return _shutdownRequested; }
export function requestShutdown() { _shutdownRequested = true; }

let _baseDir;
let _profile;

export function setup(baseDir, profile) {
  _baseDir = baseDir;
  _profile = profile;
}

export function resolvePath(template) {
  return path.resolve(_baseDir, template.replace('{profile}', _profile.profile));
}

export const processedPosts = [];

export const manifestUpdates = new Map();

export function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function interpolatePath(str, obj) {
  return str.replace(/\{([^}]+)\}/g, (match, key) => {
    if (!(key in obj)) throw new Error(`interpolatePath: unknown key "${key}"`);
    const val = obj[key];
    if (val == null) throw new Error(`interpolatePath: "${key}" is ${val}`);
    if (typeof val === 'object' || typeof val === 'function') return match;
    return String(val);
  });
}

export function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildPager(currentPage, totalPages, radius = 5) {
  if (totalPages <= 1) return [];

  // Small page count: list all pages descending
  const window = radius * 2 + 1;
  if (totalPages <= window) {
    return Array.from({ length: totalPages }, (_, i) => {
      const pn = totalPages - i;
      return { text: `${pn}`, url: `page-${pn}.html`, ariaCurrent: pn === currentPage, pageNum: pn };
    });
  }

  // Large page count: circular window centered on currentPage
  const pages = [];
  for (let offset = -radius; offset <= radius; offset++) {
    const pn = ((currentPage - 1 + offset + totalPages) % totalPages) + 1;
    pages.push({ text: `${pn}`, url: `page-${pn}.html`, ariaCurrent: pn === currentPage, pageNum: pn });
  }
  const low = currentPage - radius;
  const high = currentPage + radius;
  const wrapped = pages.filter(p => p.pageNum < low || p.pageNum > high);
  const main = pages.filter(p => p.pageNum >= low && p.pageNum <= high);
  return [
    ...wrapped.sort((a, b) => b.pageNum - a.pageNum),
    ...main.sort((a, b) => b.pageNum - a.pageNum)
  ];
}

export function renderPostCard(post) {
  return `    <article class="post">
      ${post.coverUrl ? `<a href="${post.permalinkUrl}"><img src="${post.coverUrl}" alt="" loading="lazy"></a>` : ``}
      <div class="post-content">
        <h2><a href="${post.permalinkUrl}">${post.postData.title || post.postId}</a></h2>
        <time>${post.postData.date ? new Date(post.postData.date).toLocaleDateString() : ''}</time>
      </div>
    </article>`;
}

export const mp3Presets = {
  highQuality: (src, out) => [
    '-hide_banner', '-loglevel', 'error', '-threads', '0', '-i', src,
    '-c:a', 'libmp3lame', '-q:a', '5', '-ar', '48000',
    '-af', 'aresample=resampler=soxr:precision=33:dither_method=triangular',
    '-f', 'mp3', '-y', out
  ],
  quality: (src, out) => [
    '-hide_banner', '-loglevel', 'error', '-threads', '0', '-i', src,
    '-c:a', 'libmp3lame', '-q:a', '6', '-b:a', '192k', '-ar', '44100',
    '-af', 'aresample=resampler=soxr:precision=28:dither_method=triangular',
    '-f', 'mp3', '-y', out
  ],
  balanced: (src, out) => [
    '-hide_banner', '-loglevel', 'error', '-threads', '0', '-i', src,
    '-c:a', 'libmp3lame', '-q:a', '7', '-ar', '44100',
    '-af', 'aresample=resampler=soxr:precision=24',
    '-f', 'mp3', '-y', out
  ],
  speed: (src, out) => [
    '-hide_banner', '-loglevel', 'error', '-threads', '0', '-i', src,
    '-c:a', 'libmp3lame', '-q:a', '7', '-b:a', '128k', '-ar', '44100',
    '-af', 'aresample=resampler=soxr:precision=20',
    '-f', 'mp3', '-y', out
  ],
  fast: (src, out) => [
    '-hide_banner', '-loglevel', 'error', '-threads', '0', '-i', src,
    '-c:a', 'libmp3lame', '-q:a', '8', '-b:a', '96k', '-ar', '22050',
    '-af', 'aresample=resampler=soxr',
    '-f', 'mp3', '-y', out
  ]
};

// ─────────────────────────────────────────────
// Atomic Writes
// ─────────────────────────────────────────────

export async function atomicWriteFile(destPath, data) {
  const tmpPath = destPath + '.tmp';
  await writeFile(tmpPath, data);
  await rename(tmpPath, destPath);
}

export async function atomicCopyFile(srcPath, destPath) {
  const tmpPath = destPath + '.tmp';
  await copyFile(srcPath, tmpPath);
  await rename(tmpPath, destPath);
}

// ─────────────────────────────────────────────
// Concurrency Control
// ─────────────────────────────────────────────

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

export const encodingSemaphore = createSemaphore(os.cpus().length);

// ─────────────────────────────────────────────
// Manifest
// ─────────────────────────────────────────────

export function computeConfigHash(profile) {
  return createHash('sha256').update(JSON.stringify(profile)).digest('hex');
}

export async function loadManifest(manifestPath) {
  try {
    const data = await readFile(manifestPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { version: 1, configHash: '', posts: {} };
  }
}

export async function saveManifest(manifestPath, manifest) {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2));
}

export function hashFileContent(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
