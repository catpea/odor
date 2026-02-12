// Self-reflection: persistent lessons learned across agent runs

import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export function lessonsPath(profileDir) {
  return path.join(profileDir, '.odor-lessons.json');
}

export async function loadLessons(profileDir) {
  try {
    const data = await readFile(lessonsPath(profileDir), 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function saveLessons(profileDir, lessons) {
  const dest = lessonsPath(profileDir);
  const tmp = dest + '.tmp';
  await writeFile(tmp, JSON.stringify(lessons, null, 2) + '\n');
  await rename(tmp, dest);
}

export async function appendLesson(profileDir, taskName, lesson) {
  const lessons = await loadLessons(profileDir);
  if (!lessons[taskName]) lessons[taskName] = [];
  // Dedup: don't add if already present
  if (!lessons[taskName].includes(lesson)) {
    lessons[taskName].push(lesson);
    await saveLessons(profileDir, lessons);
  }
  return lessons;
}

export function buildSystemWithLessons(baseSystem, taskName, lessons) {
  if (!lessons || !lessons[taskName] || lessons[taskName].length === 0) {
    return baseSystem;
  }
  const block = lessons[taskName].map((l, i) => `${i + 1}. ${l}`).join('\n');
  return `${baseSystem}\n\nLessons from previous runs:\n${block}`;
}
