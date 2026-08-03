import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const constructorCalls = vi.hoisted(() => ({
  blob: [] as unknown[],
  json: [] as unknown[],
  supabase: [] as unknown[],
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/history/localJsonConversationStore", () => ({
  LocalJsonConversationStore: class LocalJsonConversationStore {
    constructor(options: unknown) {
      constructorCalls.json.push(options);
    }

    async createSession() {
      return undefined;
    }

    async appendMessage() {
      return undefined;
    }

    async getMessages() {
      return [];
    }
  },
}));

vi.mock("@/lib/history/supabaseConversationStore", () => ({
  SupabaseConversationStore: class SupabaseConversationStore {
    constructor(options: unknown) {
      constructorCalls.supabase.push(options);
    }

    async createSession() {
      return undefined;
    }

    async appendMessage() {
      return undefined;
    }

    async getMessages() {
      return [];
    }
  },
}));

vi.mock("@/lib/history/vercelBlobConversationStore", () => ({
  BlobConversationStore: class BlobConversationStore {
    constructor(options: unknown) {
      constructorCalls.blob.push(options);
    }

    async createSession() {
      return undefined;
    }

    async appendMessage() {
      return undefined;
    }

    async getMessages() {
      return [];
    }
  },
}));

import {
  ConversationStoreError,
  type ConversationStoreErrorCode,
} from "@/lib/history/conversationStore";
import { createConversationStore } from "@/lib/history/createConversationStore";
import { LocalJsonConversationStore } from "@/lib/history/localJsonConversationStore";
import { SupabaseConversationStore } from "@/lib/history/supabaseConversationStore";
import { BlobConversationStore } from "@/lib/history/vercelBlobConversationStore";

function expectSynchronousStoreError(
  operation: () => unknown,
  code: ConversationStoreErrorCode,
): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ConversationStoreError);
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected ConversationStoreError with code ${code}.`);
}

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFilesUnder(absolutePath);
    }

    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [absolutePath] : [];
  });
}

describe("conversation store factory", () => {
  beforeEach(() => {
    constructorCalls.blob.length = 0;
    constructorCalls.json.length = 0;
    constructorCalls.supabase.length = 0;
  });

  it("selects the JSON implementation without changing the call shape", () => {
    const store = createConversationStore({
      CONVERSATION_STORE: "json",
      LOCAL_HISTORY_DIR: ".data/chat-history-test",
    });

    expect(store).toBeInstanceOf(LocalJsonConversationStore);
    expect(constructorCalls.json).toEqual([
      { rootDirectory: ".data/chat-history-test" },
    ]);
  });

  it("selects the Supabase implementation and prefers the secret key", () => {
    const store = createConversationStore({
      CONVERSATION_STORE: "supabase",
      SUPABASE_URL: "https://supabase-test.invalid",
      SUPABASE_SECRET_KEY: "preferred-key-test-placeholder",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test-placeholder",
    });

    expect(store).toBeInstanceOf(SupabaseConversationStore);
    expect(constructorCalls.supabase).toEqual([
      {
        url: "https://supabase-test.invalid",
        secretKey: "preferred-key-test-placeholder",
      },
    ]);
  });

  it("falls back to the legacy Supabase service-role key", () => {
    createConversationStore({
      CONVERSATION_STORE: "supabase",
      SUPABASE_URL: "https://supabase-test.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test-placeholder",
    });

    expect(constructorCalls.supabase).toEqual([
      {
        url: "https://supabase-test.invalid",
        secretKey: "service-role-test-placeholder",
      },
    ]);
  });

  it("selects the Blob implementation", () => {
    const store = createConversationStore({
      CONVERSATION_STORE: "blob",
      BLOB_READ_WRITE_TOKEN: "blob-test-placeholder",
    });

    expect(store).toBeInstanceOf(BlobConversationStore);
    expect(constructorCalls.blob).toEqual([
      { token: "blob-test-placeholder" },
    ]);
  });

  it("does not allow Blob selection without its server token", () => {
    expectSynchronousStoreError(
      () => createConversationStore({ CONVERSATION_STORE: "blob" }),
      "configuration_error",
    );
  });

  it.each([undefined, "", "unknown"])(
    "rejects a missing or invalid store selector (%s)",
    (selector) => {
      expectSynchronousStoreError(
        () => createConversationStore({ CONVERSATION_STORE: selector }),
        "configuration_error",
      );
    },
  );

  it.each([
    ["json", { CONVERSATION_STORE: "json" }],
    [
      "supabase",
      {
        CONVERSATION_STORE: "supabase",
        SUPABASE_URL: "https://supabase-test.invalid",
        SUPABASE_SECRET_KEY: "preferred-key-test-placeholder",
      },
    ],
    [
      "blob",
      {
        CONVERSATION_STORE: "blob",
        BLOB_READ_WRITE_TOKEN: "blob-test-placeholder",
      },
    ],
  ] as const)("keeps the shared method shape for %s", async (_name, environment) => {
    const store = createConversationStore(environment);

    expect(typeof store.createSession).toBe("function");
    expect(typeof store.appendMessage).toBe("function");
    await expect(
      store.getMessages("00000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual([]);
  });
});

describe("Blob contract shell", () => {
  it("builds the required one-object-per-message pathname", async () => {
    const { blobMessageObjectName } = await vi.importActual<
      typeof import("@/lib/history/vercelBlobConversationStore")
    >("@/lib/history/vercelBlobConversationStore");

    expect(
      blobMessageObjectName({
        sessionId: "session-123",
        timestamp: "2026-08-03T06:07:08.009Z",
        messageId: "message-456",
      }),
    ).toBe(
      "sessions/session-123/messages/2026-08-03T06:07:08.009Z-message-456.json",
    );
  });

  it.each([
    { sessionId: "../session", timestamp: "2026-08-03T06:07:08.009Z", messageId: "message-456" },
    { sessionId: "session-123", timestamp: "not-a-timestamp", messageId: "message-456" },
    { sessionId: "session-123", timestamp: "2026-08-03T06:07:08.009Z", messageId: "message/456" },
  ])("rejects unsafe pathname input", async (input) => {
    const { blobMessageObjectName } = await vi.importActual<
      typeof import("@/lib/history/vercelBlobConversationStore")
    >("@/lib/history/vercelBlobConversationStore");

    expectSynchronousStoreError(
      () => blobMessageObjectName(input),
      "invalid_input",
    );
  });

  it("uses unsupported_operation for every unimplemented method", async () => {
    const { BlobConversationStore: ActualBlobConversationStore } =
      await vi.importActual<
        typeof import("@/lib/history/vercelBlobConversationStore")
      >("@/lib/history/vercelBlobConversationStore");
    const store = new ActualBlobConversationStore({
      token: "blob-test-placeholder",
    });

    await expect(store.createSession({})).rejects.toMatchObject({
      code: "unsupported_operation",
    });
    await expect(
      store.appendMessage({
        sessionId: "session-123",
        role: "user",
        content: "test message",
      }),
    ).rejects.toMatchObject({ code: "unsupported_operation" });
    await expect(store.getMessages("session-123")).rejects.toMatchObject({
      code: "unsupported_operation",
    });
  });
});

describe("storage configuration boundaries", () => {
  it("keeps the local JSON history directory ignored by Git", () => {
    expect(() =>
      execFileSync(
        "git",
        [
          "check-ignore",
          "--quiet",
          "--no-index",
          ".data/chat-history/contract-test.json",
        ],
        { cwd: process.cwd(), stdio: "ignore" },
      ),
    ).not.toThrow();
  });

  it("lists only empty Supabase credential placeholders", () => {
    const example = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");

    expect(example).toMatch(/^CONVERSATION_STORE=supabase$/m);
    expect(example).toMatch(/^SUPABASE_URL=$/m);
    expect(example).toMatch(/^SUPABASE_SECRET_KEY=$/m);
    expect(example).toMatch(/^SUPABASE_SERVICE_ROLE_KEY=$/m);
    expect(example).toMatch(/^BLOB_READ_WRITE_TOKEN=$/m);
    expect(example).toMatch(/^LOCAL_HISTORY_DIR=\.data\/chat-history$/m);
  });

  it("keeps every Supabase key reference inside a server-only source module", () => {
    const sourceRoot = path.join(process.cwd(), "src");
    const forbiddenPattern =
      /SUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY)/;
    const matches = sourceFilesUnder(sourceRoot).filter((file) =>
      forbiddenPattern.test(readFileSync(file, "utf8")),
    );

    expect(matches.length).toBeGreaterThan(0);
    for (const file of matches) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain('import "server-only";');
      expect(source).not.toMatch(/^\s*["']use client["'];/m);
    }
  });
});
