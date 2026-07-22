import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleClient } from "@/lib/llm/client";
import { parseStrictJsonObject } from "@/lib/llm/json";
import { LlmError } from "@/lib/llm/types";

const CONFIG = {
  baseUrl: "https://provider.example/v1",
  apiKey: "test-only-placeholder",
  model: "test-model",
  timeoutMs: 20_000,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenAI-compatible client contract", () => {
  it("returns HTTP 200 Chinese content and sends JSON mode when requested", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchStub: typeof fetch = vi.fn(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        model: "provider-model",
        choices: [{ message: { content: '{"ok":true,"message":"服务正常"}' } }],
      });
    });
    const client = createOpenAiCompatibleClient(CONFIG, fetchStub);
    const result = await client.complete({
      temperature: 0,
      responseFormat: "json_object",
      messages: [{ role: "user", content: "请返回中文JSON" }],
    });

    expect(result).toMatchObject({
      httpStatus: 200,
      model: "provider-model",
    });
    expect(result.content).toContain("服务正常");
    expect(JSON.parse(result.content)).toEqual({ ok: true, message: "服务正常" });
    expect(requestBody?.response_format).toEqual({ type: "json_object" });
  });

  it("rejects fenced or prefixed JSON instead of repairing it", () => {
    expect(() => parseStrictJsonObject('{"ok":true}')).not.toThrow();
    expect(() => parseStrictJsonObject('```json\n{"ok":true}\n```')).toThrow(
      LlmError,
    );
    expect(() => parseStrictJsonObject('结果：{"ok":true}')).toThrow(LlmError);
  });

  it("aborts at the configured timeout with a sanitized timeout error", async () => {
    vi.useFakeTimers();
    const fetchStub: typeof fetch = vi.fn((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    );
    const client = createOpenAiCompatibleClient(CONFIG, fetchStub);
    const pending = client.complete({
      temperature: 0,
      messages: [{ role: "user", content: "timeout" }],
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(20_001);
    await rejection;
  });
});
