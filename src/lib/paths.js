import path from 'node:path';

let _baseDir;
let _profile;

export function setup(baseDir, profile) {
  _baseDir = baseDir;
  _profile = profile;
}

export function resolvePath(template) {
  return path.resolve(_baseDir, template.replace('{profile}', _profile.profile));
}

export function interpolatePath(str, obj) {
  const MAX_PASSES = 10;
  let result = str;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const prev = result;
    result = result.replace(/\{([^}]+)\}/g, (match, key) => {
      const val = resolveKey(obj, key);
      if (val == null) throw new Error(`interpolatePath: "${key}" is ${val}`);
      if (typeof val === 'object' || typeof val === 'function') return match;
      return String(val);
    });
    if (result === prev) break;
  }

  return result;
}

function resolveKey(obj, key) {
  // Flat lookup (backward compat for simple keys)
  if (key in obj) return obj[key];

  // Dotted path traversal
  if (key.includes('.')) {
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

  throw new Error(`interpolatePath: unknown key "${key}"`);
}
