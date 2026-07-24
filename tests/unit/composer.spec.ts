import { describe, expect, it } from "vitest";
import type { ComposerPlan, GroundedFact } from "@/lib/domain/conversation";
import { createComposer, resolveComposerRoute } from "@/lib/llm/composer";
import {
  assertComposerDidNotMakeExternalCommitment,
  assertComposerDidNotImpersonateHuman,
  assertComposerMentionedOnlyPlannedPeriods,
  assertComposerDidNotWriteSources,
  assertDecisionTraceConstraints,
  assertFollowUpUsesClosedDimensions,
  assertHighRiskValuesGrounded,
  assertPlanMatchesConfirmedState,
  inferFactIdsForMentionedHighRiskValues,
  GroundingError,
  validateUsedFactIds,
} from "@/lib/validation/grounding";
import { extractMoneyAmounts } from "@/lib/validation/money";
import { formatSourceFootnotes } from "@/lib/citations";
import { completion, ScriptedLlmClient } from "./helpers/scriptedLlm";
import { createInitialConversationState } from "@/lib/conversation/session";

function emptyPlan(overrides: Partial<ComposerPlan> = {}): ComposerPlan {
  return {
    status: "needs_more_information",
    route: "ask_follow_up",
    domain: "student",
    confirmedConstraints: {},
    facts: [],
    calculations: [],
    decisionTrace: [],
    nextQuestionKeys: [],
    nextQuestionOptions: [],
    actions: [],
    entityIds: [],
    ...overrides,
  };
}

describe("composer routing and contracts", () => {
  it("routes nextQuestionKeys before a terminal-looking status", () => {
    expect(
      resolveComposerRoute({
        status: "boundary_follow_up",
        nextQuestionKeys: ["canTravel"],
      }),
    ).toBe("ask_follow_up");
  });

  it("uses temperature 0.6 and permits different wording for the same facts", async () => {
    const firstClient = new ScriptedLlmClient([
      completion('{"message":"费用信息已核对。","usedFactIds":["camp-p1-bj.standardPrice"],"actions":[]}'),
    ]);
    const secondClient = new ScriptedLlmClient([
      completion('{"message":"我已为你确认课程费用。","usedFactIds":["camp-p1-bj.standardPrice"],"actions":[]}'),
    ]);
    const facts: GroundedFact[] = [
      { id: "camp-p1-bj.standardPrice", label: "标准价格", value: 6980 },
    ];
    const plan = emptyPlan({ status: "fact_answer", route: "fact_answer", facts });
    const first = await createComposer(firstClient).composeOnce(plan, []);
    const second = await createComposer(secondClient).composeOnce(plan, []);

    expect(firstClient.calls[0]).toMatchObject({
      temperature: 0.6,
      responseFormat: "json_object",
    });
    expect(firstClient.calls[0].messages[0].content).toContain(
      "不得自称或暗示自己是人工顾问、模拟人工顾问或人工客服",
    );
    expect(firstClient.calls[0].messages[0].content).toContain(
      "region只确认北京、上海、广州或其他城市，不得追问区县",
    );
    expect(firstClient.calls[0].messages[0].content).toContain(
      "不得把录播回放列为授课形式",
    );
    expect(first.message).not.toBe(second.message);
    expect(first.usedFactIds).toEqual(second.usedFactIds);
    expect(formatSourceFootnotes(first.usedFactIds)).toBe(
      formatSourceFootnotes(second.usedFactIds),
    );
  });

  it("omits history for recommendations and limits other routes to two recent turns", async () => {
    const recommendationClient = new ScriptedLlmClient([
      completion(
        '{"message":"推荐结果已核对。","usedFactIds":[],"actions":[],"recommendationReasons":[]}',
      ),
    ]);
    const factClient = new ScriptedLlmClient([
      completion(
        '{"message":"课程信息已核对。","usedFactIds":[],"actions":[],"recommendationReasons":[]}',
      ),
    ]);
    const history = [
      { role: "user" as const, content: "较早的学生问题" },
      { role: "assistant" as const, content: "较早的学生回答" },
      { role: "user" as const, content: "最近的教师问题" },
      { role: "assistant" as const, content: "最近的教师回答" },
    ];

    await createComposer(recommendationClient).composeOnce(
      emptyPlan({
        status: "recommended",
        route: "recommendation",
        domain: "teacher",
      }),
      history,
    );
    await createComposer(factClient).composeOnce(
      emptyPlan({
        status: "fact_answer",
        route: "fact_answer",
        domain: "teacher",
      }),
      history,
    );

    const recommendationPayload = JSON.parse(
      recommendationClient.calls[0].messages[1].content,
    ) as { shortContext: unknown[] };
    const factPayload = JSON.parse(
      factClient.calls[0].messages[1].content,
    ) as { shortContext: unknown[] };
    expect(recommendationPayload.shortContext).toEqual([]);
    expect(factPayload.shortContext).toEqual(history.slice(-2));
  });

  it("answers school procurement from deterministic facts without calling the model", async () => {
    const client = new ScriptedLlmClient([]);
    const plan = emptyPlan({
      status: "institution_info",
      route: "institution",
      domain: "platform",
      confirmedConstraints: { institutionNeed: "school_procurement" },
      facts: [
        {
          id: "platform-school-procurement.category",
          label: "服务类型",
          value: "学校教师培训采购",
        },
        {
          id: "platform-school-procurement.audience",
          label: "适用对象",
          value: "学校或教育局统一采购",
        },
        {
          id: "platform-school-procurement.boundary",
          label: "边界",
          value: "个人教师报名价格不适用于学校统一采购",
        },
        {
          id: "platform-school-procurement.pricingRule",
          label: "计价规则",
          value: "20人起，项目总价5万元起",
        },
        {
          id: "platform-school-procurement.minimumPeople",
          label: "最低人数",
          value: 20,
        },
        {
          id: "platform-school-procurement.minimumTotalPrice",
          label: "最低项目总价",
          value: 50_000,
        },
      ],
      actions: ["查看模拟咨询流程", "整理采购需求清单", "返回菜单"],
      entityIds: ["platform-school-procurement"],
    });

    const output = await createComposer(client).composeOnce(plan, []);

    expect(client.calls).toHaveLength(0);
    expect(output.message).toContain("20人起");
    expect(output.message).toContain("5万元起");
    expect(output.message).not.toContain("2980");
    expect(output.usedFactIds).toEqual(plan.facts.map(({ id }) => id));
    expect(output.actions).toEqual(plan.actions);
  });
});

describe("programmatic grounding gates", () => {
  it.each([
    ["student", ["region"], ["region", "district"]],
    ["teacher", ["startingLevel"], ["startingLevel", "goal"]],
  ])("rejects uncollected %s constraints before composition", (_domain, collected, traceKeys) => {
    expect(() =>
      assertDecisionTraceConstraints(
        [{ code: "test", constraintKeys: traceKeys, factIds: [] }],
        collected,
      ),
    ).toThrow("uncollected constraints");
  });

  it("accepts only facts provided to this response and appends sources in code", () => {
    const facts: GroundedFact[] = [
      { id: "camp-p1-bj.standardPrice", label: "标准价格", value: 6980 },
    ];
    expect(validateUsedFactIds([facts[0].id, facts[0].id], facts)).toEqual([
      facts[0].id,
    ]);
    expect(() =>
      validateUsedFactIds(["camp-p2-bj.standardPrice"], facts),
    ).toThrow("outside this response");
    expect(formatSourceFootnotes([facts[0].id])).toContain(
      "素材A《2026暑期AI素养夏令营课程手册》第五章",
    );
  });

  it("validates money and dates while allowing ordinary numbers", () => {
    const facts: GroundedFact[] = [
      { id: "camp-p1-bj.startDate", label: "日期", value: "2026-08-01" },
      { id: "camp-p1-bj.standardPrice", label: "标准价格", value: 6980 },
    ];
    expect(() =>
      assertHighRiskValuesGrounded({
        message: "第5天可以比较1—2个方案，8月1日开营，标准价6,980元。",
        facts,
        calculations: [],
      }),
    ).not.toThrow();
    expect(() =>
      assertHighRiskValuesGrounded({
        message: "费用6880元，日期8月99日。",
        facts,
        calculations: [],
      }),
    ).toThrow("ungrounded amount");
    expect(() =>
      assertHighRiskValuesGrounded({
        message: "报价999—1500元/人。",
        facts: [{ id: "x", label: "范围", value: "500—1500元/人" }],
        calculations: [],
      }),
    ).toThrow();
  });

  it("infers only plan facts that exactly ground mentioned dates and amounts", () => {
    const facts: GroundedFact[] = [
      {
        id: "teacher-l1-weekend.schedule",
        label: "课程安排",
        value: ["8月2日线上课程", "8月9日线下工作坊"],
      },
      {
        id: "teacher-l1-weekend.standardPrice",
        label: "标准价格",
        value: 2980,
      },
    ];

    expect(
      inferFactIdsForMentionedHighRiskValues(
        "8月2日开始，标准价格2980元。",
        facts,
      ),
    ).toEqual([
      "teacher-l1-weekend.schedule",
      "teacher-l1-weekend.standardPrice",
    ]);
    expect(
      inferFactIdsForMentionedHighRiskValues(
        "8月3日开始，标准价格2990元。",
        facts,
      ),
    ).toEqual([]);
  });

  it("rejects source metadata written by the model but allows 第5天", () => {
    expect(() => assertComposerDidNotWriteSources("第5天学习智能体。")).not.toThrow();
    expect(() => assertComposerDidNotWriteSources("来源：素材A第五章")).toThrow();
    expect(() => assertComposerDidNotWriteSources("详见资料B第5章")).toThrow();
  });

  it.each([
    "我是人工顾问，可以继续为您服务。",
    "我是模拟人工顾问，请问您还有什么需要？",
    "本人将作为一名您的模拟人工客服处理问题。",
    "您好，这里是模拟人工顾问。",
    "作为模拟人工顾问，我来为您服务。",
    "您好，我现在是人工客服。",
    "现在由人工顾问接待您。",
  ])("rejects human-advisor impersonation: %s", (message) => {
    expect(() => assertComposerDidNotImpersonateHuman(message)).toThrow(
      "impersonate a human advisor",
    );
    expect(() => assertComposerDidNotWriteSources(message)).toThrow(
      "impersonate a human advisor",
    );
  });

  it.each([
    "该价格需人工确认。",
    "如需进一步核对，请联系人工顾问。",
    "如需人工确认，建议由人工顾问接待您。",
    "我是AI课程顾问，可以帮您整理需求。",
  ])("allows neutral human-handoff wording: %s", (message) => {
    expect(() => assertComposerDidNotImpersonateHuman(message)).not.toThrow();
    expect(() => assertComposerDidNotWriteSources(message)).not.toThrow();
  });

  it.each([
    ["请问您具体是北京哪个区？", ["region"]],
    ["请问周末是否方便上课？", ["availablePeriods"]],
    ["您偏好线上、线下还是录播？", ["modePreference"]],
    ["请补充您的考级认证目标？", ["region", "availablePeriods"]],
  ])("rejects invented follow-up dimensions: %s", (message, keys) => {
    expect(() => assertFollowUpUsesClosedDimensions(message, keys)).toThrow();
  });

  it("allows closed student follow-up dimensions", () => {
    expect(() =>
      assertFollowUpUsesClosedDimensions(
        "请确认所在城市、可参加的第一至第三期，以及线上、线下或均可？",
        ["region", "availablePeriods", "modePreference"],
      ),
    ).not.toThrow();
  });

  it("rejects a period label outside the planned student entities", () => {
    expect(() =>
      assertComposerMentionedOnlyPlannedPeriods(
        "为您推荐第二期线上直播班。",
        ["camp-p1-online"],
      ),
    ).toThrow("changed the recommended period");
    expect(() =>
      assertComposerMentionedOnlyPlannedPeriods(
        "为您推荐第一期线上直播班。",
        ["camp-p1-online"],
      ),
    ).not.toThrow();
  });

  it("does not mistake the group condition '同一期' for first period", () => {
    expect(() =>
      assertComposerMentionedOnlyPlannedPeriods(
        "第三期3人同一期同班型团报，采用早鸟优惠。",
        ["camp-p3-bj"],
      ),
    ).not.toThrow();
  });

  it.each([
    [
      "学校采购需满足20人起，项目总价5万元起",
      "20人起，项目总价5万元起",
    ],
    [
      "企业培训50人起，500—1500元/人",
      "50人起，500—1500元/人",
    ],
    [
      "基础Agent交付1万—3万元/项目",
      "1万—3万元/项目",
    ],
    [
      "学校采购需满足20人起，项目总价五万元起",
      "20人起，项目总价5万元起",
    ],
    ["线上直播含30天回放", "线上直播含30天回放"],
    ["第5天搭建智能体", "第5天搭建智能体"],
  ])("grounds controlled Chinese amount syntax: %s", (message, factValue) => {
    expect(() =>
      assertHighRiskValuesGrounded({
        message,
        facts: [{ id: "test.pricingRule", label: "计价规则", value: factValue }],
        calculations: [],
      }),
    ).not.toThrow();
  });

  it("rejects an unauthorized Chinese-unit amount", () => {
    expect(() =>
      assertHighRiskValuesGrounded({
        message: "学校采购2万元起",
        facts: [
          {
            id: "platform-school-procurement.pricingRule",
            label: "计价规则",
            value: "20人起，项目总价5万元起",
          },
        ],
        calculations: [],
      }),
    ).toThrow("ungrounded amount");
  });

  it("attaches a machine-readable reason code to grounding failures", () => {
    try {
      assertHighRiskValuesGrounded({
        message: "学校采购2万元起",
        facts: [
          {
            id: "platform-school-procurement.pricingRule",
            label: "计价规则",
            value: "20人起，项目总价5万元起",
          },
        ],
        calculations: [],
      });
      throw new Error("Expected grounding rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(GroundingError);
      expect((error as GroundingError).reasonCode).toBe("ungrounded_amount");
    }
  });

  it.each([
    "已为您安排人工顾问稍后联系。",
    "顾问稍后会通过微信联系您。",
    "已提交采购需求。",
    "已为您锁定名额。",
    "已经为您报名。",
    "稍后会有人工顾问联系您。",
    "本演示不提供真实报名，但已为您安排人工顾问稍后联系。",
  ])("rejects unsupported external commitments: %s", (message) => {
    expect(() => assertComposerDidNotMakeExternalCommitment(message)).toThrow(
      "unsupported real-world commitment",
    );
  });

  it("allows explicit simulation boundaries without promising contact", () => {
    expect(() =>
      assertComposerDidNotMakeExternalCommitment(
        "可整理采购需求清单；本演示不提供真实报名、下单或人工联系。",
      ),
    ).not.toThrow();
  });

  it.each([
    "请问周末是否方便上课？",
    "您偏好线上、线下还是录播回放？",
    "请问孩子在哪所学校？",
    "请补充考级认证目标？",
    "您需要回放吗？",
    "请问您在北京哪个区域？",
    "请问您平时晚上有时间吗？",
  ])("rejects invented questions even when no question key is planned: %s", (message) => {
    expect(() => assertFollowUpUsesClosedDimensions(message, [])).toThrow();
  });

  it("does not treat a replay fact statement as an invented follow-up", () => {
    expect(() =>
      assertFollowUpUsesClosedDimensions("该线上直播班提供30天回放。", []),
    ).not.toThrow();
  });

  it("rejects a student plan whose entity and trace escape the confirmed period", () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.studentConstraints = {
      region: "beijing",
      availablePeriods: [1],
      modePreference: "offline",
    };
    const plan = emptyPlan({
      status: "recommended",
      route: "recommendation",
      confirmedConstraints: {
        region: "beijing",
        availablePeriods: [1],
        modePreference: "offline",
      },
      entityIds: ["camp-p2-bj"],
      decisionTrace: [
        {
          code: "period_available",
          constraintKeys: ["availablePeriods"],
          constraintValues: { availablePeriods: [2] },
          factIds: ["camp-p2-bj.startDate"],
        },
      ],
    });

    expect(() => assertPlanMatchesConfirmedState(state, plan)).toThrow(
      /confirmed constraint|escaped confirmed periods/u,
    );
  });

  it("rejects a same-period student entity that differs from deterministic campus output", () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.studentConstraints = {
      region: "beijing",
      availablePeriods: [1],
      modePreference: "offline",
    };
    const plan = emptyPlan({
      status: "recommended",
      route: "recommendation",
      confirmedConstraints: {
        region: "beijing",
        availablePeriods: [1],
        modePreference: "offline",
      },
      entityIds: ["camp-p1-online"],
      decisionTrace: [
        {
          code: "period_available",
          constraintKeys: ["availablePeriods"],
          constraintValues: { availablePeriods: [1] },
          factIds: ["camp-p1-online.startDate"],
        },
      ],
    });

    expect(() => assertPlanMatchesConfirmedState(state, plan)).toThrow(
      "differ from deterministic output",
    );
  });

  it("extracts only values in explicit money contexts", () => {
    expect(extractMoneyAmounts("20人起，第5天，30天回放，1—2个班型")).toEqual([]);
    expect(extractMoneyAmounts("五万元、3万元、1万—3万元、500—1500元/人"))
      .toEqual(expect.arrayContaining([50000, 30000, 10000, 500, 1500]));
  });
});
