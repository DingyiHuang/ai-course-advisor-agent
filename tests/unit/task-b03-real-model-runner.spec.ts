import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  atomicWriteText,
  computeSummary,
  createTransport,
  isTransientFailure,
  parseCliOptions,
  runTaskB03Evidence,
} from "../../scripts/task-b03-runner-core.mjs";
import {
  assertExactText,
  loadTaskB03ScenarioData,
  TASK_B03_SCENARIO_DATA,
  TASK_B03_SCENARIO_DATA_PATH,
  verifyEncodingRoundTrip,
} from "../../scripts/task-b03-encoding.mjs";
import { runTaskB03RecoveryGates } from "../../scripts/task-b03-recovery-runner.mjs";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

const feeFacts = new Map([
  ["第一期北京线下、单人", [6980, "camp-p1-bj", "student-camp-p1-bj-pricing"]],
  ["第一期北京线下班，3人团报，同一期同一班型，并选择食宿", [9040, "camp-p1-bj", "student-camp-p1-bj-pricing"]],
  ["第一期北京线下班，3人团报", [6680, "camp-p1-bj", "student-camp-p1-bj-pricing"]],
  ["第三期线上直播班，单人", [3280, "camp-p3-online", "student-camp-p3-online-pricing"]],
  ["第三期线上直播班，3人团报", [3280, "camp-p3-online", "student-camp-p3-online-pricing"]],
  ["L2周末研修班，单人", [5980, "teacher-l2-weekend", "teacher-l2-pricing"]],
] as const);

function feeFetch(options: { transientCount?: number; mismatchIds?: Set<number> } = {}) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    fetchImpl: async (_input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      if (calls <= (options.transientCount ?? 0)) {
        return jsonResponse(
          {
            status: "error",
            message: "模型服务暂时不可用。",
            error: { code: "model_unavailable", retryable: true },
            diagnostics: { modelCallCount: 2, regenerationCount: 0 },
          },
          503,
        );
      }
      const request = JSON.parse(String(init?.body ?? "{}")) as { message?: string };
      const fact = [...feeFacts].find(([needle]) => request.message?.includes(needle));
      if (!fact) throw new Error(`unexpected fee request: ${request.message ?? ""}`);
      const [amount, entityId, chunkId] = fact[1];
      const scenarioNumber = [...feeFacts].findIndex(([needle]) => request.message?.includes(needle)) + 1;
      const firstPassMatched = !options.mismatchIds?.has(scenarioNumber);
      return jsonResponse({
        status: "contextual_followup",
        message: `标准价为资料价；早鸟条件已判断；团报条件已判断；早鸟与团报不可叠加，只采用优惠金额较高的一项；最后加上明确选择的食宿费用。最终应付${amount}元。`,
        entityIds: [entityId],
        state: { version: 1, selectedEntityId: entityId, test: { failNextModelCall: false } },
        sources: [{ document: "A", chapter: "费用" }],
        presentation: { recommendations: [] },
        diagnostics: {
          retrievedChunkIds: [chunkId],
          usedChunkIds: [chunkId],
          modelCallCount: firstPassMatched ? 1 : 2,
          regenerationCount: firstPassMatched ? 0 : 1,
          calculationMode: firstPassMatched ? "model" : "regenerated_model",
          expectedAmount: amount,
          modelAmount: amount,
          firstPassMatched,
        },
      });
    },
  };
}

function recoveryFetch(options: { alterFirstHistory?: boolean } = {}) {
  let calls = 0;
  let sessionNumber = 0;
  const userMessages = new Map<string, string>();
  const recoveryGates = TASK_B03_SCENARIO_DATA.gates as Record<
    string,
    { id: string; message: string }
  >;
  const gateByMessage = new Map(
    Object.values(recoveryGates).map((gate) => [gate.message, gate]),
  );
  return {
    get calls() {
      return calls;
    },
    fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      const url = new URL(String(input));
      if (url.pathname === "/api/history/sessions" && init?.method === "POST") {
        sessionNumber += 1;
        const sessionId = `00000000-0000-4000-8000-${String(sessionNumber).padStart(12, "0")}`;
        return jsonResponse({ session: { id: sessionId } }, 201);
      }
      if (url.pathname === "/api/chat" && init?.method === "POST") {
        const request = JSON.parse(String(init.body)) as {
          message: string;
          sessionId: string;
        };
        const gate = gateByMessage.get(request.message);
        if (!gate) throw new Error("unexpected recovery scenarioId=unknown");
        userMessages.set(request.sessionId, request.message);
        if (gate.id === "gate-roundtrip-procurement") {
          return jsonResponse({
            status: "contextual_followup",
            message: "学校采购要求20人起，项目总价5万元起。",
            state: { version: 1, shortHistory: [] },
            presentation: {},
            sources: [],
            diagnostics: {
              composerAttempts: 0,
              externalModelCalls: 0,
              routeLatencyMs: 5,
            },
          });
        }
        if (gate.id === "01-fee-p1-beijing-single") {
          return jsonResponse({
            status: "contextual_followup",
            message: "最终应付6980元。",
            state: { version: 1, shortHistory: [] },
            presentation: {},
            sources: [],
            diagnostics: {
              composerAttempts: 1,
              externalModelCalls: 1,
              routeLatencyMs: 9,
              regenerationCount: 0,
              expectedAmount: 6980,
              modelAmount: 6980,
              calculationMode: "model",
              firstPassMatched: true,
            },
          });
        }
        return jsonResponse({
          status: "recommended",
          message: "模型中文回答。",
          state: { version: 1, shortHistory: [] },
          presentation: {},
          sources: [],
          diagnostics: {
            composerAttempts: 1,
            externalModelCalls: 1,
            routeLatencyMs: 7,
          },
        });
      }
      const match = url.pathname.match(/^\/api\/history\/sessions\/([^/]+)\/messages$/u);
      if (match && init?.method === "GET") {
        const message = userMessages.get(decodeURIComponent(match[1]));
        const content =
          options.alterFirstHistory && sessionNumber === 1 && typeof message === "string"
            ? `${message}x`
            : message;
        return jsonResponse({
          messages: typeof content === "string" ? [{ role: "user", content }] : [],
        });
      }
      throw new Error("unexpected recovery endpoint");
    },
  };
}

describe("TASK-B03 real-model evidence runner", () => {
  it("reads the three fixed UTF-8 strings and preserves every code unit", () => {
    const expected = new Map([
      [
        "encoding-model-health",
        "\u8bf7\u53ea\u56de\u590d\uff1a\u6a21\u578b\u6b63\u5e38",
      ],
      [
        "encoding-fee-recovery",
        "\u7b2c\u4e00\u671f\u5317\u4eac\u7ebf\u4e0b\u3001\u5355\u4eba\u3001" +
          "2026-07-22\u7f34\u8d39\uff0c\u8d39\u7528\u662f\u591a\u5c11\uff1f",
      ],
      [
        "encoding-special-symbols",
        "\u6d4b\u8bd5\u7279\u6b8a\u7b26\u53f7\uff1a!@#$%^&*()_+{}[]<>?/\\|~",
      ],
    ]);
    const data = loadTaskB03ScenarioData(TASK_B03_SCENARIO_DATA_PATH);
    expect(data.encodingChecks).toHaveLength(3);
    for (const scenario of data.encodingChecks) {
      const expectedText = expected.get(scenario.id);
      if (expectedText === undefined) throw new Error(`unexpected scenarioId=${scenario.id}`);
      const result = verifyEncodingRoundTrip(
        scenario.id,
        scenario.text,
        expectedText,
      );
      expect(result.scenarioId).toBe(scenario.id);
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it("reports only scenarioId and first difference for encoding failures", () => {
    expect(() =>
      assertExactText(
        "encoding-redacted-failure",
        "\u4e2d\u6587A",
        "\u4e2d\u6587B",
      ),
    ).toThrow(
      "harness_encoding_error scenarioId=encoding-redacted-failure firstDifference=2",
    );
  });

  it("blocks an altered message before fetch", async () => {
    let calls = 0;
    const transport = createTransport({
      baseUrl: "https://unused.example",
      requestTimeoutMs: 1_000,
      now: Date.now,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({});
      },
    });
    await expect(
      transport(
        { message: "\u4e2d\u6587A" },
        {
          scenarioId: "encoding-preflight-block",
          originalMessage: "\u4e2d\u6587B",
        },
      ),
    ).rejects.toMatchObject({
      code: "harness_encoding_error",
      scenarioId: "encoding-preflight-block",
      firstDifference: 2,
    });
    expect(calls).toBe(0);
  });

  it("serializes an unchanged request in Node with an explicit UTF-8 content type", async () => {
    let capturedBody = "";
    let capturedContentType = "";
    const message = "\u8bf7\u53ea\u56de\u590d\uff1a\u6a21\u578b\u6b63\u5e38";
    const transport = createTransport({
      baseUrl: "https://local.example",
      requestTimeoutMs: 1_000,
      now: Date.now,
      fetchImpl: async (_input: string | URL | Request, init?: RequestInit) => {
        capturedBody = String(init?.body ?? "");
        capturedContentType = new Headers(init?.headers).get("Content-Type") ?? "";
        return jsonResponse({ status: "ok" });
      },
    });
    const result = await transport(
      { message },
      { scenarioId: "encoding-preflight-pass", originalMessage: message },
    );
    expect(JSON.parse(capturedBody).message).toBe(message);
    expect(capturedContentType).toBe("application/json; charset=utf-8");
    expect(result.messageSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("runs round-trip, model, strict JSON, and one fee recovery in order", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "task-b03-recovery-"));
    const fake = recoveryFetch();
    const progress: string[] = [];
    const result = await runTaskB03RecoveryGates({
      evidenceDir,
      fetchImpl: fake.fetchImpl,
      now: () => 0,
      onProgress: ({ scenarioId }: { scenarioId: string }) => progress.push(scenarioId),
    });
    expect(result.recoverySummary.formalValidationReady).toBe(true);
    expect(fake.calls).toBe(12);
    expect(progress).toEqual([
      "gate-roundtrip-procurement",
      "gate-model-ordinary",
      "gate-model-strict-json",
      "01-fee-p1-beijing-single",
    ]);
    const fee = JSON.parse(
      await readFile(
        path.join(evidenceDir, "01-fee-p1-beijing-single", "attempt-01.json"),
        "utf8",
      ),
    );
    expect(fee).toMatchObject({
      httpStatus: 200,
      exactRoundTrip: true,
      expectedAmount: 6980,
      modelAmount: 6980,
      calculationMode: "model",
      validFeeAccuracyDenominator: 1,
      passed: true,
    });
    expect(JSON.stringify(fee)).not.toContain("sessionId");
    expect(JSON.stringify(fee)).not.toContain("Content-Type");
    expect(JSON.stringify(fee)).not.toContain(
      TASK_B03_SCENARIO_DATA.gates.feeRecovery.message,
    );
  });

  it("stops before model gates when server round-trip differs", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "task-b03-mismatch-"));
    const fake = recoveryFetch({ alterFirstHistory: true });
    await expect(
      runTaskB03RecoveryGates({
        evidenceDir,
        fetchImpl: fake.fetchImpl,
        now: () => 0,
      }),
    ).rejects.toMatchObject({
      code: "harness_encoding_error",
      scenarioId: "gate-roundtrip-procurement",
      stage: "roundtrip",
    });
    expect(fake.calls).toBe(3);
    expect(
      await readFile(path.join(evidenceDir, "recovery-summary.json"), "utf8"),
    ).toContain('"stoppedStage": "roundtrip"');
  });

  it("classifies only retryable provider and network failures", () => {
    expect(isTransientFailure({ publicErrorCode: "model_unavailable", httpStatus: 503 })).toBe(true);
    expect(isTransientFailure({ publicErrorCode: "network_timeout", httpStatus: null })).toBe(true);
    expect(isTransientFailure({ publicErrorCode: null, httpStatus: 429 })).toBe(true);
    expect(isTransientFailure({ publicErrorCode: "grounding_rejected", httpStatus: 503 })).toBe(false);
    expect(isTransientFailure({ publicErrorCode: "invalid_input", httpStatus: 400 })).toBe(false);
  });

  it("computes the required fee and reliability statistics", () => {
    const summary = computeSummary(
      [
        { category: "fee", passed: true, firstPassMatched: true, regenerationCount: 0, calculationMode: "model" },
        { category: "fee", passed: true, firstPassMatched: false, regenerationCount: 1, calculationMode: "regenerated_model" },
        { category: "conversation", passed: true, regenerationCount: 0, calculationMode: null, responseMode: "date_advisory_fallback" },
      ],
      [
        { transientFailure: true, elapsedMs: 30_000 },
        { transientFailure: false, elapsedMs: 10_000 },
      ],
      0,
    );
    expect(summary.functionalPassRate).toBe(100);
    expect(summary.feeFirstPassHitRate).toBe(50);
    expect(summary.groundingRegenerationCount).toBe(1);
    expect(summary.fallbackCount).toBe(1);
    expect(summary.transientModelErrorCount).toBe(1);
    expect(summary.averageAttemptElapsedMs).toBe(20_000);
    expect(summary.longestAttemptElapsedMs).toBe(30_000);
  });

  it("atomically replaces UTF-8 evidence without temporary fragments", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "task-b03-atomic-"));
    const target = path.join(directory, "state.json");
    await atomicWriteText(target, '{"value":"第一次"}\n');
    await atomicWriteText(target, '{"value":"第二次"}\n');
    expect(await readFile(target, "utf8")).toBe('{"value":"第二次"}\n');
    expect((await readdir(directory)).some((name) => name.includes(".tmp-"))).toBe(false);
  });

  it("runs all fee cases serially, checkpoints them, and resumes without new calls", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "task-b03-resume-"));
    const fake = feeFetch();
    const sleeps: number[] = [];
    const run = await runTaskB03Evidence({
      batch: "fees",
      evidenceDir,
      baseUrl: "https://private-provider.example",
      fetchImpl: fake.fetchImpl,
      sleep: async (milliseconds: number) => sleeps.push(milliseconds),
    });
    expect(run.completedThisRun).toBe(6);
    expect(run.summary.feeFirstPassHitCount).toBe(6);
    expect(run.summary.feeFirstPassHitRate).toBe(100);
    expect(fake.calls).toBe(6);
    expect(sleeps).toEqual([8_000, 8_000, 8_000, 30_000, 8_000, 8_000]);
    expect(await readdir(path.join(evidenceDir, "01-fee-p1-beijing-single"))).toEqual(
      expect.arrayContaining(["attempt-01.json", "attempt-01.md", "result.json", "result.md"]),
    );
    const firstAttempt = await readFile(
      path.join(evidenceDir, "01-fee-p1-beijing-single", "attempt-01.json"),
      "utf8",
    );
    expect(firstAttempt).not.toContain(
      TASK_B03_SCENARIO_DATA.gates.feeRecovery.message,
    );
    expect(JSON.parse(firstAttempt).messageSha256[0]).toMatch(/^[a-f0-9]{64}$/u);
    const allEvidence = await Promise.all(
      ["summary.json", "summary.md", "run-state.json"].map((name) =>
        readFile(path.join(evidenceDir, name), "utf8"),
      ),
    );
    expect(allEvidence.join("\n")).not.toContain("private-provider.example");

    const resumed = await runTaskB03Evidence({
      batch: "fees",
      evidenceDir,
      baseUrl: "https://unused.example",
      fetchImpl: async () => {
        throw new Error("passed checkpoints must not call fetch");
      },
      sleep: async () => undefined,
    });
    expect(resumed.completedThisRun).toBe(0);
  });

  it("resumes registration evidence at attempt-02 without overwriting attempt-01", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "task-b03-date-resume-"));
    const scenarioDir = path.join(evidenceDir, "09-registration-advisory");
    const originalAttempt = '{"scenarioId":"09-registration-advisory","attemptNumber":1,"elapsedMs":1,"transientFailure":false}\n';
    await atomicWriteText(
      path.join(evidenceDir, "run-state.json"),
      `${JSON.stringify({
        version: 1,
        mode: "local real model; testMode=false",
        updatedAt: new Date(0).toISOString(),
        scenarios: {
          "09-registration-advisory": { status: "stopped", attemptCount: 1 },
        },
      })}\n`,
    );
    await atomicWriteText(
      path.join(scenarioDir, "attempt-01.json"),
      originalAttempt,
    );
    await atomicWriteText(path.join(scenarioDir, "attempt-01.md"), "旧证据\n");

    const result = await runTaskB03Evidence({
      batch: "registration-09",
      evidenceDir,
      maxAttempts: 1,
      now: () => 0,
      sleep: async () => undefined,
      fetchImpl: async () =>
        jsonResponse({
          status: "contextual_followup",
          message:
            "资料记载的第一期报名截止时间为2026-07-25 24:00，早鸟缴费截止日期为2026-07-11。以上日期按中国标准时间理解，请以主办方最新通知为准。",
          entityIds: ["camp-p1-bj"],
          state: { version: 1, domain: "student", test: { failNextModelCall: false } },
          sources: [
            {
              document: "A",
              chapter: "第三章",
              factIds: ["camp-p1-bj.registrationDeadline"],
            },
            {
              document: "A",
              chapter: "第五章",
              factIds: ["camp-p1-bj.earlyBirdDeadline"],
            },
          ],
          presentation: { recommendations: [] },
          diagnostics: {
            retrievedChunkIds: [
              "student-camp-p1-bj-logistics",
              "student-camp-p1-bj-pricing",
            ],
            usedChunkIds: [
              "student-camp-p1-bj-logistics",
              "student-camp-p1-bj-pricing",
            ],
            modelCallCount: 2,
            composerAttempts: 2,
            regenerationCount: 1,
            groundingFailures: [
              {
                attempt: 1,
                reasonCode: "missing_required_chunk",
                detailCode: "date_advisory_early_bird_chunk_missing",
              },
            ],
            dateAdvisoryAttemptResults: [
              {
                attemptIndex: 1,
                stage: "grounding",
                publicReasonCode: "grounding_rejected",
                elapsedMs: 17,
                groundingReasonCodes: [
                  {
                    reasonCode: "missing_required_chunk",
                    detailCode: "date_advisory_early_bird_chunk_missing",
                  },
                ],
                hasValidUsedChunkIds: false,
                ignoredRawField: "must not be copied",
              },
              {
                attemptIndex: 2,
                stage: "completed",
                publicReasonCode: null,
                elapsedMs: 19,
                groundingReasonCodes: [],
                hasValidUsedChunkIds: true,
              },
            ],
          },
        }),
    });

    expect(result.completedThisRun).toBe(1);
    expect(await readFile(path.join(scenarioDir, "attempt-01.json"), "utf8"))
      .toBe(originalAttempt);
    const attempt02 = JSON.parse(
      await readFile(path.join(scenarioDir, "attempt-02.json"), "utf8"),
    );
    expect(attempt02).toMatchObject({
      attemptNumber: 2,
      httpStatus: 200,
      passed: true,
      groundingReasonCodes: [
        {
          attempt: 1,
          reasonCode: "missing_required_chunk",
          detailCode: "date_advisory_early_bird_chunk_missing",
        },
      ],
      dateAdvisoryAttemptResults: [
        {
          attemptIndex: 1,
          stage: "grounding",
          publicReasonCode: "grounding_rejected",
          elapsedMs: 17,
          groundingReasonCodes: [
            {
              reasonCode: "missing_required_chunk",
              detailCode: "date_advisory_early_bird_chunk_missing",
            },
          ],
          hasValidUsedChunkIds: false,
        },
        {
          attemptIndex: 2,
          stage: "completed",
          publicReasonCode: null,
          elapsedMs: 19,
          groundingReasonCodes: [],
          hasValidUsedChunkIds: true,
        },
      ],
    });
    expect(JSON.stringify(attempt02)).not.toContain("ignoredRawField");
  });

  it("saves all three transient attempts and then stops", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "task-b03-stop-"));
    const fake = feeFetch({ transientCount: 3 });
    const sleeps: number[] = [];
    await expect(
      runTaskB03Evidence({
        batch: "fees",
        evidenceDir,
        fetchImpl: fake.fetchImpl,
        sleep: async (milliseconds: number) => sleeps.push(milliseconds),
      }),
    ).rejects.toMatchObject({
      code: "three_consecutive_model_unavailable",
      scenarioId: "01-fee-p1-beijing-single",
    });
    expect(sleeps).toEqual([10_000, 30_000]);
    expect(await readdir(path.join(evidenceDir, "01-fee-p1-beijing-single"))).toEqual(
      expect.arrayContaining(["attempt-01.json", "attempt-02.json", "attempt-03.json"]),
    );
  });

  it("stops after six fees when fewer than five are first-pass matches", async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "task-b03-threshold-"));
    const fake = feeFetch({ mismatchIds: new Set([1, 2]) });
    await expect(
      runTaskB03Evidence({
        batch: "fees",
        evidenceDir,
        fetchImpl: fake.fetchImpl,
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "fee_first_pass_below_5_of_6" });
    const summary = JSON.parse(await readFile(path.join(evidenceDir, "summary.json"), "utf8"));
    expect(summary.feeFirstPassHitCount).toBe(4);
  });

  it("parses only the supported CLI options", () => {
    expect(parseCliOptions(["--batch", "fees", "--base-url", "http://localhost:4000"])).toMatchObject({
      batch: "fees",
      baseUrl: "http://localhost:4000",
    });
    expect(() => parseCliOptions(["--unknown"])).toThrow("Unknown TASK-B03 runner argument");
  });
});
