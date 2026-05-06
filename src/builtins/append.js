import { readPath, writePath, resolveTemplate } from '../runtime/resolver.js';

export function runAppend(node, runtime) {
  const path = node.attributes.path;
  const rawValue = node.attributes.value ?? '';

  let value;
  try {
    value = JSON.parse(rawValue);
  } catch {
    value = resolveTemplate(rawValue, runtime);
  }

  const current = readPath(runtime, path) ?? [];
  if (!Array.isArray(current)) {
    throw new Error(`Cannot append to non-array path: ${path}`);
  }
  const updated = [...current, value];
  writePath(runtime, path, updated);
  return updated;
}
