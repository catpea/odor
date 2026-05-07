import { loadPartials, tinybars } from '../../lib/tinybars.js';
import { resolvePath } from '../../lib/paths.js';

const REQUIRED = [
  'homePage', 'homePagerItem',
  'archivePage', 'archivePagerItem',
  'postCard', 'postMeta', 'favicon',
  'articlePage',
];

export const manifest = {
  name: 'use-templates',
  title: 'Load Templates',
  category: 'files',
  reads: ['context.template'],
  writes: [],
  idempotent: true,
  retries: 0,
};

export async function handle({ ctx, store, signal }) {
  signal.throwIfAborted();

  const profile  = ctx.context;
  const template = profile.template ?? {};

  if (!template.src) {
    return { skipped: true, reason: 'no template configured' };
  }

  const vars        = { ...profile, profile: profile.profile };
  const templateSrc = resolvePath(ctx.context.baseDir, template.src, vars);
  const partials    = await loadPartials(templateSrc);

  const missing = REQUIRED.filter(k => !partials[k]);
  if (missing.length > 0) {
    throw new Error(
      `[use-templates] Missing template files in ${templateSrc}:\n` +
      missing.map(k => `  ${k}.hbs`).join('\n')
    );
  }

  for (const [name, content] of Object.entries(partials)) {
    tinybars.registerPartial(name, content);
  }

  store.set('templates', partials);
  console.log(`  [templates] Loaded ${Object.keys(partials).length} template(s) from ${template.src}`);
  return { success: true, count: Object.keys(partials).length };
}
