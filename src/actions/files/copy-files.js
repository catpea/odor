import fs from 'node:fs';
import path from 'node:path';
import { cp, mkdir, readdir } from 'node:fs/promises';
import { resolvePath } from '../../lib/paths.js';

export const manifest = {
  name: 'copy-files',
  title: 'Copy Post Files',
  category: 'files',
  reads: ['post'],
  writes: ['post.filesResult'],
  queue: 'files',
  idempotent: true,
  retries: 0,
};

export async function handle({ ctx, frame, signal }) {
  signal.throwIfAborted();

  const post    = frame.local.get('post');
  const profile = ctx.context;
  const { files, postId, postData, guid, chapter } = post;
  const vars = { ...profile, profile: profile.profile, ...postData, id: postId, guid, chapter };

  if (!fs.existsSync(files.filesDir)) {
    return { skipped: true, reason: 'no files dir' };
  }

  try {
    const destDir = resolvePath(ctx.context.baseDir, `${profile.dest}/permalink/${guid}/files`, vars);

    if (ctx.dryRun) {
      const count = await countFilesRecursive(files.filesDir);
      ctx.dryRunCount += count;
      console.log(`  [dry-run] would copy ${count} file(s): ${files.filesDir} -> ${destDir}`);
      return { success: true, count, destDir };
    }

    await mkdir(destDir, { recursive: true });
    await cp(files.filesDir, destDir, { recursive: true });

    const count = await countFilesRecursive(files.filesDir);
    console.log(`  [files] ${postId}: Copied ${count} file(s)`);
    return { success: true, count, destDir };
  } catch (err) {
    console.error(`  [files] ${postId}: Error - ${err.message}`);
    return { error: err.message };
  }
}

async function countFilesRecursive(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter(e => e.isFile()).length;
}
