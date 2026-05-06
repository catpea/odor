import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

export const manifest = {
  name: 'agent-task',
  title: 'Run Agent Task',
  category: 'ai',
  reads: ['post'],
  writes: ['post.tags', 'post.description'],
  queue: 'agent',
  idempotent: false,
  retries: 0,
};

export async function handle({ ctx, frame, input, signal, log }) {
  signal.throwIfAborted();

  const post        = frame.local.get('post');
  const { postId, postDir, files } = post;

  const agentConfig = ctx.context.agent;
  const taskName    = input.task;

  if (!agentConfig || !taskName) return null;

  // Tasks can be an array (old format) or an object keyed by name (new format)
  let taskConfig;
  if (Array.isArray(agentConfig.tasks)) {
    taskConfig = agentConfig.tasks.find(t => t.name === taskName);
  } else {
    taskConfig = agentConfig.tasks?.[taskName];
  }

  if (!taskConfig) {
    log.warn(`No task config for "${taskName}"`);
    return null;
  }

  const { url, model, system: globalSystem } = agentConfig;
  const { prompt, target, system, skipExisting } = taskConfig;
  const effectiveSystem = system ?? globalSystem ?? 'You are a helpful assistant.';

  const i = target?.indexOf(':') ?? -1;
  const targetFile = i === -1 ? target : target.slice(0, i);
  const targetKey  = i === -1 ? null   : target.slice(i + 1);

  try {
    let text = '';
    try { text = await readFile(files.text, 'utf-8'); } catch { /* no text */ }

    if (!text.trim()) {
      log.info(`[agent:${taskName}] ${postId}: skipped (no text.md)`);
      return null;
    }

    let postJson    = null;
    let currentValue = null;
    if (targetKey) {
      postJson     = JSON.parse(await readFile(path.join(postDir, targetFile), 'utf-8'));
      currentValue = postJson[targetKey];
    }

    if (skipExisting && targetKey && !isEmpty(currentValue)) {
      log.info(`[agent:${taskName}] ${postId}: skipped (${targetKey} exists)`);
      return null;
    }

    const reply = await callLLM(url, model, effectiveSystem, `${prompt}\n\n${text}`);

    if (targetKey) {
      postJson[targetKey] = parseJsonResponse(reply);
      await writeFile(path.join(postDir, targetFile), JSON.stringify(postJson, null, 2) + '\n');
      if (targetFile === 'post.json') post.postData[targetKey] = postJson[targetKey];
      console.log(`  [agent:${taskName}] ${postId}: wrote ${targetKey}`);
    } else {
      await writeFile(path.join(postDir, targetFile), reply + '\n');
      console.log(`  [agent:${taskName}] ${postId}: wrote ${targetFile}`);
    }

    return { success: true };
  } catch (err) {
    console.error(`  [agent:${taskName}] ${postId}: ${err.message}`);
    return { error: err.message };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isEmpty(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

async function callLLM(url, model, system, userPrompt) {
  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: userPrompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`LLM API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

function parseJsonResponse(text) {
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try { return JSON.parse(cleaned); } catch { return text.trim(); }
}
