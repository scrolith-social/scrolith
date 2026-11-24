import { parseOllamaTokenUsage } from '../ollamaUsage';

describe('Ollama token usage extraction', () => {
  it('maps reported prompt and completion counts for durable quota settlement', () => {
    expect(parseOllamaTokenUsage({ prompt_eval_count: 321, eval_count: 45 })).toEqual({
      promptTokens: 321,
      completionTokens: 45,
      totalTokens: 366
    });
  });

  it.each([
    undefined,
    null,
    {},
    { prompt_eval_count: 12 },
    { prompt_eval_count: -1, eval_count: 2 },
    { prompt_eval_count: 1.5, eval_count: 2 },
    { prompt_eval_count: Number.MAX_SAFE_INTEGER, eval_count: 1 }
  ])('treats incomplete or invalid telemetry as unknown instead of zero', (value) => {
    expect(parseOllamaTokenUsage(value)).toBeUndefined();
  });
});
