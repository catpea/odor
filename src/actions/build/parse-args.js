export const manifest = {
  name: 'parse-args',
  title: 'Parse Arguments',
  category: 'build',
  reads: ['build.argv'],
  writes: ['build.dryRun', 'build.forcePosts'],
  idempotent: true,
  retries: 0,
};

export async function handle({ ctx, store, signal }) {
  signal.throwIfAborted();

  const argv = store.get('build.argv') ?? ctx.context.argv ?? [];
  const dryRun = argv.includes('--dry-run');
  const forcePosts = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force-post') {
      const postId = argv[++i];
      if (!postId) throw new Error('--force-post requires a post id');
      forcePosts.push(postId);
    }
  }

  ctx.dryRun = dryRun;

  store.set('build.dryRun', dryRun);
  store.set('build.forcePosts', forcePosts);

  return { dryRun, forcePosts };
}
