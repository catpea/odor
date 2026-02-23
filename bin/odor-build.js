#!/usr/bin/env node
import { run } from '../src/cli/build.js';
import { setDryRun } from '../src/lib/atomic.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const forcePosts = [];
const filtered = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') continue;
  if (args[i] === '--force-post' && args[i + 1]) {
    forcePosts.push(args[++i]);
  } else {
    filtered.push(args[i]);
  }
}

if (dryRun) setDryRun(true);
const code = await run(filtered, { dryRun, forcePosts });
process.exit(code);
