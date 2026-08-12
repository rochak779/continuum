import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, X } from "lucide-react";
import Markdown from "react-markdown";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { assistantChatFn } from "@/integrations/assistant/chat-fn";

// Assistant replies are chat prose, not documents -- render only inline
// emphasis, line breaks and short lists. Headings/rules/tables are
// intentionally unmapped (fall through as plain text) so a model that
// drifts back into report-style markdown doesn't render a heading or a
// horizontal rule inside a chat bubble.
const MARKDOWN_COMPONENTS = {
  h1: "p",
  h2: "p",
  h3: "p",
  h4: "p",
  h5: "p",
  h6: "p",
  hr: () => null,
  a: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
} as const;

type ChatMessage = { id: number; role: "user" | "assistant"; text: string; isLocal?: boolean };

const initialMessages: ChatMessage[] = [
  {
    id: 0,
    role: "assistant",
    text: "Hi! I'm your Continuum assistant. Ask me about vendor risk, alerts or upcoming reviews.",
    isLocal: true,
  },
];

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const nextMessages: ChatMessage[] = [...messages, { id: messages.length, role: "user", text }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);

    try {
      const result = await assistantChatFn({
        data: {
          messages: nextMessages.filter((m) => !m.isLocal).map((m) => ({ role: m.role, text: m.text })),
        },
      });
      setMessages((current) => [...current, { id: current.length, role: "assistant", text: result.text }]);
    } catch {
      // User-facing chat prose -- never surface raw error text (which may
      // contain internal Supabase/env details) in a chat bubble.
      setMessages((current) => [
        ...current,
        {
          id: current.length,
          role: "assistant",
          text: "Something went wrong, try again.",
          isLocal: true,
        },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[480px] w-[min(380px,calc(100vw-3rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-elevated">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Bot className="h-4 w-4" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Continuum Assistant</p>
              <p className="text-xs text-muted-foreground">Vendor intelligence, on demand</p>
            </div>
            <button
              type="button"
              aria-label="Close assistant"
              onClick={() => setOpen(false)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                {m.role === "user" ? (
                  <p className="max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {m.text}
                  </p>
                ) : (
                  <div
                    className="max-w-[85%] rounded-2xl px-3 py-2 text-sm text-foreground
                      [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0
                      [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4
                      [&_li]:my-0.5 [&_strong]:font-semibold"
                  >
                    <Markdown components={MARKDOWN_COMPONENTS}>{m.text}</Markdown>
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Thinking…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-border p-3">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about a vendor..."
              disabled={sending}
              className="h-10"
            />
            <Button
              type="submit"
              size="icon"
              className="h-10 w-10 shrink-0"
              aria-label="Send"
              disabled={sending || !input.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-elevated transition-transform hover:scale-105"
      >
        {open ? <X className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
      </button>
    </>
  );
}
