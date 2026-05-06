import fs from 'node:fs';
import path from 'node:path';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';

export const manifest = {
  name: 'analyze-post',
  title: 'Analyze Post',
  category: 'posts',
  reads: ['post'],
  writes: ['post.analysis'],
  idempotent: false,
  retries: 0,
};

export async function handle({ frame, signal, log }) {
  signal.throwIfAborted();

  const post = frame.local.get('post');
  const { postId, postDir, postData, files } = post;

  try {
    // Skip if analysis is current (post.json newer than all inputs)
    if (postData.analysis) {
      const postJsonMtime = (await stat(path.join(postDir, 'post.json'))).mtimeMs;
      const inputMtimes = [];
      if (fs.existsSync(files.text))                 inputMtimes.push((await stat(files.text)).mtimeMs);
      if (files.audio && fs.existsSync(files.audio)) inputMtimes.push((await stat(files.audio)).mtimeMs);
      if (fs.existsSync(files.filesDir))             inputMtimes.push((await stat(files.filesDir)).mtimeMs);

      if (inputMtimes.length > 0 && inputMtimes.every(mt => mt <= postJsonMtime)) {
        console.log(`  [analyze] ${postId}: unchanged`);
        return { updated: false };
      }
    }

    const analysis = {};

    if (fs.existsSync(files.text)) {
      const markdown = await readFile(files.text, 'utf-8');
      analysis.wordCount = markdown.split(/\s+/).filter(Boolean).length;

      const { marked } = await import('marked');
      const html = marked(markdown);
      const linkRegex = /<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      const seen = new Set();
      const featuredUrls = [];
      let m;
      while ((m = linkRegex.exec(html)) !== null) {
        const url = m[1].replace(/&amp;/g, '&');
        if (!url || seen.has(url)) continue;
        seen.add(url);
        featuredUrls.push({ text: m[2].replace(/<[^>]*>/g, '').trim() || url, url });
      }
      analysis.featuredUrls = featuredUrls;
    }

    if (files.audio && fs.existsSync(files.audio)) {
      try {
        analysis.audioDuration = formatDuration(await getAudioDuration(files.audio));
      } catch { /* ffprobe not available or no audio */ }
    }

    if (fs.existsSync(files.filesDir)) {
      analysis.exts  = await countFilesByExtension(files.filesDir);
      analysis.files = await listRootFiles(files.filesDir);
    }

    if (JSON.stringify(postData.analysis) === JSON.stringify(analysis)) {
      console.log(`  [analyze] ${postId}: unchanged`);
      return { updated: false };
    }

    postData.analysis = analysis;
    await writeFile(path.join(postDir, 'post.json'), JSON.stringify(postData, null, 2) + '\n');
    console.log(`  [analyze] ${postId}: updated`);
    return { updated: true };

  } catch (err) {
    console.error(`  [analyze] ${postId}: ${err.message}`);
    return { error: err.message };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      audioPath,
    ], (err, stdout) => {
      if (err) return reject(err);
      const seconds = parseFloat(stdout.trim());
      if (Number.isNaN(seconds)) return reject(new Error('bad duration'));
      resolve(seconds);
    });
  });
}

function formatDuration(totalSeconds) {
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = Math.floor(totalSeconds % 60);
  return [hh, mm, ss].map(n => String(n).padStart(2, '0')).join(':');
}

async function countFilesByExtension(dir) {
  const counts = {};
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).slice(1).toLowerCase();
    if (ext) counts[ext] = (counts[ext] || 0) + 1;
  }
  return counts;
}

async function listRootFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter(e => e.isFile()).map(e => e.name);
}
