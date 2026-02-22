import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml, buildPager, renderPostCard } from '../../src/lib/html.js';

describe('escapeXml', () => {
  it('escapes ampersand', () => {
    assert.equal(escapeXml('a&b'), 'a&amp;b');
  });

  it('escapes angle brackets', () => {
    assert.equal(escapeXml('<script>'), '&lt;script&gt;');
  });

  it('escapes quotes', () => {
    assert.equal(escapeXml('"hello"'), '&quot;hello&quot;');
  });

  it('escapes apostrophes', () => {
    assert.equal(escapeXml("it's"), 'it&apos;s');
  });

  it('handles all special chars together', () => {
    assert.equal(escapeXml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
  });

  it('returns empty string for falsy input', () => {
    assert.equal(escapeXml(''), '');
    assert.equal(escapeXml(null), '');
    assert.equal(escapeXml(undefined), '');
  });

  it('passes through safe strings', () => {
    assert.equal(escapeXml('hello world'), 'hello world');
  });
});

describe('buildPager', () => {
  it('returns empty for single page', () => {
    assert.deepEqual(buildPager(1, 1), []);
  });

  it('returns empty for zero pages', () => {
    assert.deepEqual(buildPager(1, 0), []);
  });

  it('lists all pages descending for small count', () => {
    const pages = buildPager(2, 3);
    assert.equal(pages.length, 3);
    assert.deepEqual(pages.map(p => p.pageNum), [3, 2, 1]);
  });

  it('marks current page with ariaCurrent', () => {
    const pages = buildPager(2, 3);
    const current = pages.find(p => p.ariaCurrent);
    assert.equal(current.pageNum, 2);
  });

  it('generates correct URLs', () => {
    const pages = buildPager(1, 3);
    assert.ok(pages.every(p => p.url.startsWith('page-') && p.url.endsWith('.html')));
  });

  it('returns window for large page counts', () => {
    const pages = buildPager(10, 50);
    assert.equal(pages.length, 11); // radius=5 → 2*5+1=11
  });

  it('includes current page in window', () => {
    const pages = buildPager(25, 50);
    assert.ok(pages.some(p => p.pageNum === 25 && p.ariaCurrent));
  });
});

describe('renderPostCard', () => {
  it('renders article with cover', () => {
    const post = {
      coverUrl: '/cover.avif',
      permalinkUrl: '/permalink/abc/',
      postId: 'poem-0001',
      postData: { title: 'Hello', date: '2024-01-15' }
    };
    const html = renderPostCard(post);
    assert.ok(html.includes('<article'));
    assert.ok(html.includes('src="/cover.avif"'));
    assert.ok(html.includes('href="/permalink/abc/"'));
    assert.ok(html.includes('Hello'));
  });

  it('renders article without cover', () => {
    const post = {
      coverUrl: null,
      permalinkUrl: '/permalink/abc/',
      postId: 'poem-0001',
      postData: { title: 'No Cover', date: '2024-01-15' }
    };
    const html = renderPostCard(post);
    assert.ok(html.includes('<article'));
    assert.ok(!html.includes('<img'));
  });

  it('uses postId when title is missing', () => {
    const post = {
      coverUrl: null,
      permalinkUrl: '/permalink/abc/',
      postId: 'poem-0001',
      postData: {}
    };
    const html = renderPostCard(post);
    assert.ok(html.includes('#0001:'));
  });
});
