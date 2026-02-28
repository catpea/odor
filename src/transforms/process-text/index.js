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
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <article class="permalink">
${coverUrl ? `    <figure>
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
    <section>
${html}
    </section>
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
          path: path.relative(process.cwd(), destPath),
          htmlLength: fullHtml.length
        }
      });
    } catch (err) {
      console.error(`  [text] ${postId}: Error - ${err.message}`);
      send({ ...packet, textResult: { error: err.message } });
    }
  };
}
