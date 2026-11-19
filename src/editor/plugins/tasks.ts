import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import type { EditorPlugin } from "../types";

export const tasks: EditorPlugin = {
  name: "tasks",
  extensions: () => [TaskList, TaskItem.configure({ nested: true })],
  commands: [
    {
      id: "task-list",
      title: "Azione da fare",
      hint: "[ ] + spazio",
      icon: "☑",
      group: "Elenchi",
      keywords: ["todo", "task", "checklist", "azione", "compito"],
      run: (e) => e.chain().focus().toggleTaskList().run(),
    },
  ],
  toolbar: [
    {
      id: "task-list",
      group: "block",
      label: "☑",
      title: "Azione da fare (⌘⇧9)",
      isActive: (e) => e.isActive("taskList"),
      run: (e) => e.chain().focus().toggleTaskList().run(),
    },
  ],
};
