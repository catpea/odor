import fs from 'node:fs';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { compile, html } from '../../lib/tinybars.js';
import { atomicWriteFile } from '../../lib/atomic.js';
import { resolvePath, interpolatePath } from '../../lib/paths.js';
import { bootstrapBodyScript, bootstrapHeadAssets, escapeXml, faviconLink } from '../../lib/html.js';

export const manifest = {
  name: 'process-text',
  title: 'Process Text',
  category: 'posts',
  reads: ['post', 'post.cover', 'post.audio'],
  writes: ['post.text'],
  idempotent: true,
  retries: 0,
};

// ── Article template ──────────────────────────────────────────────────────────

const articlePageTemplate = compile(html`\
<!DOCTYPE html>
<html lang="en" class="h-100" data-bs-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{title}}</title>
  {{{headAssets}}}
  {{{favicon}}}
</head>
<body class="bg-body-tertiary text-body min-vh-100">
  <main class="container py-5">
    <article class="row justify-content-center">

      <div class="col-lg-10 col-xl-8">

        <nav class="mb-4" aria-label="Post navigation">
          <a class="btn btn-outline-secondary btn-sm" href="/"><i class="bi bi-arrow-left me-1" aria-hidden="true"></i><i class="bi bi-house me-1" aria-hidden="true"></i></a>
        </nav>

        <div class="card border-0 shadow-sm overflow-hidden mb-3">

          {{{coverImage}}}

          <div class="card-body p-4 p-md-5">

            {{#if audio}}
              <audio class="w-100 mb-4" controls src="{{audio}}"></audio>
            {{/if}}

            <nav aria-label="breadcrumb">
              <ol class="breadcrumb">
                <li class="breadcrumb-item fw-lighter">Chapter {{chapter}}</li>
                <li class="breadcrumb-item fw-lighter active">Post #{{postNumber}}</li>
              </ol>
            </nav>
            <header class="mb-5">
              {{#if title}}<h1 class="display-5 fw-bold lh-1 mb-3 text-wrap-balance">{{title}}</h1>{{/if}}
              {{#if dateText}}<p class="text-body-secondary mb-0"><i class="bi bi-calendar3 me-2" aria-hidden="true"></i><time datetime="{{isoDate}}">{{dateText}}</time></p>{{/if}}
            </header>

            <section class="d-grid gap-3">
            {{{contentHtml}}}
            </section>

          </div>
        </div>

        {{#if hasLinks}}
          <div class="card border-0 shadow-sm overflow-hidden mb-3">
              <div class="card-body">
                <h2 id="links" class="h4 mb-3"><i class="bi bi-link-45deg me-2" aria-hidden="true"></i>Links</h2>
              </div>
              <ul class="list-group list-group-flush">
                {{#each links}}
                  <li class="list-group-item">
                    <a class="text-decoration-none my-2" href="{{href}}">
                      <span class="fw-semibold text-secondary"><i class="bi bi-link text-warning"></i> {{text}}</span>
                      <small class="d-block text-body-secondary fw-lighter mt-2">{{href}}</small>
                    </a>
                  </li>
                {{/each}}
              </ul>
          </div>
        {{/if}}

        {{#if hasArtwork}}
          <div class="card border-0 shadow-sm overflow-hidden mb-3">
              <div class="card-body">
                <h2 class="h5 mb-3"><i class="bi bi-palette me-2" aria-hidden="true"></i>Artwork</h2>
              </div>
              <ul class="list-group list-group-flush">
                {{#each artworkItems}}
                <li class="list-group-item">
                  <a class="text-decoration-none" href="{{url}}"><i class="bi bi-image text-secondary me-2" aria-hidden="true"></i><small class="text-secondary">{{url}}</small></a>
                </li>
                {{/each}}
              </ul>
          </div>
        {{/if}}

      </div>
    </article>
  </main>
  {{{bodyScript}}}
</body>
</html>`);

// ── Markdown ──────────────────────────────────────────────────────────────────

async function renderMarkdown(markdown) {
  try {
    const mod = await import('marked');
    return mod.marked(markdown);
  } catch {
    return fallbackMarkdown(markdown);
  }
}

function fallbackMarkdown(markdown) {
  return markdown.split(/\n{2,}/).map(block => {
    const t = block.trim();
    if (!t) return '';
    if (/^---+$/.test(t)) return '<hr>';
    if (t.startsWith('# '))  return `<h1>${escapeXml(t.slice(2))}</h1>`;
    if (t.startsWith('## ')) return `<h2>${escapeXml(t.slice(3))}</h2>`;
    return `<p>${escapeXml(t).replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
}

function decorateMarkdownHtml(html) {
  return html
    .replace(/<hr>/gi,         '<hr class="my-4">')
    .replace(/<p>/gi,          '<p class="fs-5 lh-lg mb-0">')
    .replace(/<h1>/gi,         '<h2 class="h2 fw-bold mt-4 mb-2">')
    .replace(/<\/h1>/gi,       '</h2>')
    .replace(/<h2>/gi,         '<h2 class="h3 fw-bold mt-4 mb-2">')
    .replace(/<h3>/gi,         '<h3 class="h4 fw-semibold mt-4 mb-2">')
    .replace(/<ul>/gi,         '<ul class="list-group list-group-flush mb-3">')
    .replace(/<ol>/gi,         '<ol class="list-group list-group-numbered list-group-flush mb-3">')
    .replace(/<li>/gi,         '<li class="list-group-item px-0 bg-transparent fs-5">')
    .replace(/<blockquote>/gi, '<blockquote class="blockquote border-start border-4 ps-3 text-body-secondary">')
    .replace(/<a /gi,          '<a class="link-primary link-offset-2 link-underline-opacity-25 link-underline-opacity-100-hover" ');
}

function collectLinks(html) {
  const linkRegex = /<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  const links = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const text = match[2].replace(/<[^>]*>/g, '').trim() || href;
    links.push({ href, text });
  }
  return links;
}

// ── Handle ────────────────────────────────────────────────────────────────────

export async function handle({ ctx, frame, signal }) {
  signal.throwIfAborted();

  const post        = frame.local.get('post');
  const coverResult = frame.local.get('post.cover') ?? {};
  const audioResult = frame.local.get('post.audio') ?? {};

  const { postId, postDir, guid, chapter, postData, files } = post;
  const profile  = ctx.context;
  const vars     = { ...profile, profile: profile.profile, ...postData, id: postId, guid, chapter };

  if (!fs.existsSync(files.text)) {
    console.log(`  [text] ${postId}: No text.md`);
    return { skipped: true };
  }

  try {
    const markdown    = await readFile(files.text, 'utf-8');
    const contentHtml = decorateMarkdownHtml(await renderMarkdown(markdown));
    const links       = collectLinks(contentHtml);

    const destDir  = resolvePath(ctx.context.baseDir, `${profile.dest}/permalink/${guid}`, vars);
    await mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, 'index.html');

    const coverUrl  = coverResult.url ?? '';
    const audioUrl  = audioResult.url ?? '';
    const dateValue = postData.date ? new Date(postData.date) : null;
    const dateText  = dateValue ? dateValue.toLocaleDateString() : '';
    const isoDate   = dateValue && !Number.isNaN(+dateValue) ? dateValue.toISOString().slice(0, 10) : '';
    const artwork   = Array.isArray(postData.artwork) && postData.artwork.length > 0 ? postData.artwork : null;
    const hasZoomAvif = postData.analysis?.files?.includes('zoom.avif');

    const coverImage = coverUrl
      ? hasZoomAvif
        ? `<a href="files/zoom.avif"><img class="card-img-top object-fit-cover" src="${escapeXml(coverUrl)}" alt="${escapeXml(postData.title || postId)}"></a>`
        : `<img class="card-img-top object-fit-cover" src="${escapeXml(coverUrl)}" alt="${escapeXml(postData.title || postId)}">`
      : '';

    const artworkItems = artwork
      ? artwork.map((url, i) => ({ url, credit: artwork.length > 1 ? `credit #${i + 1}` : 'credit' }))
      : [];

    const tmplCtx = {
      postId,
      postNumber: postId.split('-')[1],
      chapter,
      title:      postData.title || postId,
      headAssets: bootstrapHeadAssets(),
      favicon:    faviconLink(profile.favicon),
      bodyScript: bootstrapBodyScript(),
      audio:      audioUrl,
      dateText,
      isoDate,
      coverImage,
      contentHtml,
      links,
      hasLinks:    links.length > 0,
      artworkItems,
      hasArtwork:  artworkItems.length > 0,
    };

    const fullHtml = articlePageTemplate(tmplCtx);
    await atomicWriteFile(ctx, destPath, fullHtml);
    console.log(`  [text] ${postId}: Generated index.html`);
    return { success: true, path: path.relative(process.cwd(), destPath), htmlLength: fullHtml.length };
  } catch (err) {
    console.error(`  [text] ${postId}: Error - ${err.message}`);
    return { error: err.message };
  }
}
