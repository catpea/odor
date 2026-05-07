import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { compile } from '../../lib/tinybars.js';
import { atomicWriteFile } from '../../lib/atomic.js';
import { bootstrapBodyScript, bootstrapHeadAssets, buildPager, faviconLink, renderPostCard } from '../../lib/html.js';
import { resolvePath, interpolatePath } from '../../lib/paths.js';

export const manifest = {
  name: 'homepage',
  title: 'Generate Homepage',
  category: 'site',
  reads: ['posts.rendered', 'posts.cached'],
  writes: [],
  queue: 'files',
  idempotent: true,
  retries: 0,
};

const pagerItemTemplate = compile(
  `          <li class="page-item{{#if ariaCurrent}} active{{/if}}">` +
  `<a class="page-link"{{#if ariaCurrent}} aria-current="page"{{/if}} href="{{url}}">{{text}}</a></li>`
);

const pageTemplate = compile(`\
<!DOCTYPE html>
<html lang="en" class="h-100" data-bs-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{title}}</title>
  <link rel="alternate" type="application/rss+xml" title="{{title}} Feed" href="/feed.xml">
  {{{headAssets}}}
  {{{favicon}}}
</head>
<body class="bg-body-tertiary text-body min-vh-100">
  <main class="container-fluid py-5">
{{#if showHeader}}  <header class="row justify-content-center text-center mb-5">
    <div class="col-lg-8">
      <p class="text-primary fw-semibold text-uppercase small mb-2">Latest posts</p>
      <h1 class="display-4 fw-bold mb-3">{{title}}</h1>
      <p class="lead text-body-secondary mb-0">{{recentCount}} recent {{recentLabel}} from {{totalCount}} published {{totalLabel}}.</p>
    </div>
  </header>
{{/if}}  <section class="row row-cols-1 row-cols-md-2 row-cols-xl-3 g-4" aria-label="Latest posts">
{{{postsHtml}}}
    </section>

{{#if hasPager}}    <div class="mt-5">
{{{pagerHtml}}}
    </div>
{{/if}}

    <footer class="d-flex flex-wrap justify-content-center gap-2 mt-5">
      <a class="btn btn-outline-primary" href="/feed.xml"><i class="bi bi-rss me-1" aria-hidden="true"></i>RSS Feed</a>
      <a class="btn btn-outline-secondary" href="/playlist.m3u"><i class="bi bi-music-note-list me-1" aria-hidden="true"></i>Playlist</a>
    </footer>
  </main>
  {{{bodyScript}}}
</body>
</html>`);

export async function handle({ ctx, store, signal }) {
  signal.throwIfAborted();

  const profile      = ctx.context;
  const rendered     = store.get('posts.rendered') ?? [];
  const cached       = store.get('posts.cached')   ?? [];
  const allPosts     = [...rendered, ...cached];
  const postsPerPage = Number(profile.pagerizer?.pp ?? 12);
  const showHeader   = String(profile.header?.show) === 'true';
  const vars         = { ...profile, profile: profile.profile };
  const templates = store.get('templates');

  const localPagerItemTmpl = templates ? compile(templates.homePagerItem) : pagerItemTemplate;
  const localPageTmpl      = templates ? compile(templates.homePage)      : pageTemplate;

  const validPosts        = allPosts.filter(p => p.valid);
  const sortedNewestFirst = [...validPosts].sort((a, b) => new Date(b.postData.date) - new Date(a.postData.date));
  const latestPosts       = sortedNewestFirst.slice(0, postsPerPage);

  const archivePP  = 24;
  const totalPages = Math.ceil(validPosts.length / archivePP) || 1;
  const destDir    = resolvePath(ctx.context.baseDir, profile.pagerizer.dest, vars);
  await mkdir(destDir, { recursive: true });

  const homePagerItems = buildPager(totalPages, totalPages);
  const pagerHtml = totalPages > 1
    ? `      <nav aria-label="Archive pages">
        <ul class="pagination justify-content-center flex-wrap gap-1 mb-0">
${homePagerItems.map(item => localPagerItemTmpl(item)).join('\n')}
        </ul>
      </nav>`
    : '';

  const tmplCtx = {
    title:       profile.title,
    headAssets:  bootstrapHeadAssets(),
    favicon:     faviconLink(profile.favicon, templates),
    bodyScript:  bootstrapBodyScript(),
    showHeader,
    recentCount: latestPosts.length,
    totalCount:  validPosts.length,
    recentLabel: latestPosts.length === 1 ? 'post' : 'posts',
    totalLabel:  validPosts.length   === 1 ? 'entry' : 'entries',
    postsHtml:   latestPosts.map(p => renderPostCard(p, templates)).join('\n'),
    hasPager:    totalPages > 1,
    pagerHtml,
  };

  await atomicWriteFile(ctx, path.join(destDir, 'index.html'), localPageTmpl(tmplCtx));
  console.log(`  [homepage] Generated index.html with ${latestPosts.length} latest posts`);
  return { success: true, posts: latestPosts.length };
}
