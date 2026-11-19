import { useEffect, useRef, useState } from "react";
import { api, errorText, newStreamId, on } from "../api";
import type { ChatMessage } from "../types";
import Markdown from "./Markdown";

interface Props {
  scope: string;
  toast: (t: string) => void;
  suggestions?: string[];
  big?: boolean;
}

export default function ChatPanel({ scope, toast, suggestions = [], big }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const streamRef = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getChat(scope).then(setMessages).catch((e) => toast(errorText(e)));
  }, [scope, toast]);

  useEffect(
    () =>
      on("llm-delta", (d) => {
        if (d.streamId === streamRef.current) setStreaming((s) => (s ?? "") + d.delta);
      }),
    [],
  );

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streaming]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || streaming !== null) return;
    setInput("");
    const sid = newStreamId();
    streamRef.current = sid;
    setStreaming("");
    setMessages((m) => [...m, { id: -Date.now(), scope, role: "user", content: question, createdAt: Date.now() }]);
    try {
      await api.chat(scope, question, sid);
    } catch (e) {
      toast(errorText(e));
      // la domanda non è stata salvata: la si rimette nel campo per riprovare
      setInput((cur) => cur || question);
    } finally {
      streamRef.current = null;
      setStreaming(null);
      setMessages(await api.getChat(scope).catch(() => []));
    }
  };

  const clear = async () => {
    await api.clearChat(scope).catch(() => {});
    setMessages([]);
  };

  return (
    <div className={"chat" + (big ? " big" : "")}>
      <div className="chat-log">
        {messages.length === 0 && streaming === null && (
          <div className="suggestions">
            {suggestions.map((s) => (
              <button key={s} className="suggestion" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={"msg " + m.role}>
            {m.role === "assistant" ? <Markdown text={m.content} /> : m.content}
          </div>
        ))}
        {streaming !== null && (
          <div className="msg assistant">
            {streaming ? <Markdown text={streaming} /> : <span className="muted">Sto pensando…</span>}
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          rows={big ? 2 : 1}
          value={input}
          placeholder="Fai una domanda…"
          aria-label="Domanda"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        {streaming !== null ? (
          <button
            type="button"
            className="btn small"
            onClick={() => streamRef.current && api.cancelStream(streamRef.current).catch(() => {})}
          >
            Stop
          </button>
        ) : (
          <button className="btn primary small" disabled={!input.trim()}>
            Invia
          </button>
        )}
        {messages.length > 0 && (
          <button
            type="button"
            className="btn ghost small"
            onClick={clear}
            disabled={streaming !== null}
            title="Svuota conversazione"
            aria-label="Svuota conversazione"
          >
            ⌫
          </button>
        )}
      </form>
    </div>
  );
}
