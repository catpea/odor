export function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildPager(currentPage, totalPages, radius = 5) {
  if (totalPages <= 1) return [];

  // Small page count: list all pages descending
  const window = radius * 2 + 1;
  if (totalPages <= window) {
    return Array.from({ length: totalPages }, (_, i) => {
      const pn = totalPages - i;
      return { text: `${pn}`, url: `page-${pn}.html`, ariaCurrent: pn === currentPage, pageNum: pn };
    });
  }

  // Large page count: circular window centered on currentPage
  const pages = [];
  for (let offset = -radius; offset <= radius; offset++) {
    const pn = ((currentPage - 1 + offset + totalPages) % totalPages) + 1;
    pages.push({ text: `${pn}`, url: `page-${pn}.html`, ariaCurrent: pn === currentPage, pageNum: pn });
  }
  const low = currentPage - radius;
  const high = currentPage + radius;
  const wrapped = pages.filter(p => p.pageNum < low || p.pageNum > high);
  const main = pages.filter(p => p.pageNum >= low && p.pageNum <= high);
  return [
    ...wrapped.sort((a, b) => b.pageNum - a.pageNum),
    ...main.sort((a, b) => b.pageNum - a.pageNum)
  ];
}

export function renderPostCard(post) {
  return `    <article class="post">
      ${post.coverUrl ? `<a href="${post.permalinkUrl}"><img src="${post.coverUrl}" alt="" loading="lazy"></a>` : ``}
      <div class="post-content">
        <h2><a href="${post.permalinkUrl}">${post.postData.title || post.postId}</a></h2>
        <time>${post.postData.date ? new Date(post.postData.date).toLocaleDateString() : ''}</time>
      </div>
    </article>`;
}
