import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { atomicWriteFile } from '../../lib/atomic.js';
import { resolvePath, interpolatePath } from '../../lib/paths.js';

export const manifest = {
  name: 'playlist',
  title: 'Generate Playlist',
  category: 'site',
  reads: ['posts.rendered', 'posts.cached'],
  writes: [],
  queue: 'files',
  idempotent: true,
  retries: 0,
};

export async function handle({ ctx, store, signal }) {
  signal.throwIfAborted();

  const profile  = ctx.context;
  const config   = profile.playlist;

  if (!config) return { skipped: true };

  const rendered = store.get('posts.rendered') ?? [];
  const cached   = store.get('posts.cached')   ?? [];
  const allPosts = [...rendered, ...cached];
  const vars     = { ...profile, profile: profile.profile };

  const validPosts = allPosts
    .filter(p => p.valid && p._audioResult?.success)
    .sort((a, b) => {
      const chA = parseInt(a.postData.chapter) || 0;
      const chB = parseInt(b.postData.chapter) || 0;
      if (chA !== chB) return chA - chB;
      return (a.postData.id || '').localeCompare(b.postData.id || '');
    });

  if (validPosts.length === 0) {
    console.log('  [playlist] No audio posts found');
    return { skipped: true };
  }

  const entries = validPosts.map(post => {
    const postVars = { ...vars, ...post.postData, id: post.postId, guid: post.guid, chapter: post.chapter };
    return {
      file:     post._audioResult.path,
      url:      interpolatePath(config.url, postVars),
      title:    post.postData.title || post.postId,
      duration: 0,
    };
  });

  const destPath = resolvePath(ctx.context.baseDir, config.dest, vars);
  await mkdir(path.dirname(destPath), { recursive: true });
  await atomicWriteFile(ctx, destPath, buildM3U(entries, 'url'));

  if (String(config.intermediate) === 'true') {
    const byDir = groupByDirectory(entries);
    for (const [dir, dirEntries] of byDir) {
      await atomicWriteFile(ctx, path.join(dir, 'playlist.m3u'), buildM3U(dirEntries, 'filename'));
    }
    console.log(`  [playlist] Generated main + ${byDir.size} intermediate playlist(s), ${entries.length} tracks`);
  } else {
    console.log(`  [playlist] Generated playlist with ${entries.length} tracks`);
  }

  return { success: true, tracks: entries.length };
}

function buildM3U(entries, mode) {
  let m3u = '#EXTM3U\n';
  for (const entry of entries) {
    m3u += `\n#EXTINF:${entry.duration},${entry.title}\n`;
    m3u += mode === 'url' ? `${entry.url}\n` : `${path.basename(entry.file)}\n`;
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
