import path from 'node:path';

export function resolvePath(baseDir, template, vars = {}) {
  return path.resolve(baseDir, interpolatePath(template, vars));
}

export function interpolatePath(str, obj) {
  if (typeof str !== 'string') return str;
  const maxPasses = 10;
  let result = str;

  for (let pass = 0; pass < maxPasses; pass++) {
    const prev = result;
    result = result.replace(/\{([^}]+)\}/g, (match, key) => {
      const val = resolveKey(obj, key);
      if (val == null) throw new Error(`interpolatePath: "${key}" not found`);
      if (typeof val === 'object' || typeof val === 'function') return match;
      return String(val);
    });
    if (result === prev) break;
  }

  return result;
}

function resolveKey(obj, key) {
  if (key in obj) return obj[key];

  const parts = key.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object' || !(part in current)) {
      throw new Error(`interpolatePath: unknown key "${key}"`);
    }
    current = current[part];
  }
  return current;
}
