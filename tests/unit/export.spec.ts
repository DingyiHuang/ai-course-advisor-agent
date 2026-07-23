import { describe, expect, it } from "vitest";
import { createInitialConversationState } from "@/lib/conversation/session";
import { createConversationMarkdown } from "@/lib/export/markdown";

describe("TASK-05 actual conversation Markdown export", () => {
  it("exports Shanghai time, actual transcript, constraints, recommendation and sources", () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.studentConstraints = {
      region: "beijing",
      availablePeriods: [1],
      modePreference: "offline",
    };
    state.selectedEntityId = "camp-p1-bj";

    const result = createConversationMarkdown({
      sessionId: "TASK05-007",
      state,
      testMode: true,
      actualError: { code: "simulated_model_failure", retryable: true },
      currentEntityName: "2026暑期AI素养夏令营·第1期·北京线下班",
      exportedAt: new Date("2026-07-23T01:02:03Z"),
      messages: [
        {
          id: "u1",
          role: "user",
          content: "我在北京，第一期可参加，偏好线下",
          createdAt: "2026-07-23T01:00:00Z",
          sources: [],
          presentation: { recommendations: [] },
        },
        {
          id: "a1",
          role: "assistant",
          content: "这是本次实际生成的回答。",
          createdAt: "2026-07-23T01:00:01Z",
          sources: [
            { document: "A", chapter: "第三章", factIds: ["camp-p1-bj.startDate"] },
          ],
          presentation: {
            recommendations: [
              {
                entityId: "camp-p1-bj",
                kind: "student",
                name: "2026暑期AI素养夏令营·第1期·北京线下班",
                date: "2026-08-01 至 2026-08-07",
                delivery: "北京线下",
                standardPrice: 6980,
                actualPrice: 6980,
                discountLabel: "本次按标准价计算",
                reasons: [
                  {
                    constraintKey: "region",
                    constraintLabel: "所在地区",
                    constraintValue: "北京",
                    reason: "北京线下地点与所在地区对应。",
                  },
                ],
                sources: [],
                availabilityNote: "资料未提供实时余位。",
              },
            ],
          },
        },
      ],
    });

    expect(result.filename).toBe("AI课程顾问_TASK05-007_20260723-090203.md");
    expect(result.markdown).toContain("导出时间（Asia/Shanghai）：2026-07-23 09:02:03");
    expect(result.markdown).toContain("这是本次实际生成的回答。");
    expect(result.markdown).toContain("region: beijing");
    expect(result.markdown).toContain("标准费用：6980元");
    expect(result.markdown).toContain("素材A《2026暑期AI素养夏令营课程手册》第三章");
    expect(result.markdown).toContain("simulated_model_failure（可重试）");
  });

  it("does not invent recommendations or sources when the conversation has none", () => {
    const result = createConversationMarkdown({
      sessionId: "EMPTY",
      state: createInitialConversationState(),
      testMode: false,
      exportedAt: new Date("2026-07-23T00:00:00Z"),
      messages: [],
    });
    expect(result.markdown).toContain("本次对话尚无推荐结果");
    expect(result.markdown).toContain("本次对话尚未使用课程资料");
    expect(result.markdown).toContain("实际异常状态：无");
  });

  it("keeps the full transcript but deduplicates recommendation summaries to the current domain", () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.selectedEntityId = "camp-p1-bj";
    const studentCard = {
      entityId: "camp-p1-bj",
      kind: "student" as const,
      name: "2026暑期AI素养夏令营·第1期·北京线下班",
      date: "2026-08-01 至 2026-08-07",
      delivery: "北京线下",
      standardPrice: 6980,
      actualPrice: 6980,
      discountLabel: "本次按标准价计算",
      reasons: [],
      sources: [],
      availabilityNote: "资料未提供实时余位。",
    };
    const teacherCard = {
      entityId: "teacher-l1-weekend",
      kind: "teacher" as const,
      name: "初高中教师AI素养培训·L1·周末研修班",
      date: "8月2日",
      delivery: "线上与线下工作坊",
      standardPrice: 2980,
      actualPrice: 2980,
      discountLabel: "本次按标准价计算",
      reasons: [],
      sources: [],
      availabilityNote: "资料未提供实时余位。",
    };
    const messages = [
      {
        id: "student-1",
        clientRequestId: "logical-student-request",
        role: "assistant" as const,
        content: "第一次学生推荐",
        createdAt: "2026-07-23T01:00:00Z",
        sources: [],
        presentation: { recommendations: [studentCard] },
      },
      {
        id: "teacher-1",
        role: "assistant" as const,
        content: "历史教师推荐价格2980元",
        createdAt: "2026-07-23T01:01:00Z",
        sources: [],
        presentation: { recommendations: [teacherCard] },
      },
      {
        id: "student-2",
        clientRequestId: "logical-student-request",
        role: "assistant" as const,
        content: "切回学生后的同一实体",
        createdAt: "2026-07-23T01:02:00Z",
        sources: [],
        presentation: { recommendations: [studentCard] },
      },
    ];

    const result = createConversationMarkdown({
      sessionId: "DOMAIN-SUMMARY",
      state,
      testMode: false,
      exportedAt: new Date("2026-07-23T01:03:00Z"),
      messages,
    });
    const summary = result.markdown.split("## 推荐结果")[1].split(
      "## 实际使用的资料与章节（完整会话历史）",
    )[0];
    const transcript = result.markdown.split("## 实际对话")[1].split(
      "## 推荐结果",
    )[0];

    expect(summary.match(/第1期·北京线下班/gu)).toHaveLength(1);
    expect(summary).not.toContain("教师AI素养培训");
    expect(summary).not.toContain("2980");
    expect(transcript).toContain("历史教师推荐价格2980元");
    expect(transcript).toContain("第一次学生推荐");
    expect(transcript).toContain("切回学生后的同一实体");
    expect(result.markdown).toContain("完整会话历史");
  });
});
