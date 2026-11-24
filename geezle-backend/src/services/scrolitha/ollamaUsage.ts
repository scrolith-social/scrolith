export type OllamaTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** Extract Ollama's reported token counts without treating missing telemetry as zero. */
export function parseOllamaTokenUsage(value: unknown): OllamaTokenUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const promptTokens = raw.prompt_eval_count;
  const completionTokens = raw.eval_count;
  if (!Number.isSafeInteger(promptTokens) || Number(promptTokens) < 0 ||
      !Number.isSafeInteger(completionTokens) || Number(completionTokens) < 0) return undefined;
  const totalTokens = Number(promptTokens) + Number(completionTokens);
  if (!Number.isSafeInteger(totalTokens)) return undefined;
  return {
    promptTokens: Number(promptTokens),
    completionTokens: Number(completionTokens),
    totalTokens
  };
}
