// Static file dev server for previewing built sites
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';

import { setup, resolvePath, interpolatePath } from '../lib/index.js';

// Exit codes
const EXIT_SUCCESS = 0;
const EXIT_FATAL   = 2;

const PORT = 8590;

export const MIME_TYPES = {
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

export function safePath(root, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const resolved = path.resolve(root, '.' + decoded);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

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
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');

  let needsGen = false;

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    needsGen = true;
  } else {
    // Check expiry
    try {
      const certPem = fs.readFileSync(certPath, 'utf-8');
      const x509 = new X509Certificate(certPem);
      if (new Date(x509.validTo) < new Date()) needsGen = true;
    } catch {
      needsGen = true;
    }
  }

  if (needsGen) {
    fs.mkdirSync(certDir, { recursive: true });
    console.log(`Generating self-signed certificate in ${certDir}`);
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"`,
      { cwd: certDir, stdio: 'pipe' }
    );
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

function handleRequest(root) {
  return (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let filePath = safePath(root, url.pathname);

    if (!filePath) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Directory → index.html
    try {
      if (fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
    } catch {
      // file doesn't exist, handled below
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  };
}

export async function run(args) {
  const profilePath = args[0];
  if (!profilePath) {
    console.error('Usage: odor-server <profile.json> [--https]');
    return EXIT_FATAL;
  }

  const useHttps = args.includes('--https');

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

  const root = resolvePath(interpolatePath(profile.dest, { profile }));

  if (!fs.existsSync(root)) {
    console.error(`Fatal: dest directory does not exist: ${root}`);
    console.error(`Run odor-build first to generate the site.`);
    return EXIT_FATAL;
  }

  const handler = handleRequest(root);
  let server;

  if (useHttps) {
    const certDir = path.join(profileDir, '.odor-certs');
    const certs = ensureCerts(certDir);
    server = https.createServer(certs, handler);
  } else {
    server = http.createServer(handler);
  }

  const protocol = useHttps ? 'https' : 'http';
  const localIP = getLocalIP();

  return new Promise((resolve) => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\nOdor Server`);
      console.log(`Serving: ${root}`);
      console.log(`─────────────────────────────────────────────`);
      console.log(`  Local:   ${protocol}://localhost:${PORT}`);
      console.log(`  Network: ${protocol}://${localIP}:${PORT}`);
      console.log(`─────────────────────────────────────────────`);
      console.log(`Press CTRL-C to stop.\n`);
    });

    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      server.close(() => resolve(EXIT_SUCCESS));
    });
  });
}
