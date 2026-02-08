import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { resolvePath, interpolatePath, processedPosts, escapeXml, atomicWriteFile } from '../../lib.js';

export default function rssFeed() {
  let expectedTotal = null;
  const collected = [];

  return async (send, packet) => {
    if (packet._totalPosts !== undefined) {
      expectedTotal = packet._totalPosts;
    }

    collected.push(packet);

    if (expectedTotal !== null && collected.length >= expectedTotal) {
      const { profile } = packet;
      const validPosts = processedPosts.filter(p => p.valid);

      const sortedPosts = [...validPosts].sort((a, b) =>
        new Date(b.postData.date) - new Date(a.postData.date)
      );

      const destPath = resolvePath(interpolatePath(profile.feed.dest, { profile }));
      await mkdir(path.dirname(destPath), { recursive: true });

      const buildDate = new Date().toUTCString();

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(profile.title)}</title>
    <link>${profile.url}/</link>
    <description>${escapeXml(profile.title)} - Latest Posts</description>
    <language>en-us</language>
    <lastBuildDate>${buildDate}</lastBuildDate>
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

      await atomicWriteFile(destPath, xml);
      console.log(`  [feed] Generated feed.xml with ${Math.min(sortedPosts.length, 50)} items`);

      send({ _complete: true, feedGenerated: true, items: Math.min(sortedPosts.length, 50) });
    } else {
      send({ _complete: false });
    }
  };
}
