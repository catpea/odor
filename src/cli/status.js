// Sanity Checks for the Post Database
import { flow } from 'muriel';
import fs from 'node:fs';
import path from 'node:path';

import { setup, requestShutdown } from '../lib/index.js';

import postScanner      from '../transforms/post-scanner/index.js';
import gracefulShutdown from '../transforms/graceful-shutdown/index.js';

import checkPostJson    from '../checks/check-post-json.js';
import checkCoverImage  from '../checks/check-cover-image.js';
import checkTooManyFiles from '../checks/check-too-many-files.js';

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
    console.error('Usage: odor-status <profile.json>');
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
    console.log('\nShutdown requested — finishing in-flight checks...');
    requestShutdown();
  });

  // ─────────────────────────────────────────────
  // Checks
  // ─────────────────────────────────────────────

  console.log(`\nOdor Status`);
  console.log(`Profile: ${profile.profile}`);
  console.log(`─────────────────────────────────────────────\n`);

  const blog = flow([

    [ postScanner({ src: profile.src, profile }, profile.debug), 'post' ],

    ['post',
      gracefulShutdown(),

      // src checks
      checkPostJson(),
      checkCoverImage({expectRatio: '1:1', minResolution: '1024x1024'}),
      checkTooManyFiles({maxRecommended: 3}),

    'done'],

  ], { context: { profile } });

  // ─────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────

  return new Promise(resolve => {
    let totalComplaints = 0;
    let postsWithComplaints = 0;
    let postsChecked = 0;

    blog.on('done', packet => {
      postsChecked++;

      if (packet._complaints?.length) {
        postsWithComplaints++;
        totalComplaints += packet._complaints.length;
        console.log(`${packet.postId}:`);
        for (const c of packet._complaints) {
          console.log(`  ${c}`);
        }
      }

      if (postsChecked >= packet._totalPosts) {
        console.log(`\n─────────────────────────────────────────────`);
        console.log(`${totalComplaints} complaint(s) in ${postsWithComplaints} of ${postsChecked} posts`);
        console.log(`─────────────────────────────────────────────\n`);
        blog.dispose();

        resolve(totalComplaints > 0 ? EXIT_PARTIAL : EXIT_SUCCESS);
      }
    });
  });
}
