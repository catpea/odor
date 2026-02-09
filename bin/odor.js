#!/usr/bin/env node
import { run } from '../src/cli/build.js';
import { setDryRun } from '../src/lib/atomic.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const filtered = args.filter(a => a !== '--dry-run');

if (dryRun) setDryRun(true);
const code = await run(filtered, { dryRun });
process.exit(code);
