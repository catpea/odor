import { runSubmit } from './submit.js';

export async function runTaskGroup(node, runtime) {
  const join = node.attributes.join ?? 'all';
  const tasks = [];

  for (const child of node.children) {
    if (child.type !== 'element' || child.name !== 'Submit') {
      continue;
    }
    // Start each submit (returns a Promise) without awaiting — parallel execution.
    tasks.push(
      runSubmit({ ...child, attributes: { ...child.attributes, wait: 'true' } }, runtime)
    );
  }

  if (join === 'all') return Promise.all(tasks);
  if (join === 'any') return Promise.any(tasks);

  throw new Error(`Unsupported TaskGroup join: "${join}"`);
}
