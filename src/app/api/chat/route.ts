import { runConversationTurn } from "@/lib/conversation/orchestrator";
import { createClassifier } from "@/lib/llm/classifier";
import { createComposer } from "@/lib/llm/composer";
import { createRuntimeLlmClient } from "@/lib/llm/runtime";
import { shanghaiToday } from "@/lib/time/shanghai";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  let runtimeClient: ReturnType<typeof createRuntimeLlmClient> | undefined;
  const getClient = () => {
    runtimeClient ??= createRuntimeLlmClient();
    return runtimeClient;
  };
  const response = await runConversationTurn(body, {
    currentDate: shanghaiToday(),
    classifier: {
      classify: (message, state) =>
        createClassifier(getClient()).classify(message, state),
    },
    composer: {
      composeOnce: (plan, history) =>
        createComposer(getClient()).composeOnce(plan, history),
    },
  });
  const status = response.error
    ? response.error.retryable
      ? 503
      : 400
    : 200;
  return Response.json(response, { status });
}
