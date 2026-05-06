import { copyFile, rename, writeFile } from 'node:fs/promises';

export async function atomicWriteFile(ctx, destPath, data) {
  if (ctx.dryRun) {
    ctx.dryRunCount++;
    console.log(`  [dry-run] would write: ${destPath}`);
    return;
  }
  const tmpPath = `${destPath}.tmp`;
  await writeFile(tmpPath, data);
  await rename(tmpPath, destPath);
}

export async function atomicCopyFile(ctx, srcPath, destPath) {
  if (ctx.dryRun) {
    ctx.dryRunCount++;
    console.log(`  [dry-run] would copy: ${srcPath} -> ${destPath}`);
    return;
  }
  const tmpPath = `${destPath}.tmp`;
  await copyFile(srcPath, tmpPath);
  await rename(tmpPath, destPath);
}
