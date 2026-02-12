import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callApi } from '../../src/agents/api.js';

describe('callApi', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns content on successful response', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hello' } }] }),
    });

    const result = await callApi('http://test', 'model', 'sys', 'msg');
    assert.equal(result, 'hello');
  });

  it('retries on empty response up to 3 times', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '' } }] }),
      };
    };

    const result = await callApi('http://test', 'model', 'sys', 'msg');
    assert.equal(result, '');
    assert.equal(calls, 3);
  });

  it('returns content when retry succeeds', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      const content = calls < 3 ? '' : 'finally';
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content } }] }),
      };
    };

    const result = await callApi('http://test', 'model', 'sys', 'msg');
    assert.equal(result, 'finally');
    assert.equal(calls, 3);
  });

  it('throws on non-ok response', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await assert.rejects(
      () => callApi('http://test', 'model', 'sys', 'msg'),
      /API 500/,
    );
  });

  it('respects abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    globalThis.fetch = async () => {
      throw new Error('should not be called');
    };

    const result = await callApi('http://test', 'model', 'sys', 'msg', { signal: controller.signal });
    assert.equal(result, '');
  });
});
