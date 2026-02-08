import path from 'node:path';
import { readdir, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolvePath, interpolatePath, atomicWriteFile } from '../../lib.js';

export default function playlist(config) {
  let expectedTotal = null;
  const collected = [];

  return async (send, packet) => {
    if (packet._totalPosts !== undefined) {
      expectedTotal = packet._totalPosts;
    }

    collected.push(packet);

    if (expectedTotal !== null && collected.length >= expectedTotal) {
      const { profile } = packet;
      const srcPattern = resolvePath(interpolatePath(config.src, { profile }));
      const destPath = resolvePath(interpolatePath(config.dest, { profile }));

      const mp3Files = await matchGlob(srcPattern);

      if (mp3Files.length === 0) {
        console.log(`  [playlist] No MP3 files found`);
        send({ _complete: true, playlistGenerated: false });
        return;
      }

      const entries = [];
      for (const file of mp3Files) {
        const info = await probeFile(file);
        entries.push({ file, ...info });
      }

      // Main playlist
      await mkdir(path.dirname(destPath), { recursive: true });
      await atomicWriteFile(destPath, buildM3U(entries, path.dirname(destPath)));

      // Intermediate playlists (one per directory containing mp3s)
      if (config.intermediate) {
        const byDir = groupByDirectory(entries);
        for (const [dir, dirEntries] of byDir) {
          await atomicWriteFile(path.join(dir, 'playlist.m3u'), buildM3U(dirEntries, dir));
        }
        console.log(`  [playlist] Generated main + ${byDir.size} intermediate playlist(s), ${entries.length} tracks`);
      } else {
        console.log(`  [playlist] Generated playlist with ${entries.length} tracks`);
      }

      send({ _complete: true, playlistGenerated: true, tracks: entries.length });
    } else {
      send({ _complete: false });
    }
  };
}

// ─────────────────────────────────────────────
// Glob
// ─────────────────────────────────────────────

async function matchGlob(pattern) {
  const parts = pattern.split(path.sep);
  const fixedParts = [];
  const globParts = [];
  let hitWild = false;
  for (const part of parts) {
    if (!hitWild && !part.includes('*')) {
      fixedParts.push(part);
    } else {
      hitWild = true;
      globParts.push(part);
    }
  }

  const baseDir = fixedParts.join(path.sep) || path.sep;
  const globStr = globParts.join('/');
  const regexStr = globStr
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*');
  const regex = new RegExp('^' + regexStr + '$');

  let entries;
  try {
    entries = await readdir(baseDir, { recursive: true });
  } catch {
    return [];
  }

  return entries
    .filter(f => regex.test(f.split(path.sep).join('/')))
    .map(f => path.join(baseDir, f))
    .sort();
}

// ─────────────────────────────────────────────
// Probe
// ─────────────────────────────────────────────

async function probeFile(filePath) {
  try {
    const proc = spawn('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_format', filePath
    ]);
    let stdout = '';
    proc.stdout.on('data', d => stdout += d);
    const [code] = await once(proc, 'close');

    if (code !== 0) return { duration: 0, title: path.basename(filePath, '.mp3') };

    const info = JSON.parse(stdout);
    const duration = Math.round(parseFloat(info.format?.duration || '0'));
    const title = info.format?.tags?.title || path.basename(filePath, '.mp3');
    return { duration, title };
  } catch {
    return { duration: 0, title: path.basename(filePath, '.mp3') };
  }
}

// ─────────────────────────────────────────────
// M3U
// ─────────────────────────────────────────────

function buildM3U(entries, playlistDir) {
  let m3u = '#EXTM3U\n';
  for (const entry of entries) {
    const rel = path.relative(playlistDir, entry.file);
    m3u += `\n#EXTINF:${entry.duration},${entry.title}\n`;
    m3u += `${rel}\n`;
  }
  return m3u;
}

function groupByDirectory(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const dir = path.dirname(entry.file);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(entry);
  }
  return groups;
}
