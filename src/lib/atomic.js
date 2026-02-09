import { writeFile, rename, copyFile } from 'node:fs/promises';

let _dryRun = false;
let _dryRunCount = 0;

export function setDryRun(flag) {
  _dryRun = flag;
  _dryRunCount = 0;
}

export function getDryRunCount() {
  return _dryRunCount;
}

export async function atomicWriteFile(destPath, data) {
  if (_dryRun) {
    _dryRunCount++;
    console.log(`  [dry-run] would write: ${destPath}`);
    return;
  }
  const tmpPath = destPath + '.tmp';
  await writeFile(tmpPath, data);
  await rename(tmpPath, destPath);
}

export async function atomicCopyFile(srcPath, destPath) {
  if (_dryRun) {
    _dryRunCount++;
    console.log(`  [dry-run] would copy: ${srcPath} → ${destPath}`);
    return;
  }
  const tmpPath = destPath + '.tmp';
  await copyFile(srcPath, tmpPath);
  await rename(tmpPath, destPath);
}
