#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const subcommands = [
  { bin: 'odor-build.js',  name: 'odor-build',  args: '<profile.json> [--dry-run]', desc: 'Build the blog' },
  { bin: 'odor-status.js', name: 'odor-status', args: '<profile.json>',             desc: 'Check posts for problems' },
  { bin: 'odor-agent.js',  name: 'odor-agent',  args: '<profile.json> [task-name]', desc: 'Run AI tasks on posts' },
  { bin: 'odor-server.js', name: 'odor-server', args: '<profile.json> [--https]',   desc: 'Preview the built site' },
];

console.log(`\nOdor — Static Blog Generator\n`);
console.log(`Commands:`);

for (const cmd of subcommands) {
  const exists = fs.existsSync(path.join(__dirname, cmd.bin));
  const warning = exists ? '' : '  (missing!)';
  console.log(`  ${cmd.name}  ${cmd.args.padEnd(26)} ${cmd.desc}${warning}`);
}

console.log(`\nRun any command without arguments for detailed help.\n`);
