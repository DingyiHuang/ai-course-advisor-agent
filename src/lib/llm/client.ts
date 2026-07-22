import type {
  LlmClient,
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmRuntimeConfig,
} from "./types";
import { LlmError } from "./types";

function completionEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

type OpenAiCompatibleResponse = {
  model?: unknown;
  choices?: Array<{
    message?: { content?: unknown };
  }>;
};

function extractContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new LlmError("invalid_response", "Model response is not an object");
  }

  const body = payload as OpenAiCompatibleResponse;
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new LlmError(
      "invalid_response",
      "Model response does not contain text content",
    );
  }
  return content;
}

export function createOpenAiCompatibleClient(
  config: LlmRuntimeConfig,
  fetchImpl: typeof fetch = fetch,
): LlmClient {
  return {
    async complete(
      request: LlmCompletionRequest,
    ): Promise<LlmCompletionResult> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      const startedAt = performance.now();

      try {
        const response = await fetchImpl(completionEndpoint(config.baseUrl), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            messages: request.messages,
            temperature: request.temperature,
            ...(request.responseFormat
              ? { response_format: { type: request.responseFormat } }
              : {}),
          }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new LlmError(
            "http_error",
            `Model provider returned HTTP ${response.status}`,
            response.status,
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new LlmError(
            "invalid_response",
            "Model provider returned non-JSON HTTP content",
          );
        }

        const providerModel =
          typeof (payload as OpenAiCompatibleResponse).model === "string"
            ? ((payload as OpenAiCompatibleResponse).model as string)
            : config.model;
        const content = extractContent(payload);
        const latencyMs = Math.round(performance.now() - startedAt);

        return {
          content,
          model: providerModel,
          httpStatus: response.status,
          latencyMs,
        };
      } catch (error) {
        if (error instanceof LlmError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new LlmError(
            "timeout",
            `Model request exceeded ${config.timeoutMs}ms`,
          );
        }
        throw new LlmError("network_error", "Model network request failed");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
