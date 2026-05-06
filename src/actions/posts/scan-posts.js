import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { resolvePath, interpolatePath } from '../../lib/paths.js';

export const manifest = {
  name: 'scan-posts',
  title: 'Scan Posts',
  category: 'posts',
  reads: ['context.src'],
  writes: ['posts.scanned'],
  idempotent: true,
  retries: 0,
};

export async function handle({ ctx, signal, log }) {
  signal.throwIfAborted();

  const profile = ctx.context;
  const vars = { ...profile, profile: profile.profile };
  const srcDir = resolvePath(ctx.context.baseDir, profile.src, vars);

  log.info(`Scanning: ${path.relative(process.cwd(), srcDir) || '.'}`);

  const entries = await readdir(srcDir, { withFileTypes: true });
  const postDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

  const posts = [];

  for (const postId of postDirs) {
    const postDir = path.join(srcDir, postId);
    const dirFiles = await readdir(postDir);

    if (!dirFiles.includes('post.json')) {
      console.log(`  Skipping ${postId}: no post.json`);
      continue;
    }

    const postData = JSON.parse(await readFile(path.join(postDir, 'post.json'), 'utf-8'));
    const cover = dirFiles.find(f => f.startsWith('cover.'));
    const audio = dirFiles.find(f => f.startsWith('audio.'));

    posts.push({
      postId,
      postDir,
      postData,
      guid:    postData.guid,
      chapter: postData.chapter,
      files: {
        cover:    cover ? path.join(postDir, cover) : null,
        audio:    audio ? path.join(postDir, audio) : null,
        text:     path.join(postDir, 'text.md'),
        filesDir: path.join(postDir, 'files'),
      },
    });
  }

  // Apply debug filters if configured
  const debug = profile.debug ?? {};
  let selected = posts;
  if (debug.processOnly?.length) {
    const allowed = new Set(debug.processOnly);
    selected = posts.filter(p => allowed.has(p.postId));
  } else if (debug.mostRecent) {
    selected = posts.slice(posts.length - debug.mostRecent);
  }

  console.log(`  Found ${selected.length} posts`);
  return selected;
}
