import { createConversationStore } from "@/lib/history/createConversationStore";
import { conversationStoreErrorResponse } from "@/lib/history/http";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  try {
    const session = await createConversationStore().createSession({
      metadata: { channel: "web" },
    });
    return Response.json({ session }, { status: 201 });
  } catch (error) {
    return conversationStoreErrorResponse(error);
  }
}
