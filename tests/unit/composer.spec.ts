import { describe, expect, it } from "vitest";
import type { ComposerPlan, GroundedFact } from "@/lib/domain/conversation";
import { createComposer, resolveComposerRoute } from "@/lib/llm/composer";
import {
  assertComposerDidNotImpersonateHuman,
  assertComposerMentionedOnlyPlannedPeriods,
  assertComposerDidNotWriteSources,
  assertDecisionTraceConstraints,
  assertFollowUpUsesClosedDimensions,
  assertHighRiskValuesGrounded,
  validateUsedFactIds,
} from "@/lib/validation/grounding";
import { extractMoneyAmounts } from "@/lib/validation/money";
import { formatSourceFootnotes } from "@/lib/citations";
import { completion, ScriptedLlmClient } from "./helpers/scriptedLlm";

function emptyPlan(overrides: Partial<ComposerPlan> = {}): ComposerPlan {
  return {
    status: "needs_more_information",
    route: "ask_follow_up",
    domain: "student",
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
    ).toThrow("ungrounded amount or date");
    expect(() =>
      assertHighRiskValuesGrounded({
        message: "报价999—1500元/人。",
        facts: [{ id: "x", label: "范围", value: "500—1500元/人" }],
        calculations: [],
      }),
    ).toThrow();
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
    ).toThrow("ungrounded amount or date");
  });

  it("extracts only values in explicit money contexts", () => {
    expect(extractMoneyAmounts("20人起，第5天，30天回放，1—2个班型")).toEqual([]);
    expect(extractMoneyAmounts("五万元、3万元、1万—3万元、500—1500元/人"))
      .toEqual(expect.arrayContaining([50000, 30000, 10000, 500, 1500]));
  });
});
