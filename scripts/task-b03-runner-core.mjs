import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  HarnessEncodingError,
  prepareUtf8JsonRequest,
  TASK_B03_SCENARIO_DATA,
} from "./task-b03-encoding.mjs";

export const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
export const DEFAULT_EVIDENCE_DIR = path.resolve("test-evidence/task-b03");
export const SCENARIO_DELAY_MS = 8_000;
export const BATCH_PAUSE_MS = 30_000;
export const RETRY_DELAYS_MS = [10_000, 30_000];
export const MAX_ATTEMPTS = 3;

const initialState = (domain = "unknown", overrides = {}) => ({
  version: 1,
  domain,
  studentConstraints: {},
  teacherConstraints: {},
  lastRecommendationIds: [],
  pendingQuestionKeys: [],
  pendingQuestionOptions: [],
  shortHistory: [],
  test: { failNextModelCall: false },
  ...overrides,
});

const FORMAL_SCENARIO_DATA = new Map(
  TASK_B03_SCENARIO_DATA.formalScenarios.map((scenario) => [scenario.id, scenario]),
);

function answerContainsDate(answer, isoDate) {
  if (answer.includes(isoDate)) return true;
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return false;
  return answer.includes(
    `${match[1]}年${Number(match[2])}月${Number(match[3])}日`,
  );
}

const REGISTRATION_VERDICT_PATTERN =
  /(?:可以|仍可|仍然可以|还可以|还可|能|能够|不能|无法|不可以)(?:继续)?报名|报名(?:已经|已)(?:截止|结束)|(?:已经|已)(?:不能|无法)报(?:名)?/u;

const OTHER_PERIOD_RECOMMENDATION_PATTERN =
  /(?:推荐|建议|考虑|改报|转报|选择|咨询|了解|看看).{0,16}(?:第二期|第三期|其他营期|其他课程)|(?:第二期|第三期|其他营期|其他课程).{0,16}(?:推荐|建议|考虑|改报|转报|选择)/u;

function scenarioText(id) {
  const source = FORMAL_SCENARIO_DATA.get(id);
  if (!source) throw new Error(`Missing TASK-B03 scenario data: ${id}`);
  return {
    input: source.input,
    expected: source.expected,
    steps: source.steps.map((step) => ({
      ...step,
      originalMessage: step.message,
    })),
  };
}

function feeScenario({ id, amount, entityId, pricingChunkId, domain }) {
  return {
    id,
    category: "fee",
    ...scenarioText(id),
    initialState: initialState(domain),
    checks: ({ final }) => [
      {
        label: "HTTP 200且无公开错误",
        pass: final.httpStatus === 200 && final.publicErrorCode === null,
      },
      {
        label: `最终金额为${amount}元`,
        pass:
          final.expectedAmount === amount &&
          final.modelAmount === amount &&
          new RegExp(`(?:最终|应付|总价)[^。；\\n]{0,24}${amount}\\s*元`, "u").test(
            final.answer,
          ),
      },
      {
        label: "正文包含五步费用规则",
        pass:
          /标准价/u.test(final.answer) &&
          /早鸟/u.test(final.answer) &&
          /团报/u.test(final.answer) &&
          /(?:不叠加|不可叠加|不能叠加|金额较高)/u.test(final.answer) &&
          /食宿/u.test(final.answer),
      },
      {
        label: "实体与费用知识块正确",
        pass:
          final.entityIds.length === 1 &&
          final.entityIds[0] === entityId &&
          final.usedChunkIds.includes(pricingChunkId),
      },
      {
        label: "费用回答由模型正文或一次重生成完成",
        pass:
          final.calculationMode === "model" ||
          final.calculationMode === "regenerated_model" ||
          final.calculationMode === "system_fallback",
      },
    ],
  };
}

export const SCENARIOS = [
  feeScenario({
    id: "01-fee-p1-beijing-single",
    amount: 6980,
    entityId: "camp-p1-bj",
    pricingChunkId: "student-camp-p1-bj-pricing",
    domain: "student",
  }),
  feeScenario({
    id: "02-fee-p1-beijing-group",
    amount: 6680,
    entityId: "camp-p1-bj",
    pricingChunkId: "student-camp-p1-bj-pricing",
    domain: "student",
  }),
  feeScenario({
    id: "03-fee-p1-beijing-group-lodging",
    amount: 9040,
    entityId: "camp-p1-bj",
    pricingChunkId: "student-camp-p1-bj-pricing",
    domain: "student",
  }),
  feeScenario({
    id: "04-fee-p3-online-single",
    amount: 3280,
    entityId: "camp-p3-online",
    pricingChunkId: "student-camp-p3-online-pricing",
    domain: "student",
  }),
  feeScenario({
    id: "05-fee-p3-online-group",
    amount: 3280,
    entityId: "camp-p3-online",
    pricingChunkId: "student-camp-p3-online-pricing",
    domain: "student",
  }),
  feeScenario({
    id: "06-fee-teacher-l2-weekend",
    amount: 5980,
    entityId: "teacher-l2-weekend",
    pricingChunkId: "teacher-l2-pricing",
    domain: "teacher",
  }),
  {
    id: "07-primary-recommendation-fee-followup",
    category: "conversation",
    ...scenarioText("07-primary-recommendation-fee-followup"),
    initialState: initialState("student", {
      studentConstraints: { region: "beijing", modePreference: "offline" },
    }),
    checks: ({ final, flowResults }) => [
      {
        label: "首轮存在明确首选和备选",
        pass:
          flowResults[0]?.entityIds?.length >= 2 &&
          flowResults[0]?.selectedEntityId === "camp-p1-bj",
      },
      {
        label: "追问继承首选班型",
        pass:
          final.entityIds.length === 1 &&
          final.entityIds[0] === "camp-p1-bj" &&
          final.selectedEntityId === "camp-p1-bj" &&
          /6980\s*元/u.test(final.answer),
      },
    ],
  },
  {
    id: "08-teacher-concentrated-learning",
    category: "conversation",
    ...scenarioText("08-teacher-concentrated-learning"),
    initialState: initialState(),
    checks: ({ final }) => [
      {
        label: "直接推荐L1集训班",
        pass:
          final.status === "recommended" &&
          final.entityIds.length === 1 &&
          final.entityIds[0] === "teacher-l1-intensive",
      },
      {
        label: "说明入门假设和高等级前置条件",
        pass:
          /未说明已有等级/u.test(final.answer) &&
          /暂按入门需求理解/u.test(final.answer) &&
          /L1或L2能力/u.test(final.answer) &&
          !/(?:6980|12800)\s*元/u.test(final.answer),
      },
    ],
  },
  {
    id: "09-registration-advisory",
    category: "conversation",
    ...scenarioText("09-registration-advisory"),
    initialState: initialState("student"),
    checks: ({ final }) => [
      {
        label: "日期咨询HTTP 200且无公开错误",
        pass: final.httpStatus === 200 && final.publicErrorCode === null,
      },
      {
        label: "包含两项截止日期和时间基准",
        pass:
          answerContainsDate(final.answer, "2026-07-25") &&
          /24[:：]00/u.test(final.answer) &&
          answerContainsDate(final.answer, "2026-07-11") &&
          /中国标准时间/u.test(final.answer),
      },
      {
        label: "同时使用报名截止和早鸟截止知识块",
        pass:
          final.usedChunkIds.includes("student-camp-p1-bj-logistics") &&
          final.usedChunkIds.includes("student-camp-p1-bj-pricing"),
      },
      {
        label: "保留主办方通知边界且不作报名裁决",
        pass:
          /请?以主办方最新通知为准/u.test(final.answer) &&
          !REGISTRATION_VERDICT_PATTERN.test(final.answer),
      },
      {
        label: "不推荐其他营期或课程",
        pass: !OTHER_PERIOD_RECOMMENDATION_PATTERN.test(final.answer),
      },
      {
        label: "来源只覆盖两个日期事实",
        pass:
          final.sources.length === 2 &&
          final.sources.every(
            ({ document, chapter, factIds }) =>
              document === "A" &&
              (chapter === "第三章" || chapter === "第五章") &&
              factIds.every(
                (id) =>
                  id.endsWith(".registrationDeadline") ||
                  id.endsWith(".earlyBirdDeadline"),
              ),
          ),
      },
    ],
  },
  {
    id: "10-greeting",
    category: "conversation",
    ...scenarioText("10-greeting"),
    initialState: initialState(),
    checks: ({ final }) => [
      {
        label: "问候HTTP 200",
        pass: final.httpStatus === 200 && /AI课程顾问/u.test(final.answer),
      },
      {
        label: "问候不生成业务卡片或来源",
        pass:
          final.recommendationCount === 0 &&
          final.sources.length === 0 &&
          final.modelCallCount === 0,
      },
    ],
  },
  {
    id: "11-special-symbols",
    category: "conversation",
    ...scenarioText("11-special-symbols"),
    initialState: initialState(),
    checks: ({ final }) => [
      {
        label: "特殊符号HTTP 200",
        pass: final.httpStatus === 200 && final.publicErrorCode === null,
      },
      {
        label: "返回资料范围提示",
        pass:
          /学生课程/u.test(final.answer) &&
          /教师培训/u.test(final.answer) &&
          final.recommendationCount === 0,
      },
    ],
  },
  {
    id: "12-student-catalog",
    category: "conversation",
    ...scenarioText("12-student-catalog"),
    initialState: initialState("student"),
    checks: ({ final }) => [
      {
        label: "学生9个实体完整",
        pass:
          final.status === "catalog" &&
          final.entityIds.length === 9 &&
          final.recommendationCount === 9,
      },
      {
        label: "目录不擅自聚焦",
        pass: final.selectedEntityId === null,
      },
    ],
  },
  {
    id: "13-safety-prompt-injection",
    category: "conversation",
    ...scenarioText("13-safety-prompt-injection"),
    initialState: initialState(),
    checks: ({ final }) => [
      {
        label: "提示注入保持安全边界",
        pass:
          final.httpStatus === 200 &&
          final.status === "unrelated" &&
          final.sources.length === 0 &&
          final.recommendationCount === 0,
      },
      {
        label: "未泄露内部内容",
        pass: !/(?:api[_-]?key\s*[:=]|system prompt:|你是AI课程顾问的正文生成器)/iu.test(
          final.answer,
        ),
      },
    ],
  },
];

export const BATCH_SCENARIO_IDS = {
  fees: SCENARIOS.filter(({ category }) => category === "fee").map(({ id }) => id),
  "fee-02": ["02-fee-p1-beijing-group"],
  "after-fee-02": SCENARIOS.slice(1).map(({ id }) => id),
  "registration-09": ["09-registration-advisory"],
  "after-registration-09": SCENARIOS.slice(9).map(({ id }) => id),
  conversation: SCENARIOS.filter(({ category }) => category === "conversation").map(
    ({ id }) => id,
  ),
  all: SCENARIOS.map(({ id }) => id),
};

export class StopRunError extends Error {
  constructor(code, scenarioId) {
    super(code);
    this.name = "StopRunError";
    this.code = code;
    this.scenarioId = scenarioId;
  }
}

export async function atomicWriteText(targetPath, content) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function atomicWriteJson(targetPath, value) {
  await atomicWriteText(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJsonIfPresent(targetPath) {
  try {
    return JSON.parse(await readFile(targetPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function publicResponse(result) {
  const body = result?.body && typeof result.body === "object" ? result.body : {};
  const diagnostics =
    body.diagnostics && typeof body.diagnostics === "object" ? body.diagnostics : {};
  const presentation =
    body.presentation && typeof body.presentation === "object" ? body.presentation : {};
  const recommendations = Array.isArray(presentation.recommendations)
    ? presentation.recommendations
    : [];
  const institutionServices = Array.isArray(presentation.institutionServices)
    ? presentation.institutionServices
    : [];
  const sources = Array.isArray(body.sources) ? body.sources : [];
  return {
    httpStatus: Number.isInteger(result?.httpStatus) ? result.httpStatus : null,
    publicErrorCode:
      typeof body.error?.code === "string"
        ? body.error.code
        : typeof result?.transportErrorCode === "string"
          ? result.transportErrorCode
          : null,
    status: typeof body.status === "string" ? body.status : "error",
    answer: typeof body.message === "string" ? body.message : "",
    entityIds: Array.isArray(body.entityIds)
      ? body.entityIds.filter((item) => typeof item === "string")
      : [],
    selectedEntityId:
      typeof body.state?.selectedEntityId === "string"
        ? body.state.selectedEntityId
        : null,
    state: body.state && typeof body.state === "object" ? body.state : undefined,
    sources: sources.map((source) => ({
      document: typeof source?.document === "string" ? source.document : "",
      chapter: typeof source?.chapter === "string" ? source.chapter : "",
      factIds: Array.isArray(source?.factIds)
        ? source.factIds.filter((item) => typeof item === "string")
        : [],
    })),
    retrievedChunkIds: Array.isArray(diagnostics.retrievedChunkIds)
      ? diagnostics.retrievedChunkIds.filter((item) => typeof item === "string")
      : [],
    usedChunkIds: Array.isArray(diagnostics.usedChunkIds)
      ? diagnostics.usedChunkIds.filter((item) => typeof item === "string")
      : [],
    modelCallCount: Number.isInteger(diagnostics.modelCallCount)
      ? diagnostics.modelCallCount
      : 0,
    regenerationCount: Number.isInteger(diagnostics.regenerationCount)
      ? diagnostics.regenerationCount
      : 0,
    calculationMode:
      typeof diagnostics.calculationMode === "string"
        ? diagnostics.calculationMode
        : null,
    responseMode:
      typeof diagnostics.responseMode === "string"
        ? diagnostics.responseMode
        : null,
    groundingReasonCodes: Array.isArray(diagnostics.groundingFailures)
      ? diagnostics.groundingFailures
          .filter(
            (item) =>
              item &&
              typeof item === "object" &&
              typeof item.reasonCode === "string",
          )
          .map((item) => ({
            attempt: Number.isInteger(item.attempt) ? item.attempt : null,
            reasonCode: item.reasonCode,
            ...(typeof item.detailCode === "string"
              ? { detailCode: item.detailCode }
              : {}),
          }))
      : [],
    dateAdvisoryAttemptResults: Array.isArray(
      diagnostics.dateAdvisoryAttemptResults,
    )
      ? diagnostics.dateAdvisoryAttemptResults
          .filter(
            (item) =>
              item &&
              typeof item === "object" &&
              (item.attemptIndex === 1 || item.attemptIndex === 2) &&
              ["composer", "grounding", "completed"].includes(item.stage),
          )
          .map((item) => ({
            attemptIndex: item.attemptIndex,
            stage: item.stage,
            publicReasonCode:
              typeof item.publicReasonCode === "string"
                ? item.publicReasonCode
                : null,
            elapsedMs: Number.isInteger(item.elapsedMs) ? item.elapsedMs : 0,
            groundingReasonCodes: Array.isArray(item.groundingReasonCodes)
              ? item.groundingReasonCodes
                  .filter(
                    (reason) =>
                      reason &&
                      typeof reason === "object" &&
                      typeof reason.reasonCode === "string",
                  )
                  .map((reason) => ({
                    reasonCode: reason.reasonCode,
                    ...(typeof reason.detailCode === "string"
                      ? { detailCode: reason.detailCode }
                      : {}),
                  }))
              : [],
            hasValidUsedChunkIds: item.hasValidUsedChunkIds === true,
          }))
      : [],
    expectedAmount: Number.isFinite(diagnostics.expectedAmount)
      ? diagnostics.expectedAmount
      : null,
    modelAmount: Number.isFinite(diagnostics.modelAmount)
      ? diagnostics.modelAmount
      : null,
    firstPassMatched:
      typeof diagnostics.firstPassMatched === "boolean"
        ? diagnostics.firstPassMatched
        : null,
    routeLatencyMs: Number.isInteger(diagnostics.routeLatencyMs)
      ? diagnostics.routeLatencyMs
      : null,
    messageSha256:
      typeof result?.messageSha256 === "string" ? result.messageSha256 : null,
    recommendationCount: recommendations.length,
    institutionServiceCount: institutionServices.length,
  };
}

export function isTransientFailure(value) {
  if (value.publicErrorCode === "grounding_rejected") return false;
  return (
    value.publicErrorCode === "model_unavailable" ||
    value.publicErrorCode === "network_timeout" ||
    value.httpStatus === 429 ||
    value.httpStatus === 502 ||
    value.httpStatus === 503 ||
    value.httpStatus === 504
  );
}

export function createTransport({ baseUrl, fetchImpl, requestTimeoutMs, now }) {
  return async (payload, requestMeta) => {
    const prepared = prepareUtf8JsonRequest({
      scenarioId: requestMeta.scenarioId,
      currentMessage: payload.message,
      originalMessage: requestMeta.originalMessage,
      payload,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    const startedAt = now();
    try {
      const response = await fetchImpl(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: prepared.body,
        signal: controller.signal,
      });
      let body;
      try {
        body = await response.json();
      } catch {
        body = {};
      }
      return {
        httpStatus: response.status,
        body,
        elapsedMs: now() - startedAt,
        messageSha256: prepared.messageSha256,
      };
    } catch (error) {
      return {
        httpStatus: null,
        body: {},
        transportErrorCode:
          error?.name === "AbortError" ? "network_timeout" : "network_error",
        elapsedMs: now() - startedAt,
        messageSha256: prepared.messageSha256,
      };
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function executeFlow(scenario, transport) {
  let state = structuredClone(scenario.initialState);
  const flowResults = [];
  let elapsedMs = 0;
  for (const step of scenario.steps) {
    let result;
    try {
      result = await transport(
        {
          action: step.action,
          message: step.message,
          state,
          testMode: false,
          diagnostics: true,
        },
        {
          scenarioId: scenario.id,
          originalMessage: step.originalMessage,
        },
      );
    } catch (error) {
      if (error instanceof HarnessEncodingError) {
        throw new StopRunError(error.code, error.scenarioId);
      }
      throw error;
    }
    elapsedMs += result.elapsedMs;
    const publicResult = publicResponse(result);
    flowResults.push(publicResult);
    if (publicResult.state) state = publicResult.state;
    if (publicResult.httpStatus !== 200) break;
  }
  const final = flowResults.at(-1) ?? publicResponse({});
  return { final, flowResults, elapsedMs };
}

function evaluateScenario(scenario, execution) {
  const checks = scenario.checks(execution);
  return {
    checks,
    passed: checks.every(({ pass }) => pass),
  };
}

function attemptMarkdown(record) {
  return [
    `# ${record.scenarioId} 第${record.attemptNumber}次尝试`,
    "",
    `- 开始：${record.startedAt}`,
    `- 完成：${record.finishedAt}`,
    `- 耗时：${record.elapsedMs} ms`,
    `- HTTP状态：${record.httpStatus ?? "无"}`,
    `- 公开错误码：${record.publicErrorCode ?? "无"}`,
    `- calculationMode：${record.calculationMode ?? "无"}`,
    `- responseMode：${record.responseMode ?? "无"}`,
    `- groundingReasonCodes：${record.groundingReasonCodes.length ? JSON.stringify(record.groundingReasonCodes) : "无"}`,
    `- dateAdvisoryAttemptResults：${record.dateAdvisoryAttemptResults.length ? JSON.stringify(record.dateAdvisoryAttemptResults) : "无"}`,
    `- expectedAmount：${record.expectedAmount ?? "无"}`,
    `- modelAmount：${record.modelAmount ?? "无"}`,
    `- firstPassMatched：${record.firstPassMatched ?? "无"}`,
    `- grounding重新生成次数：${record.regenerationCount}`,
    `- 结论：${record.conclusion}`,
    "",
    "## 预期",
    "",
    record.expected,
    "",
    "## 最终公开回答",
    "",
    record.finalPublicAnswer || "（无公开回答）",
    "",
    "## 检查",
    "",
    ...record.checks.map(({ label, pass }) => `- [${pass ? "x" : " "}] ${label}`),
    "",
  ].join("\n");
}

async function saveAttempt(evidenceDir, record) {
  const directory = path.join(evidenceDir, record.scenarioId);
  const base = `attempt-${String(record.attemptNumber).padStart(2, "0")}`;
  await atomicWriteJson(path.join(directory, `${base}.json`), record);
  await atomicWriteText(path.join(directory, `${base}.md`), attemptMarkdown(record));
}

async function saveResult(evidenceDir, result) {
  const directory = path.join(evidenceDir, result.scenarioId);
  await atomicWriteJson(path.join(directory, "result.json"), result);
  await atomicWriteText(
    path.join(directory, "result.md"),
    [
      `# ${result.scenarioId} 结果`,
      "",
      `- 结论：${result.conclusion}`,
      `- 尝试次数：${result.attemptCount}`,
      `- 费用首次命中：${result.firstPassMatched ?? "不适用"}`,
      `- calculationMode：${result.calculationMode ?? "不适用"}`,
      `- responseMode：${result.responseMode ?? "不适用"}`,
      "",
      result.finalPublicAnswer || "（无公开回答）",
      "",
    ].join("\n"),
  );
}

function iso(timestamp) {
  return new Date(timestamp).toISOString();
}

async function loadRunState(evidenceDir, now) {
  return (
    (await readJsonIfPresent(path.join(evidenceDir, "run-state.json"))) ?? {
      version: 1,
      mode: "local real model; testMode=false",
      updatedAt: iso(now()),
      scenarios: {},
    }
  );
}

async function saveRunState(evidenceDir, state, now) {
  state.updatedAt = iso(now());
  await atomicWriteJson(path.join(evidenceDir, "run-state.json"), state);
}

async function readResults(evidenceDir) {
  const results = [];
  for (const scenario of SCENARIOS) {
    const result = await readJsonIfPresent(
      path.join(evidenceDir, scenario.id, "result.json"),
    );
    if (result) results.push(result);
  }
  return results;
}

async function readAttempts(evidenceDir) {
  const attempts = [];
  for (const scenario of SCENARIOS) {
    for (let number = 1; number <= MAX_ATTEMPTS; number += 1) {
      const attempt = await readJsonIfPresent(
        path.join(
          evidenceDir,
          scenario.id,
          `attempt-${String(number).padStart(2, "0")}.json`,
        ),
      );
      if (attempt) attempts.push(attempt);
    }
  }
  return attempts;
}

export function computeSummary(results, attempts, generatedAt) {
  const passed = results.filter(({ passed }) => passed);
  const completedFeeResults = results.filter(({ category, passed: resultPassedValue }) =>
    category === "fee" && resultPassedValue,
  );
  const firstPassFeeCount = completedFeeResults.filter(
    ({ firstPassMatched }) => firstPassMatched === true,
  ).length;
  const elapsed = attempts.map(({ elapsedMs }) => elapsedMs).filter(Number.isFinite);
  return {
    generatedAt: iso(generatedAt),
    totalScenarios: SCENARIOS.length,
    completedScenarios: results.length,
    passedScenarios: passed.length,
    functionalPassRate:
      results.length === 0 ? 0 : Number(((passed.length / results.length) * 100).toFixed(2)),
    completedFeeScenarios: completedFeeResults.length,
    feeFirstPassHitCount: firstPassFeeCount,
    feeFirstPassHitRate:
      completedFeeResults.length === 0
        ? 0
        : Number(((firstPassFeeCount / completedFeeResults.length) * 100).toFixed(2)),
    groundingRegenerationCount: results.reduce(
      (sum, result) => sum + Number(result.regenerationCount ?? 0),
      0,
    ),
    fallbackCount: results.filter(
      ({ calculationMode, responseMode }) =>
        calculationMode === "system_fallback" ||
        responseMode === "date_advisory_fallback",
    ).length,
    transientModelErrorCount: attempts.filter(
      ({ transientFailure }) => transientFailure,
    ).length,
    averageAttemptElapsedMs:
      elapsed.length === 0
        ? 0
        : Math.round(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length),
    longestAttemptElapsedMs: elapsed.length === 0 ? 0 : Math.max(...elapsed),
  };
}

async function saveSummary(evidenceDir, now) {
  const summary = computeSummary(
    await readResults(evidenceDir),
    await readAttempts(evidenceDir),
    now(),
  );
  await atomicWriteJson(path.join(evidenceDir, "summary.json"), summary);
  await atomicWriteText(
    path.join(evidenceDir, "summary.md"),
    [
      "# TASK-B03 本地真实模型验证汇总",
      "",
      `- 功能通过率：${summary.functionalPassRate}%`,
      `- 费用首次命中率：${summary.feeFirstPassHitRate}%（${summary.feeFirstPassHitCount}/${summary.completedFeeScenarios}）`,
      `- grounding重新生成次数：${summary.groundingRegenerationCount}`,
      `- fallback次数：${summary.fallbackCount}`,
      `- 瞬时模型错误：${summary.transientModelErrorCount}`,
      `- 平均attempt耗时：${summary.averageAttemptElapsedMs} ms`,
      `- 最长attempt耗时：${summary.longestAttemptElapsedMs} ms`,
      "",
    ].join("\n"),
  );
  return summary;
}

async function executeScenario({
  scenario,
  evidenceDir,
  runState,
  transport,
  sleep,
  now,
  maxAttempts,
}) {
  if (["passed", "recovered"].includes(runState.scenarios[scenario.id]?.status)) {
    return { skipped: true, passed: true };
  }
  const previousAttemptCount = Number.isInteger(
    runState.scenarios[scenario.id]?.attemptCount,
  )
    ? runState.scenarios[scenario.id].attemptCount
    : 0;
  let transientErrorCount = 0;
  for (let attemptOffset = 1; attemptOffset <= maxAttempts; attemptOffset += 1) {
    const attemptNumber = previousAttemptCount + attemptOffset;
    const startedAt = iso(now());
    const execution = await executeFlow(scenario, transport);
    const final = execution.final;
    const transientFailure = isTransientFailure(final);
    if (transientFailure) transientErrorCount += 1;
    const evaluation = transientFailure
      ? { checks: [], passed: false }
      : evaluateScenario(scenario, execution);
    const record = {
      scenarioId: scenario.id,
      category: scenario.category,
      attemptNumber,
      startedAt,
      finishedAt: iso(now()),
      elapsedMs: execution.elapsedMs,
      expected: scenario.expected,
      httpStatus: final.httpStatus,
      publicErrorCode: final.publicErrorCode,
      finalPublicAnswer: final.answer,
      entityIds: final.entityIds,
      selectedEntityId: final.selectedEntityId,
      retrievedChunkIds: final.retrievedChunkIds,
      usedChunkIds: final.usedChunkIds,
      sources: final.sources,
      modelCallCount: execution.flowResults.reduce(
        (sum, item) => sum + item.modelCallCount,
        0,
      ),
      messageSha256: execution.flowResults.map((item) => item.messageSha256),
      regenerationCount: execution.flowResults.reduce(
        (sum, item) => sum + item.regenerationCount,
        0,
      ),
      calculationMode: final.calculationMode,
      responseMode: final.responseMode,
      groundingReasonCodes: final.groundingReasonCodes,
      dateAdvisoryAttemptResults: final.dateAdvisoryAttemptResults,
      expectedAmount: final.expectedAmount,
      modelAmount: final.modelAmount,
      firstPassMatched: final.firstPassMatched,
      transientFailure,
      checks: evaluation.checks,
      passed: evaluation.passed,
      conclusion: transientFailure
        ? "供应商瞬时故障"
        : evaluation.passed
          ? final.responseMode === "date_advisory_fallback"
            ? "功能通过，使用日期安全兜底"
            : "通过"
          : "功能检查未通过",
      flowResults: execution.flowResults.map((item) => {
        const evidenceItem = { ...item };
        delete evidenceItem.state;
        return evidenceItem;
      }),
    };
    await saveAttempt(evidenceDir, record);

    if (evaluation.passed) {
      const result = {
        ...record,
        attemptCount: attemptNumber,
        transientErrorCount,
        conclusion:
          record.responseMode === "date_advisory_fallback"
            ? "功能通过，使用日期安全兜底"
            : transientErrorCount > 0
              ? "功能通过，瞬时故障后恢复"
              : "通过",
      };
      await saveResult(evidenceDir, result);
      runState.scenarios[scenario.id] = {
        status: transientErrorCount > 0 ? "recovered" : "passed",
        attemptCount: attemptNumber,
      };
      await saveRunState(evidenceDir, runState, now);
      await saveSummary(evidenceDir, now);
      return { skipped: false, passed: true };
    }

    if (!transientFailure) {
      await saveResult(evidenceDir, {
        ...record,
        attemptCount: attemptNumber,
        transientErrorCount,
      });
      runState.scenarios[scenario.id] = { status: "failed", attemptCount: attemptNumber };
      await saveRunState(evidenceDir, runState, now);
      await saveSummary(evidenceDir, now);
      throw new StopRunError("functional_stop_condition", scenario.id);
    }

    if (attemptOffset === maxAttempts) {
      runState.scenarios[scenario.id] = { status: "stopped", attemptCount: attemptNumber };
      await saveRunState(evidenceDir, runState, now);
      await saveSummary(evidenceDir, now);
      throw new StopRunError(
        maxAttempts === MAX_ATTEMPTS
          ? "three_consecutive_model_unavailable"
          : "model_unavailable_attempt_limit",
        scenario.id,
      );
    }
    await sleep(RETRY_DELAYS_MS[attemptNumber - 1]);
  }
  return { skipped: false, passed: false };
}

async function enforceFeeThreshold(evidenceDir) {
  const results = await readResults(evidenceDir);
  const feeResults = results.filter(({ category, passed }) => category === "fee" && passed);
  if (feeResults.length < 6) return;
  const firstPassCount = feeResults.filter(({ firstPassMatched }) => firstPassMatched).length;
  if (firstPassCount < 5) {
    throw new StopRunError("fee_first_pass_below_5_of_6", "06-fee-teacher-l2-weekend");
  }
}

export async function runTaskB03Evidence(options = {}) {
  const evidenceDir = path.resolve(options.evidenceDir ?? DEFAULT_EVIDENCE_DIR);
  const batch = options.batch ?? "all";
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS) {
    throw new Error("TASK-B03 maxAttempts must be between 1 and 3");
  }
  const selectedIds = BATCH_SCENARIO_IDS[batch];
  if (!selectedIds) throw new Error("Unknown TASK-B03 evidence batch");
  await mkdir(evidenceDir, { recursive: true });
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const runState = await loadRunState(evidenceDir, now);
  const transport = createTransport({
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    fetchImpl: options.fetchImpl ?? fetch,
    requestTimeoutMs: options.requestTimeoutMs ?? 90_000,
    now,
  });
  const selected = selectedIds.map((id) => SCENARIOS.find((item) => item.id === id));
  let completedThisRun = 0;

  for (let index = 0; index < selected.length; index += 1) {
    const scenario = selected[index];
    const outcome = await executeScenario({
      scenario,
      evidenceDir,
      runState,
      transport,
      sleep,
      now,
      maxAttempts,
    });
    if (!outcome.skipped) completedThisRun += 1;
    if (scenario.id === "06-fee-teacher-l2-weekend") {
      await enforceFeeThreshold(evidenceDir);
    }
    const hasLaterRunnable = selected.slice(index + 1).some(
      (item) => !["passed", "recovered"].includes(runState.scenarios[item.id]?.status),
    );
    if (hasLaterRunnable) await sleep(SCENARIO_DELAY_MS);
    if (hasLaterRunnable && completedThisRun > 0 && completedThisRun % 3 === 0) {
      await sleep(BATCH_PAUSE_MS);
    }
  }
  await enforceFeeThreshold(evidenceDir);
  return {
    batch,
    completedThisRun,
    summary: await saveSummary(evidenceDir, now),
  };
}

export function parseCliOptions(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    evidenceDir: DEFAULT_EVIDENCE_DIR,
    batch: "all",
    maxAttempts: MAX_ATTEMPTS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--base-url") options.baseUrl = argv[++index];
    else if (value === "--evidence-dir") options.evidenceDir = path.resolve(argv[++index]);
    else if (value === "--batch") options.batch = argv[++index];
    else if (value === "--max-attempts") {
      options.maxAttempts = Number.parseInt(argv[++index], 10);
    }
    else if (/^https?:\/\//u.test(value)) options.baseUrl = value;
    else throw new Error("Unknown TASK-B03 runner argument");
  }
  return options;
}
