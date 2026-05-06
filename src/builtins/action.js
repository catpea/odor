import { resolveInput, readPath, writePath } from '../runtime/resolver.js';

export async function runAction(node, runtime) {
  const name = node.attributes.is;

  // Fall back to running a workflow if no action is registered under this name.
  if (!runtime.registry.has(name)) {
    if (runtime.workflows.has(name)) {
      return runtime.runWorkflow(name, runtime);
    }
    throw new Error(`Unknown action or workflow: "${name}"`);
  }

  const action = runtime.registry.get(name);
  const input = resolveInput(node, runtime);

  if (node.attributes.from) {
    input.from = readPath(runtime, node.attributes.from);
  }

  runtime.log.info(`action:start ${name}`);

  try {
    const output = await action.handle({
      ctx: runtime.ctx,
      store: runtime.store,
      frame: runtime.frame,
      input,
      signal: runtime.signal,
      log: runtime.log.child(name),
    });

    if (node.attributes.save && output !== undefined) {
      writePath(runtime, node.attributes.save, output);
    }

    runtime.log.info(`action:done  ${name}`);
    return output;
  } catch (error) {
    runtime.log.error(`action:error ${name}: ${error.message}`);
    throw error;
  }
}
