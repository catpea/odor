// Extracted API call with auto-retry on empty response

const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes per request

export async function callApi(url, model, system, userMessage, { signal } = {}) {
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userMessage },
    ],
    stream: false,
  };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) return '';

    // Combine user abort signal with per-request timeout
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '';

    if (content.trim() !== '') return content;

    if (attempt < maxAttempts) {
      console.log(`  \x1b[33mempty response, retrying (${attempt}/${maxAttempts})...\x1b[0m`);
    }
  }

  console.log(`  \x1b[33mempty response after ${maxAttempts} attempts\x1b[0m`);
  return '';
}
