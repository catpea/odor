import { mkdir } from 'node:fs/promises';
import { compile } from '../../lib/tinybars.js';
import { atomicWriteFile } from '../../lib/atomic.js';
import { bootstrapBodyScript, bootstrapHeadAssets, buildPager, faviconLink, renderPostCard } from '../../lib/html.js';
import { chunk } from '../../lib/chunk.js';
import { resolvePath, interpolatePath } from '../../lib/paths.js';

export const manifest = {
  name: 'pagerizer',
  title: 'Generate Archive Pages',
  category: 'site',
  reads: ['posts.rendered', 'posts.cached'],
  writes: [],
  queue: 'files',
  idempotent: true,
  retries: 0,
};

const pagerItemTemplate = compile(
  `{{#if ariaCurrent}}<li class="page-item active"><span class="page-link" aria-current="page">{{text}}</span></li>{{/if}}` +
  `{{#if notCurrent}}<li class="page-item"><a class="page-link" href="{{url}}">{{text}}</a></li>{{/if}}`
);

const pageTemplate = compile(`\
<!DOCTYPE html>
<html lang="en" class="h-100" data-bs-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{title}} - Page {{pageNumber}}</title>
  <link rel="alternate" type="application/rss+xml" title="{{title}} Feed" href="/feed.xml">
  {{{headAssets}}}
  {{{favicon}}}
</head>
<body class="bg-body-tertiary text-body min-vh-100">
  <main class="container-fluid py-5">
    <header class="row justify-content-center text-center mb-5">
      <div class="col-lg-8">
        <p class="text-primary fw-semibold text-uppercase small mb-2">Archive</p>
        <h1 class="display-5 fw-bold mb-3">{{title}}</h1>
        <p class="lead text-body-secondary mb-0">Page {{pageNumber}} of {{totalPages}}</p>
      </div>
    </header>

    <section class="row row-cols-1 row-cols-md-2 row-cols-xl-3 g-4" aria-label="Archive posts">
{{{postsHtml}}}
    </section>

    <nav class="d-flex justify-content-between align-items-center gap-3 mt-5" aria-label="Adjacent archive pages">
      {{{newerNav}}}
      <span class="badge text-bg-light border">Page {{pageNumber}} of {{totalPages}}</span>
      {{{olderNav}}}
    </nav>

    <div class="mt-4">
{{{pagerHtml}}}
    </div>

    <footer class="d-flex flex-wrap justify-content-center gap-2 mt-5">
      <a class="btn btn-outline-primary" href="/feed.xml"><i class="bi bi-rss me-1" aria-hidden="true"></i>RSS Feed</a>
    </footer>
  </main>
  {{{bodyScript}}}
</body>
</html>`);

function buildPagerNav(pager, totalPages, itemTmpl) {
  const homeLink = `          <li class="page-item"><a class="page-link" href="index.html"><i class="bi bi-house me-1" aria-hidden="true"></i>Home</a></li>`;
  if (totalPages <= 1) {
    return `      <nav aria-label="Archive pages">
        <ul class="pagination justify-content-center mb-0">
${homeLink}
        </ul>
      </nav>`;
  }
  const items = pager.map(p => itemTmpl({ ...p, notCurrent: !p.ariaCurrent })).join('\n          ');
  return `      <nav aria-label="Archive pages">
        <ul class="pagination justify-content-center flex-wrap gap-1 mb-0">
${homeLink}
          ${items}
        </ul>
      </nav>`;
}

export async function handle({ ctx, store, signal }) {
  signal.throwIfAborted();

  const profile      = ctx.context;
  const rendered     = store.get('posts.rendered') ?? [];
  const cached       = store.get('posts.cached')   ?? [];
  const allPosts     = [...rendered, ...cached];
  const postsPerPage = Number(profile.pagerizer?.pp ?? 24);
  const vars         = { ...profile, profile: profile.profile };
  const templates = store.get('templates');

  const localPagerItemTmpl = templates ? compile(templates.archivePagerItem) : pagerItemTemplate;
  const localPageTmpl      = templates ? compile(templates.archivePage)      : pageTemplate;

  const validPosts  = allPosts.filter(p => p.valid);
  const sortedPosts = [...validPosts].sort((a, b) => new Date(b.postData.date) - new Date(a.postData.date));
  const chunks      = chunk(sortedPosts, postsPerPage);
  if (chunks.length === 0) chunks.push([]);

  const totalPages = chunks.length;
  const destDir    = resolvePath(ctx.context.baseDir, profile.pagerizer.dest, vars);
  await mkdir(destDir, { recursive: true });

  for (let ci = 0; ci < chunks.length; ci++) {
    const pageNumber      = totalPages - ci;
    const chunkPosts      = chunks[ci];
    const olderChunkIndex = ci + 1 < chunks.length ? ci + 1 : null;
    const newerChunkIndex = ci - 1 >= 0            ? ci - 1 : null;
    const olderPageNumber = olderChunkIndex !== null ? totalPages - olderChunkIndex : null;
    const newerPageNumber = newerChunkIndex !== null ? totalPages - newerChunkIndex : null;

    const newerNav = newerPageNumber
      ? `<a class="btn btn-outline-primary" href="page-${newerPageNumber}.html"><i class="bi bi-arrow-left me-1" aria-hidden="true"></i>Newer</a>`
      : `<a class="btn btn-outline-secondary" href="index.html"><i class="bi bi-house me-1" aria-hidden="true"></i>Home</a>`;
    const olderNav = olderPageNumber
      ? `<a class="btn btn-outline-primary" href="page-${olderPageNumber}.html">Older<i class="bi bi-arrow-right ms-1" aria-hidden="true"></i></a>`
      : `<span class="d-none d-sm-inline-block"></span>`;

    const tmplCtx = {
      title:      profile.title,
      headAssets: bootstrapHeadAssets(),
      favicon:    faviconLink(profile.favicon, templates),
      bodyScript: bootstrapBodyScript(),
      pageNumber,
      totalPages,
      postsHtml:  chunkPosts.map(p => renderPostCard(p, templates)).join('\n'),
      newerNav,
      olderNav,
      pagerHtml:  buildPagerNav(buildPager(pageNumber, totalPages), totalPages, localPagerItemTmpl),
    };

    await atomicWriteFile(ctx, `${destDir}/page-${pageNumber}.html`, localPageTmpl(tmplCtx));
  }

  console.log(`  [pagerizer] Generated ${chunks.length} archive page(s)`);
  return { success: true, totalPages };
}
