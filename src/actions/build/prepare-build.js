import path from 'node:path';
import { loadManifest, computeConfigHash } from '../../lib/manifest.js';
import { resolvePath, interpolatePath } from '../../lib/paths.js';

export const manifest = {
  name: 'prepare-build',
  title: 'Prepare Build',
  category: 'build',
  reads: ['context'],
  writes: ['manifest', 'build.manifestPath', 'build.configHash'],
  idempotent: false,
  retries: 0,
};

export async function handle({ ctx, store, signal }) {
  signal.throwIfAborted();

  const profile = ctx.context;
  const dryRun = store.get('build.dryRun') ?? false;
  const forcePosts = store.get('build.forcePosts') ?? [];

  const vars = { ...profile, profile: profile.profile };
  const destDir = resolvePath(ctx.context.baseDir, profile.dest, vars);
  const manifestPath = path.join(destDir, '.odor-manifest.json');

  const loadedManifest = await loadManifest(manifestPath);
  const configHash = computeConfigHash(profile);

  if (loadedManifest.configHash && loadedManifest.configHash !== configHash) {
    console.log('Profile changed - full rebuild');
    loadedManifest.posts = {};
  }
  loadedManifest.configHash = configHash;

  for (const postId of forcePosts) {
    delete loadedManifest.posts[postId];
    console.log(`Forcing rebuild: ${postId}`);
  }

  store.set('manifest', loadedManifest);
  store.set('build.manifestPath', manifestPath);
  store.set('build.configHash', configHash);

  console.log(`\nOdor 3 Blog Builder${dryRun ? ' (dry run)' : ''}`);
  console.log(`Profile: ${profile.profile}`);
  console.log(`Title: ${profile.title}`);
  console.log('---------------------------------------------\n');

  return { manifestPath, configHash };
}
