import { evaluateTest } from '../runtime/resolver.js';

export async function runWhen(node, runtime) {
  const test = node.attributes.test ?? 'false';
  if (!evaluateTest(test, runtime)) return;

  for (const child of node.children) {
    if (child.type === 'element') {
      await runtime.runNode(child, runtime);
    }
  }
}
