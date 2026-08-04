import { describe, expect, it, vi } from "vitest";
import {
  BrowserHistoryClientError,
  HISTORY_SESSION_KEY,
  initializeBrowserHistory,
  saveHistorySessionId,
  type BrowserStorage,
} from "@/lib/conversation/browserHistory";
import type { ChatSession } from "@/lib/history/types";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";

function session(id: string): ChatSession {
  return {
    id,
    createdAt: "2026-08-04T06:00:00.000Z",
    updatedAt: "2026-08-04T06:00:00.000Z",
    metadata: {},
  };
}

function storage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));
  const writes: Array<[string, string]> = [];
  return {
    adapter: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        writes.push([key, value]);
        values.set(key, value);
      },
    } satisfies BrowserStorage,
    values,
    writes,
  };
}

describe("browser history experience", () => {
  it("keeps the same session id when a refresh restores an existing session", async () => {
    const local = storage({ [HISTORY_SESSION_KEY]: SESSION_A });
    const createSession = vi.fn(async () => session(SESSION_B));
    const result = await initializeBrowserHistory({
      storage: local.adapter,
      loadMessages: vi.fn(async () => []),
      createSession,
    });

    expect(result.sessionId).toBe(SESSION_A);
    expect(result.outcome).toBe("restored");
    expect(createSession).not.toHaveBeenCalled();
    expect(local.writes).toEqual([]);
  });

  it("creates and stores a new session when no valid id exists", async () => {
    const local = storage({ [HISTORY_SESSION_KEY]: "not-a-session" });
    const result = await initializeBrowserHistory({
      storage: local.adapter,
      loadMessages: vi.fn(async () => []),
      createSession: vi.fn(async () => session(SESSION_B)),
    });

    expect(result.sessionId).toBe(SESSION_B);
    expect(result.outcome).toBe("created");
    expect(local.writes).toEqual([[HISTORY_SESSION_KEY, SESSION_B]]);
  });

  it("safely creates a new session when the saved session is not found", async () => {
    const local = storage({ [HISTORY_SESSION_KEY]: SESSION_A });
    const result = await initializeBrowserHistory({
      storage: local.adapter,
      loadMessages: vi.fn(async () => {
        throw new BrowserHistoryClientError("session_not_found");
      }),
      createSession: vi.fn(async () => session(SESSION_B)),
    });

    expect(result.sessionId).toBe(SESSION_B);
    expect(local.values.get(HISTORY_SESSION_KEY)).toBe(SESSION_B);
  });

  it("does not mask a persistence load failure by silently creating a session", async () => {
    const local = storage({ [HISTORY_SESSION_KEY]: SESSION_A });
    const createSession = vi.fn(async () => session(SESSION_B));
    await expect(
      initializeBrowserHistory({
        storage: local.adapter,
        loadMessages: vi.fn(async () => {
          throw new BrowserHistoryClientError("load_failed");
        }),
        createSession,
      }),
    ).rejects.toMatchObject({ code: "load_failed" });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("stores only the approved sessionId key and never chat content", () => {
    const local = storage();
    saveHistorySessionId(local.adapter, SESSION_A);
    expect(local.writes).toEqual([[HISTORY_SESSION_KEY, SESSION_A]]);
    expect(JSON.stringify(local.writes)).not.toContain("聊天正文");
  });

  it("restarting replaces the saved id with a newly created session id", () => {
    const local = storage({ [HISTORY_SESSION_KEY]: SESSION_A });
    saveHistorySessionId(local.adapter, SESSION_B);
    expect(local.values.get(HISTORY_SESSION_KEY)).toBe(SESSION_B);
    expect(local.values.get(HISTORY_SESSION_KEY)).not.toBe(SESSION_A);
  });
});
