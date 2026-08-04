import { describe, expect, it, vi } from "vitest";

import {
  loadH2Scenarios,
  runFeeSingle,
  runStrictJsonGate,
} from "../../scripts/task-b03h2-runner.mjs";

const modelEnv = {
  NODE_ENV: "test" as const,
  LLM_BASE_URL: "https://provider.example/v1",
  LLM_API_KEY: "secret-value",
  LLM_MODEL: "test-model",
  LLM_TIMEOUT_MS: "20000",
};

describe("TASK-B03H2 single-call recovery runner", () => {
  it("reads the exact Chinese requests from the UTF-8 scenario file", async () => {
    const scenarios = await loadH2Scenarios();

    expect(scenarios.strictJsonGate.requestText).toBe(
      "请只返回JSON，字段ok为true，message为“中文正常”。",
    );
    expect(scenarios.feeSingle.requestText).toBe(
      "第一期北京线下、单人、2026-07-22缴费，费用是多少？",
    );
  });

  it("performs one strict JSON provider call and records only redacted checks", async () => {
    const scenarios = await loadH2Scenarios();
    const providerFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify({ ok: true, message: "中文正常" }) } },
          ],
        }),
        { status: 200 },
      ),
    );

    const record = await runStrictJsonGate({
      scenario: scenarios.strictJsonGate,
      providerFetch,
      env: modelEnv,
    });

    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(record).toMatchObject({
      httpStatus: 200,
      providerCallCount: 1,
      automaticRetryCount: 0,
      directJsonParse: true,
      okIsTrue: true,
      messageExact: true,
      onlyExpectedFields: true,
      exactRoundTrip: true,
      passed: true,
    });
    const evidence = JSON.stringify(record);
    expect(evidence).not.toContain(scenarios.strictJsonGate.requestText);
    expect(evidence).not.toContain("secret-value");
    expect(evidence).not.toContain("provider.example");
    expect(evidence).not.toContain("choices");
  });

  it("does not retry a failed strict JSON provider call", async () => {
    const scenarios = await loadH2Scenarios();
    const providerFetch = vi.fn(async () => new Response("", { status: 503 }));

    const record = await runStrictJsonGate({
      scenario: scenarios.strictJsonGate,
      providerFetch,
      env: modelEnv,
    });

    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(record).toMatchObject({
      httpStatus: 503,
      providerCallCount: 1,
      automaticRetryCount: 0,
      publicErrorCode: "model_unavailable",
      passed: false,
    });
  });

  it("uses one chat request with a fresh session and keeps fee evidence redacted", async () => {
    const scenarios = await loadH2Scenarios();
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      calls.push({
        url: value,
        ...(typeof init?.body === "string" || Buffer.isBuffer(init?.body)
          ? { body: String(init.body) }
          : {}),
      });
      if (value.endsWith("/api/history/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session: { id: "fresh-session" } }), {
          status: 201,
        });
      }
      if (value.endsWith("/api/chat")) {
        return new Response(
          JSON.stringify({
            message: "按规则计算后，最终每人应付6980元。",
            diagnostics: {
              composerAttempts: 1,
              composerAttemptResults: [
                {
                  attempt: 1,
                  elapsedMs: 123,
                  category: "success",
                  enteredGrounding: true,
                },
              ],
              groundingFailures: [],
              expectedAmount: 6980,
              modelAmount: 6980,
              calculationMode: "model",
              firstPassMatched: true,
              routeLatencyMs: 140,
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          messages: [
            { role: "user", content: scenarios.feeSingle.requestText },
          ],
        }),
        { status: 200 },
      );
    });

    const record = await runFeeSingle({
      scenario: scenarios.feeSingle,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(calls.filter(({ url }) => url.endsWith("/api/chat"))).toHaveLength(1);
    expect(record).toMatchObject({
      httpStatus: 200,
      runnerRetryCount: 0,
      composerCallCount: 1,
      enteredGrounding: true,
      expectedAmount: 6980,
      modelAmount: 6980,
      calculationMode: "model",
      firstPassMatched: true,
      eligibleForFeeFirstPassStatistics: true,
      exactRoundTrip: true,
      passed: true,
      outcome: "passed_first_hit",
    });
    expect(JSON.stringify(record)).not.toContain(scenarios.feeSingle.requestText);
  });
});
