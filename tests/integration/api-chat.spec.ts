import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatResponse,
  ComposerPlan,
  ConversationState,
} from "@/lib/domain/conversation";
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
} from "@/lib/llm/types";
import { createInitialConversationState } from "@/lib/conversation/session";

const providerControl = vi.hoisted(() => ({
  composerMode: "normal" as
    | "normal"
    | "first_ungrounded_then_ok"
    | "first_impersonation_then_ok"
    | "first_wrong_period_then_ok"
    | "always_ungrounded"
    | "valid_chinese_amount",
  composerCalls: 0,
}));

function completion(content: string): LlmCompletionResult {
  return {
    content,
    model: "task05-fake-provider",
    httpStatus: 200,
    latencyMs: 1,
  };
}

type FakeClassifierCandidate = {
  domainCandidate: "student" | "teacher" | "platform" | null;
  intent: string;
  studentConstraints: Record<string, unknown>;
  teacherConstraints: Record<string, unknown>;
  studentReference: Record<string, unknown>;
  teacherReference: Record<string, unknown>;
  institutionNeed: string | null;
  factTopics: string[];
  evidence: Record<string, string>;
};

function emptyCandidate(): FakeClassifierCandidate {
  return {
    domainCandidate: null,
    intent: "unknown",
    studentConstraints: {},
    teacherConstraints: {},
    studentReference: {},
    teacherReference: {},
    institutionNeed: null,
    factTopics: [],
    evidence: {},
  };
}

function classify(message: string): Record<string, unknown> {
  const result = emptyCandidate();
  const evidence = result.evidence;

  if (message.includes("老师说这个班多少钱")) {
    result.domainCandidate = "teacher";
    result.intent = "fact_question";
    result.factTopics = ["price"];
    evidence.domain = "老师";
    evidence.intent = "多少钱";
    evidence["topic.price"] = "多少钱";
    return result;
  }
  if (message.includes("老师，这个班有回放吗")) {
    result.domainCandidate = "teacher";
    result.intent = "fact_question";
    result.factTopics = ["replay"];
    evidence.domain = "老师";
    evidence.intent = "回放";
    evidence["topic.replay"] = "回放";
    return result;
  }
  if (message === "我想学AI") {
    result.domainCandidate = "student";
    result.intent = "recommendation";
    result.studentConstraints = {
      learningGoal: "AI",
    };
    evidence.domain = "我想学AI";
    evidence.intent = "我想学AI";
    evidence["student.learningGoal"] = "我想学AI";
    return result;
  }
  if (message.includes("均不便出行")) {
    result.intent = "unrelated";
    evidence.intent = "均不便出行";
    return result;
  }
  if (message.includes("具体周末可以上课")) {
    result.domainCandidate = "student";
    result.intent = "recommendation";
    result.studentConstraints = {
      region: "guangzhou",
      availablePeriods: [2],
      modePreference: "offline",
    };
    evidence.domain = "广州";
    evidence.intent = "线下";
    evidence["student.region"] = "广州";
    evidence["student.availablePeriods"] = "周末";
    evidence["student.modePreference"] = "线下";
    return result;
  }
  if (message.includes("学校计划采购20人的教师培训")) {
    result.domainCandidate = "teacher";
    result.intent = "recommendation";
    result.teacherConstraints = { startingLevel: "beginner" };
    evidence.domain = "教师";
    evidence.intent = "教师培训";
    evidence["teacher.startingLevel"] = "教师培训";
    return result;
  }
  if (message.includes("我是广州家长")) {
    result.domainCandidate = "student";
    result.intent = "recommendation";
    result.studentConstraints = {
      region: "guangzhou",
      availablePeriods: [1],
      modePreference: "offline",
    };
    evidence.domain = "家长";
    evidence.intent = "只想";
    evidence["student.region"] = "广州";
    evidence["student.availablePeriods"] = "第一期";
    evidence["student.modePreference"] = "线下";
    return result;
  }
  if (message.includes("零基础教师")) {
    result.domainCandidate = "teacher";
    result.intent = "recommendation";
    result.teacherConstraints = {
      startingLevel: "beginner",
      canTakeContinuousLeave: false,
    };
    evidence.domain = "教师";
    evidence.intent = "教师";
    evidence["teacher.startingLevel"] = "零基础";
    evidence["teacher.canTakeContinuousLeave"] = message.includes("工作日不能连续脱岗")
      ? "工作日不能连续脱岗"
      : "工作日不能脱岗";
    return result;
  }
  if (message.includes("北京") && message.includes("第一期")) {
    result.domainCandidate = "student";
    result.intent = "recommendation";
    result.studentConstraints = {
      region: "beijing",
      availablePeriods: [1],
      modePreference: "offline",
    };
    evidence.domain = "家长";
    evidence.intent = "希望";
    evidence["student.region"] = "北京";
    evidence["student.availablePeriods"] = "第一期";
    evidence["student.modePreference"] = "线下";
    return result;
  }
  if (message.includes("上海") && message.includes("第二期")) {
    result.domainCandidate = "student";
    result.intent = "recommendation";
    result.studentConstraints = {
      region: "shanghai",
      availablePeriods: [2],
      modePreference: "offline",
    };
    evidence.domain = "家长";
    evidence.intent = "希望";
    evidence["student.region"] = "上海";
    evidence["student.availablePeriods"] = "第二期";
    evidence["student.modePreference"] = "线下";
    return result;
  }
  if (message.includes("第三期") && message.includes("需要回放")) {
    result.domainCandidate = "student";
    result.intent = "recommendation";
    result.studentConstraints = {
      availablePeriods: [3],
      canTravel: false,
      needsReplay: true,
    };
    evidence.domain = "学生";
    evidence.intent = "需要回放";
    evidence["student.availablePeriods"] = "第三期";
    evidence["student.canTravel"] = "不便出行";
    evidence["student.needsReplay"] = "需要回放";
    return result;
  }
  if (message.includes("L1同等能力") && message.includes("Web应用")) {
    result.intent = "recommendation";
    result.teacherConstraints = {
      startingLevel: "L1",
      goal: "web-app",
      canTakeContinuousLeave: true,
      availableProductIds: ["teacher-l2-intensive"],
      prerequisiteStatus: "met",
    };
    evidence.intent = "希望";
    evidence["teacher.startingLevel"] = "L1同等能力";
    evidence["teacher.goal"] = "Web应用";
    evidence["teacher.canTakeContinuousLeave"] = "连续参加";
    evidence["teacher.availableProductIds"] = "8月3";
    evidence["teacher.prerequisiteStatus"] = "L1同等能力";
    return result;
  }
  if (message === "学生" || message === "学生或家长") {
    return result;
  }
  return result;
}

function compose(payload: Record<string, unknown>): Record<string, unknown> {
  providerControl.composerCalls += 1;
  const facts = payload.facts as Array<{ id: string; value: unknown }>;
  const plan = payload as unknown as ComposerPlan & {
    recommendationReasonRequirements: Array<{
      entityId: string;
      constraintKeys: string[];
    }>;
  };
  const usedFactIds = facts.map(({ id }) => id);
  const recommendationReasons =
    plan.recommendationReasonRequirements?.map((group) => ({
      entityId: group.entityId,
      reasons: group.constraintKeys.map((constraintKey) => ({
        constraintKey,
        reason: `该班型与已确认的${constraintKey}约束相符。`,
      })),
    })) ?? [];

  let message = plan.nextQuestionKeys.length
    ? "请补充当前规则需要的信息？"
    : "已根据已确认事实完成核对。";
  if (plan.status === "institution_info") {
    message = "学校采购需满足20人起，项目总价5万元起。";
  }
  if (plan.status === "fact_answer") {
    const calculations = payload.calculations as Array<{
      value?: { total?: number };
    }>;
    const total = calculations[0]?.value?.total;
    if (typeof total === "number") message = `当前费用为${total}元。`;
  }

  if (
    providerControl.composerMode === "always_ungrounded" ||
    (providerControl.composerMode === "first_ungrounded_then_ok" &&
      providerControl.composerCalls === 1)
  ) {
    message = "学校采购2万元起。";
  } else if (
    providerControl.composerMode === "first_impersonation_then_ok" &&
    providerControl.composerCalls === 1
  ) {
    message = "您好，我是模拟人工顾问，可以继续为您服务。";
  } else if (
    providerControl.composerMode === "first_wrong_period_then_ok" &&
    providerControl.composerCalls === 1
  ) {
    message = "为您推荐第二期线上直播班。";
  } else if (providerControl.composerMode === "valid_chinese_amount") {
    message = "学校采购需满足20人起，项目总价五万元起。";
  }

  return {
    message,
    usedFactIds,
    actions: (payload.actions as string[]).slice(0, 1),
    recommendationReasons,
  };
}

vi.mock("@/lib/llm/runtime", () => ({
  createRuntimeLlmClient: () => ({
    async complete(request: LlmCompletionRequest) {
      const system = request.messages[0]?.content ?? "";
      const payload = JSON.parse(request.messages.at(-1)?.content ?? "{}") as Record<
        string,
        unknown
      >;
      return completion(
        JSON.stringify(
          system.includes("结构化分类器")
            ? classify(String(payload.message ?? ""))
            : compose(payload),
        ),
      );
    },
  }),
}));

import { POST } from "@/app/api/chat/route";

async function postChat(body: Record<string, unknown>): Promise<{
  httpStatus: number;
  response: ChatResponse;
}> {
  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return {
    httpStatus: response.status,
    response: (await response.json()) as ChatResponse,
  };
}

async function selectDomain(
  domain: "student" | "teacher" | "platform",
  state: ConversationState = createInitialConversationState(),
): Promise<ChatResponse> {
  return (
    await postChat({
      action: "select_domain",
      domain,
      state,
      testMode: false,
    })
  ).response;
}

beforeEach(() => {
  providerControl.composerMode = "normal";
  providerControl.composerCalls = 0;
});

describe("TASK-05 real Route Handler integration", () => {
  it("R01 recommends the canonical period-1 Beijing offline camp", async () => {
    const { httpStatus, response } = await postChat({
      action: "message",
      message: "家长，北京，可参加第一期，希望线下",
      state: createInitialConversationState(),
      testMode: false,
    });

    expect(httpStatus).toBe(200);
    expect(response.status).toBe("recommended");
    expect(response.state.domain).toBe("student");
    expect(response.entityIds).toEqual(["camp-p1-bj"]);
    expect(response.presentation.recommendations[0]).toMatchObject({
      entityId: "camp-p1-bj",
      standardPrice: 6980,
      actualPrice: 6980,
    });
    expect(
      response.presentation.recommendations[0].reasons.map(
        ({ constraintKey }) => constraintKey,
      ),
    ).toEqual(["availablePeriods", "region", "modePreference"]);
    expect(response.sources.every(({ document }) => document === "A")).toBe(true);
  });

  it("retains complete student constraints collected before identity selection", async () => {
    const first = (
      await postChat({
        action: "message",
        message: "我在北京，第一期可以参加，偏好线下",
        state: createInitialConversationState(),
        testMode: false,
      })
    ).response;
    expect(first.status).toBe("needs_identity");
    expect(first.state.domain).toBe("unknown");
    expect(first.state.studentConstraints).toMatchObject({
      region: "beijing",
      availablePeriods: [1],
      modePreference: "offline",
    });

    const selected = await selectDomain("student", first.state);
    expect(selected.status).toBe("recommended");
    expect(selected.entityIds).toEqual(["camp-p1-bj"]);
    expect(selected.state.pendingQuestionKeys).toEqual([]);
  });

  it("does not recompose or duplicate cards when the current identity is selected again", async () => {
    const recommended = (
      await postChat({
        action: "message",
        message: "家长，北京，可参加第一期，希望线下",
        state: createInitialConversationState(),
        testMode: false,
      })
    ).response;
    const callsBeforeRepeat = providerControl.composerCalls;

    const repeated = await selectDomain("student", recommended.state);

    expect(repeated.status).toBe("identity_selected");
    expect(repeated.entityIds).toEqual([]);
    expect(repeated.presentation.recommendations).toEqual([]);
    expect(repeated.state.lastRecommendationIds).toEqual(["camp-p1-bj"]);
    expect(providerControl.composerCalls).toBe(callsBeforeRepeat);
  });

  it("R02 recommends only the canonical period-2 Shanghai offline camp", async () => {
    const { response } = await postChat({
      action: "message",
      message: "家长，上海，可参加第二期，希望线下",
      state: createInitialConversationState(),
      testMode: false,
    });
    expect(response.entityIds).toEqual(["camp-p2-sh"]);
    expect(JSON.stringify(response.presentation)).not.toContain("camp-p2-bj");
    expect(JSON.stringify(response.presentation)).not.toContain("camp-p2-online");
  });

  it("R03 recommends the period-3 online camp for replay and no travel", async () => {
    const { response } = await postChat({
      action: "message",
      message: "学生，第三期有空，不便出行，需要回放",
      state: createInitialConversationState(),
      testMode: false,
    });
    expect(response.entityIds).toEqual(["camp-p3-online"]);
    expect(
      response.presentation.recommendations[0].reasons.map(
        ({ constraintKey }) => constraintKey,
      ),
    ).toEqual(["availablePeriods", "needsReplay", "canTravel"]);
  });

  it("R04 recommends only the L1 weekend teacher product", async () => {
    const { response } = await postChat({
      action: "message",
      message: "零基础教师，周末有空，工作日不能脱岗",
      state: createInitialConversationState(),
      testMode: false,
    });
    expect(response.state.domain).toBe("teacher");
    expect(response.entityIds).toEqual(["teacher-l1-weekend"]);
    expect(response.presentation.recommendations[0]).toMatchObject({
      entityId: "teacher-l1-weekend",
      standardPrice: 2980,
    });
    expect(JSON.stringify(response)).not.toContain("teacher-l1-intensive");
    expect(JSON.stringify(response)).not.toContain("platform-school-procurement");
  });

  it("R05 recommends L2 intensive with prerequisite, time and goal traces", async () => {
    const selected = await selectDomain("teacher");
    const { response } = await postChat({
      action: "message",
      message: "已具备L1同等能力，可在8月3—5日连续参加，希望做Web应用",
      state: selected.state,
      testMode: false,
    });
    expect(response.entityIds).toEqual(["teacher-l2-intensive"]);
    expect(response.state.teacherConstraints).toMatchObject({
      startingLevel: "L1",
      goal: "web-app",
      canTakeContinuousLeave: true,
      prerequisiteStatus: "met",
      availableProductIds: ["teacher-l2-intensive"],
    });
    expect(
      response.presentation.recommendations[0].reasons.map(
        ({ constraintKey }) => constraintKey,
      ),
    ).toEqual(
      expect.arrayContaining([
        "goal",
        "canTakeContinuousLeave",
        "prerequisiteStatus",
        "availableProductIds",
      ]),
    );
  });

  it("M01 and M02 preserve the selected student camp and use only material A", async () => {
    const recommended = (
      await postChat({
        action: "message",
        message: "家长，北京，可参加第一期，希望线下",
        state: createInitialConversationState(),
        testMode: false,
      })
    ).response;
    const selected = (
      await postChat({
        action: "select_entity",
        entityId: "camp-p1-bj",
        state: recommended.state,
        testMode: false,
      })
    ).response;
    const schedule = (
      await postChat({
        action: "message",
        message: "这个班什么时候？",
        state: selected.state,
        testMode: false,
      })
    ).response;
    expect(schedule.status).toBe("fact_answer");
    expect(schedule.state.domain).toBe("student");
    expect(schedule.state.selectedEntityId).toBe("camp-p1-bj");
    expect(schedule.state.pendingQuestionKeys).not.toContain("identity");
    expect(schedule.sources.every(({ document }) => document === "A")).toBe(true);

    const requiredItems = (
      await postChat({
        action: "message",
        message: "需要带什么？",
        state: schedule.state,
        testMode: false,
      })
    ).response;
    expect(requiredItems.status).toBe("fact_answer");
    expect(requiredItems.state.selectedEntityId).toBe("camp-p1-bj");
    expect(requiredItems.sources.every(({ document }) => document === "A")).toBe(true);
    expect(
      requiredItems.sources.flatMap(({ factIds }) => factIds),
    ).toEqual(expect.arrayContaining(["camp-p1-bj.requiredItems"]));
  });

  it("keeps a student fact question in the current domain when teacher is only quoted", async () => {
    const recommended = (
      await postChat({
        action: "message",
        message: "家长，北京，可参加第一期，希望线下",
        state: createInitialConversationState(),
        testMode: false,
      })
    ).response;
    const selected = (
      await postChat({
        action: "select_entity",
        entityId: "camp-p1-bj",
        state: recommended.state,
        testMode: false,
      })
    ).response;

    const { response } = await postChat({
      action: "message",
      message: "老师说这个班多少钱？",
      state: selected.state,
      testMode: false,
    });

    expect(response.status).toBe("fact_answer");
    expect(response.state.domain).toBe("student");
    expect(response.state.selectedEntityId).toBe("camp-p1-bj");
    expect(response.sources.every(({ document }) => document === "A")).toBe(true);
  });

  it("does not treat 老师 as a cross-domain switch when it is only a form of address", async () => {
    const recommended = (
      await postChat({
        action: "message",
        message: "家长，北京，可参加第一期，希望线下",
        state: createInitialConversationState(),
        testMode: false,
      })
    ).response;
    const selected = (
      await postChat({
        action: "select_entity",
        entityId: "camp-p1-bj",
        state: recommended.state,
        testMode: false,
      })
    ).response;

    const { response } = await postChat({
      action: "message",
      message: "老师，这个班有回放吗？",
      state: selected.state,
      testMode: false,
    });

    expect(response.status).toBe("fact_answer");
    expect(response.state.domain).toBe("student");
    expect(response.state.selectedEntityId).toBe("camp-p1-bj");
    expect(response.sources.every(({ document }) => document === "A")).toBe(true);
  });

  it("M03 preserves one teacher product across location, price and registration questions", async () => {
    const recommended = (
      await postChat({
        action: "message",
        message: "零基础教师，周末有空，工作日不能脱岗",
        state: createInitialConversationState(),
        testMode: false,
      })
    ).response;
    let state = recommended.state;
    for (const question of ["在哪里上课？", "多少钱？", "怎么报名？"]) {
      const turn = (
        await postChat({
          action: "message",
          message: question,
          state,
          testMode: false,
        })
      ).response;
      expect(turn.status).toBe("fact_answer");
      expect(turn.state.selectedEntityId).toBe("teacher-l1-weekend");
      expect(turn.sources.every(({ document }) => document === "B")).toBe(true);
      expect(JSON.stringify(turn)).not.toContain("50000");
      expect(JSON.stringify(turn)).not.toContain("refundRules");
      state = turn.state;
    }
  });

  it("switches student to teacher atomically and emits a structured notice", async () => {
    const student = (
      await postChat({
        action: "message",
        message: "家长，北京，可参加第一期，希望线下",
        state: createInitialConversationState(),
        testMode: false,
      })
    ).response;
    const teacher = (
      await postChat({
        action: "message",
        message: "我是零基础教师，工作日不能连续脱岗",
        state: student.state,
        testMode: false,
      })
    ).response;
    expect(teacher.state.domain).toBe("teacher");
    expect(teacher.state.studentConstraints).toEqual({});
    expect(teacher.entityIds).toEqual(["teacher-l1-weekend"]);
    expect(teacher.notices).toEqual([
      expect.objectContaining({
        code: "identity_switched",
        fromDomain: "student",
        toDomain: "teacher",
        message: "已切换为教师咨询。",
      }),
    ]);
  });

  it("prioritizes school procurement over the word teacher and clears teacher state", async () => {
    const teacher = (
      await postChat({
        action: "message",
        message: "零基础教师，周末有空，工作日不能脱岗",
        state: createInitialConversationState(),
        testMode: false,
      })
    ).response;
    const platform = (
      await postChat({
        action: "message",
        message: "学校计划采购20人的教师培训",
        state: teacher.state,
        testMode: false,
      })
    ).response;
    expect(platform.status).toBe("institution_info");
    expect(platform.state.domain).toBe("platform");
    expect(platform.state.institutionNeed).toBe("school_procurement");
    expect(platform.state.teacherConstraints).toEqual({});
    expect(platform.presentation.institutionService).toMatchObject({
      entityId: "platform-school-procurement",
      pricingRule: "20人起，项目总价5万元起",
    });
    expect(JSON.stringify(platform)).not.toContain("2980");
  });

  it("switches platform to student and enters the Guangzhou boundary flow", async () => {
    const platform = (
      await postChat({
        action: "message",
        message: "学校计划采购20人的教师培训",
        state: createInitialConversationState(),
        testMode: false,
      })
    ).response;
    const student = (
      await postChat({
        action: "message",
        message: "我是广州家长，第一期只想线下",
        state: platform.state,
        testMode: false,
      })
    ).response;
    expect(student.status).toBe("boundary_follow_up");
    expect(student.boundaryCode).toBe(
      "student_guangzhou_offline_not_provided",
    );
    expect(student.state.domain).toBe("student");
    expect(student.state.institutionNeed).toBeUndefined();
    expect(student.state.studentConstraints).toMatchObject({
      region: "guangzhou",
      availablePeriods: [1],
      modePreference: "offline",
    });
    expect(student.state.pendingQuestionKeys).toEqual(["canTravel"]);
    expect(student.notices[0]).toMatchObject({
      fromDomain: "platform",
      toDomain: "student",
    });
  });

  it("maps the Guangzhou no-travel answer before unrelated fallback and asserts final values", async () => {
    const first = (
      await postChat({
        action: "message",
        message: "我是广州家长，第一期只想线下",
        state: createInitialConversationState(),
        testMode: false,
      })
    ).response;
    const second = (
      await postChat({
        action: "message",
        message: "均不便出行",
        state: first.state,
        testMode: false,
      })
    ).response;
    const card = second.presentation.recommendations[0];
    expect(second.status).toBe("recommended");
    expect(second.state.studentConstraints).toMatchObject({
      region: "guangzhou",
      availablePeriods: [1],
      modePreference: "offline",
      canTravel: false,
    });
    expect(card).toMatchObject({
      entityId: "camp-p1-online",
      standardPrice: 3980,
      actualPrice: 3980,
    });
    expect(card.discountLabel).toBe("本次按标准价计算");
    expect(JSON.stringify(second)).not.toContain("3280");
    expect(
      card.reasons.map(({ constraintKey }) => constraintKey),
    ).toEqual([
      "availablePeriods",
      "region",
      "canTravel",
      "modePreference",
    ]);
    expect(
      second.sources.flatMap(({ factIds }) => factIds),
    ).toContain("camp-p1-online.replayDays");
  });

  it("does not let generic weekend wording overwrite the confirmed first period", async () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.studentConstraints = {
      region: "guangzhou",
      availablePeriods: [1],
      modePreference: "offline",
    };
    state.pendingQuestionKeys = ["canTravel"];

    const { response } = await postChat({
      action: "message",
      message: "确认是在广州，具体周末可以上课，我只想线下",
      state,
      testMode: false,
    });

    expect(response.state.studentConstraints.availablePeriods).toEqual([1]);
    expect(response.status).toBe("boundary_follow_up");
    expect(response.state.pendingQuestionKeys).toEqual(["canTravel"]);
  });

  it("does not guess an identity for an ambiguous request", async () => {
    const { response } = await postChat({
      action: "message",
      message: "我想学AI",
      state: createInitialConversationState(),
      testMode: false,
    });
    expect(response.status).toBe("needs_identity");
    expect(response.state.domain).toBe("unknown");
    expect(response.state.pendingQuestionKeys).toEqual(["identity"]);
  });

  it("keeps student follow-up keys inside defined rule dimensions", async () => {
    const selected = await selectDomain("student");
    const { response } = await postChat({
      action: "message",
      message: "学生",
      state: selected.state,
      testMode: false,
    });
    expect(response.state.pendingQuestionKeys).toEqual(
      expect.arrayContaining(["region", "availablePeriods", "modePreference"]),
    );
    expect(response.state.pendingQuestionKeys).not.toEqual(
      expect.arrayContaining(["learningGoal", "certification", "weeknight"]),
    );
  });

  it("silently retries one ungrounded composer result", async () => {
    providerControl.composerMode = "first_ungrounded_then_ok";
    const { httpStatus, response } = await postChat({
      action: "message",
      message: "学校计划采购20人的教师培训",
      state: createInitialConversationState(),
      testMode: false,
    });
    expect(httpStatus).toBe(200);
    expect(response.error).toBeUndefined();
    expect(providerControl.composerCalls).toBe(2);
  });

  it("returns one sanitized error after two grounding failures", async () => {
    providerControl.composerMode = "always_ungrounded";
    const { httpStatus, response } = await postChat({
      action: "message",
      message: "学校计划采购20人的教师培训",
      state: createInitialConversationState(),
      testMode: false,
    });
    expect(httpStatus).toBe(503);
    expect(providerControl.composerCalls).toBe(2);
    expect(response).toMatchObject({
      status: "error",
      error: { code: "grounding_rejected", retryable: true },
    });
    expect(response.message).not.toMatch(/provider|stack|prompt|key/iu);
  });

  it("normalizes 五万元 and passes on the first composer attempt", async () => {
    providerControl.composerMode = "valid_chinese_amount";
    const { response } = await postChat({
      action: "message",
      message: "学校计划采购20人的教师培训",
      state: createInitialConversationState(),
      testMode: false,
    });
    expect(response.error).toBeUndefined();
    expect(response.message).toContain("五万元");
    expect(providerControl.composerCalls).toBe(1);
  });

  it("accepts 20人起 and 5万元 on the first composer attempt", async () => {
    const { response } = await postChat({
      action: "message",
      message: "学校计划采购20人的教师培训",
      state: createInitialConversationState(),
      testMode: false,
    });
    expect(response.error).toBeUndefined();
    expect(response.message).toContain("20人起");
    expect(response.message).toContain("5万元");
    expect(providerControl.composerCalls).toBe(1);
  });

  it("silently retries an attempted human-advisor impersonation", async () => {
    providerControl.composerMode = "first_impersonation_then_ok";
    const { response } = await postChat({
      action: "message",
      message: "学校计划采购20人的教师培训",
      state: createInitialConversationState(),
      testMode: false,
    });
    expect(response.error).toBeUndefined();
    expect(response.message).not.toContain("我是模拟人工顾问");
    expect(providerControl.composerCalls).toBe(2);
  });

  it("silently retries composer prose that changes the planned period", async () => {
    providerControl.composerMode = "first_wrong_period_then_ok";
    const { response } = await postChat({
      action: "message",
      message: "家长，北京，可参加第一期，希望线下",
      state: createInitialConversationState(),
      testMode: false,
    });
    expect(response.error).toBeUndefined();
    expect(response.entityIds).toEqual(["camp-p1-bj"]);
    expect(response.message).not.toContain("第二期");
    expect(providerControl.composerCalls).toBe(2);
  });

  it("consumes an injected API failure once and succeeds with the returned state", async () => {
    const selected = await selectDomain("student");
    const armed = (
      await postChat({
        action: "inject_next_failure",
        state: selected.state,
        testMode: true,
      })
    ).response;
    const failed = await postChat({
      action: "message",
      message: "学生",
      state: armed.state,
      testMode: true,
    });
    expect(failed.httpStatus).toBe(503);
    expect(failed.response.error?.code).toBe("simulated_model_failure");
    expect(failed.response.state.test.failNextModelCall).toBe(false);

    const retried = await postChat({
      action: "message",
      message: "学生",
      state: failed.response.state,
      testMode: false,
    });
    expect(retried.httpStatus).toBe(200);
    expect(retried.response.error).toBeUndefined();
  });
});
