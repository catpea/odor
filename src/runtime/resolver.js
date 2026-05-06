// Path read/write and template resolution for the runtime.

export function readPath(runtime, path) {
  if (path.startsWith('context.')) {
    return getByPath(runtime.ctx.context, path.slice('context.'.length));
  }
  if (path.startsWith('post.')) {
    return runtime.frame.local.get(path);
  }
  if (path.startsWith('frame.')) {
    return runtime.frame.local.get(path.slice('frame.'.length));
  }
  if (path.startsWith('store.')) {
    return runtime.store.get(path.slice('store.'.length));
  }
  // Default: check store (supports array.length via dot navigation)
  return runtime.store.get(path);
}

export function writePath(runtime, path, value) {
  if (path.startsWith('context.')) {
    throw new Error(`Context is read-only: ${path}`);
  }
  if (path.startsWith('post.') || path.startsWith('frame.')) {
    const key = path.startsWith('frame.') ? path.slice('frame.'.length) : path;
    runtime.frame.local.set(key, value);
    return value;
  }
  const clean = path.startsWith('store.') ? path.slice('store.'.length) : path;
  runtime.store.set(clean, value);
  return value;
}

// Resolve ${varPath} template syntax in XML attribute strings.
export function resolveTemplate(str, runtime) {
  if (typeof str !== 'string') return str;
  return str.replace(/\$\{([^}]+)\}/g, (match, expr) => {
    const value = readPath(runtime, expr.trim());
    return value === undefined ? match : String(value);
  });
}

// Resolve all XML attributes for an action call.
export function resolveInput(node, runtime) {
  const skip = new Set(['is', 'save', 'from', 'queue', 'wait']);
  const input = {};
  for (const [key, value] of Object.entries(node.attributes)) {
    if (skip.has(key)) continue;
    input[key] = resolveTemplate(value, runtime);
  }
  return input;
}

// Evaluate a <When test="..."> expression.
export function evaluateTest(test, runtime) {
  const match = test.match(/^\$\{(.+)\}$/s);
  if (!match) {
    const resolved = resolveTemplate(test, runtime);
    return resolved !== 'false' && resolved !== '0' && resolved !== '';
  }

  const expr = match[1].trim();
  const compareMatch = expr.match(/^(.+?)\s*(===|!==|==|!=|<=|>=|<|>)\s*(.+)$/);
  if (compareMatch) {
    const [, leftStr, op, rightStr] = compareMatch;
    const left = resolveExprValue(leftStr.trim(), runtime);
    const right = resolveExprValue(rightStr.trim(), runtime);
    switch (op) {
      case '==': case '===': return left == right;
      case '!=': case '!==': return left != right;
      case '<':  return left <  right;
      case '>':  return left >  right;
      case '<=': return left <= right;
      case '>=': return left >= right;
    }
  }

  return Boolean(resolveExprValue(expr, runtime));
}

function resolveExprValue(expr, runtime) {
  if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
  if (expr === 'true')  return true;
  if (expr === 'false') return false;
  if ((expr.startsWith('"') && expr.endsWith('"')) ||
      (expr.startsWith("'") && expr.endsWith("'"))) {
    return expr.slice(1, -1);
  }
  return readPath(runtime, expr);
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

// Expand flat dot-notation keys into a nested object.
// e.g. { "cover.dest": "..." } -> { cover: { dest: "..." } }
export function expandDotPaths(flat) {
  const result = {};
  for (const [key, value] of Object.entries(flat)) {
    setDotPath(result, key, value);
  }
  return result;
}

export function setDotPath(obj, path, value) {
  const parts = path.split('.');
  let node = obj;
  while (parts.length > 1) {
    const part = parts.shift();
    if (node[part] == null || typeof node[part] !== 'object') {
      node[part] = {};
    }
    node = node[part];
  }
  node[parts[0]] = value;
}
