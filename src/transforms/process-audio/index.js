import fs from 'node:fs';
import path from 'node:path';
import { mkdir, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { interpolatePath, resolvePath, mp3Presets } from '../../lib/index.js';

export default function processAudio(config, debug) {
  const preset = config.preset || 'balanced';
  const id3 = config.id3 || {};

  return async (send, packet) => {
    if (packet._cached) {
      send({ ...packet, audioResult: packet._cachedResults.audioResult });
      return;
    }

    const { files, postId } = packet;
    const vars = { ...packet, ...packet.postData };

    if (!files.audio || !fs.existsSync(files.audio) || debug.skipAudio) {
      console.log(`  [audio] ${postId}: No audio file`);
      send({ ...packet, audioResult: { skipped: true } });
      return;
    }

    const destPath = resolvePath(interpolatePath(config.dest, vars));

    // If output already exists, skip encoding (delete file to force rebuild)
    if (fs.existsSync(destPath)) {
      const outputStats = fs.statSync(destPath);
      console.log(`  [audio] ${postId}: exists ${(outputStats.size / 1024 / 1024).toFixed(1)}MB`);
      send({
        ...packet,
        audioResult: {
          success: true,
          path: destPath,
          url: interpolatePath(config.url, vars),
          size: outputStats.size
        }
      });
      return;
    }

    await mkdir(path.dirname(destPath), { recursive: true });

    const presetFn = mp3Presets[preset];
    if (!presetFn) {
      console.error(`  [audio] ${postId}: Unknown preset "${preset}"`);
      send({ ...packet, audioResult: { error: `Unknown preset: ${preset}` } });
      return;
    }

    try {
      const tmpPath = destPath + '.tmp';
      const args = presetFn(files.audio, tmpPath);

      // Append id3 metadata flags from profile config
      const insertAt = args.indexOf('-f');
      for (const [key, value] of Object.entries(id3)) {
        args.splice(insertAt, 0, '-metadata', `${key}=${value}`);
      }

      // Append id3 metadata derived from post.json
      const { postData, profile } = packet;
      const postMeta = {};
      if (postData.title) postMeta.title = postData.title;
      if (profile?.title && postData.chapter) postMeta.album = `${profile.title} Album #${postData.chapter}`;
      if (postData.date) { const y = new Date(postData.date).getFullYear(); if (!isNaN(y)) postMeta.year = String(y); }
      if (postData.id) { const parts = postData.id.split('-'); if (parts[1]) postMeta.track = parts[1]; }
      if (postData.summary) postMeta.comment = postData.summary;

      const insertAt2 = args.indexOf('-f');
      for (const [key, value] of Object.entries(postMeta)) {
        args.splice(insertAt2, 0, '-metadata', `${key}=${value}`);
      }

      let code, stderr = '';
      const ffmpeg = spawn('ffmpeg', args);
      ffmpeg.stderr.on('data', data => stderr += data.toString());
      [code] = await once(ffmpeg, 'close');

      if (code !== 0) {
        throw new Error(`FFmpeg exited with code ${code}: ${stderr}`);
      }

      await rename(tmpPath, destPath);

      const inputStats = fs.statSync(files.audio);
      const outputStats = fs.statSync(destPath);
      const reduction = ((1 - outputStats.size / inputStats.size) * 100).toFixed(1);

      console.log(`  [audio] ${postId}: ${(inputStats.size / 1024 / 1024).toFixed(1)}MB → ${(outputStats.size / 1024 / 1024).toFixed(1)}MB (${reduction}% smaller)`);

      send({
        ...packet,
        audioResult: {
          success: true,
          path: destPath,
          url: interpolatePath(config.url, vars),
          size: outputStats.size,
          reduction: parseFloat(reduction)
        }
      });
    } catch (err) {
      console.error(`  [audio] ${postId}: Error - ${err.message}`);
      send({ ...packet, audioResult: { error: err.message } });
    }
  };
}
