export const manifest = {
  name: 'emit-posts',
  title: 'Emit Posts',
  category: 'posts',
  reads: ['posts.scanned'],
  writes: ['posts.emitted'],
  idempotent: true,
  retries: 0,
};

export function handle({ input }) {
  // input.from is posts.scanned (set by the `from` attribute on the Action node)
  return input.from ?? [];
}
