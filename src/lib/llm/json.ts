import { LlmError } from "./types";

export function parseStrictJsonObject(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new LlmError(
      "invalid_response",
      "Model content is not directly parseable JSON",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LlmError("invalid_response", "Model JSON must be an object");
  }
  return parsed as Record<string, unknown>;
}
