import { describe, expect, it } from "vitest";
import type { ComposerPlan, GroundedFact } from "@/lib/domain/conversation";
import { createComposer, resolveComposerRoute } from "@/lib/llm/composer";
import {
  assertComposerDidNotWriteSources,
  assertDecisionTraceConstraints,
  assertHighRiskValuesGrounded,
  validateUsedFactIds,
} from "@/lib/validation/grounding";
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
    expect(first.message).not.toBe(second.message);
    expect(first.usedFactIds).toEqual(second.usedFactIds);
    expect(formatSourceFootnotes(first.usedFactIds)).toBe(
      formatSourceFootnotes(second.usedFactIds),
    );
  });
});

describe("programmatic grounding gates", () => {
  it.each([
    ["student", ["region"], ["region", "learningGoal"]],
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
});
