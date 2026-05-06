#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Interpreter } from '../src/runtime/interpreter.js';

const EXIT_SUCCESS = 0;
const EXIT_FATAL   = 2;

async function run(args) {
  const programFile = args[0];
  const postTitle   = args[1];

  if (!programFile || !postTitle) {
    console.error('Usage: odor3-new <build.xml> "Post Title"');
    return EXIT_FATAL;
  }

  // Load context from the program XML to get src, prefix, chapter
  const interpreter = new Interpreter();
  try {
    await interpreter.load(programFile);
  } catch (err) {
    console.error(`Fatal: ${err.message}`);
    return EXIT_FATAL;
  }

  const ctx = interpreter.variables;
  const baseDir = process.cwd();

  function resolveSetting(key) {
    const val = ctx[key];
    if (typeof val !== 'string') return val;
    return val.replace(/\{([^}]+)\}/g, (m, k) => ctx[k] ?? m);
  }

  const srcTemplate = resolveSetting('src');
  const srcDir      = path.resolve(baseDir, srcTemplate);
  const prefix      = ctx.prefix  ?? 'post-';
  const chapter     = ctx.chapter ?? '1';

  // Check for duplicate title
  const titles = getAllPostTitlesSync(srcDir);
  if (titles.has(postTitle)) {
    const dup = titles.get(postTitle);
    console.error(`dupe: Post with that title already exists: ${dup.id} ${dup.guid}`);
    return EXIT_FATAL;
  }

  const numberOfPosts = countPosts(srcDir);
  const id            = prefix + String(numberOfPosts + 1).padStart(4, '0');
  const postBase      = path.join(srcDir, id);

  // Safety check: previous post must have a non-empty cover
  if (numberOfPosts > 0) {
    const prevId    = prefix + String(numberOfPosts).padStart(4, '0');
    const prevDir   = path.join(srcDir, prevId);
    const prevFiles = fs.existsSync(prevDir) ? fs.readdirSync(prevDir) : [];
    const coverFile = prevFiles.find(f => f.startsWith('cover.'));
    if (coverFile) {
      const coverPath = path.join(prevDir, coverFile);
      const { size }  = fs.statSync(coverPath);
      if (size === 0) {
        console.error(`safety: will not create post ${id}`);
        console.error(`safety: post ${numberOfPosts} is missing cover image data (0 bytes)`);
        return EXIT_FATAL;
      }
    }
  }

  fs.mkdirSync(postBase, { recursive: true });

  const guid     = randomUUID();
  const postJson = {
    id,
    guid,
    chapter,
    title:    postTitle,
    date:     new Date().toISOString(),
    lastmod:  null,
    artwork:  ['https://catpea.com/'],
    tags:     null,
    analysis: null,
  };

  fs.writeFileSync(path.join(postBase, 'post.json'), JSON.stringify(postJson, null, 2));
  fs.writeFileSync(path.join(postBase, 'text.md'),   'todo');
  for (const fileName of ['audio.mp3', 'cover.jpg']) {
    fs.writeFileSync(path.join(postBase, fileName), '');
  }

  console.log(postBase);
  for (const f of fs.readdirSync(postBase)) console.log(path.join(postBase, f));

  return EXIT_SUCCESS;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countPosts(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries.filter(e =>
    e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.')
  ).length;
}

function getAllPostTitlesSync(rootDir) {
  const result  = new Map();
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const jsonPath = path.join(rootDir, e.name, 'post.json');
    try {
      const obj = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      result.set(typeof obj.title === 'string' ? obj.title : '', obj);
    } catch { /* skip malformed post */ }
  }
  return result;
}

const code = await run(process.argv.slice(2));
process.exit(code);
