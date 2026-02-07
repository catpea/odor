// Blog Builder using Muriel Filtergraph Engine
import { flow } from '../../index.js';
import fs from 'node:fs';
import path from 'node:path';

import { setup, resolvePath, processedPosts, manifestUpdates, loadManifest, saveManifest, computeConfigHash } from './lib.js';

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
const baseDir = path.resolve(path.dirname(profileFullPath), '..');

setup(baseDir, profile);

// ─────────────────────────────────────────────
// Manifest
// ─────────────────────────────────────────────

const manifestPath = path.join(resolvePath(profile.dest), '.muriel-manifest.json');
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

console.log(`\nMuriel Blog Builder`);
console.log(`Profile: ${profile.profile}`);
console.log(`Title: ${profile.title}`);
console.log(`─────────────────────────────────────────────\n`);

const blog = flow([

  [ postScanner({ src: profile.src }, profile.debug), skipUnchanged(manifest), 'post' ],

  ['post',

    [
      processCover(profile.cover, profile.debug),
      processAudio(profile.audio, profile.debug),
      copyFiles()
    ],

    processText(), verifyPost(), collectPost(),

  'done'],

  ['done', [homepage(profile.pagerizer), pagerizer(profile.pagerizer), rssFeed()], useTheme({ ...profile.theme, dest: profile.dest }), 'finished'],

], { context: { profile } });

// ─────────────────────────────────────────────
// Completion
// ─────────────────────────────────────────────

blog.on('finished', async packet => {
  const allComplete = packet.branches?.every(b => b._complete);
  if (!allComplete) return;

  // Build new manifest from manifestUpdates + processedPosts results
  const newManifest = { version: 1, configHash, posts: {} };

  for (const [postId, update] of manifestUpdates) {
    const entry = {
      compositeHash: update.fingerprint.compositeHash,
      files: update.fingerprint.files,
    };

    if (update.results) {
      // Cached post — reuse stored results
      entry.results = update.results;
    } else {
      // Newly built post — find results from processedPosts
      const built = processedPosts.find(p => p.postId === postId);
      if (built) {
        // collectPost stores _coverResult, _audioResult, _textResult, _filesResult on processedPosts entries
        entry.results = {
          coverResult: built._coverResult || { skipped: true },
          audioResult: built._audioResult || { skipped: true },
          textResult: built._textResult || { skipped: true },
          filesResult: built._filesResult || { skipped: true },
          valid: built.valid,
          errors: built.errors,
          collectedPost: {
            postId: built.postId,
            guid: built.guid,
            valid: built.valid,
            errors: built.errors,
            postData: built.postData,
            coverUrl: built.coverUrl,
            audioUrl: built.audioUrl,
            permalinkUrl: built.permalinkUrl
          }
        };
      }
    }

    newManifest.posts[postId] = entry;
  }

  await saveManifest(manifestPath, newManifest);

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`Summary: ${processedPosts.length} posts processed`);

  const successful = processedPosts.filter(p => p.valid).length;
  const failed = processedPosts.filter(p => !p.valid).length;

  console.log(`  Successful: ${successful}`);
  console.log(`  Failed: ${failed}`);

  if (failed > 0) {
    console.log(`\nFailed posts:`);
    processedPosts.filter(p => !p.valid).forEach(p => {
      console.log(`  - ${p.postId}: ${p.errors.join(', ')}`);
    });
  }

  console.log(`─────────────────────────────────────────────\n`);
  blog.dispose();
});
