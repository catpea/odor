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

function renderPostMeta(post) {
  const analysis = post?.postData?.analysis;

  if (!analysis) return '';
  const items = [];

  if (analysis.audioDuration) {
    items.push(`<span class="detail">${analysis.audioDuration.replace(/^00:/, '')} audio duration</span>`);
  }

  if (analysis.wordCount != null) {
    items.push(`<span class="detail">${analysis.wordCount.toLocaleString()} words</span>`);
  }

  if (Array.isArray(analysis.featuredUrls) && analysis.featuredUrls.length > 0) {
    const n = analysis.featuredUrls.length;
    items.push(`<a href="${post?.permalinkUrl}#links" class="detail primary">${n} ${n === 1 ? 'link' : 'links'}</a>`);
  }

  if (items.length === 0) return '';
  return  items.join(' ') ;
}

export function renderPostCard(post) {
  const dateValue = post?.postData?.date ? new Date(post.postData.date) : null;
  const dateText = dateValue ? dateValue.toLocaleDateString() : "";
  const dateAttr = dateValue && !Number.isNaN(+dateValue) ? dateValue.toISOString().slice(0, 10) : "";

  const tags = Array.isArray(post?.postData?.tags) ? post.postData.tags : [];
  const title = post?.postData?.title ? escapeXml(post.postData.title) : "";
  const audio = post?.audioUrl ? escapeXml(post.audioUrl) : "";
  const description = post?.postData?.description ? escapeXml( post.postData.description .replace(/\n/g, " ") .replace(/ /g, " ") .replace(/ +/g, " ") .trim() ) : "";
  const postNumber = String(post?.postId ?? "").split(/-/)[1] ?? "";
  const permalink = post?.permalinkUrl ?? "#";

  const hasZoomAvif =  post?.postData?.analysis?.files?.includes('zoom.avif');

    if( post?.postData?.analysis?.files?.length && hasZoomAvif ){
      console.log(title, hasZoomAvif)
    }

return `<article class="post">
  ${post?.coverUrl ? `<figure class="cover"><a href="${permalink}"><img src="${post.coverUrl}" alt="${escapeXml(title)}" loading="lazy"></a> </figure>` : ""}
  <h2 class="title"><a href="${permalink}"><span class="title-text">${title}</span></a></h2>

  <p class="actions">
    ${1 ? `<a class="${['action', 'view-image', (hasZoomAvif?'primary':'')].filter(o=>o).join(' ')}" href="${hasZoomAvif ? permalink+'files/zoom.avif' : post.coverUrl}" aria-label="View Image">zoom${hasZoomAvif ? '+' : ''}</a> ` : ""}
    ${1 ? `<a class="action read-text" href="${permalink}" aria-label="Read Text">read</a> ` : ""}
    ${post?.audioUrl ? `<a class="action play-audio primary" href="${audio}" aria-label="Play Audio">listen</a> ` : ""}
  </p>

  ${description ? `<p class="text">${description}</p>` : ""}
  <p class="details">
  ${dateText ? `<span class="detail"> #${postNumber}</span>` : ""}
  ${dateText ? `<span class="detail"> published <time class="time" datetime="${dateAttr}">${dateText}</time></span>` : ""}
  ${renderPostMeta(post)}
  ${tags.length ? tags.map(tag => `<span class="tag">${escapeXml(tag)}</span>`).join(" ") : ""}
  </p>
</article>`.trim();
}
