import { describe, expect, it, vi } from "vitest";
import type { ClassifierCandidate } from "@/lib/llm/classifier";
import type {
  ComposerOutput,
  ConversationState,
} from "@/lib/domain/conversation";
import type { BusinessDate } from "@/lib/time/shanghai";
import {
  runConversationTurn,
  type ConversationDependencies,
} from "@/lib/conversation/orchestrator";
import { createInitialConversationState } from "@/lib/conversation/session";
import { LlmError } from "@/lib/llm/types";

const CURRENT_DATE = "2026-07-22" as BusinessDate;

function candidate(
  overrides: Partial<ClassifierCandidate> = {},
): ClassifierCandidate {
  return {
    intent: "unknown",
    studentConstraints: {},
    teacherConstraints: {},
    studentReference: {},
    teacherReference: {},
    factTopics: [],
    evidence: {},
    ...overrides,
  };
}

function dependencies(input: {
  candidates: Array<ClassifierCandidate | Error>;
  outputs: Array<ComposerOutput | Error>;
}): ConversationDependencies & {
  classifierCalls: ReturnType<typeof vi.fn>;
  composerCalls: ReturnType<typeof vi.fn>;
} {
  const classifierCalls = vi.fn();
  const composerCalls = vi.fn();
  return {
    currentDate: CURRENT_DATE,
    classifierCalls,
    composerCalls,
    classifier: {
      async classify(message, state) {
        classifierCalls(message, state);
        const next = input.candidates.shift();
        if (!next) throw new Error("No classifier fixture");
        if (next instanceof Error) throw next;
        return structuredClone(next);
      },
    },
    composer: {
      async composeOnce(plan, history) {
        composerCalls(plan, history);
        const next = input.outputs.shift();
        if (!next) throw new Error("No composer fixture");
        if (next instanceof Error) throw next;
        return structuredClone(next);
      },
    },
  };
}

describe("TASK-04 session orchestration", () => {
  it("keeps Guangzhou offline at travel clarification, then recommends online only after no travel", async () => {
    const firstDeps = dependencies({
      candidates: [
        candidate({
          domainCandidate: "student",
          intent: "recommendation",
          studentConstraints: {
            region: "guangzhou",
            availablePeriods: [1],
            modePreference: "offline",
          },
          evidence: {
            domain: "家长",
            intent: "想",
            "student.region": "广州",
            "student.availablePeriods": "第一期",
            "student.modePreference": "线下",
          },
        }),
      ],
      outputs: [
        {
          message: "学生线下课程目前只有北京和上海。可以前往北京、上海，还是均不便出行？",
          usedFactIds: ["camp-p1-bj.campus"],
          actions: ["返回菜单"],
          recommendationReasons: [],
        },
      ],
    });
    const first = await runConversationTurn(
      { message: "我是广州家长，第一期只想线下" },
      firstDeps,
    );

    expect(first.status).toBe("boundary_follow_up");
    expect(first.message).toMatch(/^素材A没有广州学生线下班。/u);
    expect(first.message).toContain("北京、上海");
    expect(first.message).toContain("均不便出行？");
    expect(first.state.selectedEntityId).toBeUndefined();
    expect(first.state.pendingQuestionKeys).toEqual(["canTravel"]);

    const secondDeps = dependencies({
      candidates: [
        candidate({
          intent: "recommendation",
          studentConstraints: { canTravel: false },
          evidence: {
            intent: "均不便出行",
            "student.canTravel": "均不便出行",
          },
        }),
      ],
      outputs: [
        {
          message: "结合第一期安排和不便出行的情况，线上直播班提供30天回放。",
          usedFactIds: [
            "camp-p1-online.startDate",
            "camp-p1-online.deliveryMode",
            "camp-p1-online.replayDays",
          ],
          actions: ["继续询问当前班型"],
          recommendationReasons: [
            {
              entityId: "camp-p1-online",
              reasons: [
                { constraintKey: "availablePeriods", reason: "第一期符合可参加时间。" },
                { constraintKey: "region", reason: "广州没有学生线下班。" },
                { constraintKey: "canTravel", reason: "北京、上海均不便前往。" },
                { constraintKey: "modePreference", reason: "保留线下偏好，但当前以线上直播作为可行备选。" },
              ],
            },
          ],
        },
      ],
    });
    const second = await runConversationTurn(
      { message: "均不便出行", state: first.state },
      secondDeps,
    );

    expect(second.status).toBe("recommended");
    expect(second.entityIds).toEqual(["camp-p1-online"]);
    expect(second.state.selectedEntityId).toBe("camp-p1-online");
    expect(second.presentation.recommendations).toHaveLength(1);
    expect(
      second.presentation.recommendations[0].reasons.map(
        ({ constraintKey }) => constraintKey,
      ),
    ).toEqual([
      "availablePeriods",
      "region",
      "canTravel",
      "modePreference",
    ]);
    expect(second.presentation.recommendations[0].sources.length).toBeGreaterThan(0);
  });

  it("uses startingLevel=beginner without inventing goal and recommends only L1 weekend", async () => {
    const deps = dependencies({
      candidates: [
        candidate({
          domainCandidate: "teacher",
          intent: "recommendation",
          teacherConstraints: {
            startingLevel: "beginner",
            canTakeContinuousLeave: false,
          },
          evidence: {
            domain: "教师",
            intent: "合适",
            "teacher.startingLevel": "零基础",
            "teacher.canTakeContinuousLeave": "不能脱岗",
          },
        }),
      ],
      outputs: [
        {
          message: "零基础起步且工作日不能连续脱岗，周末研修班更匹配。",
          usedFactIds: [
            "teacher-l1-weekend.format",
            "teacher-l1-weekend.level",
          ],
          actions: ["继续询问当前班型"],
          recommendationReasons: [
            {
              entityId: "teacher-l1-weekend",
              reasons: [
                { constraintKey: "canTakeContinuousLeave", reason: "周末安排不要求工作日连续脱岗。" },
                { constraintKey: "startingLevel", reason: "L1适合零基础起步。" },
              ],
            },
          ],
        },
      ],
    });
    const response = await runConversationTurn(
      { message: "我是零基础教师，工作日不能脱岗，想找合适的班" },
      deps,
    );

    expect(response.entityIds).toEqual(["teacher-l1-weekend"]);
    expect(response.state.teacherConstraints).toMatchObject({
      startingLevel: "beginner",
      canTakeContinuousLeave: false,
    });
    expect(response.state.teacherConstraints.goal).toBeUndefined();
    const plan = deps.composerCalls.mock.calls[0][0];
    expect(JSON.stringify(plan)).not.toContain('"goal"');
    expect(JSON.stringify(plan)).not.toContain("teacher-l1-intensive");
  });

  it("retries the composer once, then returns the original session unchanged", async () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.studentConstraints = {
      region: "beijing",
      availablePeriods: [1],
      modePreference: "offline",
    };
    state.shortHistory = [{ role: "assistant", content: "原有上下文" }];
    const deps = dependencies({
      candidates: [
        candidate({
          intent: "recommendation",
          evidence: { intent: "继续" },
        }),
      ],
      outputs: [
        new LlmError("timeout", "timeout"),
        new LlmError("timeout", "timeout"),
      ],
    });
    const response = await runConversationTurn(
      { message: "继续", state },
      deps,
    );

    expect(deps.composerCalls).toHaveBeenCalledTimes(2);
    expect(response).toMatchObject({
      status: "error",
      error: { code: "model_unavailable", retryable: true },
    });
    expect(response.state).toEqual(state);
  });

  it("consumes an injected failure once without changing the conversation", async () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.shortHistory = [{ role: "assistant", content: "保留我" }];
    const unused = dependencies({ candidates: [], outputs: [] });
    const armed = await runConversationTurn(
      { action: "inject_next_failure", testMode: true, state },
      unused,
    );
    expect(armed.state.test.failNextModelCall).toBe(true);

    const failed = await runConversationTurn(
      { message: "测试失败", state: armed.state },
      unused,
    );
    expect(failed.error?.code).toBe("simulated_model_failure");
    expect(failed.state.test.failNextModelCall).toBe(false);
    expect(failed.state.shortHistory).toEqual(state.shortHistory);
    expect(unused.classifierCalls).not.toHaveBeenCalled();
  });

  it("keeps facts and programmatic sources stable while allowing different wording", async () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.selectedEntityId = "camp-p1-bj";
    const makeCandidate = (intentEvidence: string, topicEvidence: string) =>
      candidate({
        intent: "fact_question",
        factTopics: ["price"],
        evidence: {
          intent: intentEvidence,
          "topic.price": topicEvidence,
        },
      });
    const firstDeps = dependencies({
      candidates: [makeCandidate("费用", "费用")],
      outputs: [{
        message: "费用信息已经为你核对。",
        usedFactIds: ["camp-p1-bj.standardPrice"],
        actions: ["继续询问当前班型"],
        recommendationReasons: [],
      }],
    });
    const first = await runConversationTurn(
      { message: "这个班费用呢", state },
      firstDeps,
    );
    const secondDeps = dependencies({
      candidates: [makeCandidate("价格", "价格")],
      outputs: [{
        message: "我已查清这个班的价格信息。",
        usedFactIds: ["camp-p1-bj.standardPrice"],
        actions: ["继续询问当前班型"],
        recommendationReasons: [],
      }],
    });
    const second = await runConversationTurn(
      { message: "它的价格如何", state },
      secondDeps,
    );

    expect(first.message).not.toBe(second.message);
    expect(first.sources).toEqual(second.sources);
    expect(first.sources[0].factIds).toEqual(["camp-p1-bj.standardPrice"]);
  });

  it("clears identity, constraints, selection and history on reset or menu", async () => {
    const state: ConversationState = {
      ...createInitialConversationState(),
      domain: "teacher",
      teacherConstraints: { startingLevel: "beginner" },
      selectedEntityId: "teacher-l1-weekend",
      lastRecommendationIds: ["teacher-l1-weekend"],
      shortHistory: [{ role: "user", content: "旧消息" }],
    };
    const unused = dependencies({ candidates: [], outputs: [] });
    for (const action of ["reset", "menu"] as const) {
      const response = await runConversationTurn({ action, state }, unused);
      expect(response.state).toEqual(createInitialConversationState());
    }
  });

  it("sets an explicit role and selects only an entity from the latest recommendations", async () => {
    const unused = dependencies({ candidates: [], outputs: [] });
    const selectedRole = await runConversationTurn(
      { action: "select_domain", domain: "teacher" },
      unused,
    );
    expect(selectedRole.status).toBe("identity_selected");
    expect(selectedRole.state.domain).toBe("teacher");

    selectedRole.state.lastRecommendationIds = ["teacher-l1-weekend"];
    const selectedCourse = await runConversationTurn(
      {
        action: "select_entity",
        entityId: "teacher-l1-weekend",
        state: selectedRole.state,
      },
      unused,
    );
    expect(selectedCourse.status).toBe("selection");
    expect(selectedCourse.state.selectedEntityId).toBe("teacher-l1-weekend");

    const rejected = await runConversationTurn(
      {
        action: "select_entity",
        entityId: "teacher-l3-intensive",
        state: selectedRole.state,
      },
      unused,
    );
    expect(rejected.error?.code).toBe("invalid_input");
  });

  it("uses a structured catalog action without classifier keyword routing", async () => {
    const state = createInitialConversationState();
    state.domain = "student";
    const catalogFactIds = [1, 2, 3].flatMap((period) =>
      ["bj", "sh", "online"].map((campus) =>
        `camp-p${period}-${campus}.startDate`,
      ),
    );
    const deps = dependencies({
      candidates: [],
      outputs: [
        {
          message: "已按三个营期与三种授课形式整理全部学生课程。",
          usedFactIds: catalogFactIds,
          actions: ["返回菜单"],
          recommendationReasons: [],
        },
      ],
    });
    const response = await runConversationTurn(
      { action: "catalog", message: "查看全部课程", state },
      deps,
    );
    expect(response.status).toBe("catalog");
    expect(response.entityIds).toHaveLength(9);
    expect(deps.classifierCalls).not.toHaveBeenCalled();
  });
});
