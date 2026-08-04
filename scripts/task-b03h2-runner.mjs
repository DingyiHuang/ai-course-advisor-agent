import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_H2_SCENARIO_FILE = path.resolve(
  "scripts/task-b03h2-scenarios.json",
);
export const DEFAULT_H2_EVIDENCE_DIR = path.resolve(
  "test-evidence/task-b03/recovery-20260804-h2",
);
export const DEFAULT_APP_BASE_URL = "http://127.0.0.1:3000";
export const H2_REQUEST_TIMEOUT_MS = 20_000;

const CONTENT_TYPE = "application/json; charset=utf-8";

export function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function integer(value, fallback = 0) {
  return Number.isInteger(value) ? value : fallback;
}

function finiteNumber(value, fallback = null) {
  return Number.isFinite(value) ? value : fallback;
}

function iso(timestamp) {
  return new Date(timestamp).toISOString();
}

function requireText(value, label) {
  if (typeof value !== "string" || !value) {
    throw new Error(`Invalid TASK-B03H2 scenario field: ${label}`);
  }
  return value;
}

export async function loadH2Scenarios(
  scenarioFile = DEFAULT_H2_SCENARIO_FILE,
) {
  const source = await readFile(scenarioFile, "utf8");
  const data = JSON.parse(source);
  if (!isRecord(data) || data.version !== 1) {
    throw new Error("Invalid TASK-B03H2 scenario file");
  }
  const strictJsonGate = data.strictJsonGate;
  const feeSingle = data.feeSingle;
  if (!isRecord(strictJsonGate) || !isRecord(strictJsonGate.expected)) {
    throw new Error("Invalid TASK-B03H2 strict JSON scenario");
  }
  if (!isRecord(feeSingle)) {
    throw new Error("Invalid TASK-B03H2 fee scenario");
  }
  return {
    strictJsonGate: {
      id: requireText(strictJsonGate.id, "strictJsonGate.id"),
      requestText: requireText(
        strictJsonGate.requestText,
        "strictJsonGate.requestText",
      ),
      expected: {
        ok: strictJsonGate.expected.ok === true,
        message: requireText(
          strictJsonGate.expected.message,
          "strictJsonGate.expected.message",
        ),
      },
    },
    feeSingle: {
      id: requireText(feeSingle.id, "feeSingle.id"),
      requestText: requireText(feeSingle.requestText, "feeSingle.requestText"),
      domain: requireText(feeSingle.domain, "feeSingle.domain"),
      expectedAmount: finiteNumber(feeSingle.expectedAmount),
    },
  };
}

function requiredRuntimeValue(env, name) {
  const value = env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required model configuration: ${name}`);
  }
  return value.trim();
}

function configuredTimeout(env) {
  const configured = env.LLM_TIMEOUT_MS?.trim();
  const value = configured ? Number.parseInt(configured, 10) : H2_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid model timeout configuration");
  }
  return value;
}

function completionEndpoint(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/u, "");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

function elapsedSince(clock, startedAt) {
  return Math.max(0, Math.round(clock() - startedAt));
}

async function providerJsonGateOnce({
  prompt,
  expected,
  fetchImpl,
  env,
  clock,
}) {
  const baseUrl = requiredRuntimeValue(env, "LLM_BASE_URL");
  const apiKey = requiredRuntimeValue(env, "LLM_API_KEY");
  const model = requiredRuntimeValue(env, "LLM_MODEL");
  const timeoutMs = configuredTimeout(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = clock();
  try {
    const response = await fetchImpl(completionEndpoint(baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": CONTENT_TYPE,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const elapsedMs = elapsedSince(clock, startedAt);
    if (!response.ok) {
      return {
        httpStatus: response.status,
        elapsedMs,
        publicErrorCode: "model_unavailable",
        directJsonParse: false,
        okIsTrue: false,
        messageExact: false,
        onlyExpectedFields: false,
      };
    }

    let envelope;
    try {
      envelope = JSON.parse(await response.text());
    } catch {
      return {
        httpStatus: response.status,
        elapsedMs,
        publicErrorCode: "invalid_response",
        directJsonParse: false,
        okIsTrue: false,
        messageExact: false,
        onlyExpectedFields: false,
      };
    }
    const content = envelope?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return {
        httpStatus: response.status,
        elapsedMs,
        publicErrorCode: "invalid_response",
        directJsonParse: false,
        okIsTrue: false,
        messageExact: false,
        onlyExpectedFields: false,
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return {
        httpStatus: response.status,
        elapsedMs,
        publicErrorCode: "invalid_response",
        directJsonParse: false,
        okIsTrue: false,
        messageExact: false,
        onlyExpectedFields: false,
      };
    }
    const keys = isRecord(parsed) ? Object.keys(parsed).sort() : [];
    return {
      httpStatus: response.status,
      elapsedMs,
      publicErrorCode: null,
      directJsonParse: true,
      okIsTrue: isRecord(parsed) && parsed.ok === expected.ok,
      messageExact: isRecord(parsed) && parsed.message === expected.message,
      onlyExpectedFields:
        keys.length === 2 && keys[0] === "message" && keys[1] === "ok",
    };
  } catch (error) {
    const timedOut = controller.signal.aborted || error?.name === "AbortError";
    return {
      httpStatus: null,
      elapsedMs: elapsedSince(clock, startedAt),
      publicErrorCode: timedOut ? "model_timeout" : "model_unavailable",
      directJsonParse: false,
      okIsTrue: false,
      messageExact: false,
      onlyExpectedFields: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readRequestBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 65_536) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": CONTENT_TYPE });
  response.end(JSON.stringify(body));
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start local TASK-B03H2 gate server");
  }
  return address.port;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function runStrictJsonGate({
  scenario,
  providerFetch = fetch,
  localFetch = fetch,
  env = process.env,
  clock = performance.now.bind(performance),
  now = Date.now,
}) {
  let providerCallCount = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/gate") {
      sendJson(response, 404, { publicErrorCode: "not_found" });
      return;
    }
    try {
      const payload = JSON.parse(await readRequestBody(request));
      if (!isRecord(payload) || typeof payload.requestText !== "string") {
        sendJson(response, 400, { publicErrorCode: "invalid_request" });
        return;
      }
      const receivedMessageSha256 = sha256Text(payload.requestText);
      providerCallCount += 1;
      const providerResult = await providerJsonGateOnce({
        prompt: payload.requestText,
        expected: scenario.expected,
        fetchImpl: providerFetch,
        env,
        clock,
      });
      const localStatus = providerResult.httpStatus ??
        (providerResult.publicErrorCode === "model_timeout" ? 504 : 502);
      sendJson(response, localStatus, {
        ...providerResult,
        receivedMessageSha256,
      });
    } catch {
      sendJson(response, 500, { publicErrorCode: "gate_server_error" });
    }
  });

  const startedAt = now();
  const sentMessageSha256 = sha256Text(scenario.requestText);
  let result;
  try {
    const port = await listen(server);
    const response = await localFetch(`http://127.0.0.1:${port}/gate`, {
      method: "POST",
      headers: { "Content-Type": CONTENT_TYPE },
      body: Buffer.from(
        JSON.stringify({ requestText: scenario.requestText }),
        "utf8",
      ),
    });
    result = await response.json();
  } finally {
    if (server.listening) await close(server);
  }
  const finishedAt = now();
  const receivedMessageSha256 =
    typeof result?.receivedMessageSha256 === "string"
      ? result.receivedMessageSha256
      : null;
  const exactRoundTrip =
    receivedMessageSha256 !== null &&
    sentMessageSha256 === receivedMessageSha256;
  const record = {
    version: 1,
    scenarioId: scenario.id,
    startedAt: iso(startedAt),
    finishedAt: iso(finishedAt),
    elapsedMs: finiteNumber(result?.elapsedMs, Math.max(0, finishedAt - startedAt)),
    httpStatus: integer(result?.httpStatus, null),
    publicErrorCode:
      typeof result?.publicErrorCode === "string" ? result.publicErrorCode : null,
    providerCallCount,
    automaticRetryCount: 0,
    directJsonParse: result?.directJsonParse === true,
    okIsTrue: result?.okIsTrue === true,
    messageExact: result?.messageExact === true,
    onlyExpectedFields: result?.onlyExpectedFields === true,
    sentMessageSha256,
    receivedMessageSha256,
    exactRoundTrip,
  };
  record.passed =
    record.providerCallCount === 1 &&
    record.automaticRetryCount === 0 &&
    record.httpStatus === 200 &&
    record.directJsonParse &&
    record.okIsTrue &&
    record.messageExact &&
    record.onlyExpectedFields &&
    record.exactRoundTrip;
  return record;
}

function initialState(domain) {
  return {
    version: 1,
    domain,
    studentConstraints: {},
    teacherConstraints: {},
    lastRecommendationIds: [],
    pendingQuestionKeys: [],
    pendingQuestionOptions: [],
    shortHistory: [],
    test: { failNextModelCall: false },
  };
}

async function fetchJsonOnce({ fetchImpl, url, init, timeoutMs, clock }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = clock();
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
      elapsedMs: elapsedSince(clock, startedAt),
      directJsonParse,
      body,
    };
  } catch (error) {
    const timedOut = controller.signal.aborted || error?.name === "AbortError";
    return {
      httpStatus: null,
      elapsedMs: elapsedSince(clock, startedAt),
      directJsonParse: false,
      body: {},
      transportErrorCode: timedOut ? "network_timeout" : "network_error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function lastUserMessage(body) {
  if (!Array.isArray(body?.messages)) return undefined;
  return body.messages
    .filter(
      (message) => message?.role === "user" && typeof message.content === "string",
    )
    .at(-1)?.content;
}

function sanitizedComposerAttempts(diagnostics) {
  if (!Array.isArray(diagnostics?.composerAttemptResults)) return [];
  return diagnostics.composerAttemptResults.map((item) => ({
    attempt: integer(item?.attempt, null),
    elapsedMs: finiteNumber(item?.elapsedMs, null),
    category:
      typeof item?.category === "string" ? item.category : "unknown_error",
    enteredGrounding: item?.enteredGrounding === true,
    ...(typeof item?.publicErrorCode === "string"
      ? { publicErrorCode: item.publicErrorCode }
      : {}),
    ...(Number.isInteger(item?.httpStatus) ? { httpStatus: item.httpStatus } : {}),
    ...(typeof item?.groundingReasonCode === "string"
      ? { groundingReasonCode: item.groundingReasonCode }
      : {}),
  }));
}

export async function runFeeSingle({
  scenario,
  baseUrl = DEFAULT_APP_BASE_URL,
  fetchImpl = fetch,
  clock = performance.now.bind(performance),
  now = Date.now,
  requestTimeoutMs = H2_REQUEST_TIMEOUT_MS,
}) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/u, "");
  const startedAt = now();
  const session = await fetchJsonOnce({
    fetchImpl,
    url: `${normalizedBaseUrl}/api/history/sessions`,
    init: { method: "POST", headers: { "Content-Type": CONTENT_TYPE } },
    timeoutMs: requestTimeoutMs,
    clock,
  });
  const sessionId = session.body?.session?.id;
  if (session.httpStatus !== 201 || typeof sessionId !== "string") {
    return {
      version: 1,
      scenarioId: scenario.id,
      startedAt: iso(startedAt),
      finishedAt: iso(now()),
      sessionHttpStatus: session.httpStatus,
      httpStatus: null,
      routeElapsedMs: 0,
      publicErrorCode:
        typeof session.body?.error?.code === "string"
          ? session.body.error.code
          : (session.transportErrorCode ?? "session_creation_failed"),
      runnerRetryCount: 0,
      composerCallCount: 0,
      composerAttemptResults: [],
      enteredGrounding: false,
      groundingFailureReasonCodes: [],
      expectedAmount: scenario.expectedAmount,
      modelAmount: null,
      calculationMode: null,
      firstPassMatched: null,
      eligibleForFeeFirstPassStatistics: false,
      sentMessageSha256: sha256Text(scenario.requestText),
      receivedMessageSha256: null,
      exactRoundTrip: false,
      passed: false,
      outcome: "session_creation_failed",
    };
  }

  const sentMessageSha256 = sha256Text(scenario.requestText);
  const chat = await fetchJsonOnce({
    fetchImpl,
    url: `${normalizedBaseUrl}/api/chat`,
    init: {
      method: "POST",
      headers: { "Content-Type": CONTENT_TYPE },
      body: Buffer.from(
        JSON.stringify({
          action: "message",
          message: scenario.requestText,
          state: initialState(scenario.domain),
          sessionId,
          clientRequestId: `task-b03h2-${randomUUID()}`,
          diagnostics: true,
          testMode: false,
        }),
        "utf8",
      ),
    },
    timeoutMs: requestTimeoutMs,
    clock,
  });

  const history = await fetchJsonOnce({
    fetchImpl,
    url: `${normalizedBaseUrl}/api/history/sessions/${encodeURIComponent(sessionId)}/messages`,
    init: { method: "GET" },
    timeoutMs: requestTimeoutMs,
    clock,
  });
  const receivedMessage = lastUserMessage(history.body);
  const receivedMessageSha256 =
    typeof receivedMessage === "string" ? sha256Text(receivedMessage) : null;
  const exactRoundTrip =
    receivedMessageSha256 !== null && sentMessageSha256 === receivedMessageSha256;
  const diagnostics = isRecord(chat.body?.diagnostics) ? chat.body.diagnostics : {};
  const composerAttemptResults = sanitizedComposerAttempts(diagnostics);
  const composerCallCount = integer(diagnostics.composerAttempts);
  const groundingFailureReasonCodes = Array.isArray(diagnostics.groundingFailures)
    ? diagnostics.groundingFailures
        .map((item) => item?.reasonCode)
        .filter((item) => typeof item === "string")
    : [];
  const calculationMode =
    typeof diagnostics.calculationMode === "string"
      ? diagnostics.calculationMode
      : null;
  const expectedAmount = finiteNumber(
    diagnostics.expectedAmount,
    scenario.expectedAmount,
  );
  const modelAmount = finiteNumber(diagnostics.modelAmount);
  const publicAnswer = typeof chat.body?.message === "string" ? chat.body.message : "";
  const hasExpectedAmountInAnswer = new RegExp(
    `(?:最终|应付|总价)[^。；\\n]{0,24}${scenario.expectedAmount}\\s*元`,
    "u",
  ).test(publicAnswer);
  const eligibleForFeeFirstPassStatistics =
    chat.httpStatus === 200 &&
    composerCallCount > 0 &&
    composerAttemptResults.some(({ category }) => category === "success") &&
    (calculationMode === "model" || calculationMode === "regenerated_model") &&
    modelAmount !== null &&
    hasExpectedAmountInAnswer;
  const firstPassMatched = eligibleForFeeFirstPassStatistics
    ? diagnostics.firstPassMatched === true
    : null;
  const passed =
    eligibleForFeeFirstPassStatistics &&
    firstPassMatched === true &&
    calculationMode === "model" &&
    expectedAmount === scenario.expectedAmount &&
    modelAmount === scenario.expectedAmount &&
    exactRoundTrip;
  const publicErrorCode =
    typeof chat.body?.error?.code === "string"
      ? chat.body.error.code
      : (chat.transportErrorCode ?? null);
  const timedOut = chat.transportErrorCode === "network_timeout";
  const outcome = passed
    ? "passed_first_hit"
    : timedOut
      ? "route_timeout"
      : chat.httpStatus === 503
        ? "provider_unavailable"
        : chat.httpStatus === 200
          ? "first_pass_or_grounding_failed"
          : "request_failed";

  return {
    version: 1,
    scenarioId: scenario.id,
    startedAt: iso(startedAt),
    finishedAt: iso(now()),
    sessionHttpStatus: session.httpStatus,
    historyHttpStatus: history.httpStatus,
    httpStatus: chat.httpStatus,
    routeElapsedMs: chat.elapsedMs,
    serverRouteLatencyMs: finiteNumber(diagnostics.routeLatencyMs),
    publicErrorCode,
    runnerRetryCount: 0,
    composerCallCount,
    composerAttemptResults,
    enteredGrounding: composerAttemptResults.some(
      ({ enteredGrounding }) => enteredGrounding,
    ),
    groundingFailureReasonCodes,
    expectedAmount,
    modelAmount,
    calculationMode,
    firstPassMatched,
    eligibleForFeeFirstPassStatistics,
    sentMessageSha256,
    receivedMessageSha256,
    exactRoundTrip,
    passed,
    outcome,
  };
}

async function writeJsonExclusive(targetPath, value) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function saveStrictJsonGate(evidenceDir, record) {
  await writeJsonExclusive(
    path.join(evidenceDir, "strict-json-model-gate.json"),
    record,
  );
}

export async function saveFeeCheckpoint(evidenceDir, record) {
  const scenarioDir = path.join(evidenceDir, record.scenarioId);
  await writeJsonExclusive(path.join(scenarioDir, "attempt-01.json"), {
    ...record,
    category: "fee",
    attemptNumber: 1,
    elapsedMs: record.routeElapsedMs,
    transientFailure:
      record.httpStatus === 503 || record.outcome === "route_timeout",
    regenerationCount: Math.max(0, record.composerCallCount - 1),
    conclusion: record.passed ? "通过" : record.outcome,
  });
  const runState = {
    version: 1,
    mode: "local real model; testMode=false; TASK-B03H2 single-call recovery",
    updatedAt: record.finishedAt,
    scenarios: {
      [record.scenarioId]: {
        status: record.passed ? "passed" : "stopped",
        attemptCount: 1,
      },
    },
  };
  await writeJsonExclusive(path.join(evidenceDir, "run-state.json"), runState);
  if (!record.passed) return;
  await writeJsonExclusive(path.join(scenarioDir, "result.json"), {
    ...record,
    category: "fee",
    attemptNumber: 1,
    attemptCount: 1,
    elapsedMs: record.routeElapsedMs,
    regenerationCount: 0,
    transientErrorCount: 0,
    conclusion: "通过",
  });
}

function parseOptions(argv) {
  const options = {
    command: argv[0],
    scenarioFile: DEFAULT_H2_SCENARIO_FILE,
    evidenceDir: DEFAULT_H2_EVIDENCE_DIR,
    baseUrl: DEFAULT_APP_BASE_URL,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--scenario-file") options.scenarioFile = path.resolve(argv[++index]);
    else if (value === "--evidence-dir") options.evidenceDir = path.resolve(argv[++index]);
    else if (value === "--base-url") options.baseUrl = argv[++index];
    else throw new Error("Unknown TASK-B03H2 runner argument");
  }
  if (options.command !== "gate" && options.command !== "fee") {
    throw new Error("TASK-B03H2 command must be gate or fee");
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const scenarios = await loadH2Scenarios(options.scenarioFile);
  if (options.command === "gate") {
    const record = await runStrictJsonGate({ scenario: scenarios.strictJsonGate });
    await saveStrictJsonGate(options.evidenceDir, record);
    process.stdout.write(
      JSON.stringify({
        scenarioId: record.scenarioId,
        httpStatus: record.httpStatus,
        elapsedMs: record.elapsedMs,
        publicErrorCode: record.publicErrorCode,
        providerCallCount: record.providerCallCount,
        passed: record.passed,
      }) + "\n",
    );
    if (!record.passed) process.exitCode = 2;
    return record;
  }
  const record = await runFeeSingle({
    scenario: scenarios.feeSingle,
    baseUrl: options.baseUrl,
  });
  await saveFeeCheckpoint(options.evidenceDir, record);
  process.stdout.write(
    JSON.stringify({
      scenarioId: record.scenarioId,
      httpStatus: record.httpStatus,
      routeElapsedMs: record.routeElapsedMs,
      publicErrorCode: record.publicErrorCode,
      composerCallCount: record.composerCallCount,
      outcome: record.outcome,
      passed: record.passed,
    }) + "\n",
  );
  if (!record.passed) process.exitCode = 2;
  return record;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
