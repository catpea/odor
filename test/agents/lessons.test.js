import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadLessons, saveLessons, appendLesson, buildSystemWithLessons, lessonsPath } from '../../src/agents/lessons.js';

describe('lessons', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'odor-lessons-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loadLessons returns empty object when no file', async () => {
    const result = await loadLessons(tmpDir);
    assert.deepEqual(result, {});
  });

  it('saveLessons + loadLessons round-trip', async () => {
    const data = { spellcheck: ['Lesson 1'], tags: ['Lesson A'] };
    await saveLessons(tmpDir, data);
    const loaded = await loadLessons(tmpDir);
    assert.deepEqual(loaded, data);
  });

  it('appendLesson creates new task entry', async () => {
    await appendLesson(tmpDir, 'spellcheck', 'Check for homophones');
    const loaded = await loadLessons(tmpDir);
    assert.deepEqual(loaded.spellcheck, ['Check for homophones']);
  });

  it('appendLesson appends to existing', async () => {
    await appendLesson(tmpDir, 'spellcheck', 'Lesson 1');
    await appendLesson(tmpDir, 'spellcheck', 'Lesson 2');
    const loaded = await loadLessons(tmpDir);
    assert.deepEqual(loaded.spellcheck, ['Lesson 1', 'Lesson 2']);
  });

  it('appendLesson deduplicates', async () => {
    await appendLesson(tmpDir, 'spellcheck', 'Lesson 1');
    await appendLesson(tmpDir, 'spellcheck', 'Lesson 1');
    const loaded = await loadLessons(tmpDir);
    assert.deepEqual(loaded.spellcheck, ['Lesson 1']);
  });

  it('lessonsPath returns correct path', () => {
    assert.equal(lessonsPath('/foo/bar'), path.join('/foo/bar', '.odor-lessons.json'));
  });
});

describe('buildSystemWithLessons', () => {
  it('returns base system when no lessons', () => {
    assert.equal(buildSystemWithLessons('base', 'task', {}), 'base');
  });

  it('returns base system when task has no lessons', () => {
    assert.equal(buildSystemWithLessons('base', 'task', { other: ['x'] }), 'base');
  });

  it('appends lessons block', () => {
    const result = buildSystemWithLessons('base', 'task', { task: ['A', 'B'] });
    assert.ok(result.startsWith('base'));
    assert.ok(result.includes('Lessons from previous runs:'));
    assert.ok(result.includes('1. A'));
    assert.ok(result.includes('2. B'));
  });
});
