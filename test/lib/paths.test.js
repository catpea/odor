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
});
