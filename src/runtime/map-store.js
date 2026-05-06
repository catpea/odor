export class MapStore {
  constructor(seed = {}) {
    this.data = structuredClone(seed);
  }

  get(path, fallback = undefined) {
    if (!path) return fallback;
    const parts = path.split('.');
    let node = this.data;
    for (const part of parts) {
      if (node == null || !(part in node)) return fallback;
      node = node[part];
    }
    return node;
  }

  set(path, value) {
    const parts = path.split('.');
    let node = this.data;
    while (parts.length > 1) {
      const part = parts.shift();
      node[part] ??= {};
      node = node[part];
    }
    node[parts[0]] = value;
    return value;
  }

  append(path, value) {
    const current = this.get(path, []);
    if (!Array.isArray(current)) {
      throw new Error(`Cannot append to non-array path: ${path}`);
    }
    current.push(value);
    this.set(path, current);
    return current;
  }

  has(path) {
    return this.get(path, undefined) !== undefined;
  }

  snapshot() {
    return structuredClone(this.data);
  }
}
