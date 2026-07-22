import { createRuntimeLlmClient, loadLlmRuntimeConfig } from "./runtime";
import { LlmError } from "./types";

export type ModelGateReport = {
  model: string;
  configuredTimeoutMs: number;
  text: {
    httpStatus: number;
    latencyMs: number;
    containsChinese: true;
  };
  json: {
    httpStatus: number;
    latencyMs: number;
    directJsonParse: true;
    responseFormatSupported: boolean;
    mode: "response_format" | "strict_prompt_fallback";
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function runModelGate(): Promise<ModelGateReport> {
  const config = loadLlmRuntimeConfig();
  const client = createRuntimeLlmClient();
  const text = await client.complete({
    temperature: 0,
    messages: [
      {
        role: "system",
        content: "你正在进行服务连通性检查，请使用自然、简短的中文回答。",
      },
      {
        role: "user",
        content: "请用一句正常中文确认课程顾问服务可以响应。",
      },
    ],
  });

  if (text.httpStatus !== 200 || !/[\u3400-\u9fff]/u.test(text.content)) {
    throw new LlmError(
      "invalid_response",
      "Text smoke response is not HTTP 200 Chinese content",
    );
  }

  const jsonRequest = {
    temperature: 0,
    messages: [
      {
        role: "system" as const,
        content:
          "只返回一个JSON对象，不要Markdown代码块、解释、前缀或后缀。对象必须包含ok布尔值和message中文字符串。",
      },
      {
        role: "user" as const,
        content: '严格返回形如{"ok":true,"message":"服务正常"}的JSON对象。',
      },
    ],
  };

  let responseFormatSupported = true;
  let jsonMode: ModelGateReport["json"]["mode"] = "response_format";
  const jsonStartedAt = performance.now();
  let json;

  try {
    json = await client.complete({
      ...jsonRequest,
      responseFormat: "json_object",
    });
  } catch (error) {
    const responseFormatRejected =
      error instanceof LlmError &&
      error.code === "http_error" &&
      (error.httpStatus === 400 || error.httpStatus === 422);
    if (!responseFormatRejected) throw error;

    responseFormatSupported = false;
    jsonMode = "strict_prompt_fallback";
    json = await client.complete(jsonRequest);
  }

  const logicalJsonLatencyMs = Math.round(performance.now() - jsonStartedAt);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.content);
  } catch {
    throw new LlmError(
      "invalid_response",
      "Strict JSON smoke response cannot be parsed directly",
    );
  }

  if (
    !isRecord(parsed) ||
    parsed.ok !== true ||
    typeof parsed.message !== "string" ||
    !/[\u3400-\u9fff]/u.test(parsed.message)
  ) {
    throw new LlmError(
      "invalid_response",
      "Strict JSON smoke response does not match the required object",
    );
  }

  if (
    text.latencyMs >= config.timeoutMs ||
    logicalJsonLatencyMs >= config.timeoutMs
  ) {
    throw new LlmError(
      "timeout",
      "Measured model latency does not leave room below the configured timeout",
    );
  }

  return {
    model: json.model || text.model,
    configuredTimeoutMs: config.timeoutMs,
    text: {
      httpStatus: text.httpStatus,
      latencyMs: text.latencyMs,
      containsChinese: true,
    },
    json: {
      httpStatus: json.httpStatus,
      latencyMs: logicalJsonLatencyMs,
      directJsonParse: true,
      responseFormatSupported,
      mode: jsonMode,
    },
  };
}
