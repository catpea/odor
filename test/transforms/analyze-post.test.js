import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeFile, mkdir } from 'node:fs/promises';
import analyzePost, { formatDuration } from '../../src/transforms/analyze-post/index.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-'));
}

describe('analyzePost', () => {
  let dir;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('computes wordCount and featuredUrls from text.md', async () => {
    const md = 'Hello world this is a test.\n\n[Example](https://example.com)\n';
    await writeFile(path.join(dir, 'text.md'), md);
    await writeFile(path.join(dir, 'post.json'), JSON.stringify({ title: 'Test' }));

    const transform = analyzePost();
    const sent = [];
    await transform(p => sent.push(p), {
      postId: 'poem-0001',
      postDir: dir,
      postData: { title: 'Test' },
      files: {
        text: path.join(dir, 'text.md'),
        audio: null,
        filesDir: path.join(dir, 'files'),
      },
    });

    assert.equal(sent.length, 1);
    assert.ok(sent[0]._analyzeResult.updated);

    const written = JSON.parse(fs.readFileSync(path.join(dir, 'post.json'), 'utf-8'));
    assert.equal(typeof written.analysis.wordCount, 'number');
    assert.ok(written.analysis.wordCount > 0);
    assert.ok(Array.isArray(written.analysis.featuredUrls));
    assert.equal(written.analysis.featuredUrls.length, 1);
    assert.equal(written.analysis.featuredUrls[0].url, 'https://example.com');
    assert.equal(written.analysis.featuredUrls[0].text, 'Example');
  });

  it('skips gracefully when no text.md exists', async () => {
    await writeFile(path.join(dir, 'post.json'), JSON.stringify({ title: 'Empty' }));

    const transform = analyzePost();
    const sent = [];
    await transform(p => sent.push(p), {
      postId: 'poem-0002',
      postDir: dir,
      postData: { title: 'Empty' },
      files: {
        text: path.join(dir, 'text.md'),
        audio: null,
        filesDir: path.join(dir, 'files'),
      },
    });

    assert.equal(sent.length, 1);
    // Should still write (analysis = {} vs undefined)
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'post.json'), 'utf-8'));
    assert.ok(written.analysis !== undefined);
  });

  it('counts files by extension', async () => {
    const filesDir = path.join(dir, 'files');
    await mkdir(filesDir, { recursive: true });
    await writeFile(path.join(filesDir, 'photo.jpg'), '');
    await writeFile(path.join(filesDir, 'image.jpg'), '');
    await writeFile(path.join(filesDir, 'script.js'), '');
    await writeFile(path.join(dir, 'text.md'), 'hello');
    await writeFile(path.join(dir, 'post.json'), JSON.stringify({ title: 'Files' }));

    const transform = analyzePost();
    const sent = [];
    await transform(p => sent.push(p), {
      postId: 'poem-0003',
      postDir: dir,
      postData: { title: 'Files' },
      files: {
        text: path.join(dir, 'text.md'),
        audio: null,
        filesDir: filesDir,
      },
    });

    const written = JSON.parse(fs.readFileSync(path.join(dir, 'post.json'), 'utf-8'));
    assert.deepEqual(written.analysis.files, { jpg: 2, js: 1 });
  });

  it('skips write when analysis is unchanged', async () => {
    const existingAnalysis = { wordCount: 1, featuredUrls: [] };
    const postData = { title: 'Same', analysis: existingAnalysis };
    await writeFile(path.join(dir, 'text.md'), 'hello');
    await writeFile(path.join(dir, 'post.json'), JSON.stringify(postData));

    const transform = analyzePost();
    const sent = [];
    await transform(p => sent.push(p), {
      postId: 'poem-0004',
      postDir: dir,
      postData: { ...postData },
      files: {
        text: path.join(dir, 'text.md'),
        audio: null,
        filesDir: path.join(dir, 'files'),
      },
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0]._analyzeResult.updated, false);
  });

  it('deduplicates featured URLs', async () => {
    const md = '[A](https://example.com) and [B](https://example.com) and [C](https://other.com)\n';
    await writeFile(path.join(dir, 'text.md'), md);
    await writeFile(path.join(dir, 'post.json'), JSON.stringify({ title: 'Dupes' }));

    const transform = analyzePost();
    const sent = [];
    await transform(p => sent.push(p), {
      postId: 'poem-0005',
      postDir: dir,
      postData: { title: 'Dupes' },
      files: {
        text: path.join(dir, 'text.md'),
        audio: null,
        filesDir: path.join(dir, 'files'),
      },
    });

    const written = JSON.parse(fs.readFileSync(path.join(dir, 'post.json'), 'utf-8'));
    assert.equal(written.analysis.featuredUrls.length, 2);
    const urls = written.analysis.featuredUrls.map(f => f.url);
    assert.ok(urls.includes('https://example.com'));
    assert.ok(urls.includes('https://other.com'));
  });
});

describe('formatDuration', () => {
  it('formats seconds to HH:MM:SS', () => {
    assert.equal(formatDuration(912.345), '00:15:12');
  });

  it('formats hours correctly', () => {
    assert.equal(formatDuration(3661), '01:01:01');
  });

  it('formats zero', () => {
    assert.equal(formatDuration(0), '00:00:00');
  });
});
