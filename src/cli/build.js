// Blog Builder using Muriel Filtergraph Engine
import { flow } from 'muriel';
import fs from 'node:fs';
import path from 'node:path';

import os from 'node:os';
import { setup, resolvePath, interpolatePath, loadManifest, saveManifest, computeConfigHash, requestShutdown } from '../lib/index.js';
import { getDryRunCount } from '../lib/atomic.js';
import { queue } from '../queue/index.js';
import { accumulate } from '../kit/index.js';

import postScanner   from '../transforms/post-scanner/index.js';
import skipUnchanged from '../transforms/skip-unchanged/index.js';
import processCover  from '../transforms/process-cover/index.js';
import processAudio  from '../transforms/process-audio/index.js';
import processText   from '../transforms/process-text/index.js';
import copyFiles     from '../transforms/copy-files/index.js';
import verifyPost    from '../transforms/verify-post/index.js';
import collectPost   from '../transforms/collect-post/index.js';
import homepage      from '../transforms/homepage/index.js';
import pagerizer     from '../transforms/pagerizer/index.js';
import rssFeed       from '../transforms/rss-feed/index.js';
import useTheme      from '../transforms/use-theme/index.js';
import playlist      from '../transforms/playlist/index.js';
import gracefulShutdown from '../transforms/graceful-shutdown/index.js';

// Exit codes
const EXIT_SUCCESS = 0;
const EXIT_PARTIAL = 1;
const EXIT_FATAL   = 2;

export async function run(args, { dryRun = false } = {}) {
  // ─────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────

  const profilePath = args[0];
  if (!profilePath) {
    console.error('Usage: odor-build <profile.json> [--dry-run]');
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

  console.log(`\nMuriel Blog Builder${dryRun ? ' (dry run)' : ''}`);
  console.log(`Profile: ${profile.profile}`);
  console.log(`Title: ${profile.title}`);
  console.log(`─────────────────────────────────────────────\n`);

  const encodingQueue = queue('encoding', { capacity: os.cpus().length });

  // Capture collected posts for manifest building (closure-scoped, not a global)
  let collectedPosts = [];

  const blog = flow([

    [ postScanner({ src: profile.src, profile }, profile.debug), skipUnchanged({...profile.skip, manifest}), 'post' ],

    ['post',

      gracefulShutdown(),

      [
        encodingQueue.wrap(processCover(profile.cover, profile.debug, { respectExisting: profile.respectExisting?.cover ?? true })),
        encodingQueue.wrap(processAudio(profile.audio, profile.debug, { respectExisting: profile.respectExisting?.audio ?? true })),
        copyFiles()
      ],

      processText(), verifyPost(), collectPost(),

      accumulate(),

    'build'],

    ['build',

      (send, packet) => { collectedPosts = packet._collected || []; send(packet); },

      [
        homepage(profile.pagerizer),
        pagerizer(profile.pagerizer),
        rssFeed(),
        playlist(profile.playlist)
      ],

      useTheme({ ...profile.theme, dest: profile.dest, profile }),
    'finished'],

  ], { context: { profile } });

  // ─────────────────────────────────────────────
  // Completion
  // ─────────────────────────────────────────────

  return new Promise(resolve => {
    blog.on('finished', async packet => {
      const allComplete = packet.branches?.every(b => b._complete);
      if (!allComplete) return;

      // Build new manifest from collected packets
      const newManifest = { version: 1, configHash, posts: {} };

      for (const post of collectedPosts) {
        const update = post._manifestUpdate;
        if (!update) continue;

        const entry = {
          compositeHash: update.fingerprint.compositeHash,
          files: update.fingerprint.files,
        };

        if (update.results) {
          // Cached post — reuse stored results
          entry.results = update.results;
        } else {
          // Newly built post — results are on the packet
          entry.results = {
            coverResult: post._coverResult || { skipped: true },
            audioResult: post._audioResult || { skipped: true },
            textResult: post._textResult || { skipped: true },
            filesResult: post._filesResult || { skipped: true },
            valid: post.valid,
            errors: post.errors,
            collectedPost: {
              postId: post.postId,
              guid: post.guid,
              valid: post.valid,
              errors: post.errors,
              postData: post.postData,
              coverUrl: post.coverUrl,
              audioUrl: post.audioUrl,
              permalinkUrl: post.permalinkUrl
            }
          };
        }

        newManifest.posts[post.postId] = entry;
      }

      if (!dryRun) {
        await saveManifest(manifestPath, newManifest);
      }

      const processed = collectedPosts.filter(p => !p._cached);
      const cached = collectedPosts.filter(p => p._cached);

      console.log(`\n─────────────────────────────────────────────`);
      console.log(`Summary: ${collectedPosts.length} posts (${processed.length} built, ${cached.length} cached)`);

      const successful = processed.filter(p => p.valid).length;
      const failed = processed.filter(p => !p.valid).length;

      console.log(`  Successful: ${successful}`);
      console.log(`  Failed: ${failed}`);

      if (failed > 0) {
        console.log(`\nFailed posts:`);
        processed.filter(p => !p.valid).forEach(p => {
          console.log(`  - ${p.postId}: ${p.errors.join(', ')}`);
        });
      }

      if (dryRun) {
        console.log(`\nDry run: ${getDryRunCount()} file(s) would be written`);
      }

      console.log(`─────────────────────────────────────────────\n`);
      blog.dispose();

      resolve(failed > 0 ? EXIT_PARTIAL : EXIT_SUCCESS);
    });
  });
}
