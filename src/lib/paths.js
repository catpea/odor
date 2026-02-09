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
  return str.replace(/\{([^}]+)\}/g, (match, key) => {
    if (!(key in obj)) throw new Error(`interpolatePath: unknown key "${key}"`);
    const val = obj[key];
    if (val == null) throw new Error(`interpolatePath: "${key}" is ${val}`);
    if (typeof val === 'object' || typeof val === 'function') return match;
    return String(val);
  });
}
