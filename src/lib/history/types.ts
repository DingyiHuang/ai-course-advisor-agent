import type { CollectedSource } from "@/lib/citations";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type ChatMessageRole = "user" | "assistant" | "system";

export type ChatSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  metadata: JsonObject;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  sources: CollectedSource[];
  metadata: JsonObject;
  createdAt: string;
};

export type CreateSessionInput = {
  metadata?: JsonObject;
};

export type AppendMessageInput = {
  id?: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  sources?: CollectedSource[];
  metadata?: JsonObject;
  createdAt?: string;
};
