// Pure validation functions for agent responses

export function hasGarbledCharacters(text) {
  // Check for control characters (except common whitespace), mojibake, U+FFFD
  const garbledPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFFD]|[\xC0-\xFF][\x80-\xBF]{0,1}(?=[^\x80-\xBF])/;
  return garbledPattern.test(text);
}

export function sanityCheck(response, original, targetKey) {
  if (!response || response.trim() === '') {
    return { ok: false, reason: 'Empty response' };
  }

  if (hasGarbledCharacters(response)) {
    return { ok: false, reason: 'Response contains garbled or control characters' };
  }

  // Length ratio check only for whole-file text targets (no key)
  if (!targetKey) {
    const ratio = response.length / original.length;
    if (ratio < 0.5) {
      return { ok: false, reason: `Response is too short (${Math.round(ratio * 100)}% of original)` };
    }
    if (ratio > 2.0) {
      return { ok: false, reason: `Response is too long (${Math.round(ratio * 100)}% of original)` };
    }
  }

  return { ok: true, reason: null };
}

export function parseJsonFieldResponse(response, key) {
  // Strip markdown code fences
  let cleaned = response.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  // For tags: try JSON array first, then comma-split fallback
  if (key === 'tags') {
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) return parsed;
    } catch {}

    // Try to extract a JSON array from within the text
    const arrayMatch = cleaned.match(/\[[\s\S]*?\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }

    // Comma-split fallback
    return cleaned.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }

  // For description and other string fields: return as plain string
  if (key === 'description') {
    return cleaned.replace(/^["']|["']$/g, '');
  }

  // Generic: try JSON.parse, fall back to string
  try {
    return JSON.parse(cleaned);
  } catch {
    return cleaned;
  }
}
