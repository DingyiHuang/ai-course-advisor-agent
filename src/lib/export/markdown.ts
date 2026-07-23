import type {
  ChatPresentation,
  ConversationState,
} from "@/lib/domain/conversation";
import type { CollectedSource } from "@/lib/citations";

export type ExportMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "error";
  content: string;
  createdAt: string;
  status?: string;
  sources: CollectedSource[];
  presentation: ChatPresentation;
};

export type ConversationExportInput = {
  sessionId: string;
  messages: ExportMessage[];
  state: ConversationState;
  testMode: boolean;
  actualError?: { code: string; retryable: boolean };
  currentEntityName?: string;
  exportedAt?: Date;
};

const DOCUMENT_TITLES = {
  A: "2026暑期AI素养夏令营课程手册",
  B: "初高中教师AI素养培训体系介绍",
  C: "OPC超级个体赋能平台产品白皮书",
} as const;

const DOMAIN_LABELS = {
  unknown: "未确认",
  student: "学生/家长",
  teacher: "教师",
  platform: "机构/学校",
} as const;

const INSTITUTION_LABELS: Record<string, string> = {
  membership: "会员权益",
  enterprise_training: "企业培训",
  school_procurement: "学校采购",
  basic_agent: "基础Agent交付",
  ai_web: "AI Web应用",
  rag: "企业知识库/RAG",
};

function shanghaiParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
}

export function formatShanghaiTimestamp(date: Date): string {
  const part = shanghaiParts(date);
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}:${part.second}`;
}

function filenameTimestamp(date: Date): string {
  const part = shanghaiParts(date);
  return `${part.year}${part.month}${part.day}-${part.hour}${part.minute}${part.second}`;
}

function displayValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.join("、");
  return String(value);
}

function constraintLines(state: ConversationState): string[] {
  const constraints =
    state.domain === "student"
      ? state.studentConstraints
      : state.domain === "teacher"
        ? state.teacherConstraints
        : {};
  const lines = Object.entries(constraints)
    .filter(
      ([key, value]) =>
        !["stalledTurns", "refusesMoreQuestions"].includes(key) &&
        value !== undefined &&
        (!Array.isArray(value) || value.length > 0),
    )
    .map(([key, value]) => `- ${key}: ${displayValue(value)}`);
  if (state.domain === "platform" && state.institutionNeed) {
    lines.push(
      `- institutionNeed: ${INSTITUTION_LABELS[state.institutionNeed] ?? state.institutionNeed}`,
    );
  }
  return lines.length ? lines : ["- 无"];
}

function sourceLabel(source: CollectedSource): string {
  const section = source.section ? `（${source.section}）` : "";
  return `素材${source.document}《${DOCUMENT_TITLES[source.document]}》${source.chapter}${section}`;
}

function recommendationLines(
  card: ExportMessage["presentation"]["recommendations"][number],
): string[] {
  return [
    `- ${card.name}`,
    `  - 日期：${card.date}`,
    `  - 地点/方式：${card.delivery}`,
    `  - 标准费用：${card.standardPrice}元`,
    `  - 实际费用：${card.actualPrice}元（${card.discountLabel}）`,
    ...card.reasons.map(
      (reason) =>
        `  - ${reason.constraintLabel}（${reason.constraintValue}）：${reason.reason}`,
    ),
  ];
}

function currentDomainRecommendations(
  messages: ExportMessage[],
  state: ConversationState,
): ExportMessage["presentation"]["recommendations"] {
  if (state.domain !== "student" && state.domain !== "teacher") return [];
  const currentKind = state.domain;
  const byEntityId = new Map<
    string,
    ExportMessage["presentation"]["recommendations"][number]
  >();
  for (const card of messages.flatMap(
    ({ presentation }) => presentation.recommendations,
  )) {
    if (card.kind === currentKind) byEntityId.set(card.entityId, card);
  }
  return [...byEntityId.values()];
}

export function createConversationMarkdown(
  input: ConversationExportInput,
): { filename: string; markdown: string } {
  const exportedAt = input.exportedAt ?? new Date();
  const recommendations = currentDomainRecommendations(
    input.messages,
    input.state,
  ).flatMap(recommendationLines);
  const uniqueSources = new Map<string, CollectedSource>();
  for (const source of input.messages.flatMap(({ sources }) => sources)) {
    const key = [source.document, source.chapter, source.section ?? ""].join("|");
    uniqueSources.set(key, source);
  }
  const sourceLines = [...uniqueSources.values()].map(
    (source) => `- ${sourceLabel(source)}`,
  );
  const currentCategory =
    input.state.domain === "platform" && input.state.institutionNeed
      ? INSTITUTION_LABELS[input.state.institutionNeed] ?? input.state.institutionNeed
      : input.currentEntityName ?? "未选择";

  const transcript = input.messages.flatMap((message) => [
    `### ${
      message.role === "user"
        ? "用户"
        : message.role === "assistant"
          ? "AI课程顾问"
          : message.role === "error"
            ? "错误"
            : "系统"
    } · ${formatShanghaiTimestamp(new Date(message.createdAt))}`,
    "",
    message.content,
    "",
  ]);

  const markdown = [
    "# AI课程顾问对话记录",
    "",
    `- 导出时间（Asia/Shanghai）：${formatShanghaiTimestamp(exportedAt)}`,
    `- 会话/测试编号：${input.sessionId || "未填写"}`,
    `- 当前身份：${DOMAIN_LABELS[input.state.domain]}`,
    `- 当前班型或机构服务分类：${currentCategory}`,
    `- 测试模式：${input.testMode ? "是" : "否"}`,
    `- 实际异常状态：${
      input.actualError
        ? `${input.actualError.code}（${input.actualError.retryable ? "可重试" : "不可重试"}）`
        : "无"
    }`,
    "",
    "## 已确认的有效约束",
    "",
    ...constraintLines(input.state),
    "",
    "## 实际对话",
    "",
    ...transcript,
    "## 推荐结果",
    "",
    ...(recommendations.length ? recommendations : ["- 本次对话尚无推荐结果"]),
    "",
    "## 实际使用的资料与章节（完整会话历史）",
    "",
    "以下来源对应上方保留的完整实际对话，不限于当前身份的推荐汇总。",
    "",
    ...(sourceLines.length ? sourceLines : ["- 本次对话尚未使用课程资料"]),
    "",
  ].join("\n");

  const safeSession = (input.sessionId || "未编号")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .slice(0, 50);
  return {
    filename: `AI课程顾问_${safeSession}_${filenameTimestamp(exportedAt)}.md`,
    markdown,
  };
}

export function downloadConversationMarkdown(
  input: ConversationExportInput,
): string {
  const result = createConversationMarkdown(input);
  const blob = new Blob([result.markdown], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return result.filename;
}
