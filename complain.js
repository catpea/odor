#!/usr/bin/env node

// Blog Builder using Muriel Filtergraph Engine
import { flow } from 'muriel';
import fs from 'node:fs';
import path from 'node:path';

import { setup, resolvePath, interpolatePath, processedPosts, manifestUpdates, loadManifest, saveManifest, computeConfigHash, requestShutdown } from './lib.js';

import postScanner   from './transforms/post-scanner/index.js';
import skipUnchanged from './transforms/skip-unchanged/index.js';
import processCover  from './transforms/process-cover/index.js';
import processAudio  from './transforms/process-audio/index.js';
import processText   from './transforms/process-text/index.js';
import copyFiles     from './transforms/copy-files/index.js';
import verifyPost    from './transforms/verify-post/index.js';
import collectPost   from './transforms/collect-post/index.js';
import homepage      from './transforms/homepage/index.js';
import pagerizer     from './transforms/pagerizer/index.js';
import rssFeed       from './transforms/rss-feed/index.js';
import useTheme      from './transforms/use-theme/index.js';
import gracefulShutdown from './transforms/graceful-shutdown/index.js';

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

const profilePath = process.argv[2];
if (!profilePath) {
  console.error('Usage: node blog.js <profile.json>');
  process.exit(1);
}

const profileFullPath = path.resolve(process.cwd(), profilePath);
const profile = JSON.parse(fs.readFileSync(profileFullPath, 'utf-8'));
const baseDir = path.resolve(path.dirname(profileFullPath));

setup(baseDir, profile);

// ─────────────────────────────────────────────
// Manifest
// ─────────────────────────────────────────────

const manifestPath = path.join(resolvePath(interpolatePath(profile.dest, { profile })), '.odor-manifest.json');
const manifest = await loadManifest(manifestPath);

const configHash = computeConfigHash(profile);
if (manifest.configHash && manifest.configHash !== configHash) {
  console.log(`Profile changed — full rebuild`);
  manifest.posts = {};
}
manifest.configHash = configHash;

// ─────────────────────────────────────────────
// Filtergraph
// ─────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\nShutdown requested — finishing in-flight work...');
  requestShutdown();
});

console.log(`\nMuriel Blog Sanity Checks`);
console.log(`Profile: ${profile.profile}`);
console.log(`Title: ${profile.title}`);
console.log(`─────────────────────────────────────────────\n`);

const blog = flow([

  [ postScanner({ src: profile.src, profile }, profile.debug),  'post' ],

  ['post',
    gracefulShutdown(),

    // src checks
    checkCoverImage({expectRatio: '1:1', minResolution: '1024x1024'}), // runs each check only complaining
    checkTooManyFiles({maxRecommended: 3}), // looks in the src ... files folder and counts all files, then complains

  'done'],

], { context: { profile } });
