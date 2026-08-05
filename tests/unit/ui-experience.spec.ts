import { describe, expect, it } from "vitest";
import {
  appViewportHeight,
  answerVerificationLabel,
  currentEntityLabel,
  friendlyRequestError,
  isNearLatestScroll,
  nextMobileQuickPanelOpen,
  QUICK_ENTRIES,
  safeTurnEvidence,
  shouldAutoFollowLatest,
  shouldSubmitComposerKey,
  userFacingStatus,
  validateComposerDraft,
} from "@/lib/conversation/uiExperience";
import {
  acquireRequestLease,
  clientChatReducer,
  createClientChatState,
} from "@/lib/conversation/clientChatState";
import type {
  ChatPresentation,
  ChatResponse,
  ConversationState,
} from "@/lib/domain/conversation";
import { CAMPS } from "@/lib/knowledge/camps";
import { TEACHER_PRODUCTS } from "@/lib/knowledge/teachers";

const EMPTY_PRESENTATION: ChatPresentation = { recommendations: [] };

function baseState(): ConversationState {
  return {
    version: 1,
    domain: "student",
    studentConstraints: {},
    teacherConstraints: {},
    lastRecommendationIds: [],
    pendingQuestionKeys: [],
    pendingQuestionOptions: [],
    shortHistory: [],
    test: { failNextModelCall: false },
  };
}

function response(): ChatResponse {
  return {
    status: "fact_answer",
    message: "回答",
    state: baseState(),
    sources: [],
    entityIds: [],
    actions: [],
    presentation: EMPTY_PRESENTATION,
    notices: [],
  };
}

describe("TASK-B04 UI experience helpers", () => {
  it("defines exactly the five required quick entries", () => {
    expect(QUICK_ENTRIES.map(({ label }) => label)).toEqual([
      "学生课程咨询",
      "教师培训咨询",
      "查看所有班型",
      "费用咨询",
      "报名条件咨询",
    ]);
  });

  it("maps student and teacher entries to explicit identity actions", () => {
    expect(QUICK_ENTRIES[0].command).toEqual({
      type: "select_domain",
      domain: "student",
    });
    expect(QUICK_ENTRIES[1].command).toEqual({
      type: "select_domain",
      domain: "teacher",
    });
  });

  it("maps catalog, fee, and registration entries to one explicit request each", () => {
    expect(QUICK_ENTRIES.slice(2).map(({ command }) => command)).toEqual([
      { type: "message", action: "catalog", message: "查看所有班型" },
      { type: "message", message: "我想咨询课程费用。" },
      { type: "message", message: "我想咨询报名条件。" },
    ]);
  });

  it("keeps the complete student and teacher catalog entity counts", () => {
    expect(CAMPS).toHaveLength(9);
    expect(TEACHER_PRODUCTS).toHaveLength(6);
  });

  it("collapses mobile quick questions as soon as a request starts or an option is selected", () => {
    expect(nextMobileQuickPanelOpen(true, "request_started")).toBe(false);
    expect(nextMobileQuickPanelOpen(true, "quick_entry_selected")).toBe(false);
    expect(nextMobileQuickPanelOpen(true, "keyboard_closed")).toBe(false);
  });

  it("tracks a keyboard-compressed visual viewport without adding a second height", () => {
    expect(appViewportHeight(500, 844)).toBe("500px");
    expect(appViewportHeight(undefined, 844)).toBe("844px");
  });

  it("restores the exact available height after the software keyboard closes", () => {
    expect(appViewportHeight(360.4, 844)).toBe("360px");
    expect(appViewportHeight(843.6, 844)).toBe("844px");
  });

  it("toggles the mobile quick panel without changing the default collapsed state", () => {
    expect(nextMobileQuickPanelOpen(false, "toggle")).toBe(true);
    expect(nextMobileQuickPanelOpen(true, "toggle")).toBe(false);
  });

  it("does not auto-follow a new AI message after the user scrolls away from latest", () => {
    expect(
      isNearLatestScroll({
        scrollHeight: 1200,
        scrollTop: 500,
        clientHeight: 500,
      }),
    ).toBe(false);
    expect(
      shouldAutoFollowLatest({ force: false, nearLatest: false }),
    ).toBe(false);
  });

  it("follows new messages near the bottom and permits an explicit jump to latest", () => {
    expect(
      isNearLatestScroll({
        scrollHeight: 1200,
        scrollTop: 580,
        clientHeight: 500,
      }),
    ).toBe(true);
    expect(
      shouldAutoFollowLatest({ force: false, nearLatest: true }),
    ).toBe(true);
    expect(
      shouldAutoFollowLatest({ force: true, nearLatest: false }),
    ).toBe(true);
  });

  it("rejects blank and over-500-character input but accepts exactly 500", () => {
    expect(validateComposerDraft("  ")).toContain("空请求");
    expect(validateComposerDraft("测".repeat(501))).toContain("501");
    expect(validateComposerDraft("测".repeat(500))).toBeUndefined();
  });

  it("submits Enter once but preserves Shift+Enter and IME composition", () => {
    expect(
      shouldSubmitComposerKey({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        disabled: false,
      }),
    ).toBe(true);
    expect(
      shouldSubmitComposerKey({
        key: "Enter",
        shiftKey: true,
        isComposing: false,
        disabled: false,
      }),
    ).toBe(false);
    expect(
      shouldSubmitComposerKey({
        key: "Enter",
        shiftKey: false,
        isComposing: true,
        disabled: false,
      }),
    ).toBe(false);
  });

  it("uses the synchronous request lease to reject an Enter/click double submit", () => {
    const first = acquireRequestLease(undefined, "request-1");
    const second = acquireRequestLease(first.activeClientRequestId, "request-2");
    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.activeClientRequestId).toBe("request-1");
  });

  it("uses a friendly error card without HTTP codes, URLs, or provider details", () => {
    const message = friendlyRequestError();
    expect(message).toContain("重试原请求");
    expect(message).not.toMatch(/503|https?:\/\/|供应商|URL/iu);
  });

  it("replaces a retryable error in place without duplicating user or AI messages", () => {
    const user = {
      id: "user-1",
      clientRequestId: "request-1",
      role: "user" as const,
      content: "费用咨询",
      createdAt: "2026-08-04T06:00:00.000Z",
      sources: [],
      presentation: EMPTY_PRESENTATION,
      actions: [],
      options: [],
    };
    let state = clientChatReducer(createClientChatState(), {
      type: "request_started",
      userMessage: user,
    });
    state = clientChatReducer(state, {
      type: "request_failed",
      error: { code: "model_unavailable", retryable: true },
      message: {
        ...user,
        id: "error-1",
        role: "error",
        content: friendlyRequestError(),
      },
    });
    state = clientChatReducer(state, {
      type: "request_succeeded",
      clientRequestId: "request-1",
      messages: [
        {
          ...user,
          id: "assistant-1",
          role: "assistant",
          content: "已恢复",
        },
      ],
    });
    expect(state.messages.map(({ role }) => role)).toEqual(["user", "assistant"]);
  });

  it("labels grounded AI output and system fallback without masquerading fallback as LLM", () => {
    expect(answerVerificationLabel("ai_grounded")).toContain("AI结合资料生成");
    expect(answerVerificationLabel("system_grounded")).toContain("系统依据资料整理");
    expect(answerVerificationLabel("system_grounded")).not.toContain("AI结合");
  });

  it("exposes only aggregate evidence counts and safe response mode", () => {
    const value = response();
    value.sources = [
      {
        document: "A",
        chapter: "第三章",
        factIds: ["safe.fact"],
      },
    ];
    value.diagnostics = {
      corrections: [],
      confirmedDomain: "student",
      confirmedConstraints: {},
      pendingQuestionKeys: [],
      entityIds: [],
      decisionTrace: [],
      groundingFailures: [],
      retrievedChunkIds: ["one", "two", "three"],
      usedChunkIds: ["one", "two"],
      modelCallCount: 2,
      regenerationCount: 1,
      promptVersion: "private",
      composerAttempts: 2,
      composerRetries: 1,
      composerAttemptResults: [],
      dateAdvisoryAttemptResults: [],
      externalModelCalls: 2,
      contextParsingMs: 1,
      constraintExtractionMs: 1,
      classifierMs: 1,
      ruleExecutionMs: 1,
      composerMs: 1,
      groundingMs: 1,
    };
    expect(safeTurnEvidence(value)).toEqual({
      retrievedCount: 3,
      usedCount: 2,
      groundingChecked: true,
      regenerated: true,
      responseMode: "normal",
    });
    expect(JSON.stringify(safeTurnEvidence(value))).not.toMatch(
      /private|safe\.fact|\bone\b/,
    );
  });

  it("reports date and fee program fallback modes in evidence mode", () => {
    const date = response();
    date.diagnostics = {
      corrections: [], confirmedDomain: "student", confirmedConstraints: {},
      pendingQuestionKeys: [], entityIds: [], decisionTrace: [], groundingFailures: [],
      retrievedChunkIds: [], usedChunkIds: [], modelCallCount: 2, regenerationCount: 1,
      promptVersion: "private", composerAttempts: 2, composerRetries: 1,
      composerAttemptResults: [], dateAdvisoryAttemptResults: [], externalModelCalls: 2,
      contextParsingMs: 0, constraintExtractionMs: 0, classifierMs: 0,
      ruleExecutionMs: 0, composerMs: 0, groundingMs: 0,
      responseMode: "date_advisory_fallback",
    };
    const fee = structuredClone(date);
    if (fee.diagnostics) {
      fee.diagnostics.responseMode = undefined;
      fee.diagnostics.calculationMode = "system_fallback";
    }
    expect(safeTurnEvidence(date)?.responseMode).toBe("date_advisory_fallback");
    expect(safeTurnEvidence(fee)?.responseMode).toBe("system_fee_fallback");
  });

  it("does not expose detailed evidence when diagnostics are unavailable", () => {
    expect(safeTurnEvidence(response())).toBeUndefined();
  });

  it("shows a user-facing current entity name after a concrete card is selected", () => {
    const state = baseState();
    state.selectedEntityId = "camp-p1-bj";
    expect(
      currentEntityLabel({
        state,
        institutionLabels: {},
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            content: "推荐",
            createdAt: "2026-08-04T06:00:00.000Z",
            sources: [],
            actions: [],
            options: [],
            presentation: {
              recommendations: [
                {
                  entityId: "camp-p1-bj",
                  kind: "student",
                  name: "第一期北京线下班",
                  date: "date",
                  delivery: "北京",
                  standardPrice: 6980,
                  actualPrice: 6980,
                  discountLabel: "标准价",
                  reasons: [],
                  sources: [],
                  availabilityNote: "资料未提供实时余位",
                },
              ],
            },
          },
        ],
      }),
    ).toBe("第一期北京线下班");
  });

  it("translates internal statuses before display", () => {
    expect(userFacingStatus("catalog")).toBe("班型目录");
    expect(userFacingStatus("fact_answer")).toBe("资料回答");
    expect(userFacingStatus("unknown_internal_status")).toBeUndefined();
  });
});
