"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface ConversationRow {
  id: string;
  title: string;
  model: string;
  provider: string;
  status: "active" | "cancelled" | "archived";
  updatedAt: string;
}

interface ModelRow {
  key: string;
  id: string;
  label: string;
  provider: string;
}

function useSessionId() {
  const [id, setId] = useState<string>("");
  useEffect(() => {
    let s = localStorage.getItem("inferlog_session");
    if (!s) {
      s = crypto.randomUUID();
      localStorage.setItem("inferlog_session", s);
    }
    setId(s);
  }, []);
  return id;
}

function textOf(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export default function ChatApp() {
  const sessionId = useSessionId();
  const [conversationId, setConversationId] = useState<string>("");
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [modelKey, setModelKey] = useState<string>("claude-sonnet");
  const [input, setInput] = useState("");
  const [banner, setBanner] = useState<string | null>(null);

  // refs so the transport closure always reads current values
  const ctx = useRef({ conversationId, sessionId, modelKey });
  ctx.current = { conversationId, sessionId, modelKey };

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            messages,
            conversationId: ctx.current.conversationId,
            sessionId: ctx.current.sessionId,
            modelKey: ctx.current.modelKey,
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, stop, setMessages, error } = useChat({
    transport,
  });

  const busy = status === "submitted" || status === "streaming";

  const refreshConversations = useCallback(async () => {
    if (!sessionId) return;
    const res = await fetch(`/api/conversations?sessionId=${sessionId}`);
    if (res.ok) setConversations((await res.json()).conversations ?? []);
  }, [sessionId]);

  // bootstrap: models + conversation list + a fresh conversation id
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => {
        setModels(d.models ?? []);
        setModelKey(d.default ?? "claude-sonnet");
      });
  }, []);
  useEffect(() => {
    if (!sessionId) return;
    setConversationId(crypto.randomUUID());
    refreshConversations();
  }, [sessionId, refreshConversations]);

  // when a turn settles, refresh the sidebar (title/timestamps)
  useEffect(() => {
    if (status === "ready" && messages.length > 0) refreshConversations();
  }, [status, messages.length, refreshConversations]);

  const newConversation = () => {
    stop();
    setMessages([]);
    setConversationId(crypto.randomUUID());
    setBanner(null);
  };

  const resume = async (id: string) => {
    stop();
    const res = await fetch(`/api/conversations/${id}?sessionId=${sessionId}`);
    if (!res.ok) return;
    const data = await res.json();
    const loaded: UIMessage[] = (data.messages ?? []).map(
      (m: { id: string; role: string; content: string }) => ({
        id: m.id,
        role: m.role,
        parts: [{ type: "text", text: m.content }],
      }),
    );
    setMessages(loaded);
    setConversationId(id);
    setModelKey(
      models.find((mm) => mm.id === data.conversation.model)?.key ?? modelKey,
    );
    setBanner(null);
  };

  const cancelConversation = async (id: string) => {
    if (id === conversationId) stop();
    await fetch(`/api/conversations/${id}?sessionId=${sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    refreshConversations();
  };

  const remove = async (id: string) => {
    await fetch(`/api/conversations/${id}?sessionId=${sessionId}`, {
      method: "DELETE",
    });
    if (id === conversationId) newConversation();
    refreshConversations();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBanner(null);
    try {
      await sendMessage({ text });
    } catch {
      /* surfaced via error/banner below */
    }
  };

  // turn server-side guardrail/rate-limit rejections into a readable banner
  useEffect(() => {
    if (!error) return;
    const msg = error.message || "";
    if (msg.includes("429") || msg.toLowerCase().includes("rate"))
      setBanner("Rate limit hit — slow down a moment and try again.");
    else if (msg.includes("422") || msg.toLowerCase().includes("guardrail"))
      setBanner("That message was blocked by a guardrail.");
    else setBanner("Something went wrong generating a response.");
  }, [error]);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)]">
      {/* Sidebar: conversation list / new / resume / cancel / delete */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-900/40">
        <div className="p-3">
          <button
            onClick={newConversation}
            className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400"
          >
            + New conversation
          </button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {conversations.length === 0 && (
            <p className="px-2 py-4 text-xs text-zinc-500">No conversations yet.</p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1 rounded-lg px-2 py-2 text-sm transition ${
                c.id === conversationId
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-300 hover:bg-zinc-800/60"
              }`}
            >
              <button
                onClick={() => resume(c.id)}
                className="min-w-0 flex-1 truncate text-left"
                title={c.title}
              >
                {c.status === "cancelled" && (
                  <span className="mr-1 text-[10px] text-amber-400">●</span>
                )}
                {c.title}
              </button>
              <button
                onClick={() => cancelConversation(c.id)}
                title="Cancel conversation"
                className="hidden rounded px-1 text-xs text-zinc-400 hover:text-amber-400 group-hover:block"
              >
                ⏹
              </button>
              <button
                onClick={() => remove(c.id)}
                title="Delete"
                className="hidden rounded px-1 text-xs text-zinc-400 hover:text-red-400 group-hover:block"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Main chat */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-2.5">
          <select
            value={modelKey}
            onChange={(e) => setModelKey(e.target.value)}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-200 outline-none focus:border-emerald-500"
          >
            {models.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label} · {m.provider}
              </option>
            ))}
          </select>
          {busy && (
            <button
              onClick={stop}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-red-500 hover:text-red-400"
            >
              ◼ Stop
            </button>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-6">
          {messages.length === 0 && (
            <div className="mx-auto mt-20 max-w-md text-center text-zinc-500">
              <p className="text-lg font-medium text-zinc-300">
                Ask the assistant anything
              </p>
              <p className="mt-1 text-sm">
                Every turn is logged — latency, tokens, status — to the
                ingestion pipeline. Open the Dashboard to watch it flow.
              </p>
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-emerald-500 text-zinc-950"
                    : "bg-zinc-800 text-zinc-100"
                }`}
              >
                {textOf(m) || (
                  <span className="cursor-blink text-zinc-400" />
                )}
              </div>
            </div>
          ))}
          {status === "submitted" && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-zinc-800 px-4 py-2.5 text-sm text-zinc-400">
                <span className="cursor-blink" />
              </div>
            </div>
          )}
        </div>

        {banner && (
          <div className="mx-5 mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {banner}
          </div>
        )}

        <form
          onSubmit={submit}
          className="flex gap-2 border-t border-zinc-800/60 p-4"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send a message…"
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm outline-none placeholder:text-zinc-500 focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </section>
    </div>
  );
}
