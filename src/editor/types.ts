import type { ComponentType } from "react";
import type { AnyExtension, Editor } from "@tiptap/react";

/** Opzioni dell'istanza di editor passate a ogni plugin. */
export interface PluginContext {
  placeholder?: string;
}

/** Voce del menu "/" (e, in futuro, di una command palette). */
export interface CommandItem {
  id: string;
  title: string;
  /** Riga secondaria: cosa fa il comando. */
  hint?: string;
  /** Glifo breve mostrato a sinistra (es. "H1", "☑"). */
  icon: string;
  /** Intestazione del gruppo nel menu. */
  group: string;
  /** Parole in più per la ricerca. */
  keywords?: string[];
  run: (editor: Editor) => void;
}

/** Pulsante della barra che compare sul testo selezionato. */
export interface ToolbarItem {
  id: string;
  /** I pulsanti dello stesso gruppo stanno vicini; tra gruppi c'è un separatore. */
  group: string;
  label: string;
  title: string;
  className?: string;
  isActive?: (editor: Editor) => boolean;
  /** Azione immediata al click. */
  run?: (editor: Editor) => void;
  /** In alternativa a `run`: pannello che sostituisce la barra (es. campo URL del link). */
  panel?: ComponentType<{ editor: Editor; close: () => void }>;
}

/**
 * Un plugin dell'editor: un'unità autonoma che può aggiungere estensioni TipTap
 * (nodi, mark, scorciatoie), comandi per il menu "/" e pulsanti per la barra di selezione.
 * Per estendere l'editor basta scrivere un plugin e aggiungerlo alla lista passata a `NoteEditor`.
 */
export interface EditorPlugin {
  name: string;
  extensions?: (ctx: PluginContext) => AnyExtension[];
  commands?: CommandItem[];
  toolbar?: ToolbarItem[];
}

export interface ResolvedPlugins {
  extensions: AnyExtension[];
  commands: CommandItem[];
  toolbar: ToolbarItem[];
}
