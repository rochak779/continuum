import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { assistantChatFn } from "@/integrations/assistant/chat-fn";
import { getErrorMessage } from "@/lib/errors";

type ChatMessage = { id: number; role: "user" | "assistant"; text: string };

const initialMessages: ChatMessage[] = [
  {
    id: 0,
    role: "assistant",
    text: "Hi! I'm your Continuum assistant. Ask me about vendor risk, alerts or upcoming reviews.",
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
          messages: nextMessages.map((m) => ({ role: m.role, text: m.text })),
        },
      });
      setMessages((current) => [...current, { id: current.length, role: "assistant", text: result.text }]);
    } catch (err) {
      setMessages((current) => [
        ...current,
        {
          id: current.length,
          role: "assistant",
          text: getErrorMessage(err, "Something went wrong, try again."),
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
        <div className="fixed bottom-20 right-4 z-50 flex h-[28rem] w-80 flex-col rounded-lg border border-border bg-background shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Continuum Assistant</span>
            </div>
            <button type="button" aria-label="Close assistant" onClick={() => setOpen(false)}>
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "mr-auto max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-foreground"
                }
              >
                {m.text}
              </div>
            ))}
            {sending && (
              <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
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
              placeholder="Ask about a vendor…"
              disabled={sending}
              className="h-9 text-sm"
            />
            <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={sending || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
      <Button
        type="button"
        size="icon"
        aria-label={open ? "Close assistant" : "Open assistant"}
        className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg"
        onClick={() => setOpen((v) => !v)}
      >
        <Bot className="h-5 w-5" />
      </Button>
    </>
  );
}
