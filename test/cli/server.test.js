import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { MIME_TYPES, safePath } from '../../src/cli/server.js';

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
