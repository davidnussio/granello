import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";

interface Props {
  /** Markdown iniziale. Cambiare `docKey` per ricaricare il contenuto. */
  value: string;
  docKey: string;
  placeholder?: string;
  onChange: (md: string) => void;
  editable?: boolean;
  className?: string;
}

function getMarkdown(editor: { storage: Record<string, unknown> }): string {
  const md = editor.storage.markdown as { getMarkdown: () => string } | undefined;
  return md ? md.getMarkdown() : "";
}

export default function NoteEditor({ value, docKey, placeholder, onChange, editable = true, className }: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: placeholder ?? "Scrivi le tue note…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, tightLists: true, linkify: true, transformPastedText: true }),
    ],
    content: value,
    editable,
    onUpdate: ({ editor }) => onChangeRef.current(getMarkdown(editor)),
  });

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

  return <EditorContent editor={editor} className={"editor " + (className ?? "")} />;
}
