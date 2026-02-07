import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { resolvePath, processedPosts, renderPostCard, buildPager, atomicWriteFile } from '../../lib.js';

export default function homepage({ pp = 12 } = {}) {
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
      const sortedNewestFirst = [...validPosts].sort((a, b) =>
        new Date(b.postData.date) - new Date(a.postData.date)
      );

      const latestPosts = sortedNewestFirst.slice(0, pp);

      const archivePP = 24;
      const totalPages = Math.ceil(validPosts.length / archivePP) || 1;

      const destDir = resolvePath(profile.pagerizer.dest);
      await mkdir(destDir, { recursive: true });

      const homePager = buildPager(totalPages, totalPages);

      const pagerHtml = totalPages > 1
        ? `  <nav class="pager">
${homePager.map(p => p.ariaCurrent
  ? `    <a aria-current="true"href="${p.url}">${p.text}</a>`
  : `    <a href="${p.url}">${p.text}</a>`
).join('\n')}
  </nav>`
        : '';

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${profile.title}</title>
  <link rel="alternate" type="application/rss+xml" title="${profile.title} Feed" href="/feed.xml">
  <link rel="stylesheet" href="/style.css">
</head>
<body>

  <main class="posts">
${latestPosts.map(renderPostCard).join('\n')}
  </main>

${pagerHtml}

  <footer>
    <p><a href="/feed.xml">RSS</a></p>
  </footer>
</body>
</html>`;

      const filePath = path.join(destDir, 'index.html');
      await atomicWriteFile(filePath, html);
      console.log(`  [homepage] Generated index.html with ${latestPosts.length} latest posts`);

      send({ _complete: true, homepageGenerated: true, posts: latestPosts.length });
    } else {
      send({ _complete: false });
    }
  };
}
