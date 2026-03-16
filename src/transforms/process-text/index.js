import fs from 'node:fs';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { marked } from 'marked';
import { resolvePath, interpolatePath, atomicWriteFile, escapeXml, faviconLink } from '../../lib/index.js';

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

      const html = marked(markdown)
        .replace(/<hr>/gi, '<hr class="permalink-divider">')
        .replace(/<p>/gi, '<p class="permalink-paragraph">')
      ;

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
<html lang="en" class="permalink">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="/style.css">
  ${faviconLink(profile.favicon)}
</head>
<body>
  <article class="permalink-article">
${coverUrl ? `    <figure>
      <img class="permalink-image" src="${escapeXml(coverUrl)}" alt="${escapeXml(title)}">
    </figure>
` : ''}\

  ${audioUrl ? `    <audio class="permalink-audio-player" controls src="${escapeXml(audioUrl)}"></audio> ` : ''}

  <header>
    ${title ? `      <h1 class="permalink-title">${title}</h1>\n` : ''}
    ${dateText ? `      <time class="permalink-time" datetime="${isoDate}">${dateText}</time>` : ''}
  </header>

    <section class="permalink-content-body">
${html}
    </section>
    <hr class="web-divider">
    </hr>

${links.length ? `    <footer class="permalink-links">
      <h2>Links</h2>
      <a id="links"></a>
        ${
          links.map(l => `      <div class="permalink-link"><a href="${l.href}">${l.text}<br><small>${l.href}</small></a></div>`).join('\n')
          //links.map(l => `      <div class="permalink-link"><a href="${l.href}">${l.text}<br><small>${l.href}</small></a> <small>(${escapeXml(l.domain)})</small></div>`).join('\n')
        }
    </footer>
     <hr class="web-divider">
` : ''}\
${artwork ? `    <footer class="permalink-artwork-credit">
artwork ${artwork.map((url,i) => `<a href="${escapeXml(url)}">credit${ (artwork.length>1?' #'+(i+1):'')}</a>`).join(', ') }
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
