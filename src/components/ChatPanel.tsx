import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Sparkles } from "../sparkles";
import { api, errorText, newStreamId, on } from "../api";
import type { ChatMessage } from "../types";
import Markdown from "./Markdown";
import { t } from "../i18n";

interface Props {
  scope: string;
  toast: (t: string) => void;
  suggestions?: string[];
  /** Pagina intera ("Chiedi ai meeting") invece del pannello laterale di un meeting. */
  big?: boolean;
  title?: string;
  subtitle?: string;
}

const MAX_INPUT_HEIGHT = 180;

export default function ChatPanel({ scope, toast, suggestions = [], big, title, subtitle }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const streamRef = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

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

  // il campo cresce con il testo, fino a un massimo
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT) + "px";
  }, [input]);

  useEffect(() => {
    if (big) field.current?.focus();
  }, [big]);

  const busy = streaming !== null;
  const empty = messages.length === 0 && !busy;

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
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
    field.current?.focus();
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    toast(t("Risposta copiata negli appunti"));
  };

  const newChatButton = !empty && (
    <button type="button" className="btn small ghost" onClick={clear} disabled={busy} title={t("Nuova conversazione")}>
      {big ? t("+ Nuova conversazione") : "+"}
    </button>
  );

  return (
    <div className={"chat" + (big ? " big" : "")}>
      {big && !empty && (
        <header className="chat-head">
          <strong>{title}</strong>
          <div className="spacer" />
          {newChatButton}
        </header>
      )}

      <div className="chat-log">
        <div className="chat-col">
          {empty && (
            <div className="chat-empty">
              {big && (
                <>
                  <div className="chat-mark"><Sparkles /></div>
                  <h1>{title}</h1>
                  {subtitle && <p className="muted">{subtitle}</p>}
                </>
              )}
              <div className="suggestions">
                {suggestions.map((s) => (
                  <button key={s} className="suggestion" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) =>
            m.role === "assistant" ? (
              <div key={m.id} className="msg assistant">
                <span className="msg-mark" aria-hidden>
                  <Sparkles />
                </span>
                <div className="msg-body">
                  <Markdown text={m.content} />
                  <button className="msg-copy" onClick={() => copy(m.content)}>
                    {t("Copia")}
                  </button>
                </div>
              </div>
            ) : (
              <div key={m.id} className="msg user">
                {m.content}
              </div>
            ),
          )}
          {busy && (
            <div className="msg assistant">
              <span className="msg-mark" aria-hidden>
                <Sparkles />
              </span>
              <div className="msg-body">
                {streaming ? (
                  <Markdown text={streaming} />
                ) : (
                  <span className="thinking" aria-label={t("Sto pensando…")}>
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
            </div>
          )}
          <div ref={end} />
        </div>
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="composer-box" onClick={() => field.current?.focus()}>
          <textarea
            ref={field}
            rows={1}
            value={input}
            placeholder={t("Fai una domanda…")}
            aria-label={t("Domanda")}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <div className="composer-actions">
            {big ? <span className="composer-hint">{t("↵ invia · ⇧↵ a capo")}</span> : newChatButton}
            <div className="spacer" />
            {busy ? (
              <button
                type="button"
                className="send stop"
                title={t("Interrompi la risposta")}
                aria-label={t("Interrompi la risposta")}
                onClick={() => streamRef.current && api.cancelStream(streamRef.current).catch(() => {})}
              >
                ■
              </button>
            ) : (
              <button className="send" disabled={!input.trim()} title={t("Invia")} aria-label={t("Invia")}>
                ↑
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
