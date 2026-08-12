// src/integrations/assistant/chat.server.ts
//
// Server-only: runs one assistant turn. Resolves tools against the
// caller's own RLS-scoped Supabase client and calls Gemini with
// tool-calling enabled, returning the final text answer. Non-streaming --
// matches every other server function in this codebase (design spec's
// "Response delivery" decision), so no new API-route infrastructure.

import { google } from "@ai-sdk/google";
import { generateText, stepCountIs } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildAssistantTools } from "./build-ai-tools";
import { createSupabaseAssistantStore } from "./store.server";
import { ASSISTANT_SYSTEM_PROMPT } from "./system-prompt";

export interface AssistantChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface RunAssistantChatInput {
  supabase: SupabaseClient;
  userId: string;
  messages: AssistantChatMessage[];
}

// Bounds how many tool-call round trips one turn can make (e.g. listVendors
// -> getVendorChanges chained by the model) -- caps latency/cost per turn.
const MAX_TOOL_STEPS = 5;

export async function runAssistantChat(input: RunAssistantChatInput): Promise<string> {
  const store = createSupabaseAssistantStore(input.supabase);
  const tools = buildAssistantTools(store, input.userId);

  const result = await generateText({
    model: google("gemini-3.5-flash"),
    system: ASSISTANT_SYSTEM_PROMPT,
    messages: input.messages.map((m) => ({ role: m.role, content: m.text })),
    tools,
    stopWhen: stepCountIs(MAX_TOOL_STEPS),
  });

  return result.text.trim() || "I couldn't find an answer to that.";
}
