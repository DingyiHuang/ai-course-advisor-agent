export type LlmRole = "system" | "user" | "assistant";

export type LlmMessage = {
  role: LlmRole;
  content: string;
};

export type LlmCompletionRequest = {
  messages: LlmMessage[];
  temperature: number;
  responseFormat?: "json_object";
};

export type LlmCompletionResult = {
  content: string;
  model: string;
  httpStatus: number;
  latencyMs: number;
};

export interface LlmClient {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}

export type LlmRuntimeConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

export type LlmErrorCode =
  | "configuration_error"
  | "http_error"
  | "invalid_response"
  | "timeout"
  | "network_error";

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
