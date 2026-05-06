import { writePath } from '../runtime/resolver.js';
import { runAction } from './action.js';

export async function runSubmit(node, runtime) {
  const queueName = node.attributes.queue;
  const actionName = node.attributes.is;

  const promise = runtime.ctx.tasks.submit(queueName, async () => {
    return runAction(
      { ...node, attributes: { ...node.attributes, is: actionName } },
      runtime
    );
  });

  // wait defaults to true; pass wait="false" to fire-and-forget
  const wait = node.attributes.wait !== 'false';
  if (!wait) return promise;

  const output = await promise;

  if (node.attributes.save && output !== undefined) {
    writePath(runtime, node.attributes.save, output);
  }

  return output;
}
