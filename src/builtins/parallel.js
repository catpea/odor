export async function runParallel(node, runtime) {
  const tasks = node.children
    .filter(c => c.type === 'element')
    .map(child => runtime.runNode(child, runtime));
  return Promise.all(tasks);
}
