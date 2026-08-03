"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  ChatPresentation,
  ChatResponse,
  ConversationDomain,
  ConversationState,
} from "@/lib/domain/conversation";
import {
  downloadConversationMarkdown,
} from "@/lib/export/markdown";
import {
  consumeRetryRequest,
  createRetryRequestSnapshot,
  identifyChatRequest,
  requestFromRetrySnapshot,
  type ChatRequest,
  type RetryRequestSnapshot,
} from "@/lib/conversation/retryRequest";
import {
  acquireRequestLease,
  areErrorControlsDisabled,
  clientChatReducer,
  createClientChatState,
  releaseRequestLease,
  type ClientUiMessage,
  type IdentifiedClientUiMessage,
} from "@/lib/conversation/clientChatState";
import { restoreConversation } from "@/lib/conversation/historyRestore";
import { isConversationId } from "@/lib/history/conversationStore";
import type { ChatMessage, ChatSession } from "@/lib/history/types";
import styles from "./CourseAdvisor.module.css";

type UiMessage = ClientUiMessage;

type RequestOptions = {
  userLabel?: string;
  appendUser?: boolean;
  replaceOnSuccess?: boolean;
  retrySnapshot?: RetryRequestSnapshot;
  historySessionId?: string;
};

const EMPTY_PRESENTATION: ChatPresentation = { recommendations: [] };
const HISTORY_SESSION_KEY = "ai-course-advisor.sessionId";

type BrowserHistory = {
  sessionId: string;
  messages: IdentifiedClientUiMessage[];
  state: ConversationState;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasSessionPayload(value: unknown): value is { session: ChatSession } {
  if (!isRecord(value) || !isRecord(value.session)) return false;
  return isConversationId(value.session.id);
}

function hasMessagesPayload(
  value: unknown,
): value is { messages: ChatMessage[] } {
  if (!isRecord(value) || !Array.isArray(value.messages)) return false;
  return value.messages.every(
    (message) =>
      isRecord(message) &&
      isConversationId(message.id) &&
      isConversationId(message.sessionId) &&
      (message.role === "user" ||
        message.role === "assistant" ||
        message.role === "system") &&
      typeof message.content === "string" &&
      typeof message.createdAt === "string" &&
      Array.isArray(message.sources) &&
      isRecord(message.metadata),
  );
}

async function createHistorySession(): Promise<ChatSession> {
  const response = await fetch("/api/history/sessions", { method: "POST" });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok || !hasSessionPayload(payload)) {
    throw new Error("history_session_create_failed");
  }
  return payload.session;
}

async function loadHistory(sessionId: string): Promise<ChatMessage[]> {
  const response = await fetch(
    `/api/history/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok || !hasMessagesPayload(payload)) {
    throw new Error(
      response.status === 404
        ? "history_session_not_found"
        : "history_session_load_failed",
    );
  }
  return payload.messages;
}

async function initializeBrowserHistory(): Promise<BrowserHistory> {
  const savedSessionId = localStorage.getItem(HISTORY_SESSION_KEY);
  if (isConversationId(savedSessionId)) {
    try {
      const storedMessages = await loadHistory(savedSessionId);
      return {
        sessionId: savedSessionId,
        ...restoreConversation(storedMessages),
      };
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "history_session_not_found"
      ) {
        throw error;
      }
    }
  }

  const session = await createHistorySession();
  localStorage.setItem(HISTORY_SESSION_KEY, session.id);
  return { sessionId: session.id, ...restoreConversation([]) };
}

const ROLE_OPTIONS = [
  {
    domain: "student" as const,
    title: "学生/家长",
    note: "夏令营班型、营期、费用与准备事项",
    mark: "学",
  },
  {
    domain: "teacher" as const,
    title: "教师",
    note: "培训等级、时间形式、前置条件与费用",
    mark: "教",
  },
  {
    domain: "platform" as const,
    title: "机构/学校",
    note: "企业培训、学校采购、平台与项目服务",
    mark: "企",
  },
];

const DOMAIN_LABELS: Record<ConversationDomain, string> = {
  unknown: "待确认",
  student: "学生/家长",
  teacher: "教师",
  platform: "机构/学校",
};

const INSTITUTION_LABELS: Record<string, string> = {
  membership: "会员权益",
  enterprise_training: "企业培训",
  school_procurement: "学校采购",
  basic_agent: "基础Agent交付",
  ai_web: "AI Web应用",
  rag: "企业知识库/RAG",
};

const CONSTRAINT_LABELS: Record<string, string> = {
  region: "地区",
  preferredOfflineCampus: "目的城市",
  availablePeriods: "可参加营期",
  excludedPeriods: "冲突营期",
  modePreference: "授课形式",
  canTravel: "能否出行",
  needsReplay: "回放需求",
  level: "目标等级",
  goal: "培训目标",
  startingLevel: "当前基础",
  canTakeContinuousLeave: "连续时间",
  availableProductIds: "可参加班型",
  city: "城市",
  prerequisiteStatus: "前置条件",
  institutionNeed: "服务分类",
};

const VALUE_LABELS: Record<string, string> = {
  beijing: "北京",
  shanghai: "上海",
  guangzhou: "广州",
  other: "其他地区",
  offline: "线下",
  online: "线上",
  any: "均可",
  beginner: "零基础",
  tools: "AI工具应用",
  "web-app": "AI Web应用",
  "rag-project": "知识库/RAG项目",
  met: "已满足",
  not_met: "未满足",
  unknown: "待确认",
};

const SOURCE_TITLES = {
  A: "2026暑期AI素养夏令营课程手册",
  B: "初高中教师AI素养培训体系介绍",
  C: "OPC超级个体赋能平台产品白皮书",
} as const;

function initialState(): ConversationState {
  return {
    version: 1,
    domain: "unknown",
    studentConstraints: {},
    teacherConstraints: {},
    lastRecommendationIds: [],
    pendingQuestionKeys: [],
    pendingQuestionOptions: [],
    shortHistory: [],
    test: { failNextModelCall: false },
  };
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function systemMessage(content: string): UiMessage {
  return {
    id: uid("system"),
    role: "system",
    content,
    createdAt: new Date().toISOString(),
    sources: [],
    presentation: EMPTY_PRESENTATION,
    actions: [],
    options: [],
  };
}

function initialMessages(): UiMessage[] {
  return [
    systemMessage(
      "欢迎使用 AI课程顾问。我会先确认身份和有效约束，再基于对应资料提供课程或机构服务建议。",
    ),
  ];
}

function displayValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) {
    return value.map((item) => VALUE_LABELS[String(item)] ?? String(item)).join("、");
  }
  return VALUE_LABELS[String(value)] ?? String(value);
}

function sourceLabel(source: UiMessage["sources"][number]): string {
  const section = source.section ? `（${source.section}）` : "";
  return `素材${source.document}《${SOURCE_TITLES[source.document]}》${source.chapter}${section}`;
}

function responseRole(response: ChatResponse): UiMessage["role"] {
  if (response.error) return "error";
  if (
    [
      "reset",
      "menu",
      "selection",
      "identity_selected",
      "test_failure_armed",
    ].includes(response.status)
  ) {
    return "system";
  }
  return "assistant";
}

function hasChatResponseShape(value: unknown): value is ChatResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.status === "string" &&
    typeof item.message === "string" &&
    Boolean(item.state) &&
    Array.isArray(item.sources) &&
    Array.isArray(item.entityIds) &&
    Array.isArray(item.actions) &&
    Array.isArray(item.notices) &&
    Boolean(item.presentation)
  );
}

export default function CourseAdvisor({ testMode }: { testMode: boolean }) {
  const [state, setState] = useState<ConversationState>(initialState);
  const [chatUi, dispatchChatUi] = useReducer(
    clientChatReducer,
    undefined,
    () => createClientChatState(initialMessages()),
  );
  const messages = chatUi.messages;
  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [historySessionId, setHistorySessionId] = useState("");
  const [sessionId, setSessionId] = useState("TASK05-001");
  const [exportNotice, setExportNotice] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const requestInFlightRef = useRef<string | undefined>(undefined);
  const consumedRetryErrorIdsRef = useRef<ReadonlySet<string>>(new Set());
  const historyInitializationRef = useRef<Promise<BrowserHistory> | undefined>(
    undefined,
  );

  useEffect(() => {
    let active = true;
    const initialization =
      historyInitializationRef.current ?? initializeBrowserHistory();
    historyInitializationRef.current = initialization;

    void initialization
      .then((restored) => {
        if (!active) return;
        setHistorySessionId(restored.sessionId);
        setState(restored.state);
        dispatchChatUi({
          type: "replace_all",
          messages: restored.messages.length
            ? restored.messages
            : initialMessages().map((message) => ({
                ...message,
                clientRequestId: message.id,
              })),
        });
        setHistoryReady(true);
      })
      .catch(() => {
        if (!active) return;
        setInputError("历史会话初始化失败，当前无法发送，请稍后刷新重试。");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, loading]);

  const constraints = useMemo(() => {
    const source =
      state.domain === "student"
        ? state.studentConstraints
        : state.domain === "teacher"
          ? state.teacherConstraints
          : {};
    const entries = Object.entries(source)
      .filter(
        ([key, value]) =>
          ![
            "stalledTurns",
            "refusesMoreQuestions",
            "regionDisplayName",
          ].includes(key) &&
          value !== undefined &&
          (!Array.isArray(value) || value.length > 0),
      )
      .map(([key, value]) => ({
        key,
        label: CONSTRAINT_LABELS[key] ?? key,
        value:
          state.domain === "student" &&
          key === "region" &&
          state.studentConstraints.regionDisplayName
            ? state.studentConstraints.regionDisplayName
            : displayValue(value),
      }));
    if (state.domain === "platform" && state.institutionNeed) {
      entries.push({
        key: "institutionNeed",
        label: CONSTRAINT_LABELS.institutionNeed,
        value: INSTITUTION_LABELS[state.institutionNeed] ?? state.institutionNeed,
      });
    }
    return entries;
  }, [state]);

  const currentEntityName = useMemo(() => {
    if (state.domain === "platform" && state.institutionNeed) {
      return INSTITUTION_LABELS[state.institutionNeed] ?? state.institutionNeed;
    }
    if (!state.selectedEntityId) return "尚未选择";
    for (const message of [...messages].reverse()) {
      const card = message.presentation.recommendations.find(
        ({ entityId }) => entityId === state.selectedEntityId,
      );
      if (card) return card.name;
      if (message.presentation.institutionService?.entityId === state.selectedEntityId) {
        return message.presentation.institutionService.name;
      }
    }
    return "已选择当前班型";
  }, [messages, state.domain, state.institutionNeed, state.selectedEntityId]);

  const latestResponseMessageId = useMemo(
    () => [...messages].reverse().find((message) => message.role !== "user")?.id,
    [messages],
  );

  async function requestChat(
    request: ChatRequest,
    options: RequestOptions = {},
  ): Promise<ChatResponse | undefined> {
    const activeHistorySessionId =
      options.historySessionId ?? historySessionId;
    if (!isConversationId(activeHistorySessionId)) {
      setInputError("历史会话尚未就绪，请稍后重试。");
      return undefined;
    }
    let identifiedRequest = identifyChatRequest({
      ...request,
      testMode: request.testMode ?? testMode,
    });
    const lease = acquireRequestLease(
      requestInFlightRef.current,
      identifiedRequest.clientRequestId,
    );
    requestInFlightRef.current = lease.activeClientRequestId;
    if (!lease.acquired) return undefined;

    if (options.retrySnapshot) {
      const consumption = consumeRetryRequest(
        options.retrySnapshot,
        consumedRetryErrorIdsRef.current,
      );
      consumedRetryErrorIdsRef.current =
        consumption.consumedErrorMessageIds;
      if (!consumption.request) {
        requestInFlightRef.current = releaseRequestLease(
          requestInFlightRef.current,
          identifiedRequest.clientRequestId,
        );
        return undefined;
      }
      identifiedRequest = consumption.request;
      dispatchChatUi({
        type: "retry_started",
        clientRequestId: identifiedRequest.clientRequestId,
        errorMessageId: options.retrySnapshot.errorMessageId,
      });
    }
    const appendUser = options.appendUser !== false && options.userLabel;
    if (appendUser) {
      dispatchChatUi({
        type: "request_started",
        userMessage: {
          id: uid("user"),
          clientRequestId: identifiedRequest.clientRequestId,
          role: "user",
          content: options.userLabel as string,
          createdAt: new Date().toISOString(),
          sources: [],
          presentation: EMPTY_PRESENTATION,
          actions: [],
          options: [],
        },
      });
    }
    setLoading(true);
    setInputError("");
    setExportNotice("");

    try {
      const httpResponse = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...identifiedRequest,
          sessionId: activeHistorySessionId,
        }),
      });
      const payload: unknown = await httpResponse.json().catch(() => undefined);
      if (!hasChatResponseShape(payload)) {
        throw new Error("invalid_response");
      }

      setState(payload.state);
      const messageId = uid(payload.error ? "error" : "assistant");
      const nextMessage: IdentifiedClientUiMessage = {
        id: messageId,
        clientRequestId: identifiedRequest.clientRequestId,
        role: responseRole(payload),
        content: payload.message,
        createdAt: new Date().toISOString(),
        status: payload.status,
        sources: payload.sources,
        presentation: payload.presentation,
        actions: payload.actions,
        options: payload.state.pendingQuestionOptions,
        retrySnapshot: payload.error?.retryable
          ? createRetryRequestSnapshot({
              request: identifiedRequest,
              errorMessageId: messageId,
            })
          : undefined,
      };
      const noticeMessages: IdentifiedClientUiMessage[] = payload.notices.map(
        (notice) => ({
          ...systemMessage(notice.message),
          clientRequestId: identifiedRequest.clientRequestId,
        }),
      );
      if (payload.error) {
        dispatchChatUi({
          type: "request_failed",
          message: nextMessage,
          error: payload.error,
        });
      } else {
        const additions = [...noticeMessages, nextMessage];
        dispatchChatUi(
          options.replaceOnSuccess
            ? { type: "replace_all", messages: additions }
            : {
                type: "request_succeeded",
                clientRequestId: identifiedRequest.clientRequestId,
                messages: additions,
              },
        );
        if (payload.status === "menu" || payload.status === "reset") {
          dispatchChatUi({ type: "menu_completed" });
          consumedRetryErrorIdsRef.current = new Set();
        }
      }
      return payload;
    } catch {
      const localError = {
        code: "network_error",
        retryable: true,
      };
      const messageId = uid("error");
      dispatchChatUi({
        type: "request_failed",
        error: localError,
        message: {
          id: messageId,
          clientRequestId: identifiedRequest.clientRequestId,
          role: "error",
          content: "暂时无法连接课程顾问服务。对话状态仍在本机保留，请重试或返回菜单。",
          createdAt: new Date().toISOString(),
          status: "error",
          sources: [],
          presentation: EMPTY_PRESENTATION,
          actions: ["重试", "返回菜单"],
          options: [],
          retrySnapshot: createRetryRequestSnapshot({
            request: identifiedRequest,
            errorMessageId: messageId,
          }),
        },
      });
      return undefined;
    } finally {
      requestInFlightRef.current = releaseRequestLease(
        requestInFlightRef.current,
        identifiedRequest.clientRequestId,
      );
      setLoading(false);
    }
  }

  async function sendMessage(message: string, action: "message" | "catalog" = "message") {
    if (!historyReady) {
      setInputError("历史会话尚未就绪，请稍后重试。");
      return;
    }
    const normalized = message.trim();
    if (!normalized) {
      setInputError("请输入问题后再发送，不会发起空请求。");
      inputRef.current?.focus();
      return;
    }
    if (message.length > 500) {
      setInputError(`当前${message.length}字，单次最多500字，请精简后再发送。`);
      inputRef.current?.focus();
      return;
    }
    setDraft("");
    await requestChat(
      { action, message: normalized, state },
      { userLabel: normalized },
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!loading && historyReady) void sendMessage(draft);
    }
  }

  async function selectDomain(domain: "student" | "teacher" | "platform") {
    const title = ROLE_OPTIONS.find((item) => item.domain === domain)?.title ?? domain;
    await requestChat(
      { action: "select_domain", domain, state },
      { userLabel: `选择身份：${title}` },
    );
    inputRef.current?.focus();
  }

  async function selectEntity(entityId: string, name: string) {
    await requestChat(
      { action: "select_entity", entityId, state },
      { userLabel: `继续咨询：${name}` },
    );
    inputRef.current?.focus();
  }

  async function returnMenu() {
    await requestChat(
      { action: "menu", state },
      { userLabel: "返回菜单" },
    );
  }

  async function restart() {
    let nextSession: ChatSession;
    try {
      nextSession = await createHistorySession();
    } catch {
      setInputError("无法创建新的历史会话，请稍后重试。");
      return;
    }
    const result = await requestChat(
      { action: "reset", state },
      {
        appendUser: false,
        replaceOnSuccess: true,
        historySessionId: nextSession.id,
      },
    );
    if (result) {
      localStorage.setItem(HISTORY_SESSION_KEY, nextSession.id);
      setHistorySessionId(nextSession.id);
      setDraft("");
      setSessionId(uid("TASK05"));
    }
  }

  async function armTestFailure() {
    await requestChat(
      { action: "inject_next_failure", state, testMode: true },
      { userLabel: "[测试] 模拟下一次模型失败" },
    );
  }

  async function retryOriginalRequest(snapshot: RetryRequestSnapshot) {
    await requestChat(requestFromRetrySnapshot(snapshot), {
      appendUser: false,
      retrySnapshot: snapshot,
    });
  }

  function focusWithDraft(value = "") {
    if (value) setDraft(value);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleApiAction(action: string) {
    switch (action) {
      case "返回菜单":
      case "重新选择身份":
        void returnMenu();
        return;
      case "咨询学生课程":
        void selectDomain("student");
        return;
      case "咨询教师培训":
        void selectDomain("teacher");
        return;
      case "咨询机构服务":
        void selectDomain("platform");
        return;
      case "继续询问当前班型":
      case "继续当前咨询":
      case "选择具体班型":
        focusWithDraft();
        return;
      case "询问时间":
        void sendMessage("请介绍当前班型的时间安排。");
        return;
      case "询问费用":
        void sendMessage("请介绍当前班型的费用和实际适用优惠。");
        return;
      case "询问准备事项":
        void sendMessage("参加当前班型需要准备什么？");
        return;
      case "查看课程推荐":
        void sendMessage("请根据我已经提供的条件推荐课程。");
        return;
      case "查看其他营期":
        focusWithDraft("我想调整可参加的营期：");
        return;
      case "查看其他班型":
        focusWithDraft("我想调整班型或时间安排：");
        return;
      case "调整日期条件":
        focusWithDraft("我可以调整日期，新的可参加时间是：");
        return;
      case "联系模拟人工顾问":
        void sendMessage("如需人工确认，请说明资料范围内可用的联系方式或下一步。");
        return;
      case "recommend_L1":
        void sendMessage("请为我改为评估L1班型。");
        return;
      case "recommend_L2":
        void sendMessage("请为我改为评估L2班型。");
        return;
      case "ability_assessment":
        void sendMessage("请说明同等能力测评这一前置路径。");
        return;
      case "submit_equivalent_project":
        void sendMessage("请说明提交同等项目作品这一前置路径。");
        return;
      default:
        focusWithDraft(action);
    }
  }

  function exportMarkdown() {
    const filename = downloadConversationMarkdown({
      sessionId,
      messages,
      state,
      testMode,
      actualError: chatUi.lastError,
      currentEntityName,
    });
    setExportNotice(`已导出：${filename}`);
  }

  const starterPrompts =
    state.domain === "student"
      ? [
          "我在北京，第一期可以参加，偏好线下",
          "我在广州，想给孩子看第一期线下班",
          "不方便出行，需要课程回放，第二期可参加",
        ]
      : state.domain === "teacher"
        ? [
            "我是零基础教师，工作日不能连续脱岗",
            "我已完成L1，能连续参加培训，想学习AI Web应用",
            "我想了解教师培训的时间安排和费用",
          ]
        : state.domain === "platform"
          ? [
              "学校计划采购20人的教师培训",
              "企业需要50人的AI工具培训",
              "我们想做一个企业知识库RAG项目",
            ]
          : [];
  const interactionDisabled = loading || !historyReady;

  return (
    <main className={styles.pageShell}>
      {testMode && (
        <div className={styles.testBanner} role="status">
          <span>TEST MODE</span>
          仅用于故障恢复验证；测试控件只影响下一次模型请求
        </div>
      )}

      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo} aria-hidden="true">AI</div>
          <div>
            <p className={styles.kicker}>资料可追溯 · 决策有依据</p>
            <h1>AI课程顾问</h1>
          </div>
        </div>
        <p className={styles.headerDescription}>
          为学生与家长、教师、机构与学校提供身份澄清、课程匹配和服务咨询。
        </p>
        <div className={styles.headerActions}>
          <button type="button" className={styles.ghostButton} onClick={exportMarkdown}>
            导出 Markdown
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => void restart()} disabled={interactionDisabled}>
            重新开始
          </button>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.contextPanel} aria-label="当前咨询状态">
          <div className={styles.contextHeader}>
            <span>咨询状态</span>
            <span className={styles.liveBadge}><i /> 实时更新</span>
          </div>

          <section className={styles.contextSection}>
            <p className={styles.contextLabel}>当前身份</p>
            <strong className={styles.contextValue}>{DOMAIN_LABELS[state.domain]}</strong>
            <div className={styles.miniRoleGrid}>
              {ROLE_OPTIONS.map((role) => (
                <button
                  type="button"
                  key={role.domain}
                  className={state.domain === role.domain ? styles.miniRoleActive : styles.miniRole}
                  onClick={() => void selectDomain(role.domain)}
                  disabled={interactionDisabled || state.domain === role.domain}
                >
                  {role.title}
                </button>
              ))}
            </div>
          </section>

          <section className={styles.contextSection}>
            <p className={styles.contextLabel}>已确认的有效约束</p>
            {constraints.length ? (
              <dl className={styles.constraintList}>
                {constraints.map((item) => (
                  <div key={item.key}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className={styles.emptyState}>尚未采集约束</p>
            )}
          </section>

          <section className={styles.contextSection}>
            <p className={styles.contextLabel}>当前班型 / 服务</p>
            <p className={styles.currentEntity}>{currentEntityName}</p>
          </section>

          <section className={styles.sessionSection}>
            <label htmlFor="session-id">会话 / 测试编号</label>
            <input
              id="session-id"
              value={sessionId}
              maxLength={50}
              onChange={(event) => setSessionId(event.target.value)}
            />
          </section>

          <div className={styles.sideActions}>
            <button type="button" onClick={() => void sendMessage("查看全部课程", "catalog")} disabled={interactionDisabled}>
              查看全部课程
            </button>
            <button type="button" onClick={() => void returnMenu()} disabled={interactionDisabled}>
              返回菜单
            </button>
            {testMode && (
              <button
                type="button"
                className={state.test.failNextModelCall ? styles.testArmedButton : styles.testButton}
                onClick={() => void armTestFailure()}
                disabled={interactionDisabled || state.test.failNextModelCall}
              >
                {state.test.failNextModelCall ? "下一次失败已就绪" : "模拟模型失败"}
              </button>
            )}
          </div>
          {exportNotice && <p className={styles.exportNotice}>{exportNotice}</p>}
        </aside>

        <section className={styles.chatPanel} aria-label="课程顾问对话">
          <div className={styles.chatHeader}>
            <div>
              <strong>课程咨询</strong>
              <p>每条事实回答均由程序校验并追加资料来源</p>
            </div>
            <span className={styles.privacyBadge}>不显示密钥与内部提示</span>
          </div>

          <div className={styles.chatBody} aria-live="polite">
            {state.domain === "unknown" && (
              <section className={styles.welcomeCard}>
                <span className={styles.welcomeEyebrow}>先从身份开始</span>
                <h2>你好，我是你的 AI 课程顾问</h2>
                <p>你可以选择明确身份，也可以直接描述“我想学AI”等需求，我会先做身份澄清。</p>
                <div className={styles.roleCards}>
                  {ROLE_OPTIONS.map((role) => (
                    <button
                      type="button"
                      key={role.domain}
                      onClick={() => void selectDomain(role.domain)}
                      disabled={interactionDisabled}
                    >
                      <span className={styles.roleMark}>{role.mark}</span>
                      <span><strong>{role.title}</strong><small>{role.note}</small></span>
                      <b aria-hidden="true">→</b>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {messages.map((message) => {
              const messageControlsDisabled =
                interactionDisabled || message.id !== latestResponseMessageId;
              const errorControlsDisabled = areErrorControlsDisabled(
                interactionDisabled,
                message.retrying,
              );
              return (
                <article className={`${styles.messageRow} ${styles[message.role]}`} key={message.id}>
                <div className={styles.messageMeta}>
                  <span>{message.role === "user" ? "你" : message.role === "assistant" ? "AI课程顾问" : message.role === "error" ? "请求异常" : "系统状态"}</span>
                  {message.status && <small>{message.status}</small>}
                </div>
                <div className={styles.messageBubble}>{message.content}</div>

                {message.presentation.recommendations.map((card) => (
                  <section
                    className={styles.recommendationCard}
                    key={`${message.clientRequestId ?? message.id}:${card.entityId}`}
                  >
                    <div className={styles.cardTopline}>
                      <span>{card.kind === "student" ? "学生课程推荐" : "教师培训推荐"}</span>
                      <span>已核对</span>
                    </div>
                    <h3>{card.name}</h3>
                    <div className={styles.cardFacts}>
                      <div><span>日期</span><strong>{card.date}</strong></div>
                      <div><span>地点 / 方式</span><strong>{card.delivery}</strong></div>
                      <div><span>标准费用</span><strong>{card.standardPrice.toLocaleString("zh-CN")}元</strong></div>
                      <div><span>本次适用</span><strong>{card.actualPrice.toLocaleString("zh-CN")}元 · {card.discountLabel}</strong></div>
                    </div>
                    <div className={styles.reasonBlock}>
                      <h4>与你的约束逐项对应</h4>
                      <ul>
                        {card.reasons.map((reason) => (
                          <li key={reason.constraintKey}>
                            <span>{reason.constraintLabel} · {reason.constraintValue}</span>
                            <p>{reason.reason}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className={styles.sourceBlock}>
                      <strong>资料来源（程序追加）</strong>
                      {card.sources.map((source) => <span key={sourceLabel(source)}>{sourceLabel(source)}</span>)}
                    </div>
                    <p className={styles.availabilityNote}>{card.availabilityNote}</p>
                    <button
                      type="button"
                      className={styles.cardButton}
                      onClick={() => void selectEntity(card.entityId, card.name)}
                      disabled={messageControlsDisabled}
                    >
                      继续咨询该班
                    </button>
                  </section>
                ))}

                {message.presentation.institutionService && (
                  <section className={styles.serviceCard}>
                    <span className={styles.welcomeEyebrow}>机构服务 · 仅使用素材C</span>
                    <h3>{message.presentation.institutionService.name}</h3>
                    <dl>
                      <div><dt>适用对象</dt><dd>{message.presentation.institutionService.audience}</dd></div>
                      <div><dt>计价规则</dt><dd>{message.presentation.institutionService.pricingRule}</dd></div>
                      <div><dt>服务边界</dt><dd>{message.presentation.institutionService.boundary}</dd></div>
                    </dl>
                    <div className={styles.sourceBlock}>
                      <strong>资料来源（程序追加）</strong>
                      {message.presentation.institutionService.sources.map((source) => <span key={sourceLabel(source)}>{sourceLabel(source)}</span>)}
                    </div>
                  </section>
                )}

                {message.options.length > 0 && (
                  <div className={styles.optionRow} aria-label="可选回答">
                    {message.options.map((option) => (
                      <button type="button" key={option} onClick={() => void sendMessage(option)} disabled={messageControlsDisabled}>{option}</button>
                    ))}
                  </div>
                )}

                {message.actions.length > 0 && !message.actions.includes("重试") && (
                  <div className={styles.actionRow} aria-label="可执行操作">
                    {message.actions.map((action) => (
                      <button type="button" key={action} onClick={() => handleApiAction(action)} disabled={messageControlsDisabled}>{action}</button>
                    ))}
                  </div>
                )}

                {message.role === "error" && (
                  <div className={styles.errorActions}>
                    {message.retrySnapshot && (
                      <button
                        type="button"
                        onClick={() => void retryOriginalRequest(message.retrySnapshot as RetryRequestSnapshot)}
                        disabled={errorControlsDisabled}
                      >
                        重试原请求
                      </button>
                    )}
                    <button type="button" onClick={() => void returnMenu()} disabled={errorControlsDisabled}>返回菜单</button>
                  </div>
                )}
                </article>
              );
            })}

            {loading && (
              <div className={styles.loadingMessage} role="status">
                <span><i /><i /><i /></span>
                正在核对约束、课程事实与资料来源…
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className={styles.composerArea}>
            {starterPrompts.length > 0 && (
              <div className={styles.starterPrompts}>
                {starterPrompts.map((prompt) => (
                  <button type="button" key={prompt} onClick={() => void sendMessage(prompt)} disabled={interactionDisabled}>{prompt}</button>
                ))}
              </div>
            )}
            <form className={styles.composer} onSubmit={handleSubmit}>
              <textarea
                ref={inputRef}
                value={draft}
                rows={2}
                maxLength={800}
                placeholder="自由描述你的需求，例如：我想学AI，但还不确定适合哪类课程…"
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (inputError) setInputError("");
                }}
                onKeyDown={handleKeyDown}
                disabled={interactionDisabled}
                aria-invalid={Boolean(inputError)}
              />
              <div className={styles.composerFooter}>
                <span className={draft.length > 500 ? styles.countError : undefined}>{draft.length}/500</span>
                <span>Enter 发送 · Shift + Enter 换行</span>
                <button type="submit" disabled={interactionDisabled || draft.length > 500}>
                  {loading ? "发送中" : "发送"}
                </button>
              </div>
            </form>
            {inputError && <p className={styles.inputError} role="alert">{inputError}</p>}
            <p className={styles.disclaimer}>课程规模与最低开班人数不代表实时余位；报名状态需以资料规则及模拟人工确认为准。</p>
          </div>
        </section>
      </div>
    </main>
  );
}
