import fs from 'node:fs';
import path from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { marked } from 'marked';

export default function analyzePost() {
  return async (send, packet) => {
    const { postId, postDir, postData, files } = packet;

    try {
      const analysis = {};

      // ── Word count + Featured URLs ──
      if (fs.existsSync(files.text)) {
        const markdown = await readFile(files.text, 'utf-8');
        const words = markdown.split(/\s+/).filter(Boolean);
        analysis.wordCount = words.length;

        const html = marked(markdown);
        const linkRegex = /<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        const seen = new Set();
        const featuredUrls = [];
        let m;
        while ((m = linkRegex.exec(html)) !== null) {
          const url = m[1].replace(/&amp;/g, '&');
          if (!url || seen.has(url)) continue;
          seen.add(url);
          const text = m[2].replace(/<[^>]*>/g, '').trim() || url;
          featuredUrls.push({ text, url });
        }
        analysis.featuredUrls = featuredUrls;
      }

      // ── Audio duration ──
      if (files.audio) {
        try {
          const seconds = await getAudioDuration(files.audio);
          analysis.audioDuration = formatDuration(seconds);
        } catch {
          // no audio duration — omit field
        }
      }

      // ── Files by extension ──
      if (fs.existsSync(files.filesDir)) {
        const filesByExt = await countFilesByExtension(files.filesDir);
        if (Object.keys(filesByExt).length > 0) {
          analysis.files = filesByExt;
        }
      }

      // ── Write-back ──
      const existing = postData.analysis;
      if (JSON.stringify(existing) === JSON.stringify(analysis)) {
        console.log(`  [analyze] ${postId}: unchanged`);
        send({ ...packet, _analyzeResult: { updated: false } });
        return;
      }

      postData.analysis = analysis;
      const postJsonPath = path.join(postDir, 'post.json');
      await writeFile(postJsonPath, JSON.stringify(postData, null, 2) + '\n');
      console.log(`  [analyze] ${postId}: updated`);
      send({ ...packet, _analyzeResult: { updated: true } });

    } catch (err) {
      console.error(`  [analyze] ${postId}: Error - ${err.message}`);
      send({ ...packet, _analyzeResult: { error: err.message } });
    }
  };
}

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
      if (Number.isNaN(seconds)) return reject(new Error('Invalid duration'));
      resolve(seconds);
    });
  });
}

export function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':');
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
