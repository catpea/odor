import fs from 'node:fs';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { marked } from 'marked';
import { resolvePath, atomicWriteFile } from '../../lib.js';

export default function processText() {
  return async (send, packet) => {
    if (packet._cached) {
      send({ ...packet, textResult: packet._cachedResults.textResult });
      return;
    }

    const { branches, guid, postId, postData, profile } = packet;

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

      const destDir = resolvePath(`${profile.dest}/permalink/${guid}`);
      await mkdir(destDir, { recursive: true });

      const destPath = path.join(destDir, 'index.html');

      const coverUrl = coverBranch?.coverResult?.url;
      const audioUrl = audioBranch?.audioResult?.url;

      const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${postData.title || postId}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; }
    img { border-radius: 8px; max-width: 100%; height: auto; }
    audio { width: 100%; }
  </style>
</head>
<body>
  <article>
    <h1>${postData.title || postId}</h1>
    <time>${postData.date ? new Date(postData.date).toLocaleDateString() : ''}</time>
    ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : ''}
    ${audioUrl ? `<audio controls src="${audioUrl}"></audio>` : ''}
    <div class="content">
${html}
    </div>
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
