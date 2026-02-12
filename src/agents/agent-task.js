// Core agent transform: strategy dispatch, skipExisting, context trim, lessons, write-back
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sanityCheck, parseJsonFieldResponse, isFieldEmpty } from './sanity-check.js';
import { callApi } from './api.js';
import { trimToContextBudget } from './context-budget.js';
import { buildSystemWithLessons, appendLesson } from './lessons.js';
import defaultStrategy from './strategies/default.js';
import iterativeSpellcheckStrategy from './strategies/iterative-spellcheck.js';
import evaluateStrategy from './strategies/evaluate.js';

const STRATEGIES = {
  'default': defaultStrategy,
  'iterative-spellcheck': iterativeSpellcheckStrategy,
  'evaluate': evaluateStrategy,
};

function parseTarget(target) {
  const colonIdx = target.indexOf(':');
  if (colonIdx === -1) return { file: target, key: null };
  return { file: target.slice(0, colonIdx), key: target.slice(colonIdx + 1) };
}

function displayDiff(original, corrected, postId) {
  const origLines = original.split('\n');
  const corrLines = corrected.split('\n');
  const maxLen = Math.max(origLines.length, corrLines.length);
  let changes = 0;

  for (let i = 0; i < maxLen; i++) {
    const origLine = origLines[i];
    const corrLine = corrLines[i];
    if (origLine !== corrLine) {
      if (origLine != null) console.log(`  \x1b[31m- ${origLine}\x1b[0m`);
      if (corrLine != null) console.log(`  \x1b[32m+ ${corrLine}\x1b[0m`);
      changes++;
    }
  }

  if (changes === 0) console.log('  (no changes)');
  return changes;
}

function displayFieldChange(key, oldVal, newVal) {
  console.log(`  ${key}:`);
  console.log(`  \x1b[31m- ${JSON.stringify(oldVal)}\x1b[0m`);
  console.log(`  \x1b[32m+ ${JSON.stringify(newVal)}\x1b[0m`);
}

function promptUser(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

export default function agentTask({
  name, prompt, target, url, model, system, yolo, rl,
  strategy = 'default', skipExisting = false, autoAccept = false,
  reflect = false, evaluate, contextSize, lessons, profileDir,
  allTasks, signal, aborted,
}) {
  const { file: targetFile, key: targetKey } = parseTarget(target);

  // Build system prompt with lessons
  const effectiveSystem = buildSystemWithLessons(system, name, lessons);

  // Resolve strategy function
  const strategyFn = STRATEGIES[strategy] || STRATEGIES['default'];

  // Build a runSubTask callback for evaluate strategy
  const runSubTask = async (taskDef, postId, postDir) => {
    const subStrategy = STRATEGIES[taskDef.strategy || 'default'] || STRATEGIES['default'];
    const subSystem = buildSystemWithLessons(taskDef.system || system, taskDef.name, lessons);
    const { file: subFile, key: subKey } = parseTarget(taskDef.target);

    // Read sub-task input content
    let subTextContent;
    try {
      subTextContent = await readFile(path.join(postDir, 'text.md'), 'utf-8');
    } catch {
      subTextContent = '';
    }

    if (contextSize) {
      subTextContent = trimToContextBudget(subTextContent, {
        contextSize, systemPrompt: subSystem, userPrompt: taskDef.prompt,
      });
    }

    let subCurrentFieldValue = null;
    let subPostJson = null;
    if (subKey) {
      const jsonPath = path.join(postDir, subFile);
      subPostJson = JSON.parse(await readFile(jsonPath, 'utf-8'));
      subCurrentFieldValue = subPostJson[subKey];
    }

    const subResult = await subStrategy({
      textContent: subTextContent,
      currentFieldValue: subCurrentFieldValue,
      postJson: subPostJson,
      targetKey: subKey,
      prompt: taskDef.prompt,
      url, model,
      system: subSystem,
      callApi, signal,
      sanityCheck, parseJsonFieldResponse,
      displayDiff, displayFieldChange, promptUser,
      yolo, autoAccept: taskDef.autoAccept ?? false,
      rl, aborted,
      postId, name: taskDef.name,
    });

    // Write-back for sub-task
    if (subResult.accepted) {
      if (subKey) {
        subPostJson[subKey] = subResult.newFieldValue;
        const jsonPath = path.join(postDir, subFile);
        await writeFile(jsonPath, JSON.stringify(subPostJson, null, 2) + '\n');
      } else if (subResult.response) {
        await writeFile(path.join(postDir, subFile), subResult.response);
      }
    }

    return subResult;
  };

  return async (send, packet) => {
    const { postId, postDir } = packet;
    const result = { accepted: false, rejected: false, retries: 0, error: null };

    try {
      // Read input content
      let textContent;
      try {
        textContent = await readFile(packet.files.text, 'utf-8');
      } catch {
        textContent = '';
      }

      // For JSON field targets, read current value
      let currentFieldValue = null;
      let postJson = null;
      if (targetKey) {
        const jsonPath = path.join(postDir, targetFile);
        postJson = JSON.parse(await readFile(jsonPath, 'utf-8'));
        currentFieldValue = postJson[targetKey];
      }

      // skipExisting: skip if field already has a value
      if (skipExisting && targetKey && !isFieldEmpty(currentFieldValue)) {
        console.log(`  [${name}] ${postId}: skipped (${targetKey} already set)`);
        result.rejected = true;
        packet._agentResult = result;
        send(packet);
        return;
      }

      // Context trimming
      if (contextSize) {
        textContent = trimToContextBudget(textContent, {
          contextSize, systemPrompt: effectiveSystem, userPrompt: prompt,
        });
      }

      // Dispatch to strategy
      const strategyResult = await strategyFn({
        textContent, currentFieldValue, postJson, targetKey,
        prompt, url, model,
        system: effectiveSystem,
        callApi, signal,
        sanityCheck, parseJsonFieldResponse,
        displayDiff, displayFieldChange, promptUser,
        yolo, autoAccept, rl, aborted,
        postId, name,
        // evaluate-specific
        evaluate, allTasks, runSubTask, postDir,
      });

      // Merge strategy result
      result.accepted = strategyResult.accepted;
      result.rejected = strategyResult.rejected;
      result.retries = strategyResult.retries;
      result.error = strategyResult.error;

      // Write-back (strategy does NOT write to disk)
      if (strategyResult.accepted) {
        if (targetKey && strategyResult.newFieldValue !== null) {
          postJson[targetKey] = strategyResult.newFieldValue;
          const jsonPath = path.join(postDir, targetFile);
          await writeFile(jsonPath, JSON.stringify(postJson, null, 2) + '\n');
        } else if (!targetKey && strategyResult.response) {
          await writeFile(packet.files.text, strategyResult.response);
        }
      }

      // Abort propagation
      if (strategyResult.abort) {
        packet._abort = true;
      }

      // Self-reflection: ask AI what could be improved
      if (reflect && strategyResult.accepted && profileDir) {
        try {
          const reflectPrompt = `You just completed a "${name}" task on a blog post. The result was accepted. What is one short lesson or tip you learned that could help you do this task better next time? Reply with a single concise sentence.`;
          const lesson = await callApi(url, model, effectiveSystem, reflectPrompt, { signal });
          const trimmedLesson = lesson.trim();
          if (trimmedLesson && trimmedLesson.length < 200) {
            await appendLesson(profileDir, name, trimmedLesson);
          }
        } catch {
          // Reflection failure is non-fatal
        }
      }
    } catch (err) {
      result.error = err.message;
      console.log(`  \x1b[31merror: ${err.message}\x1b[0m`);
    }

    packet._agentResult = result;
    send(packet);
  };
}
