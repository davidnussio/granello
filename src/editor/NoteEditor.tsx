import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { defaultPlugins, resolvePlugins, type EditorPlugin } from "./index";
import { SlashBridge, SlashMenu, slashExtension } from "./SlashMenu";
import BubbleToolbar from "./BubbleToolbar";
import { FindBar } from "./plugins/find";

interface Props {
  /** Markdown iniziale. Cambiare `docKey` per ricaricare il contenuto. */
  value: string;
  docKey: string;
  placeholder?: string;
  onChange: (md: string) => void;
  editable?: boolean;
  className?: string;
  /** Plugin attivi. Default: `defaultPlugins`. Va passato un array stabile (non ricreato a ogni render). */
  plugins?: EditorPlugin[];
  /** Riceve l'editor quando è pronto e null quando viene tolto: per chi deve inserire blocchi da fuori. */
  onEditor?: (editor: Editor | null) => void;
}

function getMarkdown(editor: { storage: Record<string, unknown> }): string {
  const md = editor.storage.markdown as { getMarkdown: () => string } | undefined;
  return md ? md.getMarkdown() : "";
}

export default function NoteEditor({
  value,
  docKey,
  placeholder,
  onChange,
  editable = true,
  className,
  plugins = defaultPlugins,
  onEditor,
}: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const { extensions, toolbar, bridge } = useMemo(() => {
    const slashBridge = new SlashBridge();
    const resolved = resolvePlugins(plugins, { placeholder, menu: slashBridge });
    return {
      extensions: [...resolved.extensions, slashExtension(resolved.commands, slashBridge)],
      toolbar: resolved.toolbar,
      bridge: slashBridge,
    };
    // il placeholder è fisso per istanza: ricreare l'editor quando cambia farebbe perdere il cursore
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugins]);

  const editor = useEditor(
    {
      extensions,
      content: value,
      editable,
      editorProps: { attributes: { spellcheck: "true" } },
      // solo un cambio del documento è una modifica: aprire una nota, o cambiare se si può
      // scrivere, non la salva (e non la porta tra quelle modificate oggi)
      onUpdate: ({ editor: ed, transaction }) => {
        if (transaction.docChanged) onChangeRef.current(getMarkdown(ed));
      },
    },
    [extensions],
  );

  // ricarica solo quando cambia il documento (o arriva testo in streaming non editabile)
  useEffect(() => {
    if (!editor) return;
    if (getMarkdown(editor) !== value) {
      editor.commands.setContent(value, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, editor, editable ? null : value]);

  useEffect(() => {
    // senza l'evento «update»: per TipTap sarebbe una modifica del testo
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  const onEditorRef = useRef(onEditor);
  onEditorRef.current = onEditor;
  useEffect(() => {
    onEditorRef.current?.(editor);
    return () => onEditorRef.current?.(null);
  }, [editor]);

  return (
    <div
      className={"editor " + (className ?? "")}
      // click nello spazio vuoto sotto il testo: il cursore va in fondo
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && editor) {
          e.preventDefault();
          editor.commands.focus("end");
        }
      }}
    >
      {/* contenitore fisso: la barra compare e scompare senza che React debba inserirla accanto
          alla barra di selezione, che TipTap sposta fuori da qui */}
      <div className="find-slot">{editor && <FindBar editor={editor} />}</div>
      {editor && <BubbleToolbar editor={editor} items={toolbar} />}
      <EditorContent editor={editor} />
      <SlashMenu bridge={bridge} />
    </div>
  );
}
