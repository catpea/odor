import { writePath, resolveTemplate } from '../runtime/resolver.js';

export function runSet(node, runtime) {
  const path = node.attributes.path;
  const rawValue = node.attributes.value ?? '';

  let value;
  try {
    value = JSON.parse(rawValue);
  } catch {
    value = resolveTemplate(rawValue, runtime);
  }

  writePath(runtime, path, value);
  return value;
}
