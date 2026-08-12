// src/integrations/assistant/chat-fn.ts
//
// TanStack Start server function wrapper around runAssistantChat. Client
// code (AssistantWidget) calls this instead of importing chat.server.ts
// directly, keeping the Google API key and Supabase service context
// server-only (same convention as check.ts / resolve-alert-fn.ts). Auth is
// enforced by requireSupabaseAuth: context.supabase is already scoped to
// the calling user via their bearer token, and context.userId is their id.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface AssistantChatFnMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantChatFnInput {
  messages: AssistantChatFnMessage[];
}

const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 4000;

function validateInput(input: AssistantChatFnInput): AssistantChatFnInput {
  if (!input || !Array.isArray(input.messages) || input.messages.length === 0) {
    throw new Error("messages is required");
  }
  if (input.messages.length > MAX_MESSAGES) {
    throw new Error(`Too many messages (max ${MAX_MESSAGES})`);
  }
  for (const message of input.messages) {
    if (message.role !== "user" && message.role !== "assistant") {
      throw new Error("Each message must have role 'user' or 'assistant'");
    }
    if (typeof message.text !== "string" || message.text.trim().length === 0) {
      throw new Error("Each message must have non-empty text");
    }
    if (message.text.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message too long (max ${MAX_MESSAGE_LENGTH} characters)`);
    }
  }
  return input;
}

export const assistantChatFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateInput)
  .handler(async ({ data, context }) => {
    const { runAssistantChat } = await import("./chat.server");
    const text = await runAssistantChat({
      supabase: context.supabase,
      userId: context.userId,
      messages: data.messages,
    });
    return { text };
  });
