/**
 * Phase 33.0 — OLLAMA / Scrolitha Core adapter.
 * Adapts existing scrolitha.ollama — does not reimplement transport.
 * Network calls only when enableProviderCalls is true (caller gates).
 */
import {
  generateScrolithaText,
  getScrolithaRuntimeHealth,
  resolveScrolithaLlmRuntime
} from '../../scrolitha/scrolitha.ollama';
import { SCROLITHA_LOCAL_MODEL } from '../config';
import type {
  AIProvider,
  AIProviderHealth,
  AIStructuredRequest,
  AIStructuredResponse,
  AITextRequest,
  AITextResponse
} from '../types';

export class OllamaAIProvider implements AIProvider {
  readonly id = 'OLLAMA' as const;

  async generateText(request: AITextRequest): Promise<AITextResponse> {
    const started = Date.now();
    const systemPrompt = request.messages.find((m) => m.role === 'system')?.content || '';
    const userPrompt = request.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n\n');
    const result = await generateScrolithaText({
      scope: 'user',
      quotaManaged: true,
      systemPrompt,
      userPrompt,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      timeoutMs: request.timeoutMs
    });
    const text = String((result as any)?.text || '');
    // Prefer the configured runtime model over the transport alias "scrolitha-core".
    const configuredModel =
      process.env.SCROLITHA_CORE_MODEL ||
      process.env.SCROLITHA_OLLAMA_MODEL ||
      process.env.SCROLITHA_AI_DEFAULT_MODEL ||
      SCROLITHA_LOCAL_MODEL;
    const reported = String((result as any)?.model || '').trim();
    const model =
      !reported || reported === 'scrolitha-core' || reported === 'core'
        ? configuredModel
        : reported;
    return {
      text,
      provider: 'OLLAMA',
      model,
      usage: result.usage,
      latencyMs: Date.now() - started,
      finishReason: 'stop'
    };
  }

  async generateStructured<T>(request: AIStructuredRequest<T>): Promise<AIStructuredResponse<T>> {
    const maxAttempts = 2;
    let lastRaw = '';
    let latency = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let tokenUsageComplete = true;
    const requestTimeoutMs = Math.max(1_000, Math.floor(request.timeoutMs || 30_000));
    const deadline = Date.now() + requestTimeoutMs;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new Error('PROVIDER_TIMEOUT');
      const raw = await this.generateText({ ...request, timeoutMs: remainingMs });
      lastRaw = raw.text;
      latency = raw.latencyMs;
      if (raw.usage?.promptTokens !== undefined && raw.usage.completionTokens !== undefined) {
        promptTokens += raw.usage.promptTokens;
        completionTokens += raw.usage.completionTokens;
      } else {
        tokenUsageComplete = false;
      }
      try {
        const data = request.parse(raw.text);
        if (!request.validate(data)) throw new Error('invalid structured output');
        return {
          data,
          rawText: raw.text,
          provider: 'OLLAMA',
          model: raw.model,
          usage: tokenUsageComplete
            ? {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens
              }
            : undefined,
          latencyMs: latency,
          parseAttempts: attempt
        };
      } catch {
        /* retry */
      }
    }
    // Safe fallback: empty parse
    const data = request.parse('{}') as T;
    return {
      data,
      rawText: lastRaw,
      provider: 'OLLAMA',
      model: request.model || SCROLITHA_LOCAL_MODEL,
      usage: tokenUsageComplete
        ? {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens
          }
        : undefined,
      latencyMs: latency,
      parseAttempts: maxAttempts
    };
  }

  async healthCheck(): Promise<AIProviderHealth> {
    const started = Date.now();
    try {
      const runtime = await resolveScrolithaLlmRuntime('user');
      const health = await getScrolithaRuntimeHealth('user', { runtime, deep: false } as any);
      const statusRaw = String((health as any)?.status || runtime.status || '').toLowerCase();
      const status =
        statusRaw === 'operational' || statusRaw === 'accelerated'
          ? 'operational'
          : statusRaw === 'degraded'
            ? 'degraded'
            : statusRaw === 'disabled'
              ? 'disabled'
              : 'unavailable';
      return {
        provider: 'OLLAMA',
        status,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        message: String((health as any)?.warning || (health as any)?.error || runtime.model || '')
      };
    } catch (err: any) {
      return {
        provider: 'OLLAMA',
        status: 'unavailable',
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        message: String(err?.message || 'health check failed')
      };
    }
  }
}

export const ollamaProvider = new OllamaAIProvider();
export default ollamaProvider;
