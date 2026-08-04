import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const TASK_B03_SCENARIO_DATA_PATH = path.join(
  MODULE_DIRECTORY,
  "task-b03-scenarios.json",
);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid TASK-B03 scenario data: ${label}`);
  }
  return value;
}

export function firstDifferenceIndex(left, right) {
  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? -1 : limit;
}

export class HarnessEncodingError extends Error {
  constructor(scenarioId, firstDifference = -1) {
    super(
      `harness_encoding_error scenarioId=${scenarioId} firstDifference=${firstDifference}`,
    );
    this.name = "HarnessEncodingError";
    this.code = "harness_encoding_error";
    this.scenarioId = scenarioId;
    this.firstDifference = firstDifference;
  }
}

export function assertExactText(scenarioId, actual, expected) {
  if (actual !== expected) {
    throw new HarnessEncodingError(
      scenarioId,
      firstDifferenceIndex(actual, expected),
    );
  }
}

function assertNoMojibakeQuestionMarks(scenarioId, text) {
  if (/\p{Script=Han}/u.test(text) && /\?{2,}/u.test(text)) {
    throw new HarnessEncodingError(scenarioId, text.search(/\?{2,}/u));
  }
}

function validateScenarioData(data) {
  if (!isRecord(data) || data.version !== 1) {
    throw new Error("Invalid TASK-B03 scenario data: version");
  }
  if (!Array.isArray(data.encodingChecks) || data.encodingChecks.length < 3) {
    throw new Error("Invalid TASK-B03 scenario data: encodingChecks");
  }
  if (!isRecord(data.gates) || !Array.isArray(data.formalScenarios)) {
    throw new Error("Invalid TASK-B03 scenario data: scenario collections");
  }

  const ids = new Set();
  for (const item of data.encodingChecks) {
    if (!isRecord(item)) throw new Error("Invalid TASK-B03 encoding check");
    const id = requireText(item.id, "encodingChecks.id");
    requireText(item.text, `${id}.text`);
  }
  for (const [gateName, gate] of Object.entries(data.gates)) {
    if (!isRecord(gate)) throw new Error(`Invalid TASK-B03 gate: ${gateName}`);
    requireText(gate.id, `${gateName}.id`);
    requireText(gate.message, `${gateName}.message`);
    requireText(gate.domain, `${gateName}.domain`);
  }
  for (const scenario of data.formalScenarios) {
    if (!isRecord(scenario)) throw new Error("Invalid TASK-B03 formal scenario");
    const id = requireText(scenario.id, "formalScenarios.id");
    if (ids.has(id)) throw new Error(`Duplicate TASK-B03 scenario id: ${id}`);
    ids.add(id);
    requireText(scenario.input, `${id}.input`);
    requireText(scenario.expected, `${id}.expected`);
    if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
      throw new Error(`Invalid TASK-B03 scenario steps: ${id}`);
    }
    for (const step of scenario.steps) {
      if (!isRecord(step)) throw new Error(`Invalid TASK-B03 step: ${id}`);
      requireText(step.action, `${id}.step.action`);
      requireText(step.message, `${id}.step.message`);
    }
  }
  return data;
}

export function loadTaskB03ScenarioData(
  scenarioDataPath = TASK_B03_SCENARIO_DATA_PATH,
) {
  const fileText = readFileSync(scenarioDataPath, "utf8");
  return validateScenarioData(JSON.parse(fileText));
}

export const TASK_B03_SCENARIO_DATA = loadTaskB03ScenarioData();

export function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function verifyEncodingRoundTrip(scenarioId, text, expectedText = text) {
  assertExactText(scenarioId, text, expectedText);
  const jsonRoundTrip = JSON.parse(JSON.stringify({ message: text })).message;
  assertExactText(scenarioId, jsonRoundTrip, expectedText);
  const bufferRoundTrip = Buffer.from(text, "utf8").toString("utf8");
  assertExactText(scenarioId, bufferRoundTrip, expectedText);
  assertNoMojibakeQuestionMarks(scenarioId, text);
  assertNoMojibakeQuestionMarks(scenarioId, jsonRoundTrip);
  assertNoMojibakeQuestionMarks(scenarioId, bufferRoundTrip);
  return { scenarioId, sha256: sha256Text(text) };
}

export function prepareUtf8JsonRequest({
  scenarioId,
  currentMessage,
  originalMessage,
  payload,
}) {
  try {
    assertExactText(scenarioId, currentMessage, originalMessage);
    const serializedBody = JSON.stringify(payload);
    const parsedBody = JSON.parse(serializedBody);
    assertExactText(scenarioId, parsedBody.message, originalMessage);
    const utf8Body = Buffer.from(serializedBody, "utf8");
    const decodedBody = utf8Body.toString("utf8");
    const decodedMessage = JSON.parse(decodedBody).message;
    assertExactText(scenarioId, decodedMessage, originalMessage);
    assertNoMojibakeQuestionMarks(scenarioId, decodedMessage);
    return {
      body: decodedBody,
      messageSha256: sha256Text(originalMessage),
    };
  } catch (error) {
    if (error instanceof HarnessEncodingError) throw error;
    throw new HarnessEncodingError(scenarioId, -1);
  }
}
