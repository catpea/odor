export const manifest = {
  name: 'summarize-build',
  title: 'Summarize Build',
  category: 'build',
  reads: ['posts.rendered', 'posts.cached', 'build.dryRun'],
  writes: ['build.summary'],
  idempotent: true,
  retries: 0,
};

export function handle({ ctx, store }) {
  const rendered = store.get('posts.rendered') ?? [];
  const cached   = store.get('posts.cached')   ?? [];
  const allPosts = [...rendered, ...cached];

  const built      = rendered.filter(p => !p._cached);
  const successful = built.filter(p => p.valid).length;
  const failed     = built.filter(p => !p.valid);

  console.log('\n---------------------------------------------');
  console.log(`Summary: ${allPosts.length} posts (${built.length} built, ${cached.length} cached)`);
  console.log(`  Successful: ${successful}`);
  console.log(`  Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log('\nFailed posts:');
    for (const post of failed) {
      console.log(`  - ${post.postId}: ${(post.errors ?? []).join(', ')}`);
    }
  }

  if (ctx.dryRun) {
    console.log(`\nDry run: ${ctx.dryRunCount} file(s) would be written`);
  }

  console.log('---------------------------------------------\n');

  const exitCode = failed.length > 0 ? 1 : 0;
  store.set('build.exitCode', exitCode);

  return { total: allPosts.length, built: built.length, cached: cached.length, exitCode };
}
