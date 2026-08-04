import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
export const DEFAULT_EVIDENCE_DIR = path.resolve("test-evidence/task-b02");
export const SCENARIO_DELAY_MS = 8_000;
export const BATCH_PAUSE_MS = 30_000;
export const RETRY_DELAYS_MS = [10_000, 30_000];
export const MAX_ATTEMPTS = 3;

const SOURCE_TITLES = {
  A: "2026暑期AI素养夏令营课程手册",
  B: "初高中教师AI素养培训体系介绍",
  C: "OPC超级个体赋能平台产品白皮书",
};

const SUPERSEDED_SCENARIOS = {
  "04-teacher-device": {
    replacementId: "04-teacher-device-context",
    reason:
      "原运行器未先建立教师身份上下文，证据保留但不计入正式统计。",
  },
};

function answerBody(message) {
  return String(message ?? "").split("\n\n来源：", 1)[0].trim();
}

function includesAll(text, values) {
  return values.every((value) => text.includes(value));
}

function overlap(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function levenshtein(left, right) {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function sourceLabel(source) {
  if (!source || typeof source !== "object") return "";
  const document = String(source.document ?? "");
  const title = SOURCE_TITLES[document] ?? "公开资料";
  const chapter =
    typeof source.chapter === "string" ? source.chapter : "";
  const section =
    typeof source.section === "string" && source.section
      ? "（" + source.section + "）"
      : "";
  return "素材" + document + "《" + title + "》" + chapter + section;
}

function studentContextFlow(finalMessage, extraMessages = []) {
  return {
    label: "student-current-entity",
    steps: [
      {
        stage: "establish_student_context",
        message: "家长，北京，可参加第一期，希望线下",
      },
      ...extraMessages.map((message, index) => ({
        stage: "student_followup_" + String(index + 1),
        message,
      })),
      { stage: "target_question", message: finalMessage },
    ],
  };
}

function teacherRecommendationFlow(message, label) {
  return {
    label,
    steps: [
      {
        stage: "select_teacher_domain",
        action: "select_domain",
        domain: "teacher",
      },
      { stage: "target_question", message },
    ],
  };
}

function isolatedFlow(message, label = "isolated") {
  return {
    label,
    steps: [{ stage: "target_question", message }],
  };
}

function onlySource(document) {
  return (result) =>
    result.sources.length > 0 &&
    result.sourceDocuments.every((item) => item === document);
}

export const SCENARIOS = [
  {
    id: "01-student-day-five",
    batch: "knowledge",
    input: "选定第一期北京线下班后：第五天学什么？",
    expected: "回答第五天的智能体课程，并使用学生课程知识块和素材A来源。",
    flows: [studentContextFlow("第五天学什么？")],
    checks: (result) => [
      {
        label: "正文说明第五天学习智能体相关内容",
        pass:
          /第五天|第5天/u.test(result.answer) &&
          /智能体|Agent/iu.test(result.answer),
      },
      {
        label: "使用七天课程安排知识块",
        pass: result.usedChunkIds.includes("student-camp-daily-outline"),
      },
      { label: "来源只属于素材A", pass: onlySource("A")(result) },
      {
        label: "真实composer被调用",
        pass: result.modelCallCount >= 1,
      },
    ],
  },
  {
    id: "02-student-preparation-followup",
    batch: "knowledge",
    input: "选定第一期北京线下班并询问第五天后：需要准备什么？",
    expected: "继承当前学生班型，说明电脑、充电器等准备事项。",
    flows: [studentContextFlow("需要准备什么？", ["第五天学什么？"])],
    checks: (result) => [
      {
        label: "正文包含笔记本电脑",
        pass: /笔记本电脑|电脑/u.test(result.answer),
      },
      {
        label: "检索学生准备事项知识块",
        pass: result.retrievedChunkIds.includes(
          "student-camp-required-items",
        ),
      },
      {
        label: "保持第一期北京线下实体",
        pass: result.entityIds.includes("camp-p1-bj"),
      },
      { label: "来源只属于素材A", pass: onlySource("A")(result) },
    ],
  },
  {
    id: "03-teacher-l2-weekend-schedule",
    batch: "knowledge",
    input: "L2周末研修班哪几天上课？",
    expected: "给出8月8日、8月9日和8月15日，不混用其他班型。",
    flows: [isolatedFlow("L2周末研修班哪几天上课？")],
    checks: (result) => [
      {
        label: "包含三天课程日期",
        pass: includesAll(result.answer, ["8月8日", "8月9日", "8月15日"]),
      },
      {
        label: "实体为L2周末研修班",
        pass:
          result.entityIds.length === 1 &&
          result.entityIds[0] === "teacher-l2-weekend",
      },
      { label: "来源只属于素材B", pass: onlySource("B")(result) },
    ],
  },
  {
    id: "04-teacher-device-context",
    batch: "knowledge",
    input: "教师参加培训需要带电脑吗？",
    expected: "明确必须携带笔记本电脑并说明基本设备要求。",
    flows: [
      teacherRecommendationFlow(
        "教师参加培训需要带电脑吗？",
        "teacher-device-context",
      ),
    ],
    checks: (result) => [
      {
        label: "明确需要或必须携带电脑",
        pass:
          /(?:必须|需要).{0,8}(?:携带|带).{0,8}(?:笔记本电脑|电脑)|(?:笔记本电脑|电脑).{0,8}(?:必须|需要).{0,8}(?:携带|带)/u.test(
            result.answer,
          ),
      },
      {
        label: "使用教师设备知识块",
        pass: result.usedChunkIds.includes("teacher-device-and-replay"),
      },
      { label: "来源只属于素材B", pass: onlySource("B")(result) },
    ],
  },
  {
    id: "05-school-procurement-pricing",
    batch: "knowledge",
    input: "学校采购20人的教师培训怎么收费？",
    expected: "说明20人起、项目总价5万元起，不混用个人课程价格。",
    flows: [isolatedFlow("学校采购20人的教师培训怎么收费？")],
    checks: (result) => [
      {
        label: "包含20人起和5万元起",
        pass:
          /20\s*人\s*起/u.test(result.answer) &&
          /[5五]\s*万元\s*起/u.test(result.answer),
      },
      {
        label: "不含个人课程价格",
        pass: !/(?:2980|3980|6980|12800)\s*元?/u.test(result.answer),
      },
      {
        label: "实体为学校采购",
        pass: result.entityIds.includes("platform-school-procurement"),
      },
      {
        label: "真实composer被调用",
        pass: result.modelCallCount >= 1,
      },
    ],
  },
  {
    id: "06-membership-price-unavailable",
    batch: "knowledge",
    input: "专业会员是不是6980元？",
    expected: "说明会员价格未提供，正文不得出现教师L2价格6980元。",
    flows: [isolatedFlow("专业会员是不是6980元？")],
    checks: (result) => [
      {
        label: "明确会员售价未提供",
        pass:
          /会员.*(?:售价|价格).*未提供|未提供.*会员.*(?:售价|价格)/u.test(
            result.answer,
          ),
      },
      {
        label: "未把6980元表述为教师L2课程价格示例",
        pass:
          !/(?:教师\s*)?L2.{0,16}6980\s*元|6980\s*元.{0,16}(?:教师\s*)?L2/iu.test(
            answerBody(result.answer),
          ),
      },
      { label: "来源只属于素材C", pass: onlySource("C")(result) },
    ],
  },
  {
    id: "07-live-availability-unavailable",
    batch: "outside",
    input: "选定第一期北京线下班后：现在还有多少余位？",
    expected: "明确现有资料未提供实时余位，不推断剩余名额。",
    flows: [studentContextFlow("现在还有多少余位？")],
    checks: (result) => [
      {
        label: "明确资料未提供实时余位",
        pass:
          /资料.*未提供.*(?:实时)?余位|(?:实时)?余位.*未提供/u.test(
            result.answer,
          ),
      },
      {
        label: "未编造剩余名额",
        pass: !/剩余\s*\d+\s*(?:人|个|位)/u.test(result.answer),
      },
      {
        label: "使用余位边界知识块",
        pass: result.usedChunkIds.includes(
          "student-camp-availability-unknown",
        ),
      },
    ],
  },
  {
    id: "08-contact-unavailable",
    batch: "outside",
    input: "报名联系电话是多少？",
    expected: "明确资料未提供联系电话，不编造联系方式。",
    flows: [isolatedFlow("报名联系电话是多少？")],
    checks: (result) => [
      {
        label: "明确联系电话未提供",
        pass:
          /资料.*未提供.*(?:电话|联系方式)|(?:电话|联系方式).*未提供/u.test(
            result.answer,
          ),
      },
      {
        label: "无编造手机号",
        pass: !/1[3-9]\d{9}/u.test(result.answer),
      },
      {
        label: "不注入无关知识块或来源",
        pass:
          result.retrievedChunkIds.length === 0 &&
          result.sources.length === 0,
      },
    ],
  },
  {
    id: "09-extra-discount-unavailable",
    batch: "outside",
    input: "是否还能获得额外优惠？",
    expected: "明确资料未提供额外优惠，不承诺新折扣。",
    flows: [isolatedFlow("是否还能获得额外优惠？")],
    checks: (result) => [
      {
        label: "明确额外优惠未提供",
        pass:
          /资料.*未提供.*额外优惠|额外优惠.*未提供/u.test(result.answer),
      },
      {
        label: "不注入无关知识块或来源",
        pass:
          result.retrievedChunkIds.length === 0 &&
          result.sources.length === 0,
      },
    ],
  },
  {
    id: "10-provider-comparison-unavailable",
    batch: "outside",
    input: "与其他培训机构相比哪家更好？",
    expected: "明确资料未提供机构比较信息，不编造排名或结论。",
    flows: [isolatedFlow("与其他培训机构相比哪家更好？")],
    checks: (result) => [
      {
        label: "明确比较资料未提供",
        pass:
          /资料.*未提供.*(?:比较|其他培训机构|可比信息)/u.test(
            result.answer,
          ),
      },
      {
        label: "不声称任何机构最好",
        pass: !/(?:我们|本机构).{0,6}(?:最好|第一|领先)/u.test(
          result.answer,
        ),
      },
      {
        label: "不注入无关知识块或来源",
        pass:
          result.retrievedChunkIds.length === 0 &&
          result.sources.length === 0,
      },
    ],
  },
  {
    id: "11-dynamic-teacher-paraphrases",
    batch: "dynamic",
    input:
      "我是零基础教师，工作日不能脱岗，想系统学习AI。 / 我刚开始接触AI，平日走不开，周末可以上课。",
    expected:
      "推荐一致、关键chunk重合、正文表达明显不同，且两次均真实调用composer。",
    flows: [
      teacherRecommendationFlow(
        "我是零基础教师，工作日不能脱岗，想系统学习AI。",
        "teacher-paraphrase-a",
      ),
      teacherRecommendationFlow(
        "我刚开始接触AI，平日走不开，周末可以上课。",
        "teacher-paraphrase-b",
      ),
    ],
    checks: (result) => {
      const first = result.flowResults[0];
      const second = result.flowResults[1];
      const firstBody = answerBody(first?.answer);
      const secondBody = answerBody(second?.answer);
      const maxLength = Math.max(firstBody.length, secondBody.length, 1);
      const similarity =
        1 - levenshtein(firstBody, secondBody) / maxLength;
      return [
        {
          label: "两次推荐结果均为L1周末研修班",
          pass:
            first?.entityIds?.length === 1 &&
            second?.entityIds?.length === 1 &&
            first.entityIds[0] === "teacher-l1-weekend" &&
            second.entityIds[0] === "teacher-l1-weekend",
        },
        {
          label: "关键知识块一致或合理重合",
          pass:
            overlap(
              first?.usedChunkIds ?? [],
              second?.usedChunkIds ?? [],
            ).length >= 3,
        },
        {
          label: "两次正文组织和措辞有明显差异",
          pass:
            firstBody !== secondBody &&
            Number.isFinite(similarity) &&
            similarity < 0.9,
        },
        {
          label: "两次均有真实composer调用",
          pass:
            (first?.modelCallCount ?? 0) >= 1 &&
            (second?.modelCallCount ?? 0) >= 1,
        },
      ];
    },
  },
];

export const BATCH_SCENARIO_IDS = {
  smoke: [
    "01-student-day-five",
    "06-membership-price-unavailable",
    "07-live-availability-unavailable",
  ],
  knowledge: SCENARIOS.filter((item) => item.batch === "knowledge").map(
    (item) => item.id,
  ),
  outside: SCENARIOS.filter((item) => item.batch === "outside").map(
    (item) => item.id,
  ),
  dynamic: SCENARIOS.filter((item) => item.batch === "dynamic").map(
    (item) => item.id,
  ),
  all: SCENARIOS.map((item) => item.id),
};

export async function atomicWriteText(targetPath, content) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath =
    targetPath +
    ".tmp-" +
    String(process.pid) +
    "-" +
    randomUUID();
  try {
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function atomicWriteJson(targetPath, value) {
  await atomicWriteText(
    targetPath,
    JSON.stringify(value, null, 2) + "\n",
  );
}

async function readJsonIfPresent(targetPath) {
  try {
    return JSON.parse(await readFile(targetPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function nowIso(now) {
  return new Date(now()).toISOString();
}

function emptyRunState(now) {
  return {
    version: 1,
    mode: "local real model; testMode=false",
    updatedAt: nowIso(now),
    scenarios: {},
  };
}

async function loadRunState(evidenceDir, now) {
  const state =
    (await readJsonIfPresent(path.join(evidenceDir, "run-state.json"))) ??
    emptyRunState(now);
  if (
    state.version !== 1 ||
    !state.scenarios ||
    typeof state.scenarios !== "object"
  ) {
    throw new Error("Invalid TASK-B02 run-state.json");
  }
  return state;
}

async function saveRunState(evidenceDir, state, now) {
  state.updatedAt = nowIso(now);
  await atomicWriteJson(path.join(evidenceDir, "run-state.json"), state);
}

function publicResponse(result) {
  const body =
    result?.body && typeof result.body === "object" ? result.body : {};
  const diagnostics =
    body.diagnostics && typeof body.diagnostics === "object"
      ? body.diagnostics
      : {};
  const sources = Array.isArray(body.sources) ? body.sources : [];
  return {
    httpStatus: Number.isInteger(result?.httpStatus)
      ? result.httpStatus
      : null,
    publicErrorCode:
      typeof body.error?.code === "string"
        ? body.error.code
        : typeof result?.transportErrorCode === "string"
          ? result.transportErrorCode
          : null,
    status: typeof body.status === "string" ? body.status : "error",
    answer: typeof body.message === "string" ? body.message : "",
    retrievedChunkIds: Array.isArray(diagnostics.retrievedChunkIds)
      ? diagnostics.retrievedChunkIds.filter(
          (item) => typeof item === "string",
        )
      : [],
    usedChunkIds: Array.isArray(diagnostics.usedChunkIds)
      ? diagnostics.usedChunkIds.filter((item) => typeof item === "string")
      : [],
    sources: sources.map(sourceLabel).filter(Boolean),
    sourceDocuments: sources
      .map((source) => source?.document)
      .filter((item) => typeof item === "string"),
    entityIds: Array.isArray(body.entityIds)
      ? body.entityIds.filter((item) => typeof item === "string")
      : [],
    modelCallCount: Number.isInteger(diagnostics.modelCallCount)
      ? diagnostics.modelCallCount
      : 0,
    regenerationCount: Number.isInteger(diagnostics.regenerationCount)
      ? diagnostics.regenerationCount
      : 0,
    routeLatencyMs: Number.isInteger(diagnostics.routeLatencyMs)
      ? diagnostics.routeLatencyMs
      : null,
  };
}

export function isTransientFailure(value) {
  return (
    value.publicErrorCode === "model_unavailable" ||
    value.publicErrorCode === "network_timeout" ||
    value.httpStatus === 429 ||
    value.httpStatus === 502 ||
    value.httpStatus === 503 ||
    value.httpStatus === 504
  );
}

function attemptFileName(attemptNumber, extension) {
  return (
    "attempt-" +
    String(attemptNumber).padStart(2, "0") +
    "." +
    extension
  );
}

function attemptMarkdown(record) {
  const checks = record.actual?.checks ?? [];
  const stages = record.requestStages ?? [];
  return [
    "# " + record.scenarioId + " 第" + record.attemptNumber + "次尝试",
    "",
    "- 开始：" + record.startedAt,
    "- 完成：" + record.finishedAt,
    "- 耗时：" + record.elapsedMs + " ms",
    "- HTTP状态：" + String(record.httpStatus ?? "无"),
    "- 公开错误码：" + String(record.publicErrorCode ?? "无"),
    "- 检索chunk ID：" +
      (record.retrievedChunkIds.join("、") || "无"),
    "- usedChunkIds：" + (record.usedChunkIds.join("、") || "无"),
    "- 来源：" + (record.sources.join("；") || "无"),
    "- 模型调用次数：" + record.modelCallCount,
    "- grounding重新生成次数：" + record.regenerationCount,
    "- 结论：" + record.conclusion,
    "",
    "## 预期",
    "",
    record.expected,
    "",
    "## 最终公开回答",
    "",
    record.finalPublicAnswer || "（无公开回答）",
    "",
    "## 请求阶段",
    "",
    ...stages.map(
      (stage) =>
        "- " +
        stage.stage +
        "：" +
        String(stage.httpStatus ?? "无") +
        " / " +
        String(stage.publicErrorCode ?? "无") +
        " / " +
        stage.elapsedMs +
        " ms",
    ),
    "",
    "## 校验",
    "",
    ...(checks.length
      ? checks.map(
          (check) =>
            "- " + (check.pass ? "通过" : "失败") + "：" + check.label,
        )
      : ["- 尚未完成"]),
    "",
  ].join("\n");
}

async function saveAttempt(evidenceDir, record) {
  const directory = path.join(evidenceDir, record.scenarioId);
  await Promise.all([
    atomicWriteJson(
      path.join(
        directory,
        attemptFileName(record.attemptNumber, "json"),
      ),
      record,
    ),
    atomicWriteText(
      path.join(
        directory,
        attemptFileName(record.attemptNumber, "md"),
      ),
      attemptMarkdown(record),
    ),
  ]);
}

function resultMarkdown(record) {
  return [
    "# " + record.scenarioId + " 最终结果",
    "",
    "- 尝试次数：" + record.attemptCount,
    "- 首次请求成功：" + (record.firstAttemptPassed ? "是" : "否"),
    "- 瞬时错误次数：" + record.transientErrorCount,
    "- 重试后恢复：" + (record.recoveredAfterTransientFailure ? "是" : "否"),
    "- grounding重新生成次数：" + record.regenerationCount,
    "- 程序兜底次数：" + record.programFallbackCount,
    "- 结论：" + record.conclusion,
    "",
    "## 最终公开回答",
    "",
    record.finalPublicAnswer || "（无公开回答）",
    "",
    "## 校验",
    "",
    ...(record.actual?.checks ?? []).map(
      (check) =>
        "- " + (check.pass ? "通过" : "失败") + "：" + check.label,
    ),
    "",
  ].join("\n");
}

async function saveResult(evidenceDir, record) {
  const directory = path.join(evidenceDir, record.scenarioId);
  await Promise.all([
    atomicWriteJson(path.join(directory, "result.json"), record),
    atomicWriteText(
      path.join(directory, "result.md"),
      resultMarkdown(record),
    ),
  ]);
}

function stageRecord(stage, elapsedMs, response) {
  return {
    stage,
    elapsedMs,
    httpStatus: response.httpStatus,
    publicErrorCode: response.publicErrorCode,
    modelCallCount: response.modelCallCount,
    regenerationCount: response.regenerationCount,
    routeLatencyMs: response.routeLatencyMs,
  };
}

function aggregateFlowResults(flowResults) {
  const last =
    flowResults.flatMap((flow) => flow.responses).at(-1) ??
    publicResponse(undefined);
  return {
    ...last,
    flowResults: flowResults.map((flow) => {
      const response =
        flow.responses.at(-1) ?? publicResponse(undefined);
      return {
        label: flow.label,
        answer: response.answer,
        retrievedChunkIds: response.retrievedChunkIds,
        usedChunkIds: response.usedChunkIds,
        sources: response.sources,
        sourceDocuments: response.sourceDocuments,
        entityIds: response.entityIds,
        modelCallCount: flow.responses.reduce(
          (sum, item) => sum + item.modelCallCount,
          0,
        ),
        regenerationCount: flow.responses.reduce(
          (sum, item) => sum + item.regenerationCount,
          0,
        ),
      };
    }),
    modelCallCount: flowResults
      .flatMap((flow) => flow.responses)
      .reduce((sum, item) => sum + item.modelCallCount, 0),
    regenerationCount: flowResults
      .flatMap((flow) => flow.responses)
      .reduce((sum, item) => sum + item.regenerationCount, 0),
  };
}

function genericChecks(result) {
  const retrieved = new Set(result.retrievedChunkIds);
  const usedAreInjected = result.usedChunkIds.every((id) =>
    retrieved.has(id),
  );
  const sourceShapeValid =
    result.usedChunkIds.length === 0 ||
    (result.sources.length > 0 && result.answer.includes("\n\n来源："));
  return [
    {
      label: "usedChunkIds全部来自本轮retrievedChunkIds",
      pass: usedAreInjected,
    },
    {
      label: "来源由程序追加且与usedChunkIds对应",
      pass: sourceShapeValid,
    },
  ];
}

function publicErrorBody(code, message) {
  return {
    status: "error",
    message,
    error: { code, retryable: code === "network_timeout" },
  };
}

async function fetchJson({
  fetchImpl,
  url,
  init,
  requestTimeoutMs,
  now,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const started = now();
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = publicErrorBody(
        "invalid_json_response",
        "本地验证接口未返回有效JSON。",
      );
    }
    return {
      elapsedMs: Math.max(0, now() - started),
      httpStatus: response.status,
      body,
    };
  } catch (error) {
    const timedOut =
      controller.signal.aborted || error?.name === "AbortError";
    return {
      elapsedMs: Math.max(0, now() - started),
      httpStatus: null,
      transportErrorCode: timedOut ? "network_timeout" : "network_error",
      body: publicErrorBody(
        timedOut ? "network_timeout" : "network_error",
        timedOut
          ? "本地验证请求超时。"
          : "本地验证请求失败。",
      ),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function createTransport(options) {
  const baseUrl = options.baseUrl.replace(/\/+$/u, "");
  let requestSequence = 0;
  return {
    async createSession() {
      return fetchJson({
        fetchImpl: options.fetchImpl,
        url: baseUrl + "/api/history/sessions",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
        },
        requestTimeoutMs: options.requestTimeoutMs,
        now: options.now,
      });
    },
    async chat({ sessionId, step, state }) {
      requestSequence += 1;
      return fetchJson({
        fetchImpl: options.fetchImpl,
        url: baseUrl + "/api/chat",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            action: step.action ?? "message",
            ...(step.message ? { message: step.message } : {}),
            ...(step.domain ? { domain: step.domain } : {}),
            ...(state ? { state } : {}),
            sessionId,
            clientRequestId:
              "task-b02e-" +
              String(requestSequence) +
              "-" +
              randomUUID(),
            diagnostics: true,
            testMode: false,
          }),
        },
        requestTimeoutMs: options.requestTimeoutMs,
        now: options.now,
      });
    },
  };
}

async function executeAttempt({
  scenario,
  attemptNumber,
  evidenceDir,
  transport,
  now,
}) {
  const startedMs = now();
  const startedAt = nowIso(() => startedMs);
  const requestStages = [];
  const flowResults = [];
  let latest = publicResponse(undefined);
  const saveProgress = async (conclusion) => {
    const finishedMs = now();
    await saveAttempt(evidenceDir, {
      scenarioId: scenario.id,
      attemptNumber,
      startedAt,
      finishedAt: nowIso(() => finishedMs),
      elapsedMs: Math.max(0, finishedMs - startedMs),
      httpStatus: latest.httpStatus,
      publicErrorCode: latest.publicErrorCode,
      finalPublicAnswer: latest.answer,
      retrievedChunkIds: latest.retrievedChunkIds,
      usedChunkIds: latest.usedChunkIds,
      sources: latest.sources,
      modelCallCount: flowResults
        .flatMap((flow) => flow.responses)
        .reduce((sum, item) => sum + item.modelCallCount, 0),
      regenerationCount: flowResults
        .flatMap((flow) => flow.responses)
        .reduce((sum, item) => sum + item.regenerationCount, 0),
      expected: scenario.expected,
      actual: { checks: [] },
      conclusion,
      requestStages,
      transientFailure: isTransientFailure(latest),
    });
  };

  for (const flow of scenario.flows) {
    const flowResult = { label: flow.label, responses: [] };
    flowResults.push(flowResult);
    const sessionResult = await transport.createSession();
    const sessionResponse = publicResponse(sessionResult);
    latest = sessionResponse;
    requestStages.push(
      stageRecord(
        flow.label + ":create_session",
        sessionResult.elapsedMs,
        sessionResponse,
      ),
    );
    await saveProgress("进行中");
    const sessionId = sessionResult.body?.session?.id;
    if (
      sessionResult.httpStatus !== 201 ||
      typeof sessionId !== "string"
    ) {
      return {
        complete: false,
        result: aggregateFlowResults(flowResults),
        requestStages,
        startedAt,
        startedMs,
      };
    }

    let state;
    for (const step of flow.steps) {
      const chatResult = await transport.chat({
        sessionId,
        step,
        state,
      });
      const response = publicResponse(chatResult);
      latest = response;
      flowResult.responses.push(response);
      requestStages.push(
        stageRecord(
          flow.label + ":" + step.stage,
          chatResult.elapsedMs,
          response,
        ),
      );
      if (chatResult.body?.state) state = chatResult.body.state;
      await saveProgress("进行中");
      if (
        chatResult.httpStatus !== 200 ||
        response.publicErrorCode !== null
      ) {
        return {
          complete: false,
          result: aggregateFlowResults(flowResults),
          requestStages,
          startedAt,
          startedMs,
        };
      }
    }
  }

  return {
    complete: true,
    result: aggregateFlowResults(flowResults),
    requestStages,
    startedAt,
    startedMs,
  };
}

function attemptRecordFromExecution({
  scenario,
  attemptNumber,
  execution,
  now,
}) {
  const finishedMs = now();
  const result = execution.result;
  const checks = execution.complete
    ? [...genericChecks(result), ...scenario.checks(result)].map(
        ({ label, pass }) => ({ label, pass: Boolean(pass) }),
      )
    : [];
  const passed =
    execution.complete &&
    result.httpStatus === 200 &&
    result.publicErrorCode === null &&
    checks.every((item) => item.pass);
  const transientFailure =
    !passed && isTransientFailure(result);
  return {
    scenarioId: scenario.id,
    attemptNumber,
    startedAt: execution.startedAt,
    finishedAt: nowIso(() => finishedMs),
    elapsedMs: Math.max(0, finishedMs - execution.startedMs),
    httpStatus: result.httpStatus,
    publicErrorCode: result.publicErrorCode,
    finalPublicAnswer: result.answer,
    retrievedChunkIds: result.retrievedChunkIds,
    usedChunkIds: result.usedChunkIds,
    sources: result.sources,
    modelCallCount: result.modelCallCount,
    regenerationCount: result.regenerationCount,
    expected: scenario.expected,
    actual: {
      status: result.status,
      entityIds: result.entityIds,
      flowResults: result.flowResults,
      checks,
    },
    conclusion: passed
      ? "通过"
      : transientFailure
        ? "供应商瞬时故障"
        : "失败",
    requestStages: execution.requestStages,
    transientFailure,
    passed,
    programFallbackCount:
      result.status === "error" &&
      ["grounding_rejected", "model_unavailable"].includes(
        String(result.publicErrorCode),
      )
        ? 1
        : 0,
  };
}

function resultRecord({
  attempt,
  attemptCount,
  transientErrorCount,
  recovered,
}) {
  return {
    ...attempt,
    attemptCount,
    firstAttemptPassed: attemptCount === 1 && attempt.passed,
    transientErrorCount,
    recoveredAfterTransientFailure: recovered,
    conclusion: attempt.passed
      ? recovered
        ? "功能通过，发生供应商瞬时故障后恢复"
        : "通过"
      : attempt.transientFailure && attemptCount >= MAX_ATTEMPTS
        ? "连续三次瞬时错误，停止"
        : "失败",
  };
}

async function loadResults(evidenceDir) {
  const results = [];
  for (const scenario of SCENARIOS) {
    const value = await readJsonIfPresent(
      path.join(evidenceDir, scenario.id, "result.json"),
    );
    if (value) results.push(value);
  }
  return results;
}

async function markSupersededEvidence(evidenceDir, runState, now) {
  let changed = false;
  for (const [scenarioId, migration] of Object.entries(
    SUPERSEDED_SCENARIOS,
  )) {
    const scenarioState = runState.scenarios[scenarioId];
    if (!scenarioState || scenarioState.status === "superseded") continue;
    const resultPath = path.join(
      evidenceDir,
      scenarioId,
      "result.json",
    );
    const existing = await readJsonIfPresent(resultPath);
    if (existing) {
      await saveResult(evidenceDir, {
        ...existing,
        originalConclusion:
          existing.originalConclusion ?? existing.conclusion,
        conclusion: migration.reason,
        excludedFromSummary: true,
        supersededBy: migration.replacementId,
      });
    }
    runState.scenarios[scenarioId] = {
      ...scenarioState,
      status: "superseded",
      excludedFromSummary: true,
      supersededBy: migration.replacementId,
      conclusion: migration.reason,
    };
    changed = true;
  }
  if (changed) await saveRunState(evidenceDir, runState, now);
}

function percentage(numerator, denominator) {
  if (denominator === 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function computeSummary(
  results,
  attempts,
  now = Date.now,
  supersededResults = [],
) {
  const passedResults = results.filter((item) =>
    ["通过", "功能通过，发生供应商瞬时故障后恢复"].includes(
      item.conclusion,
    ),
  );
  const firstAttemptSuccesses = results.filter(
    (item) => item.firstAttemptPassed,
  ).length;
  const transientErrorCount = attempts.filter(
    (item) => item.transientFailure,
  ).length;
  const recoveredCount = results.filter(
    (item) => item.recoveredAfterTransientFailure,
  ).length;
  const knowledgeResults = results.filter((item) =>
    BATCH_SCENARIO_IDS.knowledge.includes(item.scenarioId),
  );
  const outsideResults = results.filter((item) =>
    BATCH_SCENARIO_IDS.outside.includes(item.scenarioId),
  );
  const elapsedValues = attempts
    .map((item) => item.elapsedMs)
    .filter((item) => Number.isFinite(item));
  const totalElapsed = elapsedValues.reduce((sum, item) => sum + item, 0);
  return {
    generatedAt: nowIso(now),
    mode: "local real model; testMode=false",
    totalFunctionalScenarios: SCENARIOS.length,
    completedFunctionalScenarios: results.length,
    functionalPassRate: percentage(
      passedResults.length,
      SCENARIOS.length,
    ),
    firstRequestSuccessRate: percentage(
      firstAttemptSuccesses,
      results.length,
    ),
    transientErrorCount,
    recoveredScenarioCount: recoveredCount,
    groundingRegenerationCount: attempts.reduce(
      (sum, item) => sum + (item.regenerationCount ?? 0),
      0,
    ),
    programFallbackCount: attempts.reduce(
      (sum, item) => sum + (item.programFallbackCount ?? 0),
      0,
    ),
    knowledgeAccuracyRate: percentage(
      knowledgeResults.filter((item) =>
        ["通过", "功能通过，发生供应商瞬时故障后恢复"].includes(
          item.conclusion,
        ),
      ).length,
      BATCH_SCENARIO_IDS.knowledge.length,
    ),
    outsideRefusalAccuracyRate: percentage(
      outsideResults.filter((item) =>
        ["通过", "功能通过，发生供应商瞬时故障后恢复"].includes(
          item.conclusion,
        ),
      ).length,
      BATCH_SCENARIO_IDS.outside.length,
    ),
    averageAttemptElapsedMs: elapsedValues.length
      ? Math.round(totalElapsed / elapsedValues.length)
      : null,
    longestAttemptElapsedMs: elapsedValues.length
      ? Math.max(...elapsedValues)
      : null,
    supersededEvidenceCount: supersededResults.length,
    supersededAttemptCount: attempts.filter((item) =>
      Object.hasOwn(SUPERSEDED_SCENARIOS, item.scenarioId),
    ).length,
    supersededEvidence: supersededResults.map((item) => ({
      scenarioId: item.scenarioId,
      attemptCount: item.attemptCount,
      originalConclusion: item.originalConclusion ?? null,
      conclusion: item.conclusion,
      supersededBy: item.supersededBy,
    })),
    results: results.map((item) => ({
      scenarioId: item.scenarioId,
      attemptCount: item.attemptCount,
      transientErrorCount: item.transientErrorCount,
      conclusion: item.conclusion,
    })),
  };
}

function summaryMarkdown(summary) {
  return [
    "# TASK-B02 本地真实模型验证汇总",
    "",
    "- 模式：" + summary.mode,
    "- 功能场景通过率：" +
      String(summary.functionalPassRate ?? "未完成") +
      "%",
    "- 首次请求成功率：" +
      String(summary.firstRequestSuccessRate ?? "未完成") +
      "%",
    "- 瞬时错误次数：" + summary.transientErrorCount,
    "- 重试后恢复场景数：" + summary.recoveredScenarioCount,
    "- grounding重新生成次数：" +
      summary.groundingRegenerationCount,
    "- 程序兜底次数：" + summary.programFallbackCount,
    "- 库内知识准确率：" +
      String(summary.knowledgeAccuracyRate ?? "未完成") +
      "%",
    "- 资料外拒答准确率：" +
      String(summary.outsideRefusalAccuracyRate ?? "未完成") +
      "%",
    "- 平均attempt耗时：" +
      String(summary.averageAttemptElapsedMs ?? "无") +
      " ms",
    "- 最长attempt耗时：" +
      String(summary.longestAttemptElapsedMs ?? "无") +
      " ms",
    "- 保留但不计入功能准确率的旧证据：" +
      summary.supersededEvidenceCount +
      "组 / " +
      summary.supersededAttemptCount +
      "次attempt",
    "",
    ...summary.results.map(
      (item) =>
        "- " +
        item.scenarioId +
        "：尝试" +
        item.attemptCount +
        "次，瞬时错误" +
        item.transientErrorCount +
        "次，" +
        item.conclusion,
    ),
    ...summary.supersededEvidence.map(
      (item) =>
        "- " +
        item.scenarioId +
        "：保留原始" +
        item.attemptCount +
        "次attempt，替换为" +
        item.supersededBy +
        "；" +
        item.conclusion,
    ),
    "",
  ].join("\n");
}

async function loadAttempts(evidenceDir) {
  const attempts = [];
  const scenarioIds = [
    ...SCENARIOS.map((scenario) => scenario.id),
    ...Object.keys(SUPERSEDED_SCENARIOS),
  ];
  for (const scenarioId of scenarioIds) {
    for (
      let attemptNumber = 1;
      attemptNumber <= MAX_ATTEMPTS;
      attemptNumber += 1
    ) {
      const value = await readJsonIfPresent(
        path.join(
          evidenceDir,
          scenarioId,
          attemptFileName(attemptNumber, "json"),
        ),
      );
      if (value && value.conclusion !== "进行中") attempts.push(value);
    }
  }
  return attempts;
}

async function loadSupersededResults(evidenceDir) {
  const results = [];
  for (const scenarioId of Object.keys(SUPERSEDED_SCENARIOS)) {
    const value = await readJsonIfPresent(
      path.join(evidenceDir, scenarioId, "result.json"),
    );
    if (value?.excludedFromSummary === true) results.push(value);
  }
  return results;
}

async function saveSummary(evidenceDir, now) {
  const results = await loadResults(evidenceDir);
  const attempts = await loadAttempts(evidenceDir);
  const supersededResults =
    await loadSupersededResults(evidenceDir);
  const summary = computeSummary(
    results,
    attempts,
    now,
    supersededResults,
  );
  await Promise.all([
    atomicWriteJson(path.join(evidenceDir, "summary.json"), summary),
    atomicWriteText(
      path.join(evidenceDir, "summary.md"),
      summaryMarkdown(summary),
    ),
  ]);
  return summary;
}

function resultFromStoredAttempt(attempt) {
  const flowResults = Array.isArray(attempt.actual?.flowResults)
    ? attempt.actual.flowResults
    : [];
  const lastFlow = flowResults.at(-1) ?? {};
  return {
    httpStatus: attempt.httpStatus,
    publicErrorCode: attempt.publicErrorCode,
    status: attempt.actual?.status ?? "error",
    answer: attempt.finalPublicAnswer ?? "",
    retrievedChunkIds: attempt.retrievedChunkIds ?? [],
    usedChunkIds: attempt.usedChunkIds ?? [],
    sources: attempt.sources ?? [],
    sourceDocuments: lastFlow.sourceDocuments ?? [],
    entityIds: attempt.actual?.entityIds ?? [],
    modelCallCount: attempt.modelCallCount ?? 0,
    regenerationCount: attempt.regenerationCount ?? 0,
    flowResults,
  };
}

async function recheckFailedScenarios({
  selected,
  evidenceDir,
  runState,
  now,
}) {
  let rechecked = 0;
  for (const scenario of selected) {
    const scenarioState = runState.scenarios[scenario.id];
    if (scenarioState?.status !== "failed") continue;
    const attemptNumber = scenarioState.attemptCount;
    const attemptPath = path.join(
      evidenceDir,
      scenario.id,
      attemptFileName(attemptNumber, "json"),
    );
    const attempt = await readJsonIfPresent(attemptPath);
    if (!attempt || attempt.httpStatus !== 200) continue;
    const storedResult = resultFromStoredAttempt(attempt);
    if (storedResult.publicErrorCode !== null) continue;
    const checks = [
      ...genericChecks(storedResult),
      ...scenario.checks(storedResult),
    ].map(({ label, pass }) => ({ label, pass: Boolean(pass) }));
    if (!checks.every((item) => item.pass)) continue;

    const revisedAttempt = {
      ...attempt,
      actual: { ...attempt.actual, checks },
      conclusion: "通过",
      transientFailure: false,
      passed: true,
      recheckHistory: [
        ...(Array.isArray(attempt.recheckHistory)
          ? attempt.recheckHistory
          : []),
        {
          recheckedAt: nowIso(now),
          previousConclusion: attempt.conclusion,
          reason:
            "运行器断言修正后对已保存公开证据复核；未发起模型请求。",
        },
      ],
    };
    await saveAttempt(evidenceDir, revisedAttempt);
    const result = {
      ...resultRecord({
        attempt: revisedAttempt,
        attemptCount: attemptNumber,
        transientErrorCount: scenarioState.transientErrorCount ?? 0,
        recovered: false,
      }),
      reclassifiedAfterRunnerCheckFix: true,
      recheckReason:
        "运行器断言修正后对已保存公开证据复核；未发起模型请求。",
    };
    await saveResult(evidenceDir, result);
    runState.scenarios[scenario.id] = {
      status: "passed",
      attemptCount: attemptNumber,
      transientErrorCount: scenarioState.transientErrorCount ?? 0,
      conclusion: result.conclusion,
      reclassifiedAfterRunnerCheckFix: true,
    };
    await saveRunState(evidenceDir, runState, now);
    rechecked += 1;
  }
  if (rechecked > 0) await saveSummary(evidenceDir, now);
  return rechecked;
}

export class StopRunError extends Error {
  constructor(scenarioId) {
    super("Three consecutive transient failures");
    this.name = "StopRunError";
    this.code = "three_consecutive_transient_failures";
    this.scenarioId = scenarioId;
  }
}

async function executeScenario({
  scenario,
  evidenceDir,
  runState,
  transport,
  sleep,
  now,
}) {
  const priorState = runState.scenarios[scenario.id];
  if (["passed", "recovered"].includes(priorState?.status)) {
    return { skipped: true, passed: true };
  }
  if (["failed", "stopped"].includes(priorState?.status)) {
    return { skipped: true, passed: false };
  }

  let transientErrorCount = 0;
  for (
    let attemptNumber = 1;
    attemptNumber <= MAX_ATTEMPTS;
    attemptNumber += 1
  ) {
    runState.scenarios[scenario.id] = {
      status: "running",
      attemptCount: attemptNumber,
    };
    await saveRunState(evidenceDir, runState, now);
    const execution = await executeAttempt({
      scenario,
      attemptNumber,
      evidenceDir,
      transport,
      now,
    });
    const attempt = attemptRecordFromExecution({
      scenario,
      attemptNumber,
      execution,
      now,
    });
    await saveAttempt(evidenceDir, attempt);
    if (attempt.transientFailure) transientErrorCount += 1;

    if (attempt.passed) {
      const recovered = transientErrorCount > 0;
      const result = resultRecord({
        attempt,
        attemptCount: attemptNumber,
        transientErrorCount,
        recovered,
      });
      await saveResult(evidenceDir, result);
      runState.scenarios[scenario.id] = {
        status: recovered ? "recovered" : "passed",
        attemptCount: attemptNumber,
        transientErrorCount,
        conclusion: result.conclusion,
      };
      await saveRunState(evidenceDir, runState, now);
      await saveSummary(evidenceDir, now);
      return { skipped: false, passed: true, recovered };
    }

    if (!attempt.transientFailure) {
      const result = resultRecord({
        attempt,
        attemptCount: attemptNumber,
        transientErrorCount,
        recovered: false,
      });
      await saveResult(evidenceDir, result);
      runState.scenarios[scenario.id] = {
        status: "failed",
        attemptCount: attemptNumber,
        transientErrorCount,
        conclusion: result.conclusion,
      };
      await saveRunState(evidenceDir, runState, now);
      await saveSummary(evidenceDir, now);
      return { skipped: false, passed: false };
    }

    if (attemptNumber >= MAX_ATTEMPTS) {
      const result = resultRecord({
        attempt,
        attemptCount: attemptNumber,
        transientErrorCount,
        recovered: false,
      });
      await saveResult(evidenceDir, result);
      runState.scenarios[scenario.id] = {
        status: "stopped",
        attemptCount: attemptNumber,
        transientErrorCount,
        conclusion: result.conclusion,
      };
      await saveRunState(evidenceDir, runState, now);
      await saveSummary(evidenceDir, now);
      throw new StopRunError(scenario.id);
    }

    await sleep(RETRY_DELAYS_MS[attemptNumber - 1]);
  }
  return { skipped: false, passed: false };
}

export async function runTaskB02Evidence(options = {}) {
  const evidenceDir = path.resolve(
    options.evidenceDir ?? DEFAULT_EVIDENCE_DIR,
  );
  const batch = options.batch ?? "all";
  const selectedIds = BATCH_SCENARIO_IDS[batch];
  if (!selectedIds) throw new Error("Unknown TASK-B02 evidence batch");
  await mkdir(evidenceDir, { recursive: true });
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const runState = await loadRunState(evidenceDir, now);
  await markSupersededEvidence(evidenceDir, runState, now);
  const transport = createTransport({
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    fetchImpl: options.fetchImpl ?? fetch,
    requestTimeoutMs: options.requestTimeoutMs ?? 65_000,
    now,
  });
  const selected = selectedIds.map((id) =>
    SCENARIOS.find((item) => item.id === id),
  );
  const recheckedThisRun = options.recheckFailed
    ? await recheckFailedScenarios({
        selected,
        evidenceDir,
        runState,
        now,
      })
    : 0;
  let completedThisRun = 0;
  let failedThisRun = 0;

  for (let index = 0; index < selected.length; index += 1) {
    const scenario = selected[index];
    const outcome = await executeScenario({
      scenario,
      evidenceDir,
      runState,
      transport,
      sleep,
      now,
    });
    if (outcome.skipped) continue;
    completedThisRun += 1;
    if (!outcome.passed) failedThisRun += 1;
    const hasLaterRunnable = selected
      .slice(index + 1)
      .some(
        (item) =>
          !["passed", "recovered"].includes(
            runState.scenarios[item.id]?.status,
          ),
      );
    if (hasLaterRunnable) await sleep(SCENARIO_DELAY_MS);
    if (completedThisRun % 3 === 0) await sleep(BATCH_PAUSE_MS);
  }

  const summary = await saveSummary(evidenceDir, now);
  return {
    batch,
    completedThisRun,
    failedThisRun,
    recheckedThisRun,
    summary,
  };
}

export function parseCliOptions(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    evidenceDir: DEFAULT_EVIDENCE_DIR,
    batch: "all",
    recheckFailed: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--base-url") {
      options.baseUrl = argv[++index];
    } else if (value === "--evidence-dir") {
      options.evidenceDir = path.resolve(argv[++index]);
    } else if (value === "--batch") {
      options.batch = argv[++index];
    } else if (value === "--recheck-failed") {
      options.recheckFailed = true;
    } else if (/^https?:\/\//u.test(value)) {
      options.baseUrl = value;
    } else {
      throw new Error("Unknown TASK-B02 runner argument");
    }
  }
  return options;
}
