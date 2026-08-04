import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  HarnessEncodingError,
  prepareUtf8JsonRequest,
  sha256Text,
  TASK_B03_SCENARIO_DATA,
  verifyEncodingRoundTrip,
} from "./task-b03-encoding.mjs";
import { atomicWriteText } from "./task-b03-runner-core.mjs";

export const DEFAULT_RECOVERY_EVIDENCE_DIR = path.resolve(
  "test-evidence/task-b03/recovery-20260804",
);

const CONTENT_TYPE = "application/json; charset=utf-8";

const initialState = (domain = "unknown") => ({
  version: 1,
  domain,
  studentConstraints: {},
  teacherConstraints: {},
  lastRecommendationIds: [],
  pendingQuestionKeys: [],
  pendingQuestionOptions: [],
  shortHistory: [],
  test: { failNextModelCall: false },
});

function iso(timestamp) {
  return new Date(timestamp).toISOString();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function integer(value, fallback = 0) {
  return Number.isInteger(value) ? value : fallback;
}

function publicErrorCode(body, transportErrorCode) {
  if (typeof body?.error?.code === "string") return body.error.code;
  if (typeof body?.error === "string") return body.error;
  return transportErrorCode ?? null;
}

function diagnosticsFrom(body) {
  return isRecord(body?.diagnostics) ? body.diagnostics : {};
}

function modelCallCounts(body) {
  const diagnostics = diagnosticsFrom(body);
  const composerCallCount = integer(diagnostics.composerAttempts);
  const externalModelCalls = integer(diagnostics.externalModelCalls);
  return {
    classifierCallCount: Math.max(0, externalModelCalls - composerCallCount),
    composerCallCount,
    externalModelCalls,
  };
}

async function atomicWriteJson(targetPath, value) {
  await atomicWriteText(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function fetchJson({ fetchImpl, url, init, requestTimeoutMs, now }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const startedAt = now();
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const responseText = await response.text();
    let body = {};
    let directJsonParse = false;
    try {
      body = JSON.parse(responseText);
      directJsonParse = true;
    } catch {
      body = {};
    }
    return {
      httpStatus: response.status,
      elapsedMs: Math.max(0, now() - startedAt),
      body,
      directJsonParse,
    };
  } catch (error) {
    const timedOut = controller.signal.aborted || error?.name === "AbortError";
    return {
      httpStatus: null,
      elapsedMs: Math.max(0, now() - startedAt),
      body: {},
      directJsonParse: false,
      transportErrorCode: timedOut ? "network_timeout" : "network_error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function createRecoveryTransport({ baseUrl, fetchImpl, requestTimeoutMs, now }) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/u, "");
  return {
    async createSession() {
      return fetchJson({
        fetchImpl,
        url: `${normalizedBaseUrl}/api/history/sessions`,
        init: {
          method: "POST",
          headers: { "Content-Type": CONTENT_TYPE },
        },
        requestTimeoutMs,
        now,
      });
    },
    async chat({ gate, sessionId }) {
      const payload = {
        action: "message",
        message: gate.message,
        state: initialState(gate.domain),
        sessionId,
        clientRequestId: `task-b03h-${randomUUID()}`,
        diagnostics: true,
        testMode: false,
      };
      const prepared = prepareUtf8JsonRequest({
        scenarioId: gate.id,
        currentMessage: payload.message,
        originalMessage: gate.message,
        payload,
      });
      const result = await fetchJson({
        fetchImpl,
        url: `${normalizedBaseUrl}/api/chat`,
        init: {
          method: "POST",
          headers: { "Content-Type": CONTENT_TYPE },
          body: prepared.body,
        },
        requestTimeoutMs,
        now,
      });
      return { ...result, sentMessageSha256: prepared.messageSha256 };
    },
    async history(sessionId) {
      return fetchJson({
        fetchImpl,
        url: `${normalizedBaseUrl}/api/history/sessions/${encodeURIComponent(sessionId)}/messages`,
        init: { method: "GET" },
        requestTimeoutMs,
        now,
      });
    },
  };
}

function lastUserMessage(historyBody) {
  if (!Array.isArray(historyBody?.messages)) return undefined;
  return historyBody.messages
    .filter(
      (message) => message?.role === "user" && typeof message.content === "string",
    )
    .at(-1)?.content;
}

async function executeServerRoundTrip(transport, gate) {
  const session = await transport.createSession();
  const sessionId = session.body?.session?.id;
  if (session.httpStatus !== 201 || typeof sessionId !== "string") {
    return {
      scenarioId: gate.id,
      httpStatus: null,
      sessionHttpStatus: session.httpStatus,
      historyHttpStatus: null,
      elapsedMs: session.elapsedMs,
      publicErrorCode: publicErrorCode(session.body, session.transportErrorCode),
      directJsonParse: session.directJsonParse,
      sentMessageSha256: sha256Text(gate.message),
      receivedMessageSha256: null,
      exactRoundTrip: false,
      body: {},
    };
  }

  const chat = await transport.chat({ gate, sessionId });
  const history = await transport.history(sessionId);
  const receivedMessage = lastUserMessage(history.body);
  const receivedMessageSha256 =
    typeof receivedMessage === "string" ? sha256Text(receivedMessage) : null;
  const exactRoundTrip = receivedMessage === gate.message;
  return {
    scenarioId: gate.id,
    httpStatus: chat.httpStatus,
    sessionHttpStatus: session.httpStatus,
    historyHttpStatus: history.httpStatus,
    elapsedMs: session.elapsedMs + chat.elapsedMs + history.elapsedMs,
    routeLatencyMs: integer(diagnosticsFrom(chat.body).routeLatencyMs, null),
    publicErrorCode: publicErrorCode(chat.body, chat.transportErrorCode),
    directJsonParse: chat.directJsonParse,
    sentMessageSha256: chat.sentMessageSha256,
    receivedMessageSha256,
    exactRoundTrip,
    body: chat.body,
  };
}

function redactedRoundTripRecord(result) {
  const counts = modelCallCounts(result.body);
  return {
    scenarioId: result.scenarioId,
    httpStatus: result.httpStatus,
    sessionHttpStatus: result.sessionHttpStatus,
    historyHttpStatus: result.historyHttpStatus,
    elapsedMs: result.elapsedMs,
    routeLatencyMs: result.routeLatencyMs ?? null,
    publicErrorCode: result.publicErrorCode,
    directJsonParse: result.directJsonParse,
    sentMessageSha256: result.sentMessageSha256,
    receivedMessageSha256: result.receivedMessageSha256,
    exactRoundTrip: result.exactRoundTrip,
    ...counts,
  };
}

function hasValidChatShape(body) {
  return (
    isRecord(body) &&
    typeof body.status === "string" &&
    typeof body.message === "string" &&
    isRecord(body.state) &&
    isRecord(body.presentation) &&
    Array.isArray(body.sources)
  );
}

export class RecoveryGateStopError extends Error {
  constructor(code, scenarioId, stage, publicErrorCodeValue = null) {
    super(code);
    this.name = "RecoveryGateStopError";
    this.code = code;
    this.scenarioId = scenarioId;
    this.stage = stage;
    this.publicErrorCode = publicErrorCodeValue;
  }
}

function stopForRoundTrip(result, stage) {
  const receivedMessageWasAvailable = result.receivedMessageSha256 !== null;
  if (receivedMessageWasAvailable && !result.exactRoundTrip) {
    throw new RecoveryGateStopError(
      "harness_encoding_error",
      result.scenarioId,
      stage,
      result.publicErrorCode,
    );
  }
}

function asciiProgress(record, onProgress) {
  onProgress({
    scenarioId: record.scenarioId,
    httpStatus: record.httpStatus,
    elapsedMs: record.elapsedMs,
  });
}

function sanitizedFailure(error) {
  return {
    code: error?.code ?? "recovery_gate_failed",
    scenarioId: error?.scenarioId ?? "unknown",
    stage: error?.stage ?? "unknown",
    publicErrorCode: error?.publicErrorCode ?? null,
  };
}

function feeAttemptMarkdown(record) {
  return [
    `# ${record.scenarioId} recovery attempt`,
    "",
    `- HTTP: ${record.httpStatus ?? "none"}`,
    `- elapsedMs: ${record.elapsedMs}`,
    `- routeLatencyMs: ${record.routeLatencyMs ?? "none"}`,
    `- composerCallCount: ${record.composerCallCount}`,
    `- regenerated: ${record.regenerated}`,
    `- expectedAmount: ${record.expectedAmount ?? "none"}`,
    `- modelAmount: ${record.modelAmount ?? "none"}`,
    `- calculationMode: ${record.calculationMode ?? "none"}`,
    `- exactRoundTrip: ${record.exactRoundTrip}`,
    `- passed: ${record.passed}`,
    "",
  ].join("\n");
}

async function saveFeeAttempt(evidenceDir, record, now) {
  const scenarioDir = path.join(evidenceDir, record.scenarioId);
  await atomicWriteJson(path.join(scenarioDir, "attempt-01.json"), record);
  await atomicWriteText(
    path.join(scenarioDir, "attempt-01.md"),
    feeAttemptMarkdown(record),
  );
  const runState = {
    version: 1,
    mode: "local real model; testMode=false; utf8-gated recovery",
    updatedAt: iso(now()),
    scenarios: {
      [record.scenarioId]: {
        status: record.passed ? "passed" : "stopped",
        attemptCount: 1,
      },
    },
  };
  await atomicWriteJson(path.join(evidenceDir, "run-state.json"), runState);
  if (!record.passed) return;
  const result = {
    ...record,
    category: "fee",
    attemptNumber: 1,
    attemptCount: 1,
    transientErrorCount: 0,
    firstPassMatched: record.firstPassMatched,
    regenerationCount: record.regenerationCount,
    calculationMode: record.calculationMode,
    passed: true,
    conclusion: "utf8_gated_recovery_passed",
  };
  await atomicWriteJson(path.join(scenarioDir, "result.json"), result);
  await atomicWriteText(
    path.join(scenarioDir, "result.md"),
    feeAttemptMarkdown(result),
  );
}

export async function runTaskB03RecoveryGates(options = {}) {
  const evidenceDir = path.resolve(
    options.evidenceDir ?? DEFAULT_RECOVERY_EVIDENCE_DIR,
  );
  const now = options.now ?? Date.now;
  const onProgress = options.onProgress ?? (() => undefined);
  const transport = createRecoveryTransport({
    baseUrl: options.baseUrl ?? "http://127.0.0.1:3000",
    fetchImpl: options.fetchImpl ?? fetch,
    requestTimeoutMs: options.requestTimeoutMs ?? 90_000,
    now,
  });
  const recoverySummary = {
    version: 1,
    startedAt: iso(now()),
    status: "running",
    stoppedStage: null,
    failure: null,
    formalValidationReady: false,
  };

  try {
    const encodingChecks = TASK_B03_SCENARIO_DATA.encodingChecks.map((scenario) =>
      verifyEncodingRoundTrip(scenario.id, scenario.text),
    );
    await atomicWriteJson(path.join(evidenceDir, "encoding-unit-tests.json"), {
      passed: true,
      count: encodingChecks.length,
      checks: encodingChecks,
    });

    const roundTrip = await executeServerRoundTrip(
      transport,
      TASK_B03_SCENARIO_DATA.gates.roundTrip,
    );
    const roundTripRecord = redactedRoundTripRecord(roundTrip);
    const answer = typeof roundTrip.body?.message === "string" ? roundTrip.body.message : "";
    roundTripRecord.answerChecks = {
      containsMinimumPeople: /20\s*人\s*起/u.test(answer),
      containsMinimumPrice: /[5五]\s*万元\s*起/u.test(answer),
      excludesPersonalPrice: !/2980/u.test(answer),
    };
    roundTripRecord.passed =
      roundTripRecord.httpStatus === 200 &&
      roundTripRecord.historyHttpStatus === 200 &&
      roundTripRecord.exactRoundTrip &&
      roundTripRecord.sentMessageSha256 === roundTripRecord.receivedMessageSha256 &&
      roundTripRecord.classifierCallCount === 0 &&
      roundTripRecord.composerCallCount === 0 &&
      Object.values(roundTripRecord.answerChecks).every(Boolean);
    await atomicWriteJson(
      path.join(evidenceDir, "roundtrip-gate.json"),
      roundTripRecord,
    );
    asciiProgress(roundTripRecord, onProgress);
    stopForRoundTrip(roundTrip, "roundtrip");
    if (!roundTripRecord.passed) {
      throw new RecoveryGateStopError(
        "deterministic_roundtrip_gate_failed",
        roundTripRecord.scenarioId,
        "roundtrip",
        roundTripRecord.publicErrorCode,
      );
    }

    const ordinary = await executeServerRoundTrip(
      transport,
      TASK_B03_SCENARIO_DATA.gates.ordinaryModel,
    );
    const ordinaryRecord = redactedRoundTripRecord(ordinary);
    ordinaryRecord.nonEmpty =
      typeof ordinary.body?.message === "string" && ordinary.body.message.trim().length > 0;
    ordinaryRecord.passed =
      ordinaryRecord.httpStatus === 200 &&
      ordinaryRecord.publicErrorCode === null &&
      ordinaryRecord.nonEmpty &&
      ordinaryRecord.exactRoundTrip &&
      ordinaryRecord.sentMessageSha256 === ordinaryRecord.receivedMessageSha256 &&
      ordinaryRecord.externalModelCalls > 0;
    await atomicWriteJson(
      path.join(evidenceDir, "ordinary-model-gate.json"),
      ordinaryRecord,
    );
    asciiProgress(ordinaryRecord, onProgress);
    stopForRoundTrip(ordinary, "ordinary_model");
    if (!ordinaryRecord.passed) {
      throw new RecoveryGateStopError(
        "ordinary_model_gate_failed",
        ordinaryRecord.scenarioId,
        "ordinary_model",
        ordinaryRecord.publicErrorCode,
      );
    }

    const strict = await executeServerRoundTrip(
      transport,
      TASK_B03_SCENARIO_DATA.gates.strictJsonModel,
    );
    const strictRecord = redactedRoundTripRecord(strict);
    strictRecord.structureValid = hasValidChatShape(strict.body);
    strictRecord.passed =
      strictRecord.httpStatus === 200 &&
      strictRecord.publicErrorCode === null &&
      strictRecord.directJsonParse &&
      strictRecord.structureValid &&
      strictRecord.exactRoundTrip &&
      strictRecord.sentMessageSha256 === strictRecord.receivedMessageSha256 &&
      strictRecord.externalModelCalls > 0;
    await atomicWriteJson(
      path.join(evidenceDir, "strict-json-model-gate.json"),
      strictRecord,
    );
    asciiProgress(strictRecord, onProgress);
    stopForRoundTrip(strict, "strict_json_model");
    if (!strictRecord.passed) {
      throw new RecoveryGateStopError(
        "strict_json_model_gate_failed",
        strictRecord.scenarioId,
        "strict_json_model",
        strictRecord.publicErrorCode,
      );
    }

    const fee = await executeServerRoundTrip(
      transport,
      TASK_B03_SCENARIO_DATA.gates.feeRecovery,
    );
    const diagnostics = diagnosticsFrom(fee.body);
    const feeRecord = {
      ...redactedRoundTripRecord(fee),
      attemptNumber: 1,
      startedAt: recoverySummary.startedAt,
      finishedAt: iso(now()),
      regenerationCount: integer(diagnostics.regenerationCount),
      regenerated: integer(diagnostics.regenerationCount) > 0,
      expectedAmount: Number.isFinite(diagnostics.expectedAmount)
        ? diagnostics.expectedAmount
        : null,
      modelAmount: Number.isFinite(diagnostics.modelAmount)
        ? diagnostics.modelAmount
        : null,
      calculationMode:
        typeof diagnostics.calculationMode === "string"
          ? diagnostics.calculationMode
          : null,
      firstPassMatched:
        typeof diagnostics.firstPassMatched === "boolean"
          ? diagnostics.firstPassMatched
          : null,
      validFeeAccuracyDenominator:
        fee.httpStatus === 200 &&
        typeof fee.body?.message === "string" &&
        fee.body.message.trim().length > 0
          ? 1
          : 0,
    };
    const feeAnswer = typeof fee.body?.message === "string" ? fee.body.message : "";
    feeRecord.finalAmount6980 = /6980\s*元/u.test(feeAnswer);
    feeRecord.passed =
      feeRecord.httpStatus === 200 &&
      feeRecord.publicErrorCode === null &&
      feeRecord.exactRoundTrip &&
      feeRecord.sentMessageSha256 === feeRecord.receivedMessageSha256 &&
      feeRecord.finalAmount6980 &&
      feeRecord.expectedAmount === 6980 &&
      feeRecord.modelAmount === 6980;
    await saveFeeAttempt(evidenceDir, feeRecord, now);
    asciiProgress(feeRecord, onProgress);
    stopForRoundTrip(fee, "fee_recovery");
    if (!feeRecord.passed) {
      throw new RecoveryGateStopError(
        "fee_recovery_gate_failed",
        feeRecord.scenarioId,
        "fee_recovery",
        feeRecord.publicErrorCode,
      );
    }

    recoverySummary.status = "passed";
    recoverySummary.formalValidationReady = true;
    recoverySummary.feeAccuracyDenominator = feeRecord.validFeeAccuracyDenominator;
    recoverySummary.feeFirstPassHitCount = feeRecord.firstPassMatched === true ? 1 : 0;
    recoverySummary.finishedAt = iso(now());
    await atomicWriteJson(
      path.join(evidenceDir, "recovery-summary.json"),
      recoverySummary,
    );
    return { evidenceDir, recoverySummary, feeRecord };
  } catch (error) {
    const normalizedError =
      error instanceof HarnessEncodingError
        ? new RecoveryGateStopError(
            error.code,
            error.scenarioId,
            "request_preflight",
          )
        : error;
    recoverySummary.status = "stopped";
    recoverySummary.stoppedStage = normalizedError?.stage ?? "unknown";
    recoverySummary.failure = sanitizedFailure(normalizedError);
    recoverySummary.finishedAt = iso(now());
    await atomicWriteJson(
      path.join(evidenceDir, "recovery-summary.json"),
      recoverySummary,
    );
    throw normalizedError;
  }
}
