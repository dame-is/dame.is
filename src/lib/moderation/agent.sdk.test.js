// The test that would have caught it.
//
// Every other test in agent.test.js injects a fake `generate`, which means they
// validate the call shape against themselves and will happily agree with a shape
// the real SDK rejects. That is exactly what happened: moving the system prompt
// into `messages` to carry a cache marker passed 1,292 tests and then failed on
// every live turn with
//
//   Invalid prompt: System messages are not allowed in the prompt or messages
//   fields. Use the instructions option instead.
//
// So this one calls the REAL generateText against a mock MODEL. It does not
// check what the analyst says; it checks that the SDK accepts how we ask.

import { describe, it, expect } from 'vitest';
import { generateText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { answer, systemPromptFor } from './agent.js';

const model = new MockLanguageModelV4({
  doGenerate: async () => ({
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 3 },
    content: [{ type: 'text', text: 'ok' }],
    warnings: [],
  }),
});

const io = {
  preflight: async () => ({}),
  lookUp: async () => null,
  referenceStatus: () => ({}),
};

describe('the real SDK accepts how we call it', () => {
  it('takes the prompt, the tools and the history', async () => {
    const out = await answer({
      generate: generateText,
      model,
      message: 'who is this',
      io,
      history: [
        { role: 'user', content: 'earlier' },
        { role: 'assistant', content: 'answered' },
      ],
    });
    expect(out.text).toBe('ok');
  });

  it('takes a cache-marked system message on an anthropic model', async () => {
    // cacheHint only fires for anthropic/*, so the marked shape is only ever
    // exercised on that path. Passing the mock model with an anthropic-looking
    // id is the only way to reach it without a live call.
    const marked = new MockLanguageModelV4({
      modelId: 'anthropic/claude-opus-5',
      doGenerate: async () => ({
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1 },
        content: [{ type: 'text', text: 'ok' }],
        warnings: [],
      }),
    });
    const out = await answer({
      generate: generateText,
      model: marked,
      message: 'x',
      io,
      voice: 'VOICE. Terse.',
      guidance: 'Always give posting frequency.',
    });
    expect(out.text).toBe('ok');
  });

  it('takes the public surface too', async () => {
    const out = await answer({
      generate: generateText,
      model,
      message: 'x',
      io,
      surface: 'post',
    });
    expect(out.text).toBe('ok');
    expect(systemPromptFor('post')).toContain('THIS REPLY IS PUBLIC');
  });
});
