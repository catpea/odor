// Post Metadata Analysis
import fs from 'node:fs';
import path from 'node:path';

import { randomUUID } from 'crypto';
import { setup, resolvePath, interpolatePath } from '../lib/index.js';

// Exit codes
const EXIT_SUCCESS = 0;
const EXIT_PARTIAL = 1;
const EXIT_FATAL   = 2;

export async function run(args) {
  // ─────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────

  const profilePath = args[0];
  if (!profilePath) {
    console.error('Usage: odor-new <profile.json> "Post Title"');
    return EXIT_FATAL;
  }

  const postTitle = args[1];
  if (!postTitle) {
    console.error('Usage: odor-new <profile.json> "Post Title"');
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

  const rootDir = resolvePath(profile.src);
  const titles = getAllPostTitlesSync(rootDir);
  if(titles.has(postTitle)){
    console.error(`dupe: Post with that title already exists: `, titles.get(postTitle).id, titles.get(postTitle).guid, );
    return EXIT_FATAL;
  }

  const numberOfPosts = countPosts(resolvePath(profile.src))
  const id = profile.prefix + (numberOfPosts + 1);
  const postBase = path.join(resolvePath(profile.src), id);


  // Sanity Check
  const previousEntry = path.join(resolvePath(profile.src), profile.prefix + numberOfPosts );
  const coverImage = findFilesByPrefixSync(previousEntry, 'cover')[0];
  if(getFileSize(coverImage) === 0){
    console.error(`safety: will not create post ${id}`);
    console.error(`safety: post ${numberOfPosts} is missing cover image data (0 bytes), will not continue`);
    console.error(`safety: cover image size must be non-zero in previous (${numberOfPosts}) post.`);
    return EXIT_FATAL;
  }

  // Create DIR
  fs.mkdirSync(postBase, { recursive: true });

  const guid = randomUUID();
  const postJson = {
    id, guid,
    chapter: profile.chapter,
    title: postTitle,
    date: (new Date()).toISOString(),
    lastmod: null,
    artwork: [ "https://catpea.com/" ],
    tags: null,
    analysis: null
  }

  // Create JSON
  fs.writeFileSync( path.join(postBase, 'post.json'), JSON.stringify(postJson, null, 2) );

  // Create MD
  fs.writeFileSync( path.join(postBase, 'text.md'), 'todo' );

  // Create Misc
  const files = ['audio.mp3', 'cover.jpg'];
  for(const fileName of files) fs.writeFileSync( path.join(postBase, fileName), '' );

  console.log(postBase)
  listFiles(postBase).map(o=>console.log(o));


  return EXIT_SUCCESS;
}






  function countPosts(dirPath) {
  const entries =   fs.readdirSync(dirPath, { withFileTypes: true });

  const matchingDirs = entries.filter(
    (entry) =>
      entry.isDirectory() &&               // only directories
      !entry.name.startsWith('_') &&       // exclude '_' prefix
      !entry.name.startsWith('.')          // exclude hidden (dot) files
  );

  return matchingDirs.length;
}
export function getFileSize(filePath) {
  const { size } = fs.statSync(filePath);
  return size;
}

function findFilesByPrefixSync(dirPath, prefix) {
  // read all entries in the directory
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  // keep only regular files whose name (without ext) starts with the prefix
  const matches = entries
    .filter((e) => e.isFile())
    .filter((e) => {
      const name = e.name; // `name` is the filename without extension
      return name.startsWith(prefix);
    })
    .map((e) => path.join(dirPath, e.name));

  return matches;
}

function getAllPostTitlesSync(rootDir) {
  const result = new Map();

  // 1️⃣ List entries in the root directory
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  // 2️⃣ Keep only sub‑directories (ignore files, hidden dirs, etc.)
  const dirs = entries.filter((e) =>
    e.isDirectory() &&               // only directories
    !e.name.startsWith('_') &&       // exclude '_' prefix
    !e.name.startsWith('.')          // exclude hidden (dot) files
  );

  // 3️⃣ Process each sub‑directory
  for (const dirEnt of dirs) {
    const dirPath = path.join(rootDir, dirEnt.name);
    const jsonPath = path.join(dirPath, 'post.json');

      // 3a️⃣ Read and parse post.json
      const raw = fs.readFileSync(jsonPath, 'utf8');
      const obj = JSON.parse(raw);

      // 3b️⃣ Extract the title (fallback to empty string if missing)
      const title = typeof obj.title === 'string' ? obj.title : '';

      // 3c️⃣ Store in the map: key = directory name, value = title
      result.set(title, obj);
  }

  return result;
}


function listFiles(rootDir) {
  const result = new Map();

  return fs.readdirSync(rootDir ).map(o=>path.join(rootDir, o));


}
