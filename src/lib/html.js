export function faviconLink(emoji) {
  if (!emoji) return '';
  return `<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${emoji}</text></svg>">`;
}

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

function renderPostMeta(analysis) {
  if (!analysis) return '';
  const items = [];

  if (analysis.audioDuration) {
    items.push(`<li>${analysis.audioDuration.replace(/^00:/, '')} audio</li>`);
  }

  if (analysis.wordCount != null) {
    items.push(`<li>${analysis.wordCount.toLocaleString()} words</li>`);
  }

  if (Array.isArray(analysis.featuredUrls) && analysis.featuredUrls.length > 0) {
    const n = analysis.featuredUrls.length;
    items.push(`<li>${n} ${n === 1 ? 'link' : 'links'}</li>`);
  }

  if (items.length === 0) return '';
  return `<ul class="meta" aria-label="Post info">${items.join('')}</ul>`;
}

export function renderPostCard(post) {
  const dateValue = post?.postData?.date ? new Date(post.postData.date) : null;
  const dateText = dateValue ? dateValue.toLocaleDateString() : "";
  const dateAttr = dateValue && !Number.isNaN(+dateValue) ? dateValue.toISOString().slice(0, 10) : "";

  const tags = Array.isArray(post?.postData?.tags) ? post.postData.tags : [];
  const title = post?.postData?.title ? escapeXml(post.postData.title) : "";
  const audio = post?.audioUrl ? escapeXml(post.audioUrl) : "";
  const description = post?.postData?.description
    ? escapeXml(
        post.postData.description
          .replace(/\n/g, " ")
          .replace(/ /g, " ")
          .replace(/ +/g, " ")
          .trim()
      )
    : "";

  const postNumber = String(post?.postId ?? "").split(/-/)[1] ?? "";
  const permalink = post?.permalinkUrl ?? "#";

  return `<article class="post">
  ${post?.coverUrl ? `<figure class="cover">
    <a href="${permalink}"><img src="${post.coverUrl}" alt="" loading="lazy"></a>
    ${post?.audioUrl ? `<a class="btn play" href="${audio}" aria-label="Play audio for #${postNumber}: ${title}">&#9654;</a>` : ""}
  </figure>` : ""}
  ${dateText ? `<time class="time" datetime="${dateAttr}">${dateText}</time>` : ""}
  <h2 class="title"><a href="${permalink}"><span class="number">#${postNumber}</span>: ${title}</a></h2>
  ${renderPostMeta(post?.postData?.analysis)}
  ${description ? `<p class="text">${description}</p>` : ""}
  ${tags.length ? `<p class="tags">${tags.map(tag => `<span class="tag">${escapeXml(tag)}</span>`).join(", ")}</p>` : ""}
</article>`.trim();
}
