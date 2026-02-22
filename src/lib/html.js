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
  const dateValue = post?.postData?.date ? new Date(post.postData.date) : null;
  const dateText = dateValue ? dateValue.toLocaleDateString() : "";
  const dateAttr = dateValue && !Number.isNaN(+dateValue) ? dateValue.toISOString().slice(0, 10) : "";

  const tags = Array.isArray(post?.postData?.tags) ? post.postData.tags : [];
  const title = post?.postData?.title ? escapeXml(post.postData.title) : "";
  const audio = post?.audioResult?.url ? escapeXml(post.audioResult.url) : "";
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

  return `
    <article class="post">

      ${post?.coverUrl ? `
        <figure class="post-media">
          <a class="post-mediaLink" href="${permalink}">
            <img src="${post.coverUrl}" alt="" loading="lazy" />
          </a>

          ${post?.audioResult?.url ? `
            <a
              class="post-play"
              href="${audio}"
              aria-label="Play audio for #${postNumber}: ${title}"
              title="Play narrated version"
            >&#9654;</a>
          ` : ""}
        </figure>
      ` : ""}

      <header class="post-content">
        ${dateText ? `<time datetime="${dateAttr}">${dateText}</time>` : ""}

        <h2 class="post-title">
          <a href="${permalink}">#${postNumber}: ${title}</a>
        </h2>

        ${tags.length ? `
          <ul class="post-tags" aria-label="Tags">
            ${tags.map(tag => `<li><small>${escapeXml(tag)}</small></li>`).join(" ")}
          </ul>
        ` : ""}

        ${description ? `<p class="post-description"><small>${description}</small></p>` : ""}
      </header>
    </article>
  `.trim();

}
