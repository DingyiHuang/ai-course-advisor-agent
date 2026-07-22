import "server-only";

import { createOpenAiCompatibleClient } from "./client";
import type { LlmClient, LlmRuntimeConfig } from "./types";
import { LlmError } from "./types";

const DEFAULT_TIMEOUT_MS = 20_000;

function requiredServerVariable(
  env: NodeJS.ProcessEnv,
  name: "LLM_BASE_URL" | "LLM_API_KEY" | "LLM_MODEL",
): string {
  const value = env[name];
  if (!value?.trim()) {
    throw new LlmError(
      "configuration_error",
      `Required server variable is missing: ${name}`,
    );
  }
  return value.trim();
}

export function loadLlmRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): LlmRuntimeConfig {
  const configuredTimeout = env.LLM_TIMEOUT_MS?.trim();
  const timeoutMs = configuredTimeout
    ? Number.parseInt(configuredTimeout, 10)
    : DEFAULT_TIMEOUT_MS;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new LlmError(
      "configuration_error",
      "LLM_TIMEOUT_MS must be a positive integer",
    );
  }

  return {
    baseUrl: requiredServerVariable(env, "LLM_BASE_URL"),
    apiKey: requiredServerVariable(env, "LLM_API_KEY"),
    model: requiredServerVariable(env, "LLM_MODEL"),
    timeoutMs,
  };
}

export function createRuntimeLlmClient(): LlmClient {
  return createOpenAiCompatibleClient(loadLlmRuntimeConfig());
}
