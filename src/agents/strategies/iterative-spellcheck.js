// Iterative spellcheck strategy: word-list loop → apply → re-check → cumulative diff

const MAX_ITERATIONS = 5;

export function parseWordList(response) {
  let cleaned = response.trim();

  // Detect "no errors" phrases
  if (/no\s+(more\s+)?(errors?|corrections?|mistakes?|issues?)/i.test(cleaned)) return [];
  if (/looks?\s+(good|correct|fine)/i.test(cleaned)) return [];
  if (cleaned === '[]') return [];

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.every(item => Array.isArray(item) && item.length === 2)) {
      return parsed;
    }
    if (Array.isArray(parsed) && parsed.length === 0) return [];
  } catch {}

  // Try to extract embedded JSON arrays
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed) && parsed.every(item => Array.isArray(item) && item.length === 2)) {
        return parsed;
      }
      if (Array.isArray(parsed) && parsed.length === 0) return [];
    } catch {}
  }

  return [];
}

export default async function iterativeSpellcheckStrategy({
  textContent, targetKey, prompt, url, model, system,
  callApi, signal, displayDiff, promptUser, yolo, autoAccept,
  rl, aborted, postId, name,
}) {
  const result = { accepted: false, rejected: false, retries: 0, error: null, response: null, newFieldValue: null, abort: false };

  let corrected = textContent;
  let totalCorrections = 0;

  console.log(`\n  [${name}] ${postId}: iterative spellcheck`);

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    if (aborted?.()) {
      result.rejected = true;
      result.abort = true;
      return result;
    }

    const userMessage = iteration === 1
      ? `${prompt}\n\nReturn ONLY a JSON array of [wrong, right] pairs. Example: [["teh","the"],["recieve","receive"]]\nIf no errors, return []\n\n${corrected}`
      : `Check this text again for any remaining spelling or grammar errors. Return ONLY a JSON array of [wrong, right] pairs. If no errors, return []\n\n${corrected}`;

    let response;
    try {
      response = await callApi(url, model, system, userMessage, { signal });
    } catch (err) {
      console.log(`  \x1b[31mAPI error: ${err.message}\x1b[0m`);
      result.error = err.message;
      result.rejected = true;
      return result;
    }

    const wordList = parseWordList(response);

    if (wordList.length === 0) {
      console.log(`  iteration ${iteration}: no more corrections`);
      break;
    }

    console.log(`  iteration ${iteration}: ${wordList.length} correction(s)`);
    for (const [wrong, right] of wordList) {
      // Use word-boundary-aware replacement
      const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      corrected = corrected.replace(regex, right);
      totalCorrections++;
    }
  }

  if (totalCorrections === 0) {
    console.log(`  no corrections needed`);
    result.rejected = true;
    return result;
  }

  // Show cumulative diff
  console.log(`  ${totalCorrections} total correction(s):`);
  displayDiff(textContent, corrected, postId);

  result.response = corrected;

  // Prompt for approval
  if (autoAccept || yolo) {
    result.accepted = true;
    console.log(`  \x1b[32maccepted\x1b[0m`);
  } else {
    const answer = await promptUser(rl, '  [1] Yes  [2] No  [3] Abort > ');
    const choice = answer.trim();

    if (choice === '1' || choice.toLowerCase() === 'y') {
      result.accepted = true;
      console.log(`  \x1b[32maccepted\x1b[0m`);
    } else if (choice === '3' || choice.toLowerCase() === 'a') {
      result.rejected = true;
      result.abort = true;
      console.log(`  \x1b[31maborted\x1b[0m`);
    } else {
      result.rejected = true;
      console.log(`  \x1b[33mskipped\x1b[0m`);
    }
  }

  return result;
}
