import { resolveTemplate } from '../runtime/resolver.js';

export async function runLock(node, runtime) {
  const name = node.attributes.name;
  const key = resolveTemplate(node.attributes.key ?? '', runtime);

  return runtime.ctx.locks.withLock(name, key, async () => {
    let result;
    for (const child of node.children) {
      if (child.type === 'element') {
        result = await runtime.runNode(child, runtime);
      }
    }
    return result;
  });
}
