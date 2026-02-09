import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { atomicWriteFile } from './atomic.js';

export function computeConfigHash(profile) {
  return createHash('sha256').update(JSON.stringify(profile)).digest('hex');
}

export async function loadManifest(manifestPath) {
  try {
    const data = await readFile(manifestPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { version: 1, configHash: '', posts: {} };
  }
}

export async function saveManifest(manifestPath, manifest) {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2));
}

export function hashFileContent(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
