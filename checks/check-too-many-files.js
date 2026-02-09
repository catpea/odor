import fs from 'node:fs';
import { readdir } from 'node:fs/promises';

export default function checkTooManyFiles({ maxRecommended = 3 } = {}) {
  return async (send, packet) => {
    const { files, postId } = packet;
    packet._complaints = packet._complaints || [];

    if (files.filesDir && fs.existsSync(files.filesDir)) {
      try {
        const entries = await readdir(files.filesDir, { withFileTypes: true });
        const count = entries.filter(e => e.isFile()).length;
        if (count > maxRecommended) {
          packet._complaints.push(`[files] ${count} files in files/ (recommended max: ${maxRecommended})`);
        }
      } catch { /* empty or unreadable */ }
    }

    send(packet);
  };
}
