import fs from 'node:fs';
import path from 'node:path';
import { mkdir, rename } from 'node:fs/promises';
import { atomicCopyFile } from '../../lib/atomic.js';
import { resolvePath, interpolatePath } from '../../lib/paths.js';

export const manifest = {
  name: 'process-cover',
  title: 'Process Cover',
  category: 'media',
  reads: ['post'],
  writes: ['post.cover'],
  queue: 'cpu',
  idempotent: true,
  retries: 1,
};

let sharpModule;

async function loadSharp() {
  if (!sharpModule) {
    sharpModule = await import('sharp');
    sharpModule.default.concurrency(1);
  }
  return sharpModule.default;
}

export async function handle({ ctx, frame, signal }) {
  signal.throwIfAborted();

  const post    = frame.local.get('post');
  const profile = ctx.context;
  const config  = profile.cover ?? {};
  const debug   = profile.debug ?? {};
  const respectExisting = String(profile.respectExisting?.cover) !== 'false';

  const { files, postId, postData, guid, chapter } = post;
  const vars = { ...profile, profile: profile.profile, ...postData, id: postId, guid, chapter };

  if (debug.skipCovers) {
    console.log(`  [cover] ${postId}: Skip cover image`);
    return { skipped: true };
  }

  if (!files.cover || !fs.existsSync(files.cover)) {
    console.log(`  [cover] ${postId}: No cover image`);
    return { skipped: true };
  }

  const destPath = resolvePath(ctx.context.baseDir, config.dest, vars);

  if (respectExisting && fs.existsSync(destPath)) {
    const stats = fs.statSync(destPath);
    console.log(`  [cover] ${postId}: exists ${(stats.size / 1024).toFixed(1)}KB`);
    return {
      success: true,
      path:    path.relative(process.cwd(), destPath),
      url:     interpolatePath(config.url, vars),
      size:    stats.size,
    };
  }

  await mkdir(path.dirname(destPath), { recursive: true });

  try {
    if (files.cover.endsWith('.avif')) {
      await atomicCopyFile(ctx, files.cover, destPath);
      console.log(`  [cover] ${postId}: copied (already AVIF)`);
    } else {
      const { width = 1024, height = 1024, quality = 80, effort = 4, exif = {} } = config;
      const tmpPath = `${destPath}.tmp`;

      try {
        const sharp = await loadSharp();
        let pipeline = sharp(files.cover)
          .resize(Number(width), Number(height), { kernel: sharp.kernel.mitchell, fit: 'cover' })
          .avif({ quality: Number(quality), effort: Number(effort) });
        if (Object.keys(exif).length > 0) pipeline = pipeline.withExif(exif);
        await pipeline.toFile(tmpPath);
      } catch (sharpErr) {
        if (sharpErr.message.includes('unsupported image format')) {
          console.log(`  [cover] ${postId}: sharp cannot decode, copying as-is`);
          await atomicCopyFile(ctx, files.cover, destPath);
        } else {
          throw sharpErr;
        }
      }

      if (fs.existsSync(tmpPath)) await rename(tmpPath, destPath);
    }

    const stats = fs.statSync(destPath);
    console.log(`  [cover] ${postId}: ${(stats.size / 1024).toFixed(1)}KB -> ${path.basename(destPath)}`);
    return {
      success: true,
      path:    path.relative(process.cwd(), destPath),
      url:     interpolatePath(config.url, vars),
      size:    stats.size,
    };
  } catch (err) {
    console.error(`  [cover] ${postId}: Error - ${err.message}`);
    return { error: err.message };
  }
}
