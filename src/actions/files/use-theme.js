import path from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import { atomicCopyFile } from '../../lib/atomic.js';
import { resolvePath, interpolatePath } from '../../lib/paths.js';

export const manifest = {
  name: 'use-theme',
  title: 'Install Theme',
  category: 'files',
  reads: ['context.theme'],
  writes: [],
  idempotent: true,
  retries: 0,
};

export async function handle({ ctx, signal, log }) {
  signal.throwIfAborted();

  const profile = ctx.context;
  const theme   = profile.theme ?? {};

  if (!theme.src || !theme.dest) {
    return { skipped: true, reason: 'no theme configured' };
  }

  const vars     = { ...profile, profile: profile.profile };
  const themeSrc = resolvePath(ctx.context.baseDir, theme.src, vars);
  const destDir  = resolvePath(ctx.context.baseDir, theme.dest, vars);

  try {
    const count = await copyRecursive(ctx, themeSrc, destDir);
    console.log(`  [theme] Installed ${count} file(s) from ${path.basename(themeSrc)}`);
    return { success: true, count };
  } catch (err) {
    console.error(`  [theme] Error - ${err.message}`);
    return { error: err.message };
  }
}

async function copyRecursive(ctx, src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += await copyRecursive(ctx, srcPath, destPath);
    } else {
      await atomicCopyFile(ctx, srcPath, destPath);
      count++;
    }
  }
  return count;
}
