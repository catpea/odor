// Interactive AI Agent for Blog Posts
import { flow } from 'muriel';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execSync } from 'node:child_process';

import { setup, requestShutdown, gate } from '../lib/index.js';

import postScanner      from '../transforms/post-scanner/index.js';
import gracefulShutdown from '../transforms/graceful-shutdown/index.js';
import agentTask        from '../agents/agent-task.js';

// Exit codes
const EXIT_SUCCESS = 0;
const EXIT_FATAL   = 2;

export async function run(args) {
  // ─────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────

  const profilePath = args[0];
  if (!profilePath) {
    console.error('Usage: odor-agent <profile.json> [task-name]');
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

  if (!profile.agent) {
    console.error('Error: profile.agent config is missing');
    return EXIT_FATAL;
  }

  const agentConfig = profile.agent;
  const { url, model, system, yolo = false, tasks = [] } = agentConfig;

  if (!url || !model || !tasks.length) {
    console.error('Error: profile.agent must have url, model, and tasks');
    return EXIT_FATAL;
  }

  // Optional task filter
  const taskFilter = args[1];
  const selectedTasks = taskFilter
    ? tasks.filter(t => t.name === taskFilter)
    : tasks;

  if (selectedTasks.length === 0) {
    console.error(`Error: no task found matching "${taskFilter}"`);
    console.error(`Available tasks: ${tasks.map(t => t.name).join(', ')}`);
    return EXIT_FATAL;
  }

  // ─────────────────────────────────────────────
  // SIGINT
  // ─────────────────────────────────────────────

  process.on('SIGINT', () => {
    console.log('\nShutdown requested — finishing in-flight work...');
    requestShutdown();
  });

  // ─────────────────────────────────────────────
  // Run Tasks
  // ─────────────────────────────────────────────

  console.log(`\nOdor Agent`);
  console.log(`Profile: ${profile.profile}`);
  console.log(`Model: ${model}`);
  console.log(`Mode: ${yolo ? 'yolo (auto-accept)' : 'interactive'}`);
  console.log(`Tasks: ${selectedTasks.map(t => t.name).join(', ')}`);
  console.log(`─────────────────────────────────────────────\n`);

  const allStats = [];

  function runTask(task) {
    return new Promise((resolve, reject) => {
      const rl = yolo ? null : readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const stats = { name: task.name, accepted: 0, rejected: 0, retries: 0, errors: 0, total: 0 };
      let postsProcessed = 0;

      const apiGate = gate(1);

      const blog = flow([

        [ postScanner({ src: profile.src, profile }, profile.debug), 'post' ],

        ['post',
          gracefulShutdown(),
          apiGate(agentTask({
            name: task.name,
            prompt: task.prompt,
            target: task.target,
            url, model, system, yolo, rl,
          })),
        'done'],

      ], { context: { profile } });

      blog.on('done', packet => {
        postsProcessed++;

        const r = packet._agentResult;
        if (r) {
          stats.total++;
          if (r.accepted) stats.accepted++;
          if (r.rejected) stats.rejected++;
          stats.retries += r.retries;
          if (r.error) stats.errors++;
        }

        if (packet._abort) {
          if (rl) rl.close();
          blog.dispose();
          resolve(stats);
          return;
        }

        if (postsProcessed >= packet._totalPosts) {
          if (rl) rl.close();
          blog.dispose();
          resolve(stats);
        }
      });
    });
  }

  // Run tasks sequentially
  for (const task of selectedTasks) {
    console.log(`\n── Task: ${task.name} ──`);
    const stats = await runTask(task);
    allStats.push(stats);
  }

  // ─────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`Agent Summary`);
  console.log(`─────────────────────────────────────────────`);

  let totalAccepted = 0;
  for (const s of allStats) {
    console.log(`  ${s.name}: ${s.accepted} accepted, ${s.rejected} rejected, ${s.retries} retries, ${s.errors} errors (${s.total} posts)`);
    totalAccepted += s.accepted;
  }

  console.log(`─────────────────────────────────────────────\n`);

  // ─────────────────────────────────────────────
  // Optional Git Commit
  // ─────────────────────────────────────────────

  if (totalAccepted > 0 && !yolo) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => rl.question('Commit changes? (y/n) > ', resolve));
    rl.close();

    if (answer.trim().toLowerCase() === 'y') {
      try {
        const profileFullPath = path.resolve(process.cwd(), profilePath);
        const baseDir = path.resolve(path.dirname(profileFullPath));
        execSync('git add -A && git commit -m "odor-agent: apply AI edits"', {
          cwd: baseDir,
          stdio: 'inherit',
        });
      } catch (err) {
        console.error('Git commit failed:', err.message);
      }
    }
  }

  return EXIT_SUCCESS;
}
