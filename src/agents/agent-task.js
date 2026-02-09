// Core agent transform: API call + display + prompt + write-back
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sanityCheck, parseJsonFieldResponse } from './sanity-check.js';

function parseTarget(target) {
  const colonIdx = target.indexOf(':');
  if (colonIdx === -1) return { file: target, key: null };
  return { file: target.slice(0, colonIdx), key: target.slice(colonIdx + 1) };
}

async function callApi(url, model, system, userMessage) {
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userMessage },
    ],
    stream: false,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
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

export default function agentTask({ name, prompt, target, url, model, system, yolo, rl }) {

  const { file: targetFile, key: targetKey } = parseTarget(target);

  return async (send, packet) => {
    const { postId, postDir } = packet;
    const result = { accepted: false, rejected: false, retries: 0, error: null };

    try {
      // Read input content (always text.md for context)
      let textContent;
      try {
        textContent = await readFile(packet.files.text, 'utf-8');
      } catch {
        textContent = '';
      }

      // For JSON field targets, also read current value
      let currentFieldValue = null;
      let postJson = null;
      if (targetKey) {
        const jsonPath = path.join(postDir, targetFile);
        postJson = JSON.parse(await readFile(jsonPath, 'utf-8'));
        currentFieldValue = postJson[targetKey];
      }

      // Build user message
      let userMessage = prompt + '\n\n' + textContent;
      if (targetKey && currentFieldValue != null) {
        userMessage += `\n\nCurrent ${targetKey}: ${JSON.stringify(currentFieldValue)}`;
      }

      // Retry loop
      let action = 'retry';
      while (action === 'retry') {
        console.log(`\n  [${name}] ${postId}:`);

        let response;
        try {
          response = await callApi(url, model, system, userMessage);
        } catch (err) {
          console.log(`  \x1b[31mAPI error: ${err.message}\x1b[0m`);
          result.error = err.message;
          result.rejected = true;
          break;
        }

        // For JSON field targets, parse the response
        let processedResponse = response;
        let newFieldValue = null;
        if (targetKey) {
          newFieldValue = parseJsonFieldResponse(response, targetKey);
          processedResponse = JSON.stringify(newFieldValue);
        }

        // Sanity check
        const original = targetKey ? JSON.stringify(currentFieldValue ?? '') : textContent;
        const check = sanityCheck(processedResponse, original, targetKey);

        if (!check.ok) {
          console.log(`  \x1b[33mSanity check failed: ${check.reason}\x1b[0m`);
          if (yolo) {
            result.rejected = true;
            break;
          }
        }

        // Display result
        if (targetKey) {
          displayFieldChange(targetKey, currentFieldValue, newFieldValue);
        } else {
          displayDiff(textContent, response, postId);
        }

        // Prompt user (skip in yolo mode)
        if (yolo) {
          if (check.ok) {
            action = 'accept';
          } else {
            action = 'reject';
          }
        } else {
          const answer = await promptUser(rl, '  [1] Yes  [2] No  [3] Retry  [4] Abort > ');
          const choice = answer.trim();

          if (choice === '1' || choice.toLowerCase() === 'y') {
            action = 'accept';
          } else if (choice === '2' || choice.toLowerCase() === 'n') {
            action = 'reject';
          } else if (choice === '3' || choice.toLowerCase() === 'r') {
            action = 'retry';
            result.retries++;
          } else if (choice === '4' || choice.toLowerCase() === 'a') {
            action = 'abort';
          } else {
            action = 'reject';
          }
        }

        if (action === 'accept') {
          // Write back
          if (targetKey) {
            postJson[targetKey] = newFieldValue;
            const jsonPath = path.join(postDir, targetFile);
            await writeFile(jsonPath, JSON.stringify(postJson, null, 2) + '\n');
          } else {
            await writeFile(packet.files.text, response);
          }
          result.accepted = true;
          console.log(`  \x1b[32maccepted\x1b[0m`);
        } else if (action === 'reject') {
          result.rejected = true;
          console.log(`  \x1b[33mskipped\x1b[0m`);
        } else if (action === 'abort') {
          result.rejected = true;
          packet._abort = true;
          console.log(`  \x1b[31maborted\x1b[0m`);
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
