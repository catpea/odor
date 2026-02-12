// Default strategy: call API, display diff, prompt user

export default async function defaultStrategy({
  textContent, currentFieldValue, postJson, targetKey,
  prompt, url, model, system, callApi, signal,
  sanityCheck, parseJsonFieldResponse, displayDiff, displayFieldChange,
  promptUser, yolo, autoAccept, rl, aborted, postId, name,
}) {
  const result = { accepted: false, rejected: false, retries: 0, error: null, response: null, newFieldValue: null, abort: false };

  // Build user message
  let userMessage = prompt + '\n\n' + textContent;
  if (targetKey && currentFieldValue != null) {
    userMessage += `\n\nCurrent ${targetKey}: ${JSON.stringify(currentFieldValue)}`;
  }

  let action = 'retry';
  while (action === 'retry') {
    if (aborted?.()) {
      result.rejected = true;
      result.abort = true;
      break;
    }

    console.log(`\n  [${name}] ${postId}:`);

    let response;
    try {
      response = await callApi(url, model, system, userMessage, { signal });
    } catch (err) {
      console.log(`  \x1b[31mAPI error: ${err.message}\x1b[0m`);
      result.error = err.message;
      result.rejected = true;
      break;
    }

    result.response = response;

    // For JSON field targets, parse the response
    let processedResponse = response;
    let newFieldValue = null;
    if (targetKey) {
      newFieldValue = parseJsonFieldResponse(response, targetKey);
      processedResponse = JSON.stringify(newFieldValue);
      result.newFieldValue = newFieldValue;
    }

    // Sanity check
    const original = targetKey ? JSON.stringify(currentFieldValue ?? '') : textContent;
    const check = sanityCheck(processedResponse, original, targetKey);

    if (!check.ok) {
      console.log(`  \x1b[33mSanity check failed: ${check.reason}\x1b[0m`);
      if (yolo || autoAccept) {
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

    // Auto-accept mode: accept if sanity check passes, skip prompt
    if (autoAccept && check.ok) {
      action = 'accept';
    } else if (yolo) {
      action = check.ok ? 'accept' : 'reject';
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
  }

  if (action === 'accept') {
    result.accepted = true;
    console.log(`  \x1b[32maccepted\x1b[0m`);
  } else if (action === 'reject') {
    result.rejected = true;
    console.log(`  \x1b[33mskipped\x1b[0m`);
  } else if (action === 'abort') {
    result.rejected = true;
    result.abort = true;
    console.log(`  \x1b[31maborted\x1b[0m`);
  }

  return result;
}
