import { t } from "../../i18n";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import type { EditorPlugin } from "../types";

export const tasks: EditorPlugin = {
  name: "tasks",
  extensions: () => [TaskList, TaskItem.configure({ nested: true })],
  commands: [
    {
      id: "task-list",
      get title() {
        return t("Azione da fare");
      },
      get hint() {
        return t("[ ] + spazio");
      },
      icon: "☑",
      get group() {
        return t("Elenchi");
      },
      keywords: ["todo", "task", "checklist", "azione", "compito"],
      run: (e) => e.chain().focus().toggleTaskList().run(),
    },
  ],
  toolbar: [
    {
      id: "task-list",
      group: "block",
      label: "☑",
      get title() {
        return t("Azione da fare (⌘⇧9)");
      },
      isActive: (e) => e.isActive("taskList"),
      run: (e) => e.chain().focus().toggleTaskList().run(),
    },
  ],
};
