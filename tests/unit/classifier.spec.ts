import { describe, expect, it } from "vitest";
import {
  applyClassifierCandidate,
  createClassifier,
  parseClassifierCandidate,
} from "@/lib/llm/classifier";
import { createInitialConversationState } from "@/lib/conversation/session";
import { completion, ScriptedLlmClient } from "./helpers/scriptedLlm";

describe("classifier candidates are evidence-gated", () => {
  it("retries one invalid JSON response and accepts the next strict object", async () => {
    const client = new ScriptedLlmClient([
      completion("```json\n{}\n```"),
      completion(JSON.stringify({
        domainCandidate: null,
        intent: "unknown",
        studentConstraints: {},
        teacherConstraints: {},
        studentReference: {},
        teacherReference: {},
        institutionNeed: null,
        factTopics: [],
        evidence: {},
      })),
    ]);

    const result = await createClassifier(client).classify(
      "我想了解课程",
      createInitialConversationState(),
    );

    expect(result.intent).toBe("unknown");
    expect(client.calls).toHaveLength(2);
  });

  it("uses temperature 0 and strict JSON, then accepts only evidenced values", async () => {
    const client = new ScriptedLlmClient([
      completion(JSON.stringify({
        domainCandidate: "teacher",
        intent: "recommendation",
        studentConstraints: {},
        teacherConstraints: {
          startingLevel: "beginner",
          canTakeContinuousLeave: false,
          goal: "tools",
        },
        studentReference: {},
        teacherReference: {},
        institutionNeed: null,
        factTopics: [],
        evidence: {
          domain: "教师",
          intent: "想参加",
          "teacher.startingLevel": "零基础",
          "teacher.canTakeContinuousLeave": "不能脱岗",
          "teacher.goal": "零基础",
        },
      })),
    ]);
    const message = "我是零基础教师，工作日不能脱岗，想参加合适的班";
    const candidate = await createClassifier(client).classify(
      message,
      createInitialConversationState(),
    );
    const applied = applyClassifierCandidate({
      message,
      state: createInitialConversationState(),
      candidate,
    });

    expect(client.calls[0]).toMatchObject({
      temperature: 0,
      responseFormat: "json_object",
    });
    expect(applied.state.domain).toBe("teacher");
    expect(applied.state.teacherConstraints).toMatchObject({
      startingLevel: "beginner",
      canTakeContinuousLeave: false,
    });
    expect(applied.state.teacherConstraints.goal).toBeUndefined();
  });

  it("drops valid-looking values whose evidence is absent from the user message", () => {
    const state = createInitialConversationState();
    state.domain = "student";
    const candidate = parseClassifierCandidate(JSON.stringify({
      domainCandidate: "student",
      intent: "recommendation",
      studentConstraints: { region: "beijing", availablePeriods: [3] },
      teacherConstraints: {},
      studentReference: {},
      teacherReference: {},
      factTopics: [],
      evidence: {
        intent: "想报名",
        "student.region": "上海",
        "student.availablePeriods": "第三期",
      },
    }));
    const applied = applyClassifierCandidate({
      message: "我想报名第三期",
      state,
      candidate,
    });

    expect(applied.state.studentConstraints.region).toBeUndefined();
    expect(applied.state.studentConstraints.availablePeriods).toEqual([3]);
  });
});
