import type {
  LlmClient,
  LlmCompletionRequest,
  LlmCompletionResult,
} from "@/lib/llm/types";

type Step =
  | LlmCompletionResult
  | Error
  | ((request: LlmCompletionRequest) => LlmCompletionResult | Promise<LlmCompletionResult>);

export class ScriptedLlmClient implements LlmClient {
  readonly calls: LlmCompletionRequest[] = [];

  constructor(private readonly steps: Step[]) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    this.calls.push(structuredClone(request));
    const step = this.steps.shift();
    if (!step) throw new Error("No scripted LLM response remains");
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step(request) : step;
  }
}

export function completion(
  content: string,
  overrides: Partial<LlmCompletionResult> = {},
): LlmCompletionResult {
  return {
    content,
    model: "test-model",
    httpStatus: 200,
    latencyMs: 5,
    ...overrides,
  };
}
