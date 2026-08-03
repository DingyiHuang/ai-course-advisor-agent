import { isConversationId } from "@/lib/history/conversationStore";
import { createConversationStore } from "@/lib/history/createConversationStore";
import { conversationStoreErrorResponse } from "@/lib/history/http";
import { ConversationStoreError } from "@/lib/history/conversationStore";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const { sessionId } = await params;
    if (!isConversationId(sessionId)) {
      throw new ConversationStoreError("invalid_input");
    }
    const messages = await createConversationStore().getMessages(sessionId);
    return Response.json({ messages });
  } catch (error) {
    return conversationStoreErrorResponse(error);
  }
}
