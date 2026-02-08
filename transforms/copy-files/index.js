import fs from 'node:fs';
import path from 'node:path';
import { readdir, mkdir } from 'node:fs/promises';
import { resolvePath, interpolatePath, atomicCopyFile } from '../../lib.js';

export default function copyFiles() {
  return async (send, packet) => {
    if (packet._cached) {
      send({ ...packet, filesResult: packet._cachedResults.filesResult });
      return;
    }

    const { files, guid, postId, profile } = packet;
    const vars = { ...packet, ...packet.postData };

    if (!fs.existsSync(files.filesDir)) {
      send({ ...packet, filesResult: { skipped: true, reason: 'no files dir' } });
      return;
    }

    try {
      const entries = await readdir(files.filesDir, { withFileTypes: true });
      const fileList = entries.filter(e => e.isFile());

      if (fileList.length === 0) {
        send({ ...packet, filesResult: { skipped: true, reason: 'empty' } });
        return;
      }

      const destDir = resolvePath(interpolatePath(`${profile.dest}/permalink/${guid}/files`, vars));
      await mkdir(destDir, { recursive: true });

      let copiedCount = 0;
      for (const file of fileList) {
        const srcPath = path.join(files.filesDir, file.name);
        const destPath = path.join(destDir, file.name);
        await atomicCopyFile(srcPath, destPath);
        copiedCount++;
      }

      console.log(`  [files] ${postId}: Copied ${copiedCount} file(s)`);

      send({
        ...packet,
        filesResult: {
          success: true,
          count: copiedCount,
          destDir
        }
      });
    } catch (err) {
      console.error(`  [files] ${postId}: Error - ${err.message}`);
      send({ ...packet, filesResult: { error: err.message } });
    }
  };
}
