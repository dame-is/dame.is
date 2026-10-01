import { describe, it, expect, vi } from 'vitest';
import { experimental_evaluate } from 'ai';
import { Experimental_EvaluationMockModelV4 } from 'ai/test';

import { checkIntent, intentState, hostileProbabilities } from './tiers.js';

const input = {
  said: 'block the hostile ones',
  earlier: 'Plan 3f9a2c1b: 4 read as hostile.',
  action:
    'Add 4 accounts to the moderation list from plan 3f9a2c1b: every account on it that a triage labelled hostile.',
};

/** A fake `evaluate` that answers the intent question with this probability. */
const judgeSays = (p) =>
  vi.fn(async () => ({
    answers: { asked: { type: 'boolean', probability: p } },
    usage: { inputTokens: 300, outputTokens: 0 },
  }));

const strongSays = (text) =>
  vi.fn(async () => ({ text, usage: { inputTokens: 500, outputTokens: 10 } }));

describe('the intent check', () => {
  it('allows a confident yes without asking the stronger model', async () => {
    const generate = strongSays('NO');
    const out = await checkIntent(input, {
      evaluate: judgeSays(0.92),
      generate,
      judge: 'j/jev',
      second: 's/strong',
    });
    expect(out.allow).toBe(true);
    expect(out.by).toBe('j/jev');
    expect(generate).not.toHaveBeenCalled();
  });

  it('refuses a confident no without asking the stronger model', async () => {
    const generate = strongSays('YES');
    const out = await checkIntent(input, {
      evaluate: judgeSays(0.05),
      generate,
      judge: 'j/jev',
      second: 's/strong',
    });
    expect(out.allow).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it('asks the stronger model in the middle band, and does what it says', async () => {
    const yes = await checkIntent(input, {
      evaluate: judgeSays(0.38),
      generate: strongSays('YES\ndame asked for the hostile ones.'),
      judge: 'j/jev',
      second: 's/strong',
    });
    expect(yes).toMatchObject({
      allow: true,
      by: 's/strong',
      why: 'dame asked for the hostile ones.',
    });
    const no = await checkIntent(input, {
      evaluate: judgeSays(0.38),
      generate: strongSays('NO\nwider than asked'),
      judge: 'j/jev',
      second: 's/strong',
    });
    expect(no.allow).toBe(false);
    expect(yes.usage.map((u) => u.kind)).toEqual(['judge', 'judge-escalated']);
  });

  it('asks the stronger model when the judge is down', async () => {
    const generate = strongSays('YES\nfine');
    const out = await checkIntent(input, {
      evaluate: vi.fn().mockRejectedValue(new Error('503')),
      generate,
      judge: 'j/jev',
      second: 's/strong',
    });
    expect(generate).toHaveBeenCalled();
    expect(out.allow).toBe(true);
  });

  it('fails closed when nobody can check', async () => {
    const out = await checkIntent(input, {
      evaluate: vi.fn().mockRejectedValue(new Error('503')),
      generate: vi.fn().mockRejectedValue(new Error('503')),
      judge: 'j/jev',
      second: 's/strong',
    });
    expect(out.allow).toBe(false);
  });

  it('refuses an answer it cannot read', async () => {
    const out = await checkIntent(input, {
      evaluate: judgeSays(0.4),
      generate: strongSays('Well, it depends.'),
      judge: 'j/jev',
      second: 's/strong',
    });
    expect(out.allow).toBe(false);
  });

  it('is off when both tiers are off', async () => {
    const evaluate = judgeSays(0.01);
    const out = await checkIntent(input, {
      evaluate,
      judge: 'off',
      second: 'off',
    });
    expect(out.allow).toBe(true);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('asks dame when only an uncertain judge is available', async () => {
    const out = await checkIntent(input, {
      evaluate: judgeSays(0.4),
      judge: 'j/jev',
      second: 'off',
    });
    expect(out.allow).toBe(false);
  });

  it("puts dame's words, the last reply and the change in the state, and nothing else", () => {
    const state = intentState(input);
    expect(state).toContain('dame\'s latest message: "block the hostile ones"');
    expect(state).toContain("The assistant's previous message");
    expect(state).toContain('Proposed change: Add 4 accounts');
  });
});

// The fakes above agree with whatever shape they are handed. This runs the
// REAL experimental_evaluate against a mock model, so a question shape the SDK
// rejects fails here and not on the first write of the day.
describe('the real SDK accepts the check', () => {
  it('asks a boolean question and reads the probability back', async () => {
    let asked = null;
    const model = new Experimental_EvaluationMockModelV4({
      supportedQuestionTypes: ['boolean', 'choice', 'score'],
      doEvaluate: async (options) => {
        asked = options;
        return {
          answers: { asked: { type: 'boolean', probability: 0.83 } },
          usage: { inputTokens: 321 },
          warnings: [],
        };
      },
    });
    const out = await checkIntent(input, {
      evaluate: experimental_evaluate,
      judge: model,
      second: 'off',
    });
    expect(out).toMatchObject({ allow: true, p: 0.83 });
    expect(asked.questions.asked.type).toBe('boolean');
    expect(asked.state).toContain('Proposed change');
  });

  it('asks a choice question for hostility and reads P(hostile) back', async () => {
    const model = new Experimental_EvaluationMockModelV4({
      supportedQuestionTypes: ['boolean', 'choice', 'score'],
      doEvaluate: async () => ({
        answers: {
          tone: {
            type: 'choice',
            choice: 'arguing',
            probabilities: { hostile: 0.2, arguing: 0.7, neutral: 0.1 },
          },
        },
        usage: { inputTokens: 100 },
        warnings: [],
      }),
    });
    const usage = [];
    const out = await hostileProbabilities(
      ['this policy is cowardly', 'second'],
      {
        evaluate: experimental_evaluate,
        judge: model,
        usage,
      },
    );
    expect(out).toEqual([0.2, 0.2]);
    expect(usage[0].inputTokens).toBe(200);
  });

  it('leaves a gap rather than guessing when one call fails', async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce({
        answers: {
          tone: {
            type: 'choice',
            choice: 'hostile',
            probabilities: { hostile: 0.9, arguing: 0.1, neutral: 0 },
          },
        },
        usage: {},
      })
      .mockRejectedValueOnce(new Error('503'));
    const out = await hostileProbabilities(['a', 'b'], {
      evaluate,
      judge: 'j/jev',
      concurrency: 1,
    });
    expect(out).toEqual([0.9, null]);
  });
});
