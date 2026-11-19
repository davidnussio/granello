import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { defaultPlugins, resolvePlugins, type EditorPlugin } from "./index";
import { SlashBridge, SlashMenu, slashExtension } from "./SlashMenu";
import BubbleToolbar from "./BubbleToolbar";

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
}: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const { extensions, toolbar, bridge } = useMemo(() => {
    const bridge = new SlashBridge();
    const resolved = resolvePlugins(plugins, { placeholder, menu: bridge });
    return {
      extensions: [...resolved.extensions, slashExtension(resolved.commands, bridge)],
      toolbar: resolved.toolbar,
      bridge,
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
      onUpdate: ({ editor }) => onChangeRef.current(getMarkdown(editor)),
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
    editor?.setEditable(editable);
  }, [editor, editable]);

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
      {editor && <BubbleToolbar editor={editor} items={toolbar} />}
      <EditorContent editor={editor} />
      <SlashMenu bridge={bridge} />
    </div>
  );
}
