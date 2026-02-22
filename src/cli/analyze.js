// Post Metadata Analysis
import { flow } from 'muriel';
import fs from 'node:fs';
import path from 'node:path';

import { setup, requestShutdown } from '../lib/index.js';

import postScanner      from '../transforms/post-scanner/index.js';
import gracefulShutdown from '../transforms/graceful-shutdown/index.js';
import analyzePost      from '../transforms/analyze-post/index.js';

// Exit codes
const EXIT_SUCCESS = 0;
const EXIT_PARTIAL = 1;
const EXIT_FATAL   = 2;

export async function run(args) {
  // ─────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────

  const profilePath = args[0];
  if (!profilePath) {
    console.error('Usage: odor-analyze <profile.json>');
    return EXIT_FATAL;
  }

  let profile;
  try {
    const profileFullPath = path.resolve(process.cwd(), profilePath);
    profile = JSON.parse(fs.readFileSync(profileFullPath, 'utf-8'));
    const baseDir = path.resolve(path.dirname(profileFullPath));
    setup(baseDir, profile);
  } catch (err) {
    console.error(`Fatal: ${err.message}`);
    return EXIT_FATAL;
  }

  // ─────────────────────────────────────────────
  // SIGINT
  // ─────────────────────────────────────────────

  process.on('SIGINT', () => {
    console.log('\nShutdown requested — finishing in-flight analysis...');
    requestShutdown();
  });

  // ─────────────────────────────────────────────
  // Analysis
  // ─────────────────────────────────────────────

  console.log(`\nOdor Analyze`);
  console.log(`Profile: ${profile.profile}`);
  console.log(`─────────────────────────────────────────────\n`);

  const blog = flow([

    [ postScanner({ src: profile.src, profile }, profile.debug), 'post' ],

    ['post',
      gracefulShutdown(),
      analyzePost(),
    'done'],

  ], { context: { profile } });

  // ─────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────

  return new Promise(resolve => {
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    let postsProcessed = 0;

    blog.on('done', packet => {
      postsProcessed++;

      if (packet._analyzeResult?.updated) updated++;
      else if (packet._analyzeResult?.error) errors++;
      else skipped++;

      if (postsProcessed >= packet._totalPosts) {
        console.log(`\n─────────────────────────────────────────────`);
        console.log(`${updated} updated, ${skipped} unchanged, ${errors} error(s) — ${postsProcessed} posts`);
        console.log(`─────────────────────────────────────────────\n`);
        blog.dispose();

        resolve(errors > 0 ? EXIT_PARTIAL : EXIT_SUCCESS);
      }
    });
  });
}
