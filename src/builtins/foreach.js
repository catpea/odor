import { readPath, writePath } from '../runtime/resolver.js';
import { MapStore } from '../runtime/map-store.js';

export async function runForEach(node, runtime) {
  const items = readPath(runtime, node.attributes.in) ?? [];
  const workflowName = node.attributes.run;
  const itemName = node.attributes.as ?? 'item';
  const collectPath = node.attributes.collect;
  const savePath = node.attributes.save;

  const results = await Promise.all(
    items.map(async item => {
      const childFrame = {
        workflow: workflowName,
        item,
        parent: runtime.frame,
        local: new MapStore({ [itemName]: item }),
      };

      const childRuntime = { ...runtime, frame: childFrame };

      await runtime.runWorkflow(workflowName, childRuntime);

      return collectPath
        ? readPath(childRuntime, collectPath)
        : childFrame.local.snapshot();
    })
  );

  if (savePath) {
    writePath(runtime, savePath, results);
  }

  return results;
}
