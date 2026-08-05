import type {
  ChatResponse,
  ConversationDomain,
  ConversationState,
} from "@/lib/domain/conversation";
import type { ClientUiMessage, SafeTurnEvidence } from "./clientChatState";

export type QuickEntry = {
  id: "student" | "teacher" | "catalog" | "fees" | "registration";
  label: string;
  description: string;
  command:
    | {
        type: "select_domain";
        domain: Exclude<ConversationDomain, "unknown" | "platform">;
      }
    | {
        type: "message";
        message: string;
        action?: "catalog";
      };
};

export const QUICK_ENTRIES: readonly QuickEntry[] = [
  {
    id: "student",
    label: "学生课程咨询",
    description: "营期、班型与准备事项",
    command: { type: "select_domain", domain: "student" },
  },
  {
    id: "teacher",
    label: "教师培训咨询",
    description: "等级、形式与前置条件",
    command: { type: "select_domain", domain: "teacher" },
  },
  {
    id: "catalog",
    label: "查看所有班型",
    description: "按当前身份查看完整目录",
    command: {
      type: "message",
      action: "catalog",
      message: "查看所有班型",
    },
  },
  {
    id: "fees",
    label: "费用咨询",
    description: "了解费用与适用优惠",
    command: { type: "message", message: "我想咨询课程费用。" },
  },
  {
    id: "registration",
    label: "报名条件咨询",
    description: "了解报名要求与资料边界",
    command: { type: "message", message: "我想咨询报名条件。" },
  },
] as const;

export type MobileQuickPanelEvent =
  | "toggle"
  | "request_started"
  | "quick_entry_selected"
  | "keyboard_closed";

export function nextMobileQuickPanelOpen(
  current: boolean,
  event: MobileQuickPanelEvent,
): boolean {
  return event === "toggle" ? !current : false;
}

export function isNearLatestScroll(input: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  threshold?: number;
}): boolean {
  return (
    input.scrollHeight - input.scrollTop - input.clientHeight <=
    (input.threshold ?? 120)
  );
}

export function shouldAutoFollowLatest(input: {
  force: boolean;
  nearLatest: boolean;
}): boolean {
  return input.force || input.nearLatest;
}

export function validateComposerDraft(value: string): string | undefined {
  if (!value.trim()) return "请输入问题后再发送，不会发起空请求。";
  if (value.length > 500) {
    return `当前${value.length}字，单次最多500字，请精简后再发送。`;
  }
  return undefined;
}

export function shouldSubmitComposerKey(input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  disabled: boolean;
}): boolean {
  return (
    input.key === "Enter" &&
    !input.shiftKey &&
    !input.isComposing &&
    !input.disabled
  );
}

export function friendlyRequestError(): string {
  return "这次回答暂时没有完成。你的问题和咨询进度都已保留，可以重试原请求。";
}

export function answerVerificationLabel(
  answerMode: ChatResponse["answerMode"],
): string {
  return answerMode === "system_grounded"
    ? "系统依据资料整理 · 已完成事实校验"
    : "AI结合资料生成 · 已完成事实校验";
}

export function currentEntityLabel(input: {
  state: ConversationState;
  messages: ClientUiMessage[];
  institutionLabels: Record<string, string>;
}): string {
  if (input.state.domain === "platform" && input.state.institutionNeed) {
    return (
      input.institutionLabels[input.state.institutionNeed] ??
      input.state.institutionNeed
    );
  }
  if (!input.state.selectedEntityId) return "尚未选择";
  for (const message of [...input.messages].reverse()) {
    const card = message.presentation.recommendations.find(
      ({ entityId }) => entityId === input.state.selectedEntityId,
    );
    if (card) return card.name;
    if (
      message.presentation.institutionService?.entityId ===
      input.state.selectedEntityId
    ) {
      return message.presentation.institutionService.name;
    }
    const service = message.presentation.institutionServices?.find(
      ({ entityId }) => entityId === input.state.selectedEntityId,
    );
    if (service) return service.name;
  }
  return "已选择当前班型";
}

export function safeTurnEvidence(
  response: ChatResponse,
): SafeTurnEvidence | undefined {
  const diagnostics = response.diagnostics;
  if (!diagnostics) return undefined;
  return {
    retrievedCount: diagnostics.retrievedChunkIds.length,
    usedCount: diagnostics.usedChunkIds.length,
    groundingChecked:
      diagnostics.usedChunkIds.length > 0 || response.sources.length > 0,
    regenerated: diagnostics.regenerationCount > 0,
    responseMode:
      diagnostics.responseMode === "date_advisory_fallback"
        ? "date_advisory_fallback"
        : diagnostics.calculationMode === "system_fallback"
          ? "system_fee_fallback"
          : "normal",
  };
}

export function userFacingStatus(status: string | undefined): string | undefined {
  if (!status) return undefined;
  const labels: Record<string, string> = {
    needs_identity: "待确认身份",
    needs_more_information: "还需补充",
    insufficient_information: "资料不足",
    boundary_follow_up: "需要确认",
    recommended: "已生成建议",
    no_match: "暂无匹配",
    prerequisite_blocked: "前置条件未满足",
    institution_info: "机构服务",
    fact_answer: "资料回答",
    contextual_followup: "继续当前咨询",
    catalog: "班型目录",
    unrelated: "范围提示",
    selection: "已选择",
    identity_selected: "身份已确认",
    reset: "新会话",
    menu: "已返回菜单",
    test_failure_armed: "测试状态",
    error: "可重试",
  };
  return labels[status];
}
