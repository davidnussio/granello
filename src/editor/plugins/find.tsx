import { useEffect, useReducer, useRef, useState } from "react";
import { Extension } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

interface Match {
  from: number;
  to: number;
}

interface FindState {
  open: boolean;
  /** Cresce a ogni ⌘F: la barra già aperta riprende il fuoco. */
  focus: number;
  query: string;
  matchCase: boolean;
  matches: Match[];
  /** La corrispondenza corrente tra `matches`. */
  index: number;
  deco: DecorationSet;
}

type Action =
  | { type: "open"; query?: string }
  | { type: "close" }
  | { type: "query"; query: string; matchCase: boolean }
  | { type: "go"; index: number }
  /** Dopo una sostituzione: la corrente diventa la prima corrispondenza da `pos` in poi. */
  | { type: "seek"; pos: number };

const findKey = new PluginKey<FindState>("find");

/**
 * Le corrispondenze nel testo della nota, un blocco di testo alla volta (una ricerca non
 * scavalca i paragrafi). I blocchi fatti di dati (sondaggi, kanban, citazioni…) hanno
 * campi loro e restano fuori.
 */
function findMatches(doc: PMNode, query: string, matchCase: boolean): Match[] {
  if (!query) return [];
  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "gu" : "giu");
  const out: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // il testo del blocco e, per ogni carattere, la sua posizione nel documento
    let text = "";
    const at: number[] = [];
    node.descendants((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) at.push(pos + 1 + offset + i);
        text += child.text;
      } else if (child.isLeaf) {
        // una menzione o una data in mezzo alla riga interrompe la corrispondenza
        at.push(pos + 1 + offset);
        text += "￼";
      }
      return true;
    });
    for (const m of text.matchAll(re)) {
      if (m[0]) out.push({ from: at[m.index], to: at[m.index + m[0].length - 1] + 1 });
    }
    return false;
  });
  return out;
}

const closed = (prev: FindState): FindState => ({
  ...prev,
  open: false,
  matches: [],
  index: 0,
  deco: DecorationSet.empty,
});

const Find = Extension.create({
  name: "find",
  addKeyboardShortcuts() {
    return {
      "Mod-f": () => {
        const { from, to, empty } = this.editor.state.selection;
        const selected = empty ? "" : this.editor.state.doc.textBetween(from, to, "\n");
        // il testo selezionato, se sta su una riga, è già quello da cercare
        const query = selected && selected.length < 100 && !selected.includes("\n") ? selected : undefined;
        this.editor.view.dispatch(this.editor.state.tr.setMeta(findKey, { type: "open", query } as Action));
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({
            open: false,
            focus: 0,
            query: "",
            matchCase: false,
            matches: [],
            index: 0,
            deco: DecorationSet.empty,
          }),
          apply(tr, prev) {
            const action = tr.getMeta(findKey) as Action | undefined;
            if (!action && (!tr.docChanged || !prev.open)) return prev;
            if (action?.type === "close") return closed(prev);

            const next: FindState = { ...prev };
            // da dove riparte la corrispondenza corrente, se non resta quella di prima
            let seek: number | null = null;
            if (action?.type === "open") {
              next.open = true;
              next.focus = prev.focus + 1;
              next.query = action.query ?? prev.query;
              seek = tr.selection.from;
            } else if (action?.type === "query") {
              next.query = action.query;
              next.matchCase = action.matchCase;
              seek = prev.matches[prev.index]?.from ?? tr.selection.from;
            } else if (action?.type === "seek") {
              seek = action.pos;
            } else if (tr.docChanged && prev.matches[prev.index]) {
              seek = tr.mapping.map(prev.matches[prev.index].from);
            }

            next.matches = findMatches(tr.doc, next.query, next.matchCase);
            if (action?.type === "go") next.index = action.index;
            else if (seek !== null)
              next.index = Math.max(
                0,
                next.matches.findIndex((m) => m.from >= seek),
              );
            if (next.matches.length === 0) next.index = 0;
            else
              next.index = ((next.index % next.matches.length) + next.matches.length) % next.matches.length;

            next.deco = DecorationSet.create(
              tr.doc,
              next.matches.map((m, i) =>
                Decoration.inline(m.from, m.to, {
                  class: i === next.index ? "find-match current" : "find-match",
                }),
              ),
            );
            return next;
          },
        },
        props: {
          decorations: (state) => findKey.getState(state)?.deco,
        },
      }),
    ];
  },
});

/** La barra "trova e sostituisci" in cima alla nota: si apre con ⌘F dentro l'editor. */
export function FindBar({ editor }: { editor: Editor }) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [replacement, setReplacement] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    editor.on("transaction", refresh);
    return () => {
      editor.off("transaction", refresh);
    };
  }, [editor]);

  const state = editor.isDestroyed ? undefined : findKey.getState(editor.state);
  const open = state?.open ?? false;
  const current = state?.matches[state.index];

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    input.current?.select();
  }, [open, state?.focus]);

  // la corrispondenza corrente resta in vista
  const from = current?.from;
  const to = current?.to;
  useEffect(() => {
    if (from !== undefined)
      editor.view.dom.querySelector(".find-match.current")?.scrollIntoView({ block: "nearest" });
  }, [editor, from, to]);

  if (!state || !open) return null;
  const { matches, index, query, matchCase } = state;
  const send = (action: Action) => editor.view.dispatch(editor.state.tr.setMeta(findKey, action));
  const close = () => {
    send({ type: "close" });
    editor.view.focus();
  };

  const replaceOne = () => {
    if (!current) return;
    const tr = editor.state.tr;
    if (replacement) tr.insertText(replacement, current.from, current.to);
    else tr.delete(current.from, current.to);
    editor.view.dispatch(
      tr.setMeta(findKey, { type: "seek", pos: current.from + replacement.length } as Action),
    );
  };
  const replaceAll = () => {
    if (matches.length === 0) return;
    // dall'ultima alla prima, così le posizioni non ancora toccate restano valide; un solo Annulla
    const tr = editor.state.tr;
    for (const m of matches.toReversed()) {
      if (replacement) tr.insertText(replacement, m.from, m.to);
      else tr.delete(m.from, m.to);
    }
    editor.view.dispatch(tr);
  };

  const onKeyDown = (e: React.KeyboardEvent, enter: () => void) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      enter();
    } else if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    }
  };
  const go = (step: number) => send({ type: "go", index: index + step });

  return (
    <div className="find-bar" role="search" aria-label={t("Trova e sostituisci")}>
      <div className="find-row">
        <input
          ref={input}
          className="search"
          value={query}
          spellCheck={false}
          placeholder={t("Trova nella nota")}
          aria-label={t("Trova nella nota")}
          onChange={(e) => send({ type: "query", query: e.target.value, matchCase })}
          onKeyDown={(e) => onKeyDown(e, () => go(e.shiftKey ? -1 : 1))}
        />
        <span className="find-count" aria-live="polite">
          {query ? (matches.length ? `${index + 1}/${matches.length}` : t("Nessun risultato")) : ""}
        </span>
        <button
          className={"btn small ghost" + (matchCase ? " on" : "")}
          aria-pressed={matchCase}
          title={t("Distingui maiuscole e minuscole")}
          aria-label={t("Distingui maiuscole e minuscole")}
          onClick={() => send({ type: "query", query, matchCase: !matchCase })}
        >
          Aa
        </button>
        <button
          className="btn small ghost"
          disabled={matches.length === 0}
          title={t("Precedente (Maiusc Invio)")}
          aria-label={t("Precedente (Maiusc Invio)")}
          onClick={() => go(-1)}
        >
          ↑
        </button>
        <button
          className="btn small ghost"
          disabled={matches.length === 0}
          title={t("Successivo (Invio)")}
          aria-label={t("Successivo (Invio)")}
          onClick={() => go(1)}
        >
          ↓
        </button>
        <button
          className="btn small ghost"
          title={t("Chiudi (Esc)")}
          aria-label={t("Chiudi (Esc)")}
          onClick={close}
        >
          ×
        </button>
      </div>
      {editor.isEditable && (
        <div className="find-row">
          <input
            className="search"
            value={replacement}
            spellCheck={false}
            placeholder={t("Sostituisci con")}
            aria-label={t("Sostituisci con")}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => onKeyDown(e, replaceOne)}
          />
          <button className="btn small" disabled={!current} onClick={replaceOne}>
            {t("Sostituisci")}
          </button>
          <button
            className="btn small"
            disabled={matches.length === 0}
            title={t("Sostituisce tutte le corrispondenze; un solo Annulla le riporta")}
            onClick={replaceAll}
          >
            {t("Tutti")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Trova e sostituisci nel testo della nota (⌘F). */
export const find: EditorPlugin = {
  name: "find",
  extensions: () => [Find],
};
