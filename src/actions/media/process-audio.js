import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, rename } from 'node:fs/promises';
import { resolvePath, interpolatePath } from '../../lib/paths.js';
import { mp3Presets } from '../../lib/audio-presets.js';

export const manifest = {
  name: 'process-audio',
  title: 'Process Audio',
  category: 'media',
  reads: ['post'],
  writes: ['post.audio'],
  queue: 'cpu',
  idempotent: true,
  retries: 1,
};

export async function handle({ ctx, frame, signal, log }) {
  signal.throwIfAborted();

  const post    = frame.local.get('post');
  const profile = ctx.context;
  const config  = profile.audio ?? {};
  const debug   = profile.debug ?? {};
  const respectExisting = String(profile.respectExisting?.audio) !== 'false';

  const { files, postId, postData, guid, chapter } = post;
  const vars = { ...profile, profile: profile.profile, ...postData, id: postId, guid, chapter };

  if (!files.audio || !fs.existsSync(files.audio) || debug.skipAudio) {
    console.log(`  [audio] ${postId}: No audio file`);
    return { skipped: true };
  }

  const destPath = resolvePath(ctx.context.baseDir, config.dest, vars);

  if (respectExisting && fs.existsSync(destPath)) {
    const stats = fs.statSync(destPath);
    console.log(`  [audio] ${postId}: exists ${(stats.size / 1024 / 1024).toFixed(1)}MB`);
    return {
      success: true,
      path:    path.relative(process.cwd(), destPath),
      url:     interpolatePath(config.url, vars),
      size:    stats.size,
    };
  }

  await mkdir(path.dirname(destPath), { recursive: true });

  const preset = config.preset || 'balanced';
  const id3    = config.id3 || {};
  const presetFn = mp3Presets[preset];

  if (!presetFn) {
    console.error(`  [audio] ${postId}: Unknown preset "${preset}"`);
    return { error: `Unknown preset: ${preset}` };
  }

  try {
    const tmpPath = `${destPath}.tmp`;
    const args = presetFn(files.audio, tmpPath);

    // Insert profile ID3 tags
    const insertAt = args.indexOf('-f');
    for (const [key, value] of Object.entries(id3)) {
      args.splice(insertAt, 0, '-metadata', `${key}=${value}`);
    }

    // Insert per-post ID3 metadata
    const postMeta = {};
    if (postData.title)  postMeta.title = postData.title;
    if (profile.title && postData.chapter) postMeta.album = `${profile.title} Album #${postData.chapter}`;
    if (postData.date) {
      const year = new Date(postData.date).getFullYear();
      if (!Number.isNaN(year)) postMeta.year = String(year);
    }
    if (postData.id) {
      const parts = postData.id.split('-');
      if (parts[1]) postMeta.track = parts[1];
    }

    const insertAt2 = args.indexOf('-f');
    for (const [key, value] of Object.entries(postMeta)) {
      args.splice(insertAt2, 0, '-metadata', `${key}=${value}`);
    }

    let stderr = '';
    const ffmpeg = spawn('ffmpeg', args);
    ffmpeg.stderr.on('data', d => { stderr += d.toString(); });
    const [code] = await once(ffmpeg, 'close');
    if (code !== 0) throw new Error(`FFmpeg exited ${code}: ${stderr}`);

    await rename(tmpPath, destPath);

    const inputStats  = fs.statSync(files.audio);
    const outputStats = fs.statSync(destPath);
    const reduction   = ((1 - outputStats.size / inputStats.size) * 100).toFixed(1);
    console.log(`  [audio] ${postId}: ${(inputStats.size / 1024 / 1024).toFixed(1)}MB -> ${(outputStats.size / 1024 / 1024).toFixed(1)}MB (${reduction}% smaller)`);

    return {
      success:   true,
      path:      path.relative(process.cwd(), destPath),
      url:       interpolatePath(config.url, vars),
      size:      outputStats.size,
      reduction: parseFloat(reduction),
    };
  } catch (err) {
    console.error(`  [audio] ${postId}: Error - ${err.message}`);
    return { error: err.message };
  }
}
