// Extracted API call with auto-retry on empty response

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

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
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
