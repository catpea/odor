import fs from 'node:fs';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { compile } from '../../lib/tinybars.js';
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

// ── Markdown ──────────────────────────────────────────────────────────────────

async function renderMarkdown(markdown) {
  try {
    const mod = await import('marked');
    const fn = mod.marked?.parse ?? mod.marked ?? mod.default?.parse ?? mod.default;
    if (typeof fn !== 'function') throw new Error('marked not usable');
    return await fn(markdown);
  } catch {
    return fallbackMarkdown(markdown);
  }
}

function inlineMarkdown(escaped) {
  return escaped
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g,       '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g,           '<em>$1</em>')
    .replace(/`([^`\n]+)`/g,             '<code>$1</code>');
}

function fallbackMarkdown(markdown) {
  return markdown.split(/\n{2,}/).map(block => {
    const t = block.trim();
    if (!t) return '';
    if (/^---+$/.test(t)) return '<hr>';
    if (t.startsWith('# '))   return `<h1>${inlineMarkdown(escapeXml(t.slice(2)))}</h1>`;
    if (t.startsWith('## '))  return `<h2>${inlineMarkdown(escapeXml(t.slice(3)))}</h2>`;
    if (t.startsWith('### ')) return `<h3>${inlineMarkdown(escapeXml(t.slice(4)))}</h3>`;

    const lines = t.split('\n');
    if (lines.every(l => /^[*-] /.test(l.trim()))) {
      const items = lines.map(l => `<li>${inlineMarkdown(escapeXml(l.trim().slice(2)))}</li>`).join('');
      return `<ul>${items}</ul>`;
    }
    if (lines.every(l => /^\d+\. /.test(l.trim()))) {
      const items = lines.map(l => `<li>${inlineMarkdown(escapeXml(l.trim().replace(/^\d+\. /, '')))}</li>`).join('');
      return `<ol>${items}</ol>`;
    }

    return `<p>${inlineMarkdown(escapeXml(t)).replace(/\n/g, '<br>')}</p>`;
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
    .replace(/<a /gi,          '<a class="link-info link-offset-2 link-underline-opacity-25 link-underline-opacity-100-hover" ');
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

export async function handle({ ctx, store, frame, signal }) {
  signal.throwIfAborted();

  const post        = frame.local.get('post');
  const coverResult = frame.local.get('post.cover') ?? {};
  const audioResult = frame.local.get('post.audio') ?? {};

  const { postId, postDir, guid, chapter, postData, files } = post;
  const profile   = ctx.context;
  const vars      = { ...profile, profile: profile.profile, ...postData, id: postId, guid, chapter };
  const templates = store.get('templates');
  if (!templates) throw new Error('[process-text] No templates loaded — configure template.src in settings.xml');
  const localArticlePageTemplate = compile(templates.articlePage);

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
      favicon:    faviconLink(profile.favicon, templates),
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

    const fullHtml = localArticlePageTemplate(tmplCtx);
    await atomicWriteFile(ctx, destPath, fullHtml);
    console.log(`  [text] ${postId}: Generated index.html`);
    return { success: true, path: path.relative(process.cwd(), destPath), htmlLength: fullHtml.length };
  } catch (err) {
    console.error(`  [text] ${postId}: Error - ${err.message}`);
    return { error: err.message };
  }
}
