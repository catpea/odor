// Interactive AI Agent for Blog Posts
import { flow } from 'muriel';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execSync } from 'node:child_process';

import { setup, requestShutdown, gate } from '../lib/index.js';
import { loadLessons } from '../agents/lessons.js';

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
  let profileDir;
  try {
    const profileFullPath = path.resolve(process.cwd(), profilePath);
    profile = JSON.parse(fs.readFileSync(profileFullPath, 'utf-8'));
    profileDir = path.resolve(path.dirname(profileFullPath));
    setup(profileDir, profile);
  } catch (err) {
    console.error(`Fatal: ${err.message}`);
    return EXIT_FATAL;
  }

  if (!profile.agent) {
    console.error('Error: profile.agent config is missing');
    return EXIT_FATAL;
  }

  const agentConfig = profile.agent;
  const { url, model, system, yolo = false, contextSize, tasks = [] } = agentConfig;

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
  // Wait for API server
  // ─────────────────────────────────────────────

  await waitForServer(url);

  // ─────────────────────────────────────────────
  // Lessons preload
  // ─────────────────────────────────────────────

  const lessons = await loadLessons(profileDir);

  // ─────────────────────────────────────────────
  // SIGINT — Triple CTRL-C
  // ─────────────────────────────────────────────

  const abortController = new AbortController();
  const sigintTimestamps = [];

  process.on('SIGINT', () => {
    const now = Date.now();
    // Clean entries older than 1 second
    while (sigintTimestamps.length > 0 && now - sigintTimestamps[0] > 1000) {
      sigintTimestamps.shift();
    }
    sigintTimestamps.push(now);

    if (sigintTimestamps.length === 1) {
      console.log('\nShutdown requested — press two more times to terminate');
      requestShutdown();
      abortController.abort();
    } else if (sigintTimestamps.length === 2) {
      console.log('\nPress one more time to terminate');
    } else {
      process.exit(1);
    }
  });

  const aborted = () => abortController.signal.aborted;

  // ─────────────────────────────────────────────
  // Run Tasks
  // ─────────────────────────────────────────────

  console.log(`\nOdor Agent`);
  console.log(`Profile: ${profile.profile}`);
  console.log(`Model: ${model}`);
  console.log(`Mode: ${yolo ? 'yolo (auto-accept)' : 'interactive'}`);
  console.log(`Tasks: ${selectedTasks.map(t => t.name).join(', ')}`);
  if (contextSize) console.log(`Context: ${contextSize} tokens`);
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

      // Resolve per-task system prompt
      const taskSystem = task.system ?? system;

      const blog = flow([

        [ postScanner({ src: profile.src, profile }, profile.debug), 'post' ],

        ['post',
          gracefulShutdown(),
          apiGate(agentTask({
            name: task.name,
            prompt: task.prompt,
            target: task.target,
            url, model,
            system: taskSystem,
            yolo, rl,
            strategy: task.strategy,
            skipExisting: task.skipExisting,
            autoAccept: task.autoAccept,
            reflect: task.reflect,
            evaluate: task.evaluate,
            contextSize,
            lessons,
            profileDir,
            allTasks: tasks,
            signal: abortController.signal,
            aborted,
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
    if (aborted()) break;
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
        execSync('git add -A && git commit -m "odor-agent: apply AI edits"', {
          cwd: profileDir,
          stdio: 'inherit',
        });
      } catch (err) {
        console.error('Git commit failed:', err.message);
      }
    }
  }

  return EXIT_SUCCESS;
}

async function waitForServer(url) {
  while (true) {
    try {
      await fetch(url, { method: 'HEAD' });
      return; // any HTTP response means server is up
    } catch (err) {
      if (err.cause?.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNRESET' || err.message?.includes('fetch failed')) {
        console.log(`Cannot reach ${url}`);
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        await new Promise(resolve => rl.question('Press ENTER when the server is ready... ', resolve));
        rl.close();
      } else {
        throw err;
      }
    }
  }
}
