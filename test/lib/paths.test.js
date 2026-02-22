import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { interpolatePath } from '../../src/lib/paths.js';

describe('interpolatePath', () => {
  it('replaces known keys', () => {
    assert.equal(interpolatePath('{name}/docs', { name: 'blog' }), 'blog/docs');
  });

  it('replaces multiple keys', () => {
    assert.equal(
      interpolatePath('{a}/{b}/{a}', { a: 'x', b: 'y' }),
      'x/y/x'
    );
  });

  it('throws on unknown key', () => {
    assert.throws(
      () => interpolatePath('{missing}', {}),
      /unknown key "missing"/
    );
  });

  it('throws on null value', () => {
    assert.throws(
      () => interpolatePath('{key}', { key: null }),
      /"key" is null/
    );
  });

  it('throws on undefined value', () => {
    assert.throws(
      () => interpolatePath('{key}', { key: undefined }),
      /"key" is undefined/
    );
  });

  it('leaves object values as-is (returns original placeholder)', () => {
    assert.equal(
      interpolatePath('{obj}/path', { obj: { nested: true } }),
      '{obj}/path'
    );
  });

  it('leaves function values as-is', () => {
    assert.equal(
      interpolatePath('{fn}/path', { fn: () => {} }),
      '{fn}/path'
    );
  });

  it('converts numbers to strings', () => {
    assert.equal(interpolatePath('chapter-{num}', { num: 42 }), 'chapter-42');
  });

  it('handles string with no placeholders', () => {
    assert.equal(interpolatePath('no/placeholders/here', {}), 'no/placeholders/here');
  });

  it('handles empty string', () => {
    assert.equal(interpolatePath('', {}), '');
  });

  // Dotted notation
  it('resolves dotted keys', () => {
    assert.equal(
      interpolatePath('{cover.base}', { cover: { base: 'dist/img' } }),
      'dist/img'
    );
  });

  it('resolves deeply dotted keys', () => {
    assert.equal(
      interpolatePath('{a.b.c}', { a: { b: { c: 'deep' } } }),
      'deep'
    );
  });

  it('throws on unknown dotted key', () => {
    assert.throws(
      () => interpolatePath('{a.b.missing}', { a: { b: {} } }),
      /unknown key "a.b.missing"/
    );
  });

  it('prefers flat key over dotted traversal', () => {
    assert.equal(
      interpolatePath('{a.b}', { 'a.b': 'flat', a: { b: 'nested' } }),
      'flat'
    );
  });

  // Recursive interpolation
  it('recursively resolves placeholders in resolved values', () => {
    assert.equal(
      interpolatePath('{base}/docs', { base: 'dist/{profile}', profile: 'blog' }),
      'dist/blog/docs'
    );
  });

  it('resolves the cover.base example from the plan', () => {
    const obj = {
      cover: {
        base: 'dist/chapters/chapter-{chapter}',
        dest: '{cover.base}/docs/{id}.avif',
      },
      chapter: 42,
      id: 99,
    };
    assert.equal(
      interpolatePath(obj.cover.dest, obj),
      'dist/chapters/chapter-42/docs/99.avif'
    );
  });

  it('stops recursion when stable (no infinite loop)', () => {
    // {obj} is an object, never resolves — should stabilize immediately
    assert.equal(
      interpolatePath('{obj}/path', { obj: { nested: true } }),
      '{obj}/path'
    );
  });

  it('handles multi-level recursive resolution', () => {
    assert.equal(
      interpolatePath('{c}', { a: 'final', b: '{a}', c: '{b}' }),
      'final'
    );
  });
});
