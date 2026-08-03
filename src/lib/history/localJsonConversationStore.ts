import "server-only";

import { randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { ConversationStore } from "./conversationStore";
import {
  ConversationStoreError,
  isConversationId,
} from "./conversationStore";
import type {
  AppendMessageInput,
  ChatMessage,
  ChatSession,
  CreateSessionInput,
} from "./types";

export type LocalJsonConversationStoreOptions = {
  rootDirectory?: string;
};

const DEFAULT_ROOT_DIRECTORY = ".data/chat-history";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "object") {
    return false;
  }

  if (ancestors.has(value)) {
    return false;
  }

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, ancestors))
    : isPlainObject(value) &&
      Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function cloneJsonObject(value: unknown): ChatSession["metadata"] {
  if (!isPlainObject(value) || !isJsonValue(value)) {
    throw new ConversationStoreError("invalid_input");
  }

  return JSON.parse(JSON.stringify(value)) as ChatSession["metadata"];
}

function normalizeSources(value: unknown): ChatMessage["sources"] {
  if (!Array.isArray(value)) {
    throw new ConversationStoreError("invalid_input");
  }

  return value.map((source) => {
    if (
      !isPlainObject(source) ||
      !["A", "B", "C"].includes(String(source.document)) ||
      typeof source.chapter !== "string" ||
      source.chapter.trim().length === 0 ||
      (source.section !== undefined && typeof source.section !== "string") ||
      !Array.isArray(source.factIds) ||
      !source.factIds.every(
        (factId) => typeof factId === "string" && factId.trim().length > 0,
      )
    ) {
      throw new ConversationStoreError("invalid_input");
    }

    return {
      document: source.document as "A" | "B" | "C",
      chapter: source.chapter,
      ...(source.section === undefined ? {} : { section: source.section }),
      factIds: [...source.factIds] as string[],
    };
  });
}

function assertConversationId(value: unknown): asserts value is string {
  if (!isConversationId(value)) {
    throw new ConversationStoreError("invalid_input");
  }
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new ConversationStoreError("invalid_input");
  }

  return new Date(value).toISOString();
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function persistenceError(error: unknown): ConversationStoreError {
  return error instanceof ConversationStoreError
    ? error
    : new ConversationStoreError("persistence_error");
}

function parseSession(value: unknown, expectedId: string): ChatSession {
  if (
    !isPlainObject(value) ||
    value.id !== expectedId ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !isPlainObject(value.metadata) ||
    !isJsonValue(value.metadata)
  ) {
    throw new Error("Invalid local conversation session data.");
  }

  return {
    id: value.id,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    metadata: cloneJsonObject(value.metadata),
  };
}

function parseMessage(value: unknown, expectedSessionId: string): ChatMessage {
  if (
    !isPlainObject(value) ||
    typeof value.id !== "string" ||
    !isConversationId(value.id) ||
    value.sessionId !== expectedSessionId ||
    !["user", "assistant", "system"].includes(String(value.role)) ||
    typeof value.content !== "string" ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !isPlainObject(value.metadata) ||
    !isJsonValue(value.metadata)
  ) {
    throw new Error("Invalid local conversation message data.");
  }

  let sources: ChatMessage["sources"];
  try {
    sources = normalizeSources(value.sources);
  } catch {
    throw new Error("Invalid local conversation message data.");
  }

  return {
    id: value.id,
    sessionId: value.sessionId,
    role: value.role as ChatMessage["role"],
    content: value.content,
    sources,
    metadata: cloneJsonObject(value.metadata),
    createdAt: value.createdAt,
  };
}

function isIdempotentRetry(
  existing: ChatMessage,
  candidate: ChatMessage,
): boolean {
  return (
    existing.id === candidate.id &&
    existing.sessionId === candidate.sessionId &&
    existing.role === candidate.role &&
    existing.content === candidate.content &&
    isDeepStrictEqual(existing.sources, candidate.sources) &&
    isDeepStrictEqual(existing.metadata, candidate.metadata)
  );
}

export class LocalJsonConversationStore implements ConversationStore {
  private readonly sessionsDirectory: string;

  constructor(options: LocalJsonConversationStoreOptions = {}) {
    const configuredRoot = options.rootDirectory?.trim();
    const rootDirectory = path.resolve(
      configuredRoot || DEFAULT_ROOT_DIRECTORY,
    );
    this.sessionsDirectory = path.join(rootDirectory, "sessions");
  }

  private sessionDirectory(sessionId: string): string {
    assertConversationId(sessionId);
    return path.join(this.sessionsDirectory, sessionId);
  }

  private sessionFile(sessionId: string): string {
    return path.join(this.sessionDirectory(sessionId), "session.json");
  }

  private messagesDirectory(sessionId: string): string {
    return path.join(this.sessionDirectory(sessionId), "messages");
  }

  private async writeJsonAtomically(
    targetPath: string,
    value: ChatSession | ChatMessage,
  ): Promise<void> {
    const temporaryPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.${randomUUID()}.tmp`,
    );

    try {
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporaryPath, targetPath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  private async createJsonAtomically(
    targetPath: string,
    value: ChatMessage,
  ): Promise<void> {
    const temporaryPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.${randomUUID()}.tmp`,
    );

    try {
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await link(temporaryPath, targetPath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  private async readSession(sessionId: string): Promise<ChatSession> {
    try {
      const contents = await readFile(this.sessionFile(sessionId), "utf8");
      return parseSession(JSON.parse(contents) as unknown, sessionId);
    } catch (error) {
      if (error instanceof ConversationStoreError) {
        throw error;
      }
      if (isNodeError(error, "ENOENT")) {
        throw new ConversationStoreError("session_not_found");
      }
      throw new ConversationStoreError("persistence_error");
    }
  }

  async createSession(input: CreateSessionInput): Promise<ChatSession> {
    if (!isPlainObject(input)) {
      throw new ConversationStoreError("invalid_input");
    }
    const metadata = cloneJsonObject(input.metadata ?? {});

    try {
      await mkdir(this.sessionsDirectory, { recursive: true });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const id = randomUUID();
        const sessionDirectory = this.sessionDirectory(id);
        try {
          await mkdir(sessionDirectory);
        } catch (error) {
          if (isNodeError(error, "EEXIST")) {
            continue;
          }
          throw error;
        }

        const timestamp = new Date().toISOString();
        const session: ChatSession = {
          id,
          createdAt: timestamp,
          updatedAt: timestamp,
          metadata,
        };
        await mkdir(this.messagesDirectory(id));
        await this.writeJsonAtomically(this.sessionFile(id), session);
        return session;
      }

      throw new Error("Unable to allocate a unique conversation session ID.");
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async appendMessage(input: AppendMessageInput): Promise<ChatMessage> {
    if (!isPlainObject(input)) {
      throw new ConversationStoreError("invalid_input");
    }
    assertConversationId(input.sessionId);
    if (input.id !== undefined) {
      assertConversationId(input.id);
    }
    if (
      !["user", "assistant", "system"].includes(String(input.role)) ||
      typeof input.content !== "string" ||
      input.content.length === 0
    ) {
      throw new ConversationStoreError("invalid_input");
    }

    const id = input.id ?? randomUUID();
    const createdAt =
      input.createdAt === undefined
        ? new Date().toISOString()
        : normalizeTimestamp(input.createdAt);
    const sources = normalizeSources(input.sources ?? []);
    const metadata = cloneJsonObject(input.metadata ?? {});

    try {
      const session = await this.readSession(input.sessionId);
      const message: ChatMessage = {
        id,
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        sources,
        metadata,
        createdAt,
      };
      const messagePath = path.join(
        this.messagesDirectory(input.sessionId),
        `${id}.json`,
      );

      try {
        await this.createJsonAtomically(messagePath, message);
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) {
          throw error;
        }

        const existing = parseMessage(
          JSON.parse(await readFile(messagePath, "utf8")) as unknown,
          input.sessionId,
        );
        if (isIdempotentRetry(existing, message)) {
          return existing;
        }
        throw new ConversationStoreError("invalid_input");
      }
      await this.writeJsonAtomically(this.sessionFile(input.sessionId), {
        ...session,
        updatedAt: new Date().toISOString(),
      });
      return message;
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    assertConversationId(sessionId);

    try {
      await this.readSession(sessionId);
      const entries = await readdir(this.messagesDirectory(sessionId), {
        withFileTypes: true,
      });
      const messages = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => {
            const contents = await readFile(
              path.join(this.messagesDirectory(sessionId), entry.name),
              "utf8",
            );
            return parseMessage(JSON.parse(contents) as unknown, sessionId);
          }),
      );

      return messages.sort((left, right) => {
        const timestampDifference =
          Date.parse(left.createdAt) - Date.parse(right.createdAt);
        return timestampDifference || left.id.localeCompare(right.id);
      });
    } catch (error) {
      throw persistenceError(error);
    }
  }
}
