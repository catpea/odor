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

  it('renders play button when audioUrl is present', () => {
    const post = {
      coverUrl: '/cover.avif',
      audioUrl: 'https://example.com/audio.mp3',
      permalinkUrl: '/permalink/abc/',
      postId: 'poem-0001',
      postData: { title: 'With Audio', date: '2024-01-15' }
    };
    const html = renderPostCard(post);
    assert.ok(html.includes('class="post-play"'));
    assert.ok(html.includes('href="https://example.com/audio.mp3"'));
  });

  it('omits play button when audioUrl is missing', () => {
    const post = {
      coverUrl: '/cover.avif',
      permalinkUrl: '/permalink/abc/',
      postId: 'poem-0001',
      postData: { title: 'No Audio', date: '2024-01-15' }
    };
    const html = renderPostCard(post);
    assert.ok(!html.includes('post-play'));
  });

  it('renders post-meta with full analysis', () => {
    const post = {
      coverUrl: '/cover.avif',
      permalinkUrl: '/permalink/abc/',
      postId: 'poem-0001',
      postData: {
        title: 'Full Analysis',
        date: '2024-01-15',
        analysis: {
          wordCount: 5421,
          audioDuration: '00:15:12',
          featuredUrls: [
            { text: 'Example', url: 'https://example.com' },
            { text: 'Other', url: 'https://other.com' },
            { text: 'Third', url: 'https://third.com' },
          ],
        }
      }
    };
    const html = renderPostCard(post);
    assert.ok(html.includes('class="post-meta"'));
    assert.ok(html.includes('5,421 words'));
    assert.ok(html.includes('15:12 minutes'));
    assert.ok(!html.includes('00:15:12'));
    assert.ok(html.includes('3 links'));

    // single link → singular
    const post2 = {
      ...post,
      postData: { ...post.postData, analysis: {
        featuredUrls: [{ text: 'Only', url: 'https://only.com' }],
      }},
    };
    const html2 = renderPostCard(post2);
    assert.ok(html2.includes('1 link'));
    assert.ok(!html2.includes('1 links'));
  });

  it('renders post-meta with partial analysis', () => {
    const post = {
      coverUrl: '/cover.avif',
      permalinkUrl: '/permalink/abc/',
      postId: 'poem-0001',
      postData: {
        title: 'Partial',
        date: '2024-01-15',
        analysis: {
          wordCount: 100,
        }
      }
    };
    const html = renderPostCard(post);
    assert.ok(html.includes('class="post-meta"'));
    assert.ok(html.includes('100 words'));
    assert.ok(!html.includes('links'));
    assert.ok(!html.includes('<li>15:12</li>'));
  });

  it('omits post-meta when no analysis', () => {
    const post = {
      coverUrl: '/cover.avif',
      permalinkUrl: '/permalink/abc/',
      postId: 'poem-0001',
      postData: { title: 'No Analysis', date: '2024-01-15' }
    };
    const html = renderPostCard(post);
    assert.ok(!html.includes('post-meta'));
  });
});
