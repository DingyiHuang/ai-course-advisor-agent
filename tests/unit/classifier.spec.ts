import { describe, expect, it } from "vitest";
import {
  applyClassifierCandidate,
  createClassifier,
  parseClassifierCandidate,
} from "@/lib/llm/classifier";
import {
  createInitialConversationState,
  sanitizeConversationState,
  transitionConversationDomain,
} from "@/lib/conversation/session";
import { resolveDeterministicTurnRouting } from "@/lib/conversation/routing";
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

  it("does not let generic weekend evidence overwrite an explicit period", () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.studentConstraints.availablePeriods = [1];
    const candidate = parseClassifierCandidate(JSON.stringify({
      intent: "recommendation",
      studentConstraints: { availablePeriods: [2] },
      teacherConstraints: {},
      studentReference: {},
      teacherReference: {},
      factTopics: [],
      evidence: {
        intent: "周末可以上课",
        "student.availablePeriods": "周末可以上课",
      },
    }));

    const applied = applyClassifierCandidate({
      message: "周末可以上课",
      state,
      candidate,
    });

    expect(applied.state.studentConstraints.availablePeriods).toEqual([1]);
    expect(applied.acceptedConstraintKeys).not.toContain("availablePeriods");
  });

  it("normalizes a Beijing district as provisional Beijing without inventing district", () => {
    const state = createInitialConversationState();
    const candidate = parseClassifierCandidate(JSON.stringify({
      intent: "recommendation",
      studentConstraints: {
        region: "beijing",
        district: "chaoyang",
      },
      teacherConstraints: {},
      studentReference: {},
      teacherReference: {},
      factTopics: [],
      evidence: {
        intent: "想报名",
        "student.region": "朝阳区",
        "student.district": "朝阳区",
      },
    }));

    const applied = applyClassifierCandidate({
      message: "我住朝阳区，想报名",
      state,
      candidate,
    });

    expect(applied.state.domain).toBe("unknown");
    expect(applied.state.studentConstraints).toEqual({ region: "beijing" });
    expect(
      transitionConversationDomain(applied.state, "student").studentConstraints,
    ).toEqual({ region: "beijing" });
  });

  it("drops free student keys and enum values outside the closed contract", () => {
    const candidate = parseClassifierCandidate(JSON.stringify({
      intent: "recommendation",
      studentConstraints: {
        district: "朝阳区",
        learningGoal: "做一个助手",
        modePreference: "recorded",
      },
      teacherConstraints: {},
      studentReference: {},
      teacherReference: {},
      factTopics: [],
      evidence: {
        "student.district": "朝阳区",
        "student.learningGoal": "做一个助手",
        "student.modePreference": "录播回放",
      },
    }));

    expect(candidate.studentConstraints).not.toHaveProperty("district");
    expect(candidate.studentConstraints).not.toHaveProperty("learningGoal");
    expect(candidate.studentConstraints.modePreference).toBeUndefined();
  });

  it("sanitizes student state and pending questions through runtime whitelists", () => {
    const state = sanitizeConversationState({
      domain: "student",
      studentConstraints: {
        region: "chaoyang",
        district: "朝阳区",
        availablePeriods: [1, 4],
        modePreference: "recorded",
        canTravel: "no",
        needsReplay: true,
        learningGoal: "自由文本",
      },
      pendingQuestionKeys: [
        "district",
        "region",
        "learningGoal",
        "availablePeriods",
        "identity",
      ],
    });

    expect(state.studentConstraints).toEqual({
      availablePeriods: [1],
      needsReplay: true,
    });
    expect(state.pendingQuestionKeys).toEqual(["region", "availablePeriods"]);
  });

  it("collects closed provisional constraints before identity selection", () => {
    const routing = resolveDeterministicTurnRouting({
      message: "我住海淀区，第一期有空，线上线下均可",
      state: createInitialConversationState(),
    });

    expect(routing.domain).toBeUndefined();
    expect(routing.studentConstraints).toEqual({
      region: "beijing",
      availablePeriods: [1],
      modePreference: "any",
    });
  });

  it("does not accept an LLM-inferred student identity from a learning goal", () => {
    const candidate = parseClassifierCandidate(JSON.stringify({
      domainCandidate: "student",
      intent: "recommendation",
      studentConstraints: { learningGoal: "AI" },
      teacherConstraints: {},
      studentReference: {},
      teacherReference: {},
      factTopics: [],
      evidence: {
        domain: "我想学AI",
        intent: "我想学AI",
        "student.learningGoal": "我想学AI",
      },
    }));

    const applied = applyClassifierCandidate({
      message: "我想学AI",
      state: createInitialConversationState(),
      candidate,
    });

    expect(applied.state.domain).toBe("unknown");
    expect(applied.state.studentConstraints).toEqual({});
  });

  it("does not switch to the institution domain from the isolated word 学校", () => {
    const candidate = parseClassifierCandidate(JSON.stringify({
      domainCandidate: "platform",
      intent: "institution_service",
      studentConstraints: {},
      teacherConstraints: {},
      studentReference: {},
      teacherReference: {},
      factTopics: [],
      evidence: {
        domain: "学校",
        intent: "学校",
      },
    }));

    const applied = applyClassifierCandidate({
      message: "学校",
      state: createInitialConversationState(),
      candidate,
    });

    expect(applied.state.domain).toBe("unknown");
  });

  it("does not treat a quoted or vocative role noun as a cross-domain switch", () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.selectedEntityId = "camp-p1-bj";
    state.lastRecommendationIds = ["camp-p1-bj"];
    const candidate = parseClassifierCandidate(JSON.stringify({
      domainCandidate: "teacher",
      intent: "fact_question",
      studentConstraints: {},
      teacherConstraints: {},
      studentReference: {},
      teacherReference: {},
      factTopics: ["replay"],
      evidence: {
        domain: "老师",
        intent: "回放",
        "topic.replay": "回放",
      },
    }));

    const applied = applyClassifierCandidate({
      message: "老师，这个班有回放吗？",
      state,
      candidate,
    });

    expect(applied.state.domain).toBe("student");
    expect(applied.state.selectedEntityId).toBe("camp-p1-bj");
    expect(applied.factTopics).toEqual(["replay"]);
  });
});
