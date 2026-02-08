import path from 'node:path';
import { readdir, mkdir } from 'node:fs/promises';
import { resolvePath, interpolatePath, atomicCopyFile } from '../../lib.js';

export default function useTheme(config) {
  const { profile } = config;
  const themeSrc = resolvePath(interpolatePath(config.src, { profile }));
  const destDir = resolvePath(interpolatePath(config.dest, { profile }));

  return async (send, packet) => {
    const allComplete = packet.branches?.every(b => b._complete);
    if (!allComplete) {
      send(packet);
      return;
    }

    try {
      const count = await copyRecursive(themeSrc, destDir);
      console.log(`  [theme] Installed ${count} file(s) from ${path.basename(themeSrc)}`);
    } catch (err) {
      console.error(`  [theme] Error - ${err.message}`);
    }

    send(packet);
  };
}

async function copyRecursive(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += await copyRecursive(srcPath, destPath);
    } else {
      await atomicCopyFile(srcPath, destPath);
      count++;
    }
  }
  return count;
}
