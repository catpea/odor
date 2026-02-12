// Evaluate strategy: rate post quality, run sub-tasks for low dimensions

export function parseEvaluation(response) {
  let cleaned = response.trim();

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {}

  // Try to extract embedded JSON object
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {}
  }

  return null;
}

export default async function evaluateStrategy({
  textContent, postJson, targetKey,
  prompt, url, model, system, callApi, signal,
  aborted, postId, name, evaluate, allTasks, runSubTask, postDir,
}) {
  const result = { accepted: false, rejected: false, retries: 0, error: null, response: null, newFieldValue: null, abort: false };

  if (!evaluate) {
    console.log(`  \x1b[33m[${name}] no evaluate config, skipping\x1b[0m`);
    result.rejected = true;
    return result;
  }

  const { thresholds = {}, subTasks = {} } = evaluate;

  console.log(`\n  [${name}] ${postId}: evaluating post quality`);

  if (aborted?.()) {
    result.rejected = true;
    result.abort = true;
    return result;
  }

  // Build evaluation prompt
  const dimensions = Object.keys(thresholds);
  const ratingInstructions = `Rate this post on a scale of 1-10 for each dimension: ${dimensions.join(', ')}.\nReturn ONLY a JSON object like: {${dimensions.map(d => `"${d}": N`).join(', ')}, "suggestions": "..."}`;

  const userMessage = `${prompt}\n\n${ratingInstructions}\n\n${textContent}`;

  let response;
  try {
    response = await callApi(url, model, system, userMessage, { signal });
  } catch (err) {
    console.log(`  \x1b[31mAPI error: ${err.message}\x1b[0m`);
    result.error = err.message;
    result.rejected = true;
    return result;
  }

  const evaluation = parseEvaluation(response);
  if (!evaluation) {
    console.log(`  \x1b[33mcould not parse evaluation response\x1b[0m`);
    result.rejected = true;
    return result;
  }

  // Display ratings
  console.log(`  Ratings:`);
  const belowThreshold = [];
  for (const dim of dimensions) {
    const score = evaluation[dim];
    const threshold = thresholds[dim];
    const pass = typeof score === 'number' && score >= threshold;
    const color = pass ? '\x1b[32m' : '\x1b[33m';
    console.log(`    ${color}${dim}: ${score ?? '?'}/${threshold}\x1b[0m`);
    if (!pass && subTasks[dim]) {
      belowThreshold.push(dim);
    }
  }

  if (evaluation.suggestions) {
    console.log(`  Suggestions: ${evaluation.suggestions}`);
  }

  // Run sub-tasks for dimensions below threshold
  if (belowThreshold.length > 0 && runSubTask && allTasks) {
    console.log(`  Running sub-tasks for: ${belowThreshold.join(', ')}`);
    for (const dim of belowThreshold) {
      if (aborted?.()) {
        result.abort = true;
        break;
      }
      const taskName = subTasks[dim];
      const taskDef = allTasks.find(t => t.name === taskName);
      if (taskDef) {
        console.log(`  → sub-task: ${taskName}`);
        await runSubTask(taskDef, postId, postDir);
      } else {
        console.log(`  \x1b[33msub-task "${taskName}" not found\x1b[0m`);
      }
    }
  }

  result.accepted = true;
  result.response = JSON.stringify(evaluation);
  return result;
}
