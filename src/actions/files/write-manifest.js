import { saveManifest } from '../../lib/manifest.js';

export const manifest = {
  name: 'write-manifest',
  title: 'Write Manifest',
  category: 'files',
  reads: ['posts.rendered', 'posts.cached', 'manifest', 'build.manifestPath', 'build.configHash'],
  writes: [],
  idempotent: false,
  retries: 0,
};

export async function handle({ ctx, store, signal, log }) {
  signal.throwIfAborted();

  const oldManifest  = store.get('manifest')           ?? { posts: {} };
  const rendered     = store.get('posts.rendered')     ?? [];
  const cached       = store.get('posts.cached')       ?? [];
  const manifestPath = store.get('build.manifestPath');
  const configHash   = store.get('build.configHash')   ?? '';

  // Start from the old manifest so cached posts keep their entries.
  const newManifest = {
    version:    1,
    configHash,
    posts:      { ...oldManifest.posts },
  };

  // Overwrite entries for freshly rendered posts.
  for (const post of rendered) {
    const update = post._manifestUpdate;
    if (!update) continue;

    newManifest.posts[post.postId] = {
      compositeHash: update.fingerprint?.compositeHash,
      files:         update.fingerprint?.files ?? {},
      results:       update.results ?? {},
    };
  }

  if (!ctx.dryRun && manifestPath) {
    await saveManifest(ctx, manifestPath, newManifest);
  }

  return newManifest;
}
