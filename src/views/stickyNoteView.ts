/**
 * [INPUT]: 依赖 Obsidian MarkdownRenderer、CommentAnnotation 数据与便签操作回调
 * [OUTPUT]: 对外提供 renderStickyNoteCard，用于渲染可折叠、可编辑的便签卡片
 * [POS]: views 模块的便签卡片组件，当前保留为 PDF/弹层卡片样式的兼容组件
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { App, Component, MarkdownRenderer, setIcon } from "obsidian";

import { COLOR_LABELS, CommentAnnotation } from "../storage/types";
import { formatTime } from "../utils/format";

interface StickyNoteCardOptions {
  app: App;
  component: Component;
  sourcePath: string;
  comment: CommentAnnotation;
  onToggle: (comment: CommentAnnotation) => void;
  onUpdate: (comment: CommentAnnotation, content: string, title?: string) => void;
  onDelete: (comment: CommentAnnotation) => void;
}

export function renderStickyNoteCard(container: HTMLElement, options: StickyNoteCardOptions): HTMLElement {
  container.empty();
  const card = container.createDiv({
    cls: `yh-card yh-card--${options.comment.color} yh-sticky-card`,
    attr: {
      "data-yh-color": options.comment.color,
      "data-yh-id": options.comment.id,
      "data-yh-card-id": options.comment.id,
    },
  });

  const header = card.createDiv({ cls: "yh-card-head" });
  header.createSpan({
    cls: `yh-card-color-label yh-label--${options.comment.color}`,
    text: COLOR_LABELS[options.comment.color],
  });
  header.createSpan({ cls: "yh-card-page", text: "md" });
  header.createSpan({ cls: "yh-card-time", text: formatTime(options.comment.updatedAt) });
  header.createSpan({ cls: "yh-card-author", text: options.comment.author });
  const tools = header.createDiv({ cls: "yh-card-tools" });

  const edit = tools.createEl("button", {
    cls: "yh-icon-btn",
    attr: { type: "button", title: "编辑笔记" },
  });
  setIcon(edit, "pencil");

  const collapse = tools.createEl("button", {
    cls: "yh-icon-btn",
    attr: { type: "button", title: options.comment.collapsed ? "展开" : "折叠" },
  });
  setIcon(collapse, options.comment.collapsed ? "chevron-down" : "chevron-up");
  collapse.addEventListener("click", () => options.onToggle(options.comment));

  const remove = tools.createEl("button", {
    cls: "yh-icon-btn",
    attr: { type: "button", title: "删除笔记" },
  });
  setIcon(remove, "trash-2");
  remove.addEventListener("click", () => options.onDelete(options.comment));

  if (options.comment.collapsed) {
    const body = card.createDiv({ cls: "yh-card-body" });
    body.createDiv({ cls: "yh-card-quote", text: options.comment.anchor.selectedText });
    return card;
  }

  const body = card.createDiv({ cls: "yh-card-body" });
  body.createDiv({ cls: "yh-card-quote", text: options.comment.anchor.selectedText });
  const content = body.createDiv({ cls: "yh-card-content" });
  renderDisplayMode(content, options);
  edit.addEventListener("click", () => renderEditMode(content, options));
  const foot = card.createDiv({ cls: "yh-card-foot" });
  foot.createEl("button", { cls: "yh-card-more", text: "···", attr: { type: "button", title: "更多" } });

  return card;
}

function renderDisplayMode(container: HTMLElement, options: StickyNoteCardOptions): void {
  container.empty();
  MarkdownRenderer.render(options.app, options.comment.content, container, options.sourcePath, options.component);
}

function renderEditMode(container: HTMLElement, options: StickyNoteCardOptions): void {
  container.empty();
  const title = container.createEl("input", {
    cls: "yh-sticky-title-editor",
    attr: { type: "text", placeholder: "标题" },
  });
  title.value = options.comment.title ?? "";
  const editor = container.createEl("textarea", {
    cls: "yh-sticky-editor",
    attr: { rows: "5", placeholder: "写下 Markdown 笔记..." },
  });
  editor.value = options.comment.content;
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);

  const actions = container.createDiv({ cls: "yh-sticky-edit-actions" });
  const save = actions.createEl("button", { text: "保存", cls: "mod-cta", attr: { type: "button" } });
  const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });

  const saveContent = (): void => {
    options.onUpdate(options.comment, editor.value, title.value.trim());
    renderDisplayMode(container, {
      ...options,
      comment: {
        ...options.comment,
        title: title.value.trim(),
        content: editor.value,
      },
    });
  };

  save.addEventListener("click", saveContent);
  cancel.addEventListener("click", () => renderDisplayMode(container, options));
  editor.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      saveContent();
    }
  });
}

