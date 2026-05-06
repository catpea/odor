import { readdir, readFile } from 'fs/promises';
import { join, basename } from 'path';

class TinyBars {
  #partials = {};

  registerPartial(name, template) {
    this.#partials[name] = template;
    return this;
  }

  compile(template) {
    return (data = {}, extraPartials = {}) => this.render(template, data, extraPartials);
  }

  render(template, data = {}, extraPartials = {}) {
    const partials = { ...this.#partials, ...extraPartials };
    return this.#renderSection(template, data, data, partials);
  }

  #renderSection(template, root, scope, partials) {
    template = template.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => {
      const src = partials[name];
      if (src === undefined) throw new Error(`[tinybars] Unknown partial: "${name}"`);
      return this.#renderSection(src, root, scope, partials);
    });

    template = template.replace(/\{\{\{([\w.]+)\}\}\}/g, (_, path) => {
      const value = this.#get(scope, path) ?? this.#get(root, path);
      return String(value ?? '');
    });

    template = template.replace(
      /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (_, path, inner) => {
        const list = this.#get(scope, path) ?? this.#get(root, path);
        if (!Array.isArray(list)) return '';
        return list.map(item => {
          const childScope = item && typeof item === 'object'
            ? { ...scope, ...item, this: item }
            : { ...scope, this: item };
          return this.#renderSection(inner, root, childScope, partials);
        }).join('');
      }
    );

    template = template.replace(
      /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_, path, inner) => {
        const value = this.#get(scope, path) ?? this.#get(root, path);
        return value ? this.#renderSection(inner, root, scope, partials) : '';
      }
    );

    template = template.replace(/\{\{([\w.]+)\}\}/g, (_, path) => {
      if (path === 'this') return this.#escape(scope.this ?? '');
      const value = this.#get(scope, path) ?? this.#get(root, path);
      return this.#escape(value ?? '');
    });

    return template;
  }

  #get(obj, path) {
    return path.split('.').reduce((acc, key) => acc?.[key], obj);
  }

  #escape(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

export const tinybars = new TinyBars();

export function render(template, ctx = {}, partials = {}) {
  return tinybars.render(template, ctx, partials);
}

export function compile(template, partials = {}) {
  return (ctx = {}) => tinybars.render(template, ctx, partials);
}

export async function loadPartials(dir) {
  const files = (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.hbs'));
  const entries = await Promise.all(
    files.map(async f => [basename(f, '.hbs'), await readFile(join(dir, f), 'utf8')])
  );
  return Object.fromEntries(entries);
}

export function html(...a) {
  return a.join();
}
