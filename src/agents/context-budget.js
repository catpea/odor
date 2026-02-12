// Context budgeting: estimate tokens and trim text to fit context window

export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

export function trimToContextBudget(text, { contextSize, systemPrompt = '', userPrompt = '', responseReserve = 400 } = {}) {
  if (!contextSize) return text;

  const overhead = estimateTokens(systemPrompt) + estimateTokens(userPrompt) + responseReserve;
  const available = contextSize - overhead;

  if (available <= 0) return '';

  const textTokens = estimateTokens(text);
  if (textTokens <= available) return text;

  // Convert available tokens back to approximate characters
  const availableChars = available * 4;
  const marker = '\n\n[...trimmed...]\n\n';
  const budget = availableChars - marker.length;

  if (budget <= 0) return marker.trim();

  const half = Math.floor(budget / 2);
  const beginning = text.slice(0, half);
  const ending = text.slice(-half);

  return beginning + marker + ending;
}
