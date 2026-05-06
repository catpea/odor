export const manifest = {
  name: 'read-args',
  title: 'Read Arguments',
  category: 'build',
  reads: ['context.argv'],
  writes: ['build.argv'],
  idempotent: true,
  retries: 0,
};

export async function handle({ ctx, store, signal }) {
  signal.throwIfAborted();

  const argv = ctx.context.argv ?? [];
  store.set('build.argv', argv);
  store.set('build.startedAt', Date.now());

  return { argv };
}
