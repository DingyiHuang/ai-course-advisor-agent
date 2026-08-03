import "server-only";

import type { ConversationStore } from "./conversationStore";
import { ConversationStoreError } from "./conversationStore";
import { LocalJsonConversationStore } from "./localJsonConversationStore";
import { SupabaseConversationStore } from "./supabaseConversationStore";
import { BlobConversationStore } from "./vercelBlobConversationStore";

export type ConversationStoreEnvironment = {
  CONVERSATION_STORE?: string;
  LOCAL_HISTORY_DIR?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  BLOB_READ_WRITE_TOKEN?: string;
};

function runtimeEnvironment(): ConversationStoreEnvironment {
  return {
    CONVERSATION_STORE: process.env.CONVERSATION_STORE,
    LOCAL_HISTORY_DIR: process.env.LOCAL_HISTORY_DIR,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
  };
}

export function createConversationStore(
  environment: ConversationStoreEnvironment = runtimeEnvironment(),
): ConversationStore {
  switch (environment.CONVERSATION_STORE) {
    case "json":
      return new LocalJsonConversationStore({
        rootDirectory: environment.LOCAL_HISTORY_DIR,
      });
    case "supabase":
      return new SupabaseConversationStore({
        url: environment.SUPABASE_URL,
        secretKey:
          environment.SUPABASE_SECRET_KEY ??
          environment.SUPABASE_SERVICE_ROLE_KEY,
      });
    case "blob":
      if (!environment.BLOB_READ_WRITE_TOKEN?.trim()) {
        throw new ConversationStoreError("configuration_error");
      }
      return new BlobConversationStore({
        token: environment.BLOB_READ_WRITE_TOKEN,
      });
    default:
      throw new ConversationStoreError("configuration_error");
  }
}
