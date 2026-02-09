#!/usr/bin/env node

// Sanity Checks for the Post Database
import { flow } from 'muriel';
import fs from 'node:fs';
import path from 'node:path';

import { setup, requestShutdown } from './lib.js';

import postScanner      from './transforms/post-scanner/index.js';
import gracefulShutdown from './transforms/graceful-shutdown/index.js';

import checkPostJson    from './checks/check-post-json.js';
import checkCoverImage  from './checks/check-cover-image.js';
import checkTooManyFiles from './checks/check-too-many-files.js';

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

const profilePath = process.argv[2];
if (!profilePath) {
  console.error('Usage: odor-complaint <profile.json>');
  process.exit(1);
}

const profileFullPath = path.resolve(process.cwd(), profilePath);
const profile = JSON.parse(fs.readFileSync(profileFullPath, 'utf-8'));
const baseDir = path.resolve(path.dirname(profileFullPath));

setup(baseDir, profile);

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

console.log(`\nOdor Complaint Desk`);
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
  }
});
