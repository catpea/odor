import fs from 'node:fs';
import path from 'node:path';
import { mkdir, rename } from 'node:fs/promises';
import sharp from 'sharp';
import { interpolatePath, resolvePath, atomicCopyFile } from '../../lib.js';

sharp.concurrency(1);

export default function processCover(config, debug) {

  const { width = 1024, height = 1024, quality = 80, effort = 4, exif = {} } = config;

  return async (send, packet) => {
    if (packet._cached) {
      send({ ...packet, coverResult: packet._cachedResults.coverResult });
      return;
    }

    const { files, postId } = packet;
    const vars = { ...packet, ...packet.postData };

    if (debug.skipCovers) {
      console.log(`  [cover] ${postId}: Skip cover image`);
      send({ ...packet, coverResult: { skipped: true } });
      return;
    }

    if (!files.cover || !fs.existsSync(files.cover)) {
      console.log(`  [cover] ${postId}: No cover image`);
      send({ ...packet, coverResult: { skipped: true } });
      return;
    }


    const destPath = resolvePath(interpolatePath(config.dest, vars));

    // If output already exists, skip encoding (delete file to force rebuild)
    if (fs.existsSync(destPath)) {
      const stats = fs.statSync(destPath);
      console.log(`  [cover] ${postId}: exists ${(stats.size / 1024).toFixed(1)}KB`);
      send({
        ...packet,
        coverResult: {
          success: true,
          path: destPath,
          url: interpolatePath(config.url, vars),
          size: stats.size
        }
      });
      return;
    }

    await mkdir(path.dirname(destPath), { recursive: true });

    try {
      if (files.cover.endsWith('.avif')) {
        // NOTE: do not compress/transform existing avi files as they may contain exotic things such as animation
        await atomicCopyFile(files.cover, destPath);
        console.log(`  [cover] ${postId}: copied (already AVIF)`);
      } else {
        const tmpPath = destPath + '.tmp';
        try {
          let pipeline = sharp(files.cover)
            .resize(width, height, { kernel: sharp.kernel.mitchell, fit: 'cover' })
            .avif({ quality, effort });
          if (Object.keys(exif).length > 0) {
            pipeline = pipeline.withExif(exif);
          }
          await pipeline.toFile(tmpPath);
        } catch (sharpErr) {
          if (sharpErr.message.includes('unsupported image format')) {
            console.log(`  [cover] ${postId}: sharp can't decode, copying as-is`);
            await atomicCopyFile(files.cover, destPath);
          } else {
            throw sharpErr;
          }
        }
        if (fs.existsSync(tmpPath)) await rename(tmpPath, destPath);
      }

      const stats = fs.statSync(destPath);
      console.log(`  [cover] ${postId}: ${(stats.size / 1024).toFixed(1)}KB → ${path.basename(destPath)}`);

      send({
        ...packet,
        coverResult: {
          success: true,
          path: destPath,
          url: interpolatePath(config.url, vars),
          size: stats.size
        }
      });
    } catch (err) {
      console.error(`  [cover] ${postId}: Error - ${err.message}`);
      send({ ...packet, coverResult: { error: err.message } });
    }
  };
}
