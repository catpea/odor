#!/usr/bin/env node
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, exec } from 'node:child_process';
import { X509Certificate, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

import { Interpreter } from '../src/runtime/interpreter.js';
import { resolvePath, interpolatePath } from '../src/lib/paths.js';

const EXIT_SUCCESS = 0;
const EXIT_FATAL   = 2;

// ── MIME types ────────────────────────────────────────────────────────────────

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico':  'image/x-icon',
  '.mp3':  'audio/mpeg',
  '.m4a':  'audio/mp4',
  '.ogg':  'audio/ogg',
  '.wav':  'audio/wav',
  '.m3u':  'audio/x-mpegurl',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.otf':   'font/otf',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/plain; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb':  'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

// ── Static file serving ───────────────────────────────────────────────────────

function safePath(root, requestPath) {
  const decoded  = decodeURIComponent(requestPath);
  const resolved = path.resolve(root, '.' + decoded);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

function serveStatic(root) {
  return (req, res, next) => {
    const url      = new URL(req.url, 'http://localhost');
    const filePath = safePath(root, url.pathname);

    if (!filePath) { res.writeHead(403); res.end('Forbidden'); return; }

    let target = filePath;
    try {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        target = path.join(target, 'index.html');
        fs.statSync(target);
      }
    } catch { return next(); }

    const ext  = path.extname(target).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(target).pipe(res);
  };
}

function compose(handlers) {
  return (req, res) => {
    let i = 0;
    function next() {
      if (i >= handlers.length) { res.writeHead(404); res.end('Not Found'); return; }
      handlers[i++](req, res, next);
    }
    next();
  };
}

// ── Multipart parser ──────────────────────────────────────────────────────────

function splitBuffer(buf, sep) {
  const parts = [];
  let pos = 0;
  while (true) {
    const found = indexOfBuf(buf, sep, pos);
    if (found === -1) { parts.push(buf.slice(pos)); break; }
    parts.push(buf.slice(pos, found));
    pos = found + sep.length;
  }
  return parts;
}

function indexOfBuf(buf, search, start = 0) {
  outer: for (let i = start; i <= buf.length - search.length; i++) {
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function parseMultipart(body, boundary) {
  const sep    = Buffer.from(`--${boundary}`);
  const result = { fields: {}, files: {} };
  const parts  = splitBuffer(body, sep);

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part.length) continue;
    if (part[0] === 0x2d && part[1] === 0x2d) continue;

    const bodyStart0 = (part[0] === 0x0d && part[1] === 0x0a) ? 2 : 0;
    const headerEnd  = indexOfBuf(part, Buffer.from('\r\n\r\n'), bodyStart0);
    if (headerEnd === -1) continue;

    const headerStr = part.slice(bodyStart0, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    let bodyEnd = part.length;
    if (part[bodyEnd - 2] === 0x0d && part[bodyEnd - 1] === 0x0a) bodyEnd -= 2;
    const partBody = part.slice(bodyStart, bodyEnd);

    const dispMatch = headerStr.match(/Content-Disposition:\s*form-data;\s*([^\r\n]+)/i);
    if (!dispMatch) continue;
    const nameMatch = dispMatch[1].match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    const filenameMatch = dispMatch[1].match(/filename="([^"]*)"/);
    const ctMatch       = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

    if (filenameMatch !== null) {
      result.files[name] = {
        data:        partBody,
        filename:    filenameMatch[1] || name,
        contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
      };
    } else {
      result.fields[name] = partBody.toString('utf8');
    }
  }
  return result;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data',  chunk => chunks.push(chunk));
    req.on('end',   ()    => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const UPLOAD_MIME_EXT = {
  'image/jpeg':      '.jpg',
  'image/png':       '.png',
  'image/gif':       '.gif',
  'image/webp':      '.webp',
  'image/avif':      '.avif',
  'image/svg+xml':   '.svg',
  'video/mp4':       '.mp4',
  'video/webm':      '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg':      '.mp3',
  'audio/ogg':       '.ogg',
  'audio/wav':       '.wav',
};

function uploadExt(filename, contentType) {
  const fromName = path.extname(filename || '');
  if (fromName) return fromName;
  return UPLOAD_MIME_EXT[contentType] ?? '.bin';
}

// ── JSON / CORS helpers ───────────────────────────────────────────────────────

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type':                'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function corsPreflightOk(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

// ── New-post helpers ──────────────────────────────────────────────────────────

function countPosts(dirPath) {
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.')).length;
}

function findCoverFiles(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.startsWith('cover'))
      .map(e => path.join(dirPath, e.name));
  } catch { return []; }
}

function getAllPostTitles(rootDir) {
  const result = new Map();
  for (const e of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
    try {
      const raw = fs.readFileSync(path.join(rootDir, e.name, 'post.json'), 'utf8');
      const obj = JSON.parse(raw);
      if (typeof obj.title === 'string') result.set(obj.title, obj);
    } catch { /* skip malformed entries */ }
  }
  return result;
}

// ── Route: POST /upload-post ──────────────────────────────────────────────────

async function handleUploadPost(req, res, vars, baseDir) {
  if (req.method === 'OPTIONS') { corsPreflightOk(res); return; }
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method Not Allowed' }); return; }

  const ct             = req.headers['content-type'] || '';
  const boundaryMatch  = ct.match(/boundary=([^\s;]+)/);
  if (!ct.startsWith('multipart/form-data') || !boundaryMatch) {
    sendJson(res, 400, { error: 'Expected multipart/form-data with a boundary' });
    return;
  }

  const boundary = boundaryMatch[1].replace(/^"(.*)"$/, '$1');
  const body     = await readBody(req);
  const { fields, files } = parseMultipart(body, boundary);

  const title = (fields.title || '').trim();
  const poem  = fields.poem ?? null;

  if (!title)       { sendJson(res, 400, { error: 'Field "title" is required' }); return; }
  if (poem === null) { sendJson(res, 400, { error: 'Field "poem" is required' });  return; }
  if (!files.cover) { sendJson(res, 400, { error: 'File field "cover" is required' }); return; }

  const srcDir = resolvePath(baseDir, vars.src, vars);

  const titles = getAllPostTitles(srcDir);
  if (titles.has(title)) {
    const existing = titles.get(title);
    sendJson(res, 409, { error: 'Post with title already exists', existingId: existing.id, existingGuid: existing.guid });
    return;
  }

  const numberOfPosts = countPosts(srcDir);
  const prefix        = vars.prefix ?? 'post-';
  const prevId        = prefix + String(numberOfPosts).padStart(4, '0');
  const prevDir       = path.join(srcDir, prevId);
  const prevCovers    = findCoverFiles(prevDir);
  if (prevCovers.length === 0 || fs.statSync(prevCovers[0]).size === 0) {
    sendJson(res, 422, {
      error: `Safety check failed: post ${prevId} is missing a non-empty cover image`,
      prevDir,
      prevCovers,
    });
    return;
  }

  const id       = prefix + String(numberOfPosts + 1).padStart(4, '0');
  const postBase = path.join(srcDir, id);
  const guid     = randomUUID();

  await mkdir(postBase, { recursive: true });
  const filesDir = path.join(postBase, 'files');
  await mkdir(filesDir, { recursive: true });

  const credit   = (fields.credit || '').trim() || null;
  const postJson = {
    id, guid,
    chapter:  vars.chapter ?? '1',
    title,
    date:     new Date().toISOString(),
    lastmod:  null,
    artwork:  ['https://catpea.com/'],
    tags:     null,
    analysis: null,
    ...(credit ? { credit } : {}),
  };

  await writeFile(path.join(postBase, 'post.json'), JSON.stringify(postJson, null, 2));
  await writeFile(path.join(postBase, 'text.md'),   poem);

  const coverExt  = uploadExt(files.cover.filename, files.cover.contentType);
  const coverFile = `cover${coverExt}`;
  await writeFile(path.join(postBase, coverFile), files.cover.data);

  const audioData = files.audio ? files.audio.data : Buffer.alloc(0);
  await writeFile(path.join(postBase, 'audio.mp3'), audioData);

  const writtenFiles = [];
  for (const [key, file] of Object.entries(files)) {
    if (key === 'cover' || key === 'audio') continue;
    const ext      = uploadExt(file.filename, file.contentType);
    const filename = file.filename || `${key}${ext}`;
    const dest     = path.join(filesDir, filename);
    await writeFile(dest, file.data);
    writtenFiles.push({ key, filename, path: dest, size: file.data.length, contentType: file.contentType });
  }

  sendJson(res, 200, {
    ok:   true,
    post: {
      id, guid, title,
      path:      postBase,
      coverFile: path.join(postBase, coverFile),
      audioFile: path.join(postBase, 'audio.mp3'),
      textFile:  path.join(postBase, 'text.md'),
      postJson:  path.join(postBase, 'post.json'),
      filesDir,
      files: writtenFiles,
    },
  });
}

// ── Route: POST /build ────────────────────────────────────────────────────────

async function handleBuild(req, res, programFile, baseDir) {
  if (req.method === 'OPTIONS') { corsPreflightOk(res); return; }
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method Not Allowed' }); return; }

  const cmd = `odor3-build "${programFile}"`;
  console.log(`[build] Running: ${cmd}`);

  await new Promise((resolve) => {
    exec(cmd, { cwd: baseDir, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const status = err ? 500 : 200;
      sendJson(res, status, {
        ok:       !err,
        cmd,
        stdout:   stdout || '',
        stderr:   stderr || '',
        error:    err ? err.message : null,
        exitCode: err ? (err.code ?? 1) : 0,
      });
      resolve();
    });
  });
}

// ── TLS cert helpers ──────────────────────────────────────────────────────────

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function ensureCerts(certDir) {
  const keyPath  = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');
  let needsGen   = false;

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    needsGen = true;
  } else {
    try {
      const x509 = new X509Certificate(fs.readFileSync(certPath, 'utf-8'));
      if (new Date(x509.validTo) < new Date()) needsGen = true;
    } catch { needsGen = true; }
  }

  if (needsGen) {
    fs.mkdirSync(certDir, { recursive: true });
    console.log(`Generating self-signed certificate in ${certDir}`);
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"`,
      { cwd: certDir, stdio: 'pipe' }
    );
  }

  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

async function run(args) {
  const programArg = args[0];
  if (!programArg) {
    console.error('Usage: odor3-server <build.xml> [--https]');
    return EXIT_FATAL;
  }

  const useHttps  = args.includes('--https');
  const baseDir   = process.cwd();
  const programFile = path.resolve(baseDir, programArg);

  const interpreter = new Interpreter();
  try {
    await interpreter.load(programFile);
  } catch (err) {
    console.error(`Fatal: ${err.message}`);
    return EXIT_FATAL;
  }

  const vars = interpreter.variables;
  const port = Number(vars.server?.port ?? 8590);
  const staticTemplate = vars.server?.static ?? vars.dest;

  if (!staticTemplate) {
    console.error('Fatal: no server.static or dest variable defined in program');
    return EXIT_FATAL;
  }

  const staticRoots = String(staticTemplate)
    .split(',')
    .map(t => resolvePath(baseDir, t.trim(), vars));

  for (const root of staticRoots) {
    if (!fs.existsSync(root)) console.log(`Warning: static directory not found: ${root}`);
  }

  const existingRoots = staticRoots.filter(r => fs.existsSync(r));
  if (existingRoots.length === 0) {
    console.log(`Run odor3-build first to generate the site.`);
  }

  const apiHandler = (req, res, next) => {
    const url = req.url.split('?')[0];

    if (url === '/health') {
      sendJson(res, 200, { ok: true, version: '3.0.0' });
      return;
    }

    if (url === '/upload-post') {
      handleUploadPost(req, res, vars, baseDir).catch(err => {
        console.error('[upload-post]', err);
        sendJson(res, 500, { error: err.message, stack: err.stack });
      });
      return;
    }

    if (url === '/build') {
      handleBuild(req, res, programFile, baseDir).catch(err => {
        console.error('[build]', err);
        sendJson(res, 500, { error: err.message, stack: err.stack });
      });
      return;
    }

    next();
  };

  const handlers = [apiHandler, ...existingRoots.map(serveStatic)];
  const handler  = compose(handlers);

  let server;
  if (useHttps) {
    const certDir = path.join(baseDir, '.odor-certs');
    server = https.createServer(ensureCerts(certDir), handler);
  } else {
    server = http.createServer(handler);
  }

  const protocol = useHttps ? 'https' : 'http';
  const localIP  = getLocalIP();

  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      console.log(`\nOdor 3 Server`);
      console.log(`─────────────────────────────────────────────`);
      for (const r of staticRoots) console.log(`  Serving: ${r}`);
      console.log(`─────────────────────────────────────────────`);
      console.log(`  Local:   ${protocol}://localhost:${port}`);
      console.log(`  Network: ${protocol}://${localIP}:${port}`);
      console.log(`─────────────────────────────────────────────`);
      console.log(`  API:     POST ${protocol}://${localIP}:${port}/upload-post`);
      console.log(`  API:     POST ${protocol}://${localIP}:${port}/build`);
      console.log(`  API:     GET  ${protocol}://${localIP}:${port}/health`);
      console.log(`─────────────────────────────────────────────`);
      console.log(`Press CTRL-C to stop.\n`);
    });

    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      server.close(() => resolve(EXIT_SUCCESS));
    });
  });
}

const code = await run(process.argv.slice(2));
process.exit(code);
