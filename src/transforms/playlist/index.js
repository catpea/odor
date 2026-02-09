import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { resolvePath, interpolatePath, atomicWriteFile } from '../../lib/index.js';

export default function playlist(config) {

  return async (send, packet) => {
    const posts = packet._collected;
    if (!posts) { send(packet); return; }

    const { profile } = posts[0];

    const validPosts = posts
      .filter(p => p.valid && p._audioResult?.success)
      .sort((a, b) => {
        const chA = parseInt(a.postData.chapter) || 0;
        const chB = parseInt(b.postData.chapter) || 0;
        if (chA !== chB) return chA - chB;
        return (a.postData.id || '').localeCompare(b.postData.id || '');
      });

    if (validPosts.length === 0) {
      console.log(`  [playlist] No audio posts found`);
      send({ _complete: true, playlistGenerated: false });
      return;
    }

    // Build entries from collected posts using post.json data
    const entries = validPosts.map(p => {
      const vars = { ...p, ...p.postData, profile };
      return {
        file: p._audioResult.path,
        url: interpolatePath(config.url, vars),
        title: p.postData.title || p.postId,
        duration: 0,
      };
    });

    // Main playlist (uses url pattern)
    const destPath = resolvePath(interpolatePath(config.dest, { profile }));
    await mkdir(path.dirname(destPath), { recursive: true });
    await atomicWriteFile(destPath, buildM3U(entries, 'url'));

    // Intermediate playlists (uses filenames only)
    if (config.intermediate) {
      const byDir = groupByDirectory(entries);
      for (const [dir, dirEntries] of byDir) {
        await atomicWriteFile(path.join(dir, 'playlist.m3u'), buildM3U(dirEntries, 'filename'));
      }
      console.log(`  [playlist] Generated main + ${byDir.size} intermediate playlist(s), ${entries.length} tracks`);
    } else {
      console.log(`  [playlist] Generated playlist with ${entries.length} tracks`);
    }

    send({ _complete: true, playlistGenerated: true, tracks: entries.length });
  };
}

// ─────────────────────────────────────────────
// M3U
// ─────────────────────────────────────────────

function buildM3U(entries, mode) {
  let m3u = '#EXTM3U\n';
  for (const entry of entries) {
    m3u += `\n#EXTINF:${entry.duration},${entry.title}\n`;
    if (mode === 'url') {
      m3u += `${entry.url}\n`;
    } else {
      m3u += `${path.basename(entry.file)}\n`;
    }
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
