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
    expect(applied.state.studentConstraints).toEqual({
      region: "beijing",
      regionDisplayName: "北京",
    });
    expect(
      transitionConversationDomain(applied.state, "student").studentConstraints,
    ).toEqual({ region: "beijing", regionDisplayName: "北京" });
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
      regionDisplayName: "北京",
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

  it("lets an explicit period override conflicting classifier output and old state", () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.studentConstraints = {
      region: "beijing",
      availablePeriods: [2],
      modePreference: "offline",
    };
    const routing = resolveDeterministicTurnRouting({
      message: "改成第1期",
      state,
    });
    const candidate = parseClassifierCandidate(JSON.stringify({
      intent: "recommendation",
      studentConstraints: { availablePeriods: [2] },
      teacherConstraints: {},
      studentReference: {},
      teacherReference: {},
      factTopics: [],
      evidence: {
        intent: "改成",
        "student.availablePeriods": "第1期",
      },
    }));

    const applied = applyClassifierCandidate({
      message: "改成第1期",
      state,
      candidate,
      authoritativeStudentConstraints: routing.studentConstraints,
    });

    expect(routing.studentConstraints.availablePeriods).toEqual([1]);
    expect(applied.state.studentConstraints.availablePeriods).toEqual([1]);
    expect(applied.corrections).toEqual([
      {
        reasonCode: "explicit_constraint_overrode_classifier",
        field: "student.availablePeriods",
        candidateValue: [2],
        confirmedValue: [1],
      },
    ]);
  });

  it("collects all closed constraints from a same-turn explicit student identity", () => {
    const routing = resolveDeterministicTurnRouting({
      message: "我是广州家长，第一期只想线下",
      state: createInitialConversationState(),
    });

    expect(routing.domain).toBe("student");
    expect(routing.studentConstraints).toEqual({
      region: "guangzhou",
      regionDisplayName: "广州",
      availablePeriods: [1],
      modePreference: "offline",
    });
  });

  it("collects teacher identity, foundation, leave constraint, flexible dates and original city in one turn", () => {
    const routing = resolveDeterministicTurnRouting({
      message:
        "我是教师，零基础，工作日不能脱岗，人在深圳，日期没有要求，想学习AI课程",
      state: createInitialConversationState(),
    });

    expect(routing.domain).toBe("teacher");
    expect(routing.teacherConstraints).toMatchObject({
      startingLevel: "beginner",
      canTakeContinuousLeave: false,
      city: "深圳",
    });
    expect(routing.teacherConstraints.availableProductIds).toHaveLength(6);
  });

  it("fills all supported teacher pending answers from one natural response", () => {
    const state = createInitialConversationState();
    state.domain = "teacher";
    state.pendingQuestionKeys = [
      "canTakeContinuousLeave",
      "availableDates",
      "city",
    ];

    const routing = resolveDeterministicTurnRouting({
      message: "可以连续参加，日期没有要求，在深圳",
      state,
    });

    expect(routing.intent).toBe("new_consultation");
    expect(routing.teacherConstraints).toMatchObject({
      canTakeContinuousLeave: true,
      city: "深圳",
    });
    expect(routing.teacherConstraints.availableProductIds).toHaveLength(6);
  });

  it("recognizes flexible dates, weekend-only availability and Chengdu without replacing the city", () => {
    const state = createInitialConversationState();
    state.domain = "teacher";

    const routing = resolveDeterministicTurnRouting({
      message: "日期都行，只能周末，我在成都",
      state,
    });

    expect(routing.teacherConstraints).toMatchObject({
      canTakeContinuousLeave: false,
      city: "成都",
    });
    expect(routing.teacherConstraints.availableProductIds).toHaveLength(6);
  });

  it.each([
    ["没学过", "beginner", undefined],
    ["刚入门", "beginner", undefined],
    ["学过一点", "beginner", undefined],
    ["完成过L1", "L1", "met"],
    ["已经完成L2", "L2", "met"],
  ])(
    "maps teacher foundation phrase %s to the existing level fields",
    (phrase, startingLevel, prerequisiteStatus) => {
      const state = createInitialConversationState();
      state.domain = "teacher";
      const routing = resolveDeterministicTurnRouting({
        message: phrase,
        state,
      });

      expect(routing.teacherConstraints.startingLevel).toBe(startingLevel);
      expect(routing.teacherConstraints.prerequisiteStatus).toBe(
        prerequisiteStatus,
      );
    },
  );

  it.each(["查看全部班型", "查看所有课程", "有哪些班型"])(
    "marks explicit full-catalog wording independently of stored constraints: %s",
    (message) => {
      const state = createInitialConversationState();
      state.domain = "teacher";
      state.teacherConstraints = {
        startingLevel: "L1",
        prerequisiteStatus: "met",
        canTakeContinuousLeave: false,
      };
      const routing = resolveDeterministicTurnRouting({ message, state });

      expect(routing.catalogRequested).toBe(true);
      expect(routing.fullCatalogRequested).toBe(true);
    },
  );

  it.each(["根据我的情况推荐", "我完成L1后适合学什么"])(
    "keeps personalized recommendation wording out of full-catalog routing: %s",
    (message) => {
      const state = createInitialConversationState();
      state.domain = "teacher";
      state.teacherConstraints = {
        startingLevel: "L1",
        prerequisiteStatus: "met",
      };
      const routing = resolveDeterministicTurnRouting({ message, state });

      expect(routing.catalogRequested).toBe(false);
      expect(routing.fullCatalogRequested).toBe(false);
    },
  );

  it("normalizes a Beijing district and explicit mode change over adversarial classifier values", () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.studentConstraints = {
      region: "guangzhou",
      availablePeriods: [1],
      modePreference: "offline",
    };
    const message = "我住朝阳区，改成线上";
    const routing = resolveDeterministicTurnRouting({ message, state });
    const candidate = parseClassifierCandidate(JSON.stringify({
      intent: "recommendation",
      studentConstraints: {
        region: "shanghai",
        modePreference: "offline",
      },
      teacherConstraints: {},
      studentReference: {},
      teacherReference: {},
      factTopics: [],
      evidence: {
        intent: "改成",
        "student.region": "朝阳区",
        "student.modePreference": "改成线上",
      },
    }));
    const applied = applyClassifierCandidate({
      message,
      state,
      candidate,
      authoritativeStudentConstraints: routing.studentConstraints,
    });

    expect(routing.studentConstraints).toMatchObject({
      region: "beijing",
      modePreference: "online",
    });
    expect(applied.state.studentConstraints).toMatchObject({
      region: "beijing",
      availablePeriods: [1],
      modePreference: "online",
    });
    expect(applied.corrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "student.region",
          candidateValue: "shanghai",
          confirmedValue: "beijing",
        }),
        expect.objectContaining({
          field: "student.modePreference",
          candidateValue: "offline",
          confirmedValue: "online",
        }),
      ]),
    );
  });

  it("maps named non-Beijing/Shanghai cities to other and atomically replaces stale Guangzhou", () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.studentConstraints = {
      region: "guangzhou",
      regionDisplayName: "广州",
      availablePeriods: [1],
      modePreference: "offline",
      canTravel: false,
    };

    for (const city of ["天津", "深圳", "成都"]) {
      const routing = resolveDeterministicTurnRouting({
        message: `我在${city}，想报一个学生班`,
        state,
      });
      expect(routing.studentConstraints).toMatchObject({
        region: "other",
        regionDisplayName: city,
      });
    }
  });

  it("rejects a classifier city name that is absent from the current user message", () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.studentConstraints = {
      region: "guangzhou",
      regionDisplayName: "广州",
      availablePeriods: [1],
      modePreference: "offline",
    };
    const message = "我在其他地区，第一期只想线下";
    const routing = resolveDeterministicTurnRouting({ message, state });
    const candidate = parseClassifierCandidate(JSON.stringify({
      intent: "new_consultation",
      studentConstraints: {
        region: "other",
        regionDisplayName: "深圳",
        availablePeriods: [1],
        modePreference: "offline",
      },
      teacherConstraints: {},
      studentReference: {},
      teacherReference: {},
      factTopics: [],
      evidence: {
        intent: "想线下",
        "student.region": "其他地区",
        "student.regionDisplayName": "其他地区",
        "student.availablePeriods": "第一期",
        "student.modePreference": "线下",
      },
    }));

    const applied = applyClassifierCandidate({
      message,
      state,
      candidate,
      authoritativeStudentConstraints: routing.studentConstraints,
    });

    expect(applied.state.studentConstraints).toMatchObject({
      region: "other",
      availablePeriods: [1],
      modePreference: "offline",
    });
    expect(applied.state.studentConstraints.regionDisplayName).toBeUndefined();
    expect(JSON.stringify(applied.state)).not.toContain("深圳");
    expect(JSON.stringify(applied.state)).not.toContain("广州");
  });

  it("sanitizes inconsistent other-region display names from client state", () => {
    const state = sanitizeConversationState({
      domain: "student",
      studentConstraints: {
        region: "other",
        regionDisplayName: "广州",
      },
    });

    expect(state.studentConstraints).toEqual({ region: "other" });
  });
});
