import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ConversationStore } from "./conversationStore";
import {
  ConversationStoreError,
  isConversationId,
} from "./conversationStore";
import type {
  AppendMessageInput,
  ChatMessage,
  ChatMessageRole,
  ChatSession,
  CreateSessionInput,
  JsonObject,
  JsonValue,
} from "./types";

const SESSION_COLUMNS = "id, created_at, updated_at, metadata";
const MESSAGE_COLUMNS =
  "id, session_id, role, content, sources, metadata, created_at";

export type SupabaseGatewayResult = {
  data: unknown;
  error: unknown;
};

export type SupabaseMessageInsert = {
  id?: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  sources: ChatMessage["sources"];
  metadata: JsonObject;
  createdAt?: string;
};

export interface SupabaseConversationGateway {
  insertSession(metadata: JsonObject): Promise<SupabaseGatewayResult>;
  selectSession(sessionId: string): Promise<SupabaseGatewayResult>;
  insertMessage(input: SupabaseMessageInsert): Promise<SupabaseGatewayResult>;
  listMessages(sessionId: string): Promise<SupabaseGatewayResult>;
}

export type SupabaseServerClientOptions = {
  auth: {
    persistSession: false;
    autoRefreshToken: false;
    detectSessionInUrl: false;
  };
};

export type SupabaseClientFactory = (
  url: string,
  secretKey: string,
  options: SupabaseServerClientOptions,
) => SupabaseClient;

export type SupabaseConversationStoreOptions = {
  url?: string;
  secretKey?: string;
  gateway?: SupabaseConversationGateway;
  clientFactory?: SupabaseClientFactory;
};

const SERVER_CLIENT_OPTIONS: SupabaseServerClientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

const defaultClientFactory: SupabaseClientFactory = (
  url,
  secretKey,
  options,
) => createClient(url, secretKey, options);

class SupabaseJsConversationGateway implements SupabaseConversationGateway {
  constructor(private readonly client: SupabaseClient) {}

  async insertSession(metadata: JsonObject): Promise<SupabaseGatewayResult> {
    const { data, error } = await this.client
      .from("chat_sessions")
      .insert({ metadata })
      .select(SESSION_COLUMNS)
      .single();

    return { data, error };
  }

  async selectSession(sessionId: string): Promise<SupabaseGatewayResult> {
    const { data, error } = await this.client
      .from("chat_sessions")
      .select(SESSION_COLUMNS)
      .eq("id", sessionId)
      .maybeSingle();

    return { data, error };
  }

  async insertMessage(
    input: SupabaseMessageInsert,
  ): Promise<SupabaseGatewayResult> {
    const row = {
      session_id: input.sessionId,
      role: input.role,
      content: input.content,
      sources: input.sources,
      metadata: input.metadata,
      ...(input.id === undefined ? {} : { id: input.id }),
      ...(input.createdAt === undefined
        ? {}
        : { created_at: input.createdAt }),
    };
    const { data, error } = await this.client
      .from("chat_messages")
      .insert(row)
      .select(MESSAGE_COLUMNS)
      .single();

    return { data, error };
  }

  async listMessages(sessionId: string): Promise<SupabaseGatewayResult> {
    const { data, error } = await this.client
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    return { data, error };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
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

  if (typeof value !== "object" || ancestors.has(value)) {
    return false;
  }

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, ancestors))
    : Object.values(value).every((item) => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && isJsonValue(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRole(value: unknown): value is ChatMessageRole {
  return value === "user" || value === "assistant" || value === "system";
}

function isCollectedSource(
  value: unknown,
): value is ChatMessage["sources"][number] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.document === "A" ||
      value.document === "B" ||
      value.document === "C") &&
    isNonEmptyString(value.chapter) &&
    (value.section === undefined || typeof value.section === "string") &&
    Array.isArray(value.factIds) &&
    value.factIds.every(isNonEmptyString)
  );
}

function normalizeSources(
  value: unknown,
  errorCode: "invalid_input" | "persistence_error",
): ChatMessage["sources"] {
  if (!Array.isArray(value) || !value.every(isCollectedSource)) {
    throw new ConversationStoreError(errorCode);
  }

  return value.map((source) => ({
    document: source.document,
    chapter: source.chapter,
    ...(source.section === undefined ? {} : { section: source.section }),
    factIds: [...source.factIds],
  }));
}

function asIsoTimestamp(value: unknown): string {
  if (typeof value !== "string") {
    throw new ConversationStoreError("persistence_error");
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new ConversationStoreError("persistence_error");
  }

  return timestamp.toISOString();
}

function mapSession(value: unknown): ChatSession {
  if (!isRecord(value)) {
    throw new ConversationStoreError("persistence_error");
  }

  const { id, created_at: createdAt, updated_at: updatedAt, metadata } = value;
  if (!isConversationId(id) || !isJsonObject(metadata)) {
    throw new ConversationStoreError("persistence_error");
  }

  return {
    id,
    createdAt: asIsoTimestamp(createdAt),
    updatedAt: asIsoTimestamp(updatedAt),
    metadata,
  };
}

function mapMessage(value: unknown): ChatMessage {
  if (!isRecord(value)) {
    throw new ConversationStoreError("persistence_error");
  }

  const {
    id,
    session_id: sessionId,
    role,
    content,
    sources,
    metadata,
    created_at: createdAt,
  } = value;

  if (
    !isConversationId(id) ||
    !isConversationId(sessionId) ||
    !isRole(role) ||
    typeof content !== "string" ||
    !isJsonObject(metadata)
  ) {
    throw new ConversationStoreError("persistence_error");
  }

  return {
    id,
    sessionId,
    role,
    content,
    sources: normalizeSources(sources, "persistence_error"),
    metadata,
    createdAt: asIsoTimestamp(createdAt),
  };
}

function assertCreateSessionInput(input: CreateSessionInput): JsonObject {
  if (!isRecord(input)) {
    throw new ConversationStoreError("invalid_input");
  }

  const metadata = input.metadata ?? {};
  if (!isJsonObject(metadata)) {
    throw new ConversationStoreError("invalid_input");
  }

  return metadata;
}

function normalizeAppendInput(input: AppendMessageInput): SupabaseMessageInsert {
  if (
    !isRecord(input) ||
    !isConversationId(input.sessionId) ||
    !isRole(input.role) ||
    typeof input.content !== "string" ||
    input.content.length === 0 ||
    (input.id !== undefined && !isConversationId(input.id)) ||
    (input.createdAt !== undefined &&
      (typeof input.createdAt !== "string" ||
        Number.isNaN(new Date(input.createdAt).getTime())))
  ) {
    throw new ConversationStoreError("invalid_input");
  }

  const sources = normalizeSources(input.sources ?? [], "invalid_input");
  const metadata = input.metadata ?? {};
  if (!isJsonObject(metadata)) {
    throw new ConversationStoreError("invalid_input");
  }

  return {
    id: input.id,
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    sources,
    metadata,
    createdAt:
      input.createdAt === undefined
        ? undefined
        : new Date(input.createdAt).toISOString(),
  };
}

function compareMessages(left: ChatMessage, right: ChatMessage): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }

  if (left.id === right.id) {
    return 0;
  }

  return left.id < right.id ? -1 : 1;
}

function assertGatewaySuccess(result: SupabaseGatewayResult): unknown {
  if (result.error !== null) {
    throw new ConversationStoreError("persistence_error");
  }

  return result.data;
}

function normalizeUnexpectedError(error: unknown): never {
  if (error instanceof ConversationStoreError) {
    throw error;
  }

  throw new ConversationStoreError("persistence_error");
}

export class SupabaseConversationStore implements ConversationStore {
  private readonly gateway: SupabaseConversationGateway;

  constructor(options: SupabaseConversationStoreOptions = {}) {
    if (options.gateway !== undefined) {
      this.gateway = options.gateway;
      return;
    }

    if (!isNonEmptyString(options.url) || !isNonEmptyString(options.secretKey)) {
      throw new ConversationStoreError("configuration_error");
    }

    try {
      const client = (options.clientFactory ?? defaultClientFactory)(
        options.url,
        options.secretKey,
        SERVER_CLIENT_OPTIONS,
      );
      this.gateway = new SupabaseJsConversationGateway(client);
    } catch {
      throw new ConversationStoreError("configuration_error");
    }
  }

  async createSession(input: CreateSessionInput): Promise<ChatSession> {
    try {
      const metadata = assertCreateSessionInput(input);
      const result = await this.gateway.insertSession(metadata);
      return mapSession(assertGatewaySuccess(result));
    } catch (error) {
      return normalizeUnexpectedError(error);
    }
  }

  async appendMessage(input: AppendMessageInput): Promise<ChatMessage> {
    try {
      const normalizedInput = normalizeAppendInput(input);
      await this.assertSessionExists(normalizedInput.sessionId);
      const result = await this.gateway.insertMessage(normalizedInput);
      return mapMessage(assertGatewaySuccess(result));
    } catch (error) {
      return normalizeUnexpectedError(error);
    }
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    try {
      if (!isConversationId(sessionId)) {
        throw new ConversationStoreError("invalid_input");
      }

      await this.assertSessionExists(sessionId);
      const result = await this.gateway.listMessages(sessionId);
      const data = assertGatewaySuccess(result);
      if (!Array.isArray(data)) {
        throw new ConversationStoreError("persistence_error");
      }

      return data.map(mapMessage).sort(compareMessages);
    } catch (error) {
      return normalizeUnexpectedError(error);
    }
  }

  private async assertSessionExists(sessionId: string): Promise<void> {
    const result = await this.gateway.selectSession(sessionId);
    const data = assertGatewaySuccess(result);
    if (data === null) {
      throw new ConversationStoreError("session_not_found");
    }

    mapSession(data);
  }
}
