import { compile, html } from './tinybars.js';

const faviconTemplate = compile(
  `<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>{{{emoji}}}</text></svg>">`
);

const postMetaTemplate = compile(html`\
{{#if audioDuration}}<span class="badge text-bg-info border"><i class="bi bi-clock me-1" aria-hidden="true"></i>{{audioDuration}} audio</span>{{/if}}\
{{#if wordCount}}<span class="badge text-bg-info border"><i class="bi bi-file-text me-1" aria-hidden="true"></i>{{wordCount}} words</span>{{/if}}\
{{#if hasLinks}}<a href="{{permalinkUrl}}#links" class="badge text-bg-primary text-decoration-none"><i class="bi bi-link-45deg me-1" aria-hidden="true"></i>{{linkCount}} {{linkCountText}}</a>{{/if}}
`);

const postCardTemplate = compile(html`\
<article class="col">
  <div class="card h-100 shadow border-0">
    {{#if coverUrl}}
      <a href="{{permalink}}" class="ratio ratio-1x1 bg-body-secondary rounded-top overflow-hidden"><img src="{{coverUrl}}" class="card-img-top object-fit-cover" alt="{{title}}" loading="lazy"></a>
    {{/if}}
    <div class="card-body d-flex flex-column gap-3">
      <div>
        {{#if postNumber}}<p class="text-body-secondary small fw-semibold text-uppercase mb-2">#{{postNumber}}</p>{{/if}}
        <h2 class="card-title h4 mb-0 text-wrap-balance"><a class="link-body-emphasis text-decoration-none" href="{{permalink}}">{{title}}</a></h2>
      </div>
      {{#if description}}<p class="card-text text-body-secondary mb-0">{{description}}</p>{{/if}}

      <div class="d-flex flex-wrap gap-2 mt-auto position-relative z-1">
        {{#if coverUrl}}<a class="btn {{zoomBtnClass}} btn-sm" href="{{zoomHref}}" aria-label="View image"><i class="bi bi-arrows-fullscreen me-1" aria-hidden="true"></i>{{zoomLabel}}</a>{{/if}}
        <a class="btn btn-outline-primary btn-sm" href="{{permalink}}" aria-label="Read text"><i class="bi bi-book me-1" aria-hidden="true"></i>Read</a>
        {{#if audio}}<a class="btn btn-primary btn-sm" href="{{audio}}" aria-label="Play audio"><i class="bi bi-play-circle me-1" aria-hidden="true"></i>Listen</a>{{/if}}
      </div>

    </div>
    <div class="card-footer bg-body-accent border-0">
      <div class="d-flex flex-wrap align-items-center gap-2 small">

      {{#if dateText}}
          <span class="text-body-secondary">
            <i class="bi bi-calendar3 me-1" aria-hidden="true"></i>
            <time datetime="{{dateAttr}}">{{dateText}}</time>
            </span>
        {{/if}}

        {{{postMeta}}}
        {{#each tags}}<span class="badge rounded-pill text-bg-secondary">{{this}}</span>{{/each}}
      </div>
    </div>
  </div>
</article>`);

export function faviconLink(emoji) {
  if (!emoji) return '';
  return faviconTemplate({ emoji });
}

export function bootstrapHeadAssets() {
  return (
    `<link rel="stylesheet" href="/bootstrap.min.css">\n` +
    `  <link rel="stylesheet" href="/bootstrap-icons.min.css">\n` +
    `  <link rel="stylesheet" href="/theme.css">\n  `
  );
}

export function bootstrapBodyScript() {
  return '<script src="/bootstrap.bundle.min.js"></script>';
}

export function escapeXml(value) {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildPager(currentPage, totalPages, radius = 5) {
  if (totalPages <= 1) return [];

  const windowSize = radius * 2 + 1;
  if (totalPages <= windowSize) {
    return Array.from({ length: totalPages }, (_, i) => {
      const pageNum = totalPages - i;
      return { text: `${pageNum}`, url: `page-${pageNum}.html`, ariaCurrent: pageNum === currentPage, pageNum };
    });
  }

  const pages = [];
  for (let offset = -radius; offset <= radius; offset++) {
    const pageNum = ((currentPage - 1 + offset + totalPages) % totalPages) + 1;
    pages.push({ text: `${pageNum}`, url: `page-${pageNum}.html`, ariaCurrent: pageNum === currentPage, pageNum });
  }

  const low = currentPage - radius;
  const high = currentPage + radius;
  const wrapped = pages.filter(p => p.pageNum < low || p.pageNum > high);
  const main = pages.filter(p => p.pageNum >= low && p.pageNum <= high);
  return [
    ...wrapped.sort((a, b) => b.pageNum - a.pageNum),
    ...main.sort((a, b) => b.pageNum - a.pageNum),
  ];
}

function buildPostMetaCtx(post) {
  const analysis = post?.postData?.analysis;
  if (!analysis) return null;

  const linkCount = Array.isArray(analysis.featuredUrls) ? analysis.featuredUrls.length : 0;
  return {
    audioDuration: analysis.audioDuration?.replace(/^00:/, '') ?? '',
    wordCount: analysis.wordCount != null ? Number(analysis.wordCount).toLocaleString() : '',
    hasLinks: linkCount > 0,
    linkCount,
    linkCountText: linkCount === 1 ? 'link' : 'links',
    permalinkUrl: post?.permalinkUrl ?? '',
  };
}

export function renderPostCard(post) {
  const dateValue = post?.postData?.date ? new Date(post.postData.date) : null;
  const dateText = dateValue ? dateValue.toLocaleDateString() : '';
  const dateAttr = dateValue && !Number.isNaN(+dateValue) ? dateValue.toISOString().slice(0, 10) : '';
  const tags = Array.isArray(post?.postData?.tags) ? post.postData.tags : [];
  const permalink = post?.permalinkUrl ?? '#';
  const description = post?.postData?.description
    ? post.postData.description.replace(/\n/g, ' ').replace(/ +/g, ' ').trim()
    : '';
  const postNumber = String(post?.postId ?? '').split(/-/)[1] ?? '';
  const hasZoomAvif = post?.postData?.analysis?.files?.includes('zoom.avif');
  const zoomHref = hasZoomAvif ? `${permalink}files/zoom.avif` : (post?.coverUrl || permalink);

  const metaCtx = buildPostMetaCtx(post);
  const postMeta = metaCtx ? postMetaTemplate(metaCtx).trim() : '';

  const ctx = {
    permalink,
    title: post?.postData?.title ?? post?.postId ?? '',
    description,
    audio: post?.audioUrl ?? '',
    postNumber,
    dateText,
    dateAttr,
    coverUrl: post?.coverUrl ?? '',
    zoomHref,
    zoomBtnClass: hasZoomAvif ? 'btn-primary' : 'btn-outline-secondary',
    zoomLabel: hasZoomAvif ? 'Zoom+' : 'Zoom',
    tags,
    postMeta,
  };

  return postCardTemplate(ctx).trim();
}
