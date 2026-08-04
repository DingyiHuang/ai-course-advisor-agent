import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  atomicWriteText,
  computeSummary,
  isTransientFailure,
  runTaskB02Evidence,
  SCENARIOS,
} from "../../scripts/task-b02-runner-core.mjs";

type FakeOptions = {
  membershipTransientOnce?: boolean;
  membershipL2Example?: boolean;
  dayFiveHttp400?: boolean;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function diagnostics(
  retrievedChunkIds: string[],
  usedChunkIds: string[],
  overrides: Record<string, unknown> = {},
) {
  return {
    retrievedChunkIds,
    usedChunkIds,
    modelCallCount: 1,
    regenerationCount: 0,
    routeLatencyMs: 12,
    ...overrides,
  };
}

function publicSource(document: "A" | "C") {
  return {
    material: "material-" + document,
    document,
    chapter: "公开章节",
  };
}

function createFakeFetch(options: FakeOptions = {}) {
  let sessionCount = 0;
  let membershipCalls = 0;
  const requests: Array<{ path: string; message?: string }> = [];

  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      input instanceof Request ? input.url : String(input);
    const pathname = new URL(url).pathname;
    if (pathname === "/api/history/sessions") {
      sessionCount += 1;
      requests.push({ path: pathname });
      return jsonResponse(
        { session: { id: "session-" + String(sessionCount) } },
        201,
      );
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      message?: string;
      action?: string;
    };
    requests.push({ path: pathname, message: body.message });
    const state = { version: 1, test: { failNextModelCall: false } };

    if (body.message === "第五天学什么？") {
      if (options.dayFiveHttp400) {
        return jsonResponse(
          {
            status: "error",
            message: "输入无法处理。",
            error: { code: "invalid_input", retryable: false },
            diagnostics: diagnostics([], [], { modelCallCount: 0 }),
          },
          400,
        );
      }
      return jsonResponse({
        status: "contextual_followup",
        message:
          "第五天学习智能体Agent实践。\n\n来源：素材A《课程手册》公开章节",
        state,
        entityIds: ["camp-p1-bj"],
        sources: [publicSource("A")],
        diagnostics: diagnostics(
          ["student-camp-daily-outline"],
          ["student-camp-daily-outline"],
        ),
      });
    }

    if (body.message === "专业会员是不是6980元？") {
      membershipCalls += 1;
      if (
        options.membershipTransientOnce &&
        membershipCalls === 1
      ) {
        return jsonResponse(
          {
            status: "error",
            message: "模型服务暂时不可用。",
            error: { code: "model_unavailable", retryable: true },
            diagnostics: diagnostics([], [], {
              modelCallCount: 2,
              regenerationCount: 0,
            }),
          },
          503,
        );
      }
      return jsonResponse({
        status: "institution_info",
        message:
          (options.membershipL2Example
            ? "会员价格未提供，可参考教师L2课程6980元。"
            : "现有资料未提供专业会员价格，因此无法确认是否为6980元。") +
          "\n\n来源：素材C《产品白皮书》公开章节",
        state,
        entityIds: ["platform-membership"],
        sources: [publicSource("C")],
        diagnostics: diagnostics(
          ["platform-membership-price-unknown"],
          ["platform-membership-price-unknown"],
        ),
      });
    }

    if (body.message === "现在还有多少余位？") {
      return jsonResponse({
        status: "contextual_followup",
        message:
          "现有资料未提供当前实时余位。\n\n来源：素材A《课程手册》公开章节",
        state,
        entityIds: ["camp-p1-bj"],
        sources: [publicSource("A")],
        diagnostics: diagnostics(
          ["student-camp-availability-unknown"],
          ["student-camp-availability-unknown"],
        ),
      });
    }

    return jsonResponse({
      status: "recommended",
      message: "已建立当前咨询班型。",
      state,
      entityIds: ["camp-p1-bj"],
      sources: [],
      diagnostics: diagnostics([], [], { modelCallCount: 0 }),
    });
  };

  return {
    fetchImpl,
    requests,
    get sessionCount() {
      return sessionCount;
    },
  };
}

async function allFileNames(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      return entry.isDirectory()
        ? allFileNames(target)
        : [target];
    }),
  );
  return nested.flat();
}

describe("TASK-B02 real-model evidence runner", () => {
  it("allows denying the user-supplied 6980 amount but rejects an L2 price example", () => {
    const scenario = SCENARIOS.find(
      (item: { id: string }) =>
        item.id === "06-membership-price-unavailable",
    );
    if (!scenario) throw new Error("membership scenario is missing");
    const base = {
      answer: "现有资料未提供会员价格，因此无法确认是否为6980元。",
      sources: ["素材C"],
      sourceDocuments: ["C"],
      retrievedChunkIds: ["membership-price"],
      usedChunkIds: ["membership-price"],
      entityIds: [],
      modelCallCount: 1,
      flowResults: [],
    };
    expect(
      scenario
        .checks(base)
        .every((item: { pass: boolean }) => item.pass),
    ).toBe(true);
    expect(
      scenario
        .checks({
          ...base,
          answer:
            "会员价格未提供，可参考教师L2课程6980元。",
        })
        .every((item: { pass: boolean }) => item.pass),
    ).toBe(false);
  });

  it("establishes teacher identity before the device scenario and accepts equivalent wording", () => {
    const scenario = SCENARIOS.find(
      (item: { id: string }) =>
        item.id === "04-teacher-device-context",
    );
    if (!scenario) throw new Error("teacher device scenario is missing");
    expect(scenario.flows[0].steps[0]).toMatchObject({
      action: "select_domain",
      domain: "teacher",
    });
    const checks = scenario.checks({
      answer: "教师参加培训需要携带笔记本电脑。",
      sources: ["素材B"],
      sourceDocuments: ["B"],
      retrievedChunkIds: ["teacher-device-and-replay"],
      usedChunkIds: ["teacher-device-and-replay"],
      entityIds: [],
      modelCallCount: 1,
      flowResults: [],
    });
    expect(
      checks.every((item: { pass: boolean }) => item.pass),
    ).toBe(true);
  });

  it("classifies only the allowed transient failures", () => {
    expect(
      isTransientFailure({
        publicErrorCode: "model_unavailable",
        httpStatus: 503,
      }),
    ).toBe(true);
    expect(
      isTransientFailure({
        publicErrorCode: null,
        httpStatus: 429,
      }),
    ).toBe(true);
    expect(
      isTransientFailure({
        publicErrorCode: "network_timeout",
        httpStatus: null,
      }),
    ).toBe(true);
    expect(
      isTransientFailure({
        publicErrorCode: "grounding_rejected",
        httpStatus: 503,
      }),
    ).toBe(true);
    expect(
      isTransientFailure({
        publicErrorCode: "grounding_rejected",
        httpStatus: 400,
      }),
    ).toBe(false);
    expect(
      isTransientFailure({
        publicErrorCode: "invalid_input",
        httpStatus: 400,
      }),
    ).toBe(false);
  });

  it("counts superseded transient attempts without affecting functional results", () => {
    const summary = computeSummary(
      [],
      [
        {
          scenarioId: "04-teacher-device",
          transientFailure: true,
          elapsedMs: 20_000,
          regenerationCount: 0,
          programFallbackCount: 1,
        },
      ],
      () => 0,
      [
        {
          scenarioId: "04-teacher-device",
          attemptCount: 3,
          originalConclusion: "失败",
          conclusion: "旧证据保留",
          supersededBy: "04-teacher-device-context",
        },
      ],
    );
    expect(summary.completedFunctionalScenarios).toBe(0);
    expect(summary.transientErrorCount).toBe(1);
    expect(summary.supersededEvidenceCount).toBe(1);
    expect(summary.supersededAttemptCount).toBe(1);
    expect(summary.longestAttemptElapsedMs).toBe(20_000);
  });

  it("atomically replaces UTF-8 files without leaving temporary fragments", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "task-b02e-atomic-"),
    );
    const target = path.join(directory, "state.json");
    await atomicWriteText(target, '{"value":"第一次"}\n');
    await atomicWriteText(target, '{"value":"第二次"}\n');

    expect(await readFile(target, "utf8")).toBe(
      '{"value":"第二次"}\n',
    );
    expect(
      (await readdir(directory)).some((name) => name.includes(".tmp-")),
    ).toBe(false);
  });

  it("persists every transient attempt, retries with a new session, and skips passed checkpoints", async () => {
    const evidenceDir = await mkdtemp(
      path.join(os.tmpdir(), "task-b02e-resume-"),
    );
    const fake = createFakeFetch({ membershipTransientOnce: true });
    const sleeps: number[] = [];

    const firstRun = await runTaskB02Evidence({
      batch: "smoke",
      baseUrl: "https://private-provider.example",
      evidenceDir,
      fetchImpl: fake.fetchImpl,
      sleep: async (milliseconds: number) => {
        sleeps.push(milliseconds);
      },
    });

    expect(firstRun.completedThisRun).toBe(3);
    expect(firstRun.failedThisRun).toBe(0);
    expect(fake.sessionCount).toBe(4);
    expect(sleeps).toEqual([8_000, 10_000, 8_000, 30_000]);

    const membershipDir = path.join(
      evidenceDir,
      "06-membership-price-unavailable",
    );
    const failedAttempt = JSON.parse(
      await readFile(
        path.join(membershipDir, "attempt-01.json"),
        "utf8",
      ),
    );
    const recoveredAttempt = JSON.parse(
      await readFile(
        path.join(membershipDir, "attempt-02.json"),
        "utf8",
      ),
    );
    const result = JSON.parse(
      await readFile(path.join(membershipDir, "result.json"), "utf8"),
    );
    expect(failedAttempt.publicErrorCode).toBe("model_unavailable");
    expect(failedAttempt.conclusion).toBe("供应商瞬时故障");
    expect(recoveredAttempt.conclusion).toBe("通过");
    expect(result.conclusion).toBe(
      "功能通过，发生供应商瞬时故障后恢复",
    );
    expect(result.firstAttemptPassed).toBe(false);
    expect(result.transientErrorCount).toBe(1);

    const summary = JSON.parse(
      await readFile(path.join(evidenceDir, "summary.json"), "utf8"),
    );
    expect(summary.transientErrorCount).toBe(1);
    expect(summary.recoveredScenarioCount).toBe(1);
    expect(summary.firstRequestSuccessRate).toBeCloseTo(66.67, 2);

    const evidenceText = (
      await Promise.all(
        (await allFileNames(evidenceDir)).map((file) =>
          readFile(file, "utf8"),
        ),
      )
    ).join("\n");
    expect(evidenceText).not.toContain("private-provider.example");
    expect(evidenceText).not.toContain("Authorization");
    expect(evidenceText).not.toContain("LLM_API_KEY");
    expect(
      (await allFileNames(evidenceDir)).some((file) =>
        file.includes(".tmp-"),
      ),
    ).toBe(false);

    let resumedFetchCalls = 0;
    const resumed = await runTaskB02Evidence({
      batch: "smoke",
      baseUrl: "https://unused.example",
      evidenceDir,
      fetchImpl: async () => {
        resumedFetchCalls += 1;
        throw new Error("passed checkpoints must not call fetch");
      },
      sleep: async () => undefined,
    });
    expect(resumed.completedThisRun).toBe(0);
    expect(resumedFetchCalls).toBe(0);
  });

  it("does not retry HTTP 400 or business validation failures", async () => {
    const evidenceDir = await mkdtemp(
      path.join(os.tmpdir(), "task-b02e-no-retry-"),
    );
    const fake = createFakeFetch({ dayFiveHttp400: true });
    const run = await runTaskB02Evidence({
      batch: "smoke",
      baseUrl: "https://local.test",
      evidenceDir,
      fetchImpl: fake.fetchImpl,
      sleep: async () => undefined,
    });

    expect(run.failedThisRun).toBe(1);
    const dayFiles = await readdir(
      path.join(evidenceDir, "01-student-day-five"),
    );
    expect(dayFiles).toContain("attempt-01.json");
    expect(dayFiles).not.toContain("attempt-02.json");
    const state = JSON.parse(
      await readFile(path.join(evidenceDir, "run-state.json"), "utf8"),
    );
    expect(state.scenarios["01-student-day-five"].status).toBe(
      "failed",
    );
  });

  it("rechecks a saved runner-assertion failure without another model request", async () => {
    const evidenceDir = await mkdtemp(
      path.join(os.tmpdir(), "task-b02e-recheck-"),
    );
    const fake = createFakeFetch({ membershipL2Example: true });
    await runTaskB02Evidence({
      batch: "smoke",
      baseUrl: "https://local.test",
      evidenceDir,
      fetchImpl: fake.fetchImpl,
      sleep: async () => undefined,
    });

    const attemptPath = path.join(
      evidenceDir,
      "06-membership-price-unavailable",
      "attempt-01.json",
    );
    const attempt = JSON.parse(await readFile(attemptPath, "utf8"));
    const correctedAnswer =
      "现有资料未提供专业会员价格，因此无法确认是否为6980元。\n\n来源：素材C";
    attempt.finalPublicAnswer = correctedAnswer;
    attempt.actual.flowResults[0].answer = correctedAnswer;
    await writeFile(
      attemptPath,
      JSON.stringify(attempt, null, 2) + "\n",
      "utf8",
    );

    let fetchCalls = 0;
    const rechecked = await runTaskB02Evidence({
      batch: "smoke",
      recheckFailed: true,
      baseUrl: "https://unused.test",
      evidenceDir,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("recheck must not call fetch");
      },
      sleep: async () => undefined,
    });
    expect(rechecked.recheckedThisRun).toBe(1);
    expect(rechecked.completedThisRun).toBe(0);
    expect(fetchCalls).toBe(0);
    const result = JSON.parse(
      await readFile(
        path.join(
          evidenceDir,
          "06-membership-price-unavailable",
          "result.json",
        ),
        "utf8",
      ),
    );
    expect(result.conclusion).toBe("通过");
    expect(result.reclassifiedAfterRunnerCheckFix).toBe(true);
    expect(result.recheckReason).toContain("未发起模型请求");
  });
});
