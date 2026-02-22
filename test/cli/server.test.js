import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

import { MIME_TYPES, safePath, serveStatic, compose } from '../../src/cli/server.js';

describe('MIME_TYPES', () => {
  it('maps common web extensions', () => {
    assert.equal(MIME_TYPES['.html'], 'text/html; charset=utf-8');
    assert.equal(MIME_TYPES['.css'], 'text/css; charset=utf-8');
    assert.equal(MIME_TYPES['.js'], 'application/javascript; charset=utf-8');
    assert.equal(MIME_TYPES['.json'], 'application/json; charset=utf-8');
    assert.equal(MIME_TYPES['.png'], 'image/png');
    assert.equal(MIME_TYPES['.jpg'], 'image/jpeg');
    assert.equal(MIME_TYPES['.avif'], 'image/avif');
    assert.equal(MIME_TYPES['.svg'], 'image/svg+xml');
    assert.equal(MIME_TYPES['.mp3'], 'audio/mpeg');
    assert.equal(MIME_TYPES['.m3u'], 'audio/x-mpegurl');
    assert.equal(MIME_TYPES['.woff2'], 'font/woff2');
    assert.equal(MIME_TYPES['.xml'], 'application/xml; charset=utf-8');
    assert.equal(MIME_TYPES['.glb'], 'model/gltf-binary');
  });

  it('returns undefined for unknown extensions', () => {
    assert.equal(MIME_TYPES['.xyz'], undefined);
  });
});

describe('safePath', () => {
  const root = '/srv/site';

  it('resolves normal paths within root', () => {
    assert.equal(safePath(root, '/index.html'), path.resolve(root, 'index.html'));
    assert.equal(safePath(root, '/css/style.css'), path.resolve(root, 'css/style.css'));
  });

  it('resolves root path itself', () => {
    assert.equal(safePath(root, '/'), root);
  });

  it('blocks directory traversal with ../', () => {
    assert.equal(safePath(root, '/../etc/passwd'), null);
    assert.equal(safePath(root, '/../../etc/shadow'), null);
  });

  it('blocks encoded traversal', () => {
    assert.equal(safePath(root, '/%2e%2e/etc/passwd'), null);
  });

  it('handles double slashes', () => {
    const result = safePath(root, '//index.html');
    assert.notEqual(result, null);
    assert.ok(result.startsWith(root));
  });
});

describe('compose', () => {
  it('calls handlers in order until one responds', () => {
    const calls = [];
    const h1 = (req, res, next) => { calls.push('h1'); next(); };
    const h2 = (req, res, next) => { calls.push('h2'); res.end('ok'); };
    const h3 = (req, res, next) => { calls.push('h3'); };

    const handler = compose([h1, h2, h3]);
    const res = { end() {}, writeHead() {} };
    handler({}, res);

    assert.deepEqual(calls, ['h1', 'h2']);
  });

  it('returns 404 when all handlers call next', () => {
    const h1 = (req, res, next) => next();
    const h2 = (req, res, next) => next();

    const handler = compose([h1, h2]);
    let status;
    let body;
    const res = {
      writeHead(code) { status = code; },
      end(b) { body = b; },
    };
    handler({}, res);

    assert.equal(status, 404);
    assert.equal(body, 'Not Found');
  });

  it('works with a single handler', () => {
    const handler = compose([(req, res, next) => { res.end('single'); }]);
    let body;
    handler({}, { end(b) { body = b; }, writeHead() {} });
    assert.equal(body, 'single');
  });
});

describe('serveStatic + compose (HTTP)', () => {
  let tmpA, tmpB, server, baseUrl;

  before(async () => {
    // Root A: has index.html and style.css
    tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'odor-a-'));
    fs.writeFileSync(path.join(tmpA, 'index.html'), '<h1>home</h1>');
    fs.writeFileSync(path.join(tmpA, 'style.css'), 'body{}');
    fs.mkdirSync(path.join(tmpA, 'sub'));
    fs.writeFileSync(path.join(tmpA, 'sub', 'index.html'), '<h1>sub</h1>');

    // Root B: has cover.avif (simulated) and data.json
    tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'odor-b-'));
    fs.writeFileSync(path.join(tmpB, 'cover.avif'), 'fake-avif');
    fs.writeFileSync(path.join(tmpB, 'data.json'), '{}');

    const handler = compose([serveStatic(tmpA), serveStatic(tmpB)]);
    server = http.createServer(handler);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise(r => server.close(r));
    fs.rmSync(tmpA, { recursive: true });
    fs.rmSync(tmpB, { recursive: true });
  });

  it('serves a file from the first root', async () => {
    const res = await fetch(`${baseUrl}/style.css`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(await res.text(), 'body{}');
  });

  it('serves index.html for directory requests', async () => {
    const res = await fetch(`${baseUrl}/sub/`);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('<h1>sub</h1>'));
  });

  it('serves index.html for root request', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('<h1>home</h1>'));
  });

  it('falls through to second root when first misses', async () => {
    const res = await fetch(`${baseUrl}/cover.avif`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/avif');
    assert.equal(await res.text(), 'fake-avif');
  });

  it('returns correct MIME type for json', async () => {
    const res = await fetch(`${baseUrl}/data.json`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  });

  it('returns 404 when no root has the file', async () => {
    const res = await fetch(`${baseUrl}/nope.txt`);
    assert.equal(res.status, 404);
  });
});
