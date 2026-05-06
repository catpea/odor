import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse } from '../lib/xml-parser.js';

import { MapStore } from './map-store.js';
import { ActionRegistry } from './action-registry.js';
import { TaskManager } from './task-manager.js';
import { LockManager } from './lock-manager.js';
import { setDotPath, expandDotPaths } from './resolver.js';

import { runAction }    from '../builtins/action.js';
import { runSubmit }    from '../builtins/submit.js';
import { runTaskGroup } from '../builtins/task-group.js';
import { runForEach }   from '../builtins/foreach.js';
import { runWhen }      from '../builtins/when.js';
import { runLock }      from '../builtins/lock.js';
import { runParallel }  from '../builtins/parallel.js';
import { runSet }       from '../builtins/set.js';
import { runAppend }    from '../builtins/append.js';

// ── Action imports ────────────────────────────────────────────────────────────
import * as readArgs      from '../actions/build/read-args.js';
import * as parseArgs     from '../actions/build/parse-args.js';
import * as prepareBuild  from '../actions/build/prepare-build.js';
import * as summarizeBuild from '../actions/build/summarize-build.js';
import * as scanPosts     from '../actions/posts/scan-posts.js';
import * as emitPosts     from '../actions/posts/emit-posts.js';
import * as skipUnchanged from '../actions/posts/skip-unchanged.js';
import * as analyzePost   from '../actions/posts/analyze-post.js';
import * as processText   from '../actions/posts/process-text.js';
import * as verifyPost    from '../actions/posts/verify-post.js';
import * as collectPost   from '../actions/posts/collect-post.js';
import * as processAudio  from '../actions/media/process-audio.js';
import * as processCover  from '../actions/media/process-cover.js';
import * as copyFiles     from '../actions/files/copy-files.js';
import * as useTheme      from '../actions/files/use-theme.js';
import * as writeManifest from '../actions/files/write-manifest.js';
import * as homepage      from '../actions/site/homepage.js';
import * as pagerizer     from '../actions/site/pagerizer.js';
import * as rssFeed       from '../actions/site/rss-feed.js';
import * as playlist      from '../actions/site/playlist.js';
import * as agentTask     from '../actions/ai/agent-task.js';
import * as emitEvents    from '../actions/events/emit-events.js';

const ALL_ACTIONS = [
  readArgs, parseArgs, prepareBuild, summarizeBuild,
  scanPosts, emitPosts, skipUnchanged, analyzePost,
  processText, verifyPost, collectPost,
  processAudio, processCover,
  copyFiles, useTheme, writeManifest,
  homepage, pagerizer, rssFeed, playlist,
  agentTask,
  emitEvents,
];

// ── Logger ────────────────────────────────────────────────────────────────────

function createLogger(prefix = '') {
  return {
    info:  (msg) => console.log(`${prefix}${msg}`),
    warn:  (msg) => console.warn(`[warn] ${prefix}${msg}`),
    error: (msg) => console.error(`[err]  ${prefix}${msg}`),
    child: (name) => createLogger(`[${name}] `),
  };
}

// ── Interpreter ───────────────────────────────────────────────────────────────

export class Interpreter {
  constructor() {
    this.variables  = {};       // flat variable table, expanded to nested objects
    this.workflows  = new Map();
    this.registry   = new ActionRegistry();
    this.programDir = null;
    this.taskConfig = [];       // { name, concurrency, retries }
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  async load(programFile) {
    this.programDir = path.dirname(path.resolve(programFile));
    const source = await readFile(programFile, 'utf-8');
    const nodes = parse(source);
    await this.processNodes(nodes);
  }

  async processNodes(nodes) {
    for (const node of nodes) {
      if (node.type === 'element') await this.processTopNode(node);
    }
  }

  async processTopNode(node) {
    switch (node.name) {
      case 'Program':
        for (const child of node.children) {
          if (child.type === 'element') await this.processTopNode(child);
        }
        break;
      case 'Import':
        await this.processImport(node);
        break;
      case 'Variable':
        this.processVariable(node, this.variables);
        break;
      case 'Store':
        // store paths are declared but the MapStore handles them dynamically
        break;
      case 'TaskManager':
        this.processTaskManager(node);
        break;
      case 'Workflow':
        this.workflows.set(node.attributes.name, node);
        break;
      // Context/Use are documentation; we build context from variables directly
    }
  }

  async processImport(node) {
    const src = path.resolve(this.programDir, node.attributes.src);
    const source = await readFile(src, 'utf-8');
    const nodes = parse(source);
    await this.processNodes(nodes);
  }

  processVariable(node, target) {
    const name = node.attributes.name;
    if (!name) return;

    const value = node.attributes.value;
    const children = node.children.filter(n => n.type === 'element' && n.name === 'Variable');

    if (children.length > 0) {
      // Nested variables become a nested object
      const nested = {};
      for (const child of children) {
        this.processVariable(child, nested);
      }
      setDotPath(target, name, nested);
    } else if (value !== undefined) {
      setDotPath(target, name, value);
    }
  }

  processTaskManager(node) {
    for (const child of node.children) {
      if (child.type !== 'element' || child.name !== 'Queue') continue;
      this.taskConfig.push({
        name:        child.attributes.name,
        concurrency: child.attributes.concurrency ?? '1',
        retries:     Number(child.attributes.retries ?? 0),
      });
    }
  }

  // ── Running ─────────────────────────────────────────────────────────────────

  async run(argv = [], options = {}) {
    // Register all built-in actions
    for (const mod of ALL_ACTIONS) {
      this.registry.register(mod);
    }

    // Build context from the variable table.
    // baseDir is the working directory where the build is invoked (not the program file's dir),
    // so that src/dest paths like "database/posts" resolve relative to the project root.
    const context = structuredClone(this.variables);
    context.baseDir = process.cwd();
    context.argv    = argv;

    // Initialize task manager from declared queues
    const tasks = new TaskManager();
    for (const q of this.taskConfig) {
      tasks.createQueue(q.name, { concurrency: q.concurrency, retries: q.retries });
    }

    const locks  = new LockManager();
    const store  = new MapStore();
    const controller = new AbortController();

    const ctx = {
      context,
      tasks,
      locks,
      dryRun:       false,
      dryRunCount:  0,
      events:       options.events ?? null,
    };

    const frame = {
      workflow: 'main',
      item:     null,
      parent:   null,
      local:    new MapStore(),
    };

    const self = this;
    const runtime = {
      ctx,
      store,
      frame,
      signal:   controller.signal,
      log:      createLogger(),
      registry: this.registry,
      workflows: this.workflows,
      runWorkflow(name, rt) { return self.runWorkflow(name, rt); },
      runNode(node, rt)     { return self.runNode(node, rt); },
    };

    await this.runWorkflow('main', runtime);

    return { runtime, controller };
  }

  async runWorkflow(name, runtime) {
    const workflow = this.workflows.get(name);
    if (!workflow) throw new Error(`Unknown workflow: "${name}"`);

    for (const node of workflow.children) {
      if (node.type === 'element') {
        await this.runNode(node, runtime);
      }
    }
  }

  async runNode(node, runtime) {
    switch (node.name) {
      case 'Action':    return runAction(node, runtime);
      case 'Submit':    return runSubmit(node, runtime);
      case 'TaskGroup': return runTaskGroup(node, runtime);
      case 'ForEach':   return runForEach(node, runtime);
      case 'When':      return runWhen(node, runtime);
      case 'Lock':      return runLock(node, runtime);
      case 'Parallel':  return runParallel(node, runtime);
      case 'Set':       return runSet(node, runtime);
      case 'Append':    return runAppend(node, runtime);
      case 'Attribute':
      case 'Item':
      case 'Map':
        return; // declarative only
      default:
        throw new Error(`Unknown built-in node: "${node.name}"`);
    }
  }
}
