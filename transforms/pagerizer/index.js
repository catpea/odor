import { mkdir } from 'node:fs/promises';
import { resolvePath, processedPosts, renderPostCard, chunk, buildPager, atomicWriteFile } from '../../lib.js';

export default function pagerizer({ pp = 24 } = {}) {
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

      // Sort newest first: chunk[0] = newest pp posts, chunk[N] = oldest (remainder)
      const sortedPosts = [...validPosts].sort((a, b) =>
        new Date(b.postData.date) - new Date(a.postData.date)
      );

      const chunks = chunk(sortedPosts, pp);
      if (chunks.length === 0) chunks.push([]);

      const totalPages = chunks.length;
      const destDir = resolvePath(profile.pagerizer.dest);
      await mkdir(destDir, { recursive: true });

      for (let i = 0; i < chunks.length; i++) {
        // Page number: chunk 0 = Page N (highest/newest), chunk N-1 = Page 1 (lowest/oldest)
        const pageNumber = totalPages - i;
        const chunkPosts = chunks[i];

        const olderChunkIndex = i + 1 < chunks.length ? i + 1 : null;
        const newerChunkIndex = i - 1 >= 0 ? i - 1 : null;

        const olderPageNumber = olderChunkIndex !== null ? totalPages - olderChunkIndex : null;
        const newerPageNumber = newerChunkIndex !== null ? totalPages - newerChunkIndex : null;

        const pager = buildPager(pageNumber, totalPages);

        const pagerHtml = totalPages > 1
          ? `  <nav class="pager">
    <a href="index.html">Home</a>
${pager.map(p => p.ariaCurrent
  ? `    <span aria-current="true">${p.text}</span>`
  : `    <a href="${p.url}">${p.text}</a>`
).join('\n')}
  </nav>`
          : `  <nav class="pager">
    <a href="index.html">Home</a>
  </nav>`;

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${profile.title} - Page ${pageNumber}</title>
  <link rel="alternate" type="application/rss+xml" title="${profile.title} Feed" href="/feed.xml">
  <link rel="stylesheet" href="/style.css">
</head>
<body>


  <main class="posts">
${chunkPosts.map(renderPostCard).join('\n')}
  </main>

  <nav class="nav">
    ${newerPageNumber ? `<a href="page-${newerPageNumber}.html">&larr; Newer</a>` : '<a href="index.html">&larr; Home</a>'}
    <span>Page ${pageNumber} of ${totalPages}</span>
    ${olderPageNumber ? `<a href="page-${olderPageNumber}.html">Older &rarr;</a>` : '<span></span>'}
  </nav>

${pagerHtml}

  <footer>
    <p><a href="/feed.xml">RSS Feed</a></p>
  </footer>
</body>
</html>`;

        await atomicWriteFile(`${destDir}/page-${pageNumber}.html`, html);
      }

      console.log(`  [pagerizer] Generated ${chunks.length} archive page(s)`);

      send({ _complete: true, pagerized: true, totalPages });
    } else {
      send({ _complete: false });
    }
  };
}
