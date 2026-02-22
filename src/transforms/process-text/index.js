import fs from 'node:fs';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { marked } from 'marked';
import { resolvePath, interpolatePath, atomicWriteFile, escapeXml } from '../../lib/index.js';

export default function processText() {
  return async (send, packet) => {
    if (packet._cached) {
      send({ ...packet, textResult: packet._cachedResults.textResult });
      return;
    }

    const { branches, guid, postId, postData, profile } = packet;
    const vars = { ...packet, ...packet.postData };

    const coverBranch = branches?.find(b => b.coverResult);
    const audioBranch = branches?.find(b => b.audioResult);
    const filesBranch = branches?.find(b => b.files);

    const files = filesBranch?.files || packet.files;

    if (!fs.existsSync(files.text)) {
      console.log(`  [text] ${postId}: No text.md`);
      send({ ...packet, textResult: { skipped: true } });
      return;
    }

    try {
      const markdown = await readFile(files.text, 'utf-8');
      const html = marked(markdown);

      const linkRegex = /<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      const seen = new Set();
      const links = [];
      let m;
      while ((m = linkRegex.exec(html)) !== null) {
        const href = m[1];
        if (!href || seen.has(href)) continue;
        seen.add(href);
        const text = m[2].replace(/<[^>]*>/g, '').trim() || href;
        let domain;
        try { domain = new URL(href.replace(/&amp;/g, '&')).hostname; } catch { domain = 'local'; }
        links.push({ href, text, domain });
      }

      const destDir = resolvePath(interpolatePath(`${profile.dest}/permalink/${guid}`, vars));
      await mkdir(destDir, { recursive: true });

      const destPath = path.join(destDir, 'index.html');

      const coverUrl = coverBranch?.coverResult?.url;
      const audioUrl = audioBranch?.audioResult?.url;

      const title = escapeXml(postData.title || postId);
      const dateValue = postData.date ? new Date(postData.date) : null;
      const dateText = dateValue ? dateValue.toLocaleDateString() : '';
      const isoDate = dateValue && !Number.isNaN(+dateValue) ? dateValue.toISOString().slice(0, 10) : '';
      const artwork = Array.isArray(postData.artwork) && postData.artwork.length > 0 ? postData.artwork : null;

      const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 38em;
      margin: 0 auto;
      padding: 2rem 1.5rem;
      line-height: 1.7;
      color: #1a1a1a;
      background: #fff;
    }
    article { position: relative; }
    .cover {
      position: relative;
      margin: 0 0 2rem;
      padding: 0;
      overflow: hidden;
      border-radius: 4px;
    }
    .cover img { width: 100%; height: auto; display: block; }
    .cover h1 {
      margin: 0;
      padding: 1rem 0 0;
      font-size: 1.8em;
      line-height: 1.2;
    }
    header { margin-bottom: 2rem; }
    h1 { font-size: 1.8em; line-height: 1.2; margin: 0 0 0.25em; }
    time { color: #666; font-size: 0.9em; }
    audio { width: 100%; margin-bottom: 2rem; }
    .content h2 { font-size: 1.4em; margin-top: 2em; }
    .content h3 { font-size: 1.15em; margin-top: 1.5em; }
    .content p { margin: 1em 0; }
    .content blockquote {
      margin: 1.5em 0;
      padding: 0.5em 1.5em;
      border-left: 3px solid #ccc;
      color: #444;
    }
    .content pre {
      padding: 1em;
      overflow-x: auto;
      background: #f5f5f5;
      border-radius: 4px;
      font-size: 0.9em;
      line-height: 1.5;
    }
    .content code { font-size: 0.9em; }
    .content pre code { background: none; padding: 0; }
    .content hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
    .content ul, .content ol { padding-left: 1.5em; }
    .content li { margin: 0.3em 0; }
    .content table { border-collapse: collapse; width: 100%; margin: 1.5em 0; }
    .content th, .content td { border: 1px solid #ddd; padding: 0.5em 0.75em; text-align: left; }
    .content th { background: #f5f5f5; }
    .content img { max-width: 100%; height: auto; }
    .artwork-credit { margin-top: 3rem; font-size: 0.8em; color: #999; }
    .artwork-credit a { color: #999; }
    .links { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #ddd; font-size: 0.85em; }
    .links h2 { font-size: 1em; margin: 0 0 1em; color: #666; }
    .links div { margin-bottom: 1em; line-height: 1.6; }
    .links a { color: inherit; word-break: break-all; }

    @media (prefers-color-scheme: dark) {
      body { color: #d4d4d4; background: #1a1a1a; }
      time { color: #999; }
      .content blockquote { border-left-color: #555; color: #aaa; }
      .content pre { background: #2a2a2a; }
      .content hr { border-top-color: #444; }
      .content th, .content td { border-color: #444; }
      .content th { background: #2a2a2a; }
      .artwork-credit, .artwork-credit a { color: #666; }
      .links { border-top-color: #444; }
      .links h2 { color: #999; }
    }

    @media print {
      @page { size: letter; margin: 2.54cm 1.8cm; }
      body {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 12pt;
        line-height: 1.5;
        max-width: none;
        padding: 0;
        color: #000;
        background: #fff;
      }
      .cover {
        page-break-after: always;
        margin: -2.54cm -1.8cm 0;
        width: calc(100% + 3.6cm);
        border-radius: 0;
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
      .cover img { width: 100%; border-radius: 0; }
      .cover::after {
        content: '';
        position: absolute;
        bottom: 0; left: 0; right: 0;
        height: 50%;
        background: linear-gradient(transparent, rgba(0,0,0,0.65));
        pointer-events: none;
      }
      .cover h1 {
        position: absolute;
        bottom: 0; left: 0; right: 0;
        padding: 6rem;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 3em;
        color: #fff;
        text-shadow: 0 1px 6px rgba(0,0,0,0.7);
        z-index: 1;
      }
      audio { display: none; }
      .artwork-credit { display: none; }
      a { color: #000; text-decoration: underline; }
      h1, h2, h3, h4 { page-break-after: avoid; }
      p, li { orphans: 3; widows: 3; }
      img, blockquote, pre, figure, table { page-break-inside: avoid; }
      .content pre { border: 1px solid #ccc; background: none; }
      .content blockquote { border-left-color: #000; color: #000; }
      .content th { background: none; }
      .links { border-top: 1pt solid #000; }
      .links h2 { color: #000; }
      .links a { text-decoration: none; }
    }
  </style>
</head>
<body>
  <article>
${coverUrl ? `    <figure class="cover">
      <img src="${escapeXml(coverUrl)}" alt="">
      <h1>${title}</h1>
    </figure>
` : ''}\
    <header>
${!coverUrl ? `      <h1>${title}</h1>\n` : ''}\
${dateText ? `      <time datetime="${isoDate}">${dateText}</time>` : ''}\

    </header>
${audioUrl ? `    <audio controls src="${escapeXml(audioUrl)}"></audio>
` : ''}\
    <div class="content">
${html}
    </div>
${links.length ? `    <footer class="links">
      <h2>Links</h2>
${links.map(l => `      <div>${l.text} (${escapeXml(l.domain)})<br><a href="${l.href}">${l.href}</a></div>`).join('\n')}
    </footer>
` : ''}\
${artwork ? `    <footer class="artwork-credit">
      artwork ${artwork.map(url => `<a href="${escapeXml(url)}">credit</a>`).join(' ')}
    </footer>
` : ''}\
  </article>
</body>
</html>`;

      await atomicWriteFile(destPath, fullHtml);
      console.log(`  [text] ${postId}: Generated index.html`);

      send({
        ...packet,
        textResult: {
          success: true,
          path: destPath,
          htmlLength: fullHtml.length
        }
      });
    } catch (err) {
      console.error(`  [text] ${postId}: Error - ${err.message}`);
      send({ ...packet, textResult: { error: err.message } });
    }
  };
}
