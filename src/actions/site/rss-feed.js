import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { atomicWriteFile } from '../../lib/atomic.js';
import { escapeXml } from '../../lib/html.js';
import { resolvePath, interpolatePath } from '../../lib/paths.js';

export const manifest = {
  name: 'rss-feed',
  title: 'Generate RSS Feed',
  category: 'site',
  reads: ['posts.rendered', 'posts.cached'],
  writes: [],
  queue: 'files',
  idempotent: true,
  retries: 0,
};

export async function handle({ ctx, store, signal }) {
  signal.throwIfAborted();

  const profile   = ctx.context;
  const rendered  = store.get('posts.rendered') ?? [];
  const cached    = store.get('posts.cached')   ?? [];
  const allPosts  = [...rendered, ...cached];
  const vars      = { ...profile, profile: profile.profile };

  const validPosts   = allPosts.filter(p => p.valid);
  const sortedPosts  = [...validPosts].sort((a, b) => new Date(b.postData.date) - new Date(a.postData.date));
  const destPath     = resolvePath(ctx.context.baseDir, profile.feed.dest, vars);
  await mkdir(path.dirname(destPath), { recursive: true });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(profile.title)}</title>
    <link>${profile.url}/</link>
    <description>${escapeXml(profile.title)} - Latest Posts</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${profile.url}/feed.xml" rel="self" type="application/rss+xml"/>
${sortedPosts.slice(0, 50).map(post => `    <item>
      <title>${escapeXml(post.postData.title || post.postId)}</title>
      <link>${profile.url}/permalink/${post.guid}/</link>
      <guid isPermaLink="true">${profile.url}/permalink/${post.guid}/</guid>
      <pubDate>${new Date(post.postData.date).toUTCString()}</pubDate>
      ${post.postData.description ? `<description>${escapeXml(post.postData.description)}</description>` : ''}
      ${post.coverUrl ? `<enclosure url="${post.coverUrl}" type="image/avif"/>` : ''}
    </item>`).join('\n')}
  </channel>
</rss>`;

  await atomicWriteFile(ctx, destPath, xml);
  console.log(`  [feed] Generated feed.xml with ${Math.min(sortedPosts.length, 50)} items`);
  return { success: true, items: Math.min(sortedPosts.length, 50) };
}
