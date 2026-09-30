/**
 * [INPUT]: 依赖 DOM selection、Obsidian setIcon 与命令回调，接收高亮颜色与便签动作
 * [OUTPUT]: 对外提供 SelectionToolbar，在选中文本附近显示非侵入式阅读工具条
 * [POS]: editor 模块的交互入口，被 main.ts 装配并调用
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { setIcon } from "obsidian";
import { ANNOTATION_COLORS, AnnotationColor, COLOR_LABELS } from "../storage/types";

interface SelectionToolbarOptions {
  onHighlight: (color: AnnotationColor) => void;
  onComment: () => void;
  onCopy: () => void;
  onOpenSidebar: () => void;
}

export class SelectionToolbar {
  private readonly element: HTMLElement;
  private visible = false;
  private readonly handleMouseUp = (): void => {
    window.setTimeout(() => this.showForSelection(), 0);
  };

  constructor(private readonly options: SelectionToolbarOptions) {
    this.element = document.body.createDiv({ cls: "yh-toolbar yh-selection-toolbar" });
    this.render();
    this.hide();
    document.addEventListener("mouseup", this.handleMouseUp);
  }

  destroy(): void {
    document.removeEventListener("mouseup", this.handleMouseUp);
    this.element.remove();
  }

  showForSelection(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      this.hide();
      return;
    }

    const text = selection.toString().trim();
    const range = selection.getRangeAt(0);
    if (!text || !isSelectionInsideAnnotatableContent(range)) {
      this.hide();
      return;
    }

    const rect = range.getBoundingClientRect();
    this.element.style.left = `${Math.max(8, rect.left + rect.width / 2)}px`;
    this.element.style.top = `${Math.max(8, rect.top - 46)}px`;
    this.element.toggleClass("is-visible", true);
    this.visible = true;
  }

  hide(): void {
    this.element.toggleClass("is-visible", false);
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  private render(): void {
    for (const color of ANNOTATION_COLORS) {
      const button = this.element.createEl("button", {
        cls: `yh-toolbar-color yh-toolbar-color--${color}`,
        attr: {
          type: "button",
          "aria-label": `高亮 ${COLOR_LABELS[color]}`,
          "data-yh-color": color,
        },
      });
      button.addEventListener("click", () => this.options.onHighlight(color));
    }

    this.element.createDiv({ cls: "yh-toolbar-sep" });

    const commentButton = this.iconButton("添加便签", "message-square");
    commentButton.addEventListener("click", () => this.options.onComment());

    const copyButton = this.iconButton("复制", "copy");
    copyButton.addEventListener("click", () => this.options.onCopy());

    const sidebarButton = this.iconButton("打开总览", "list");
    sidebarButton.addEventListener("click", () => this.options.onOpenSidebar());
  }

  private iconButton(label: string, icon: string): HTMLButtonElement {
    const button = this.element.createEl("button", {
      cls: "yh-toolbar-action",
      attr: {
        type: "button",
        "aria-label": label,
        title: label,
      },
    });
    setIcon(button, icon);
    return button;
  }
}

function isSelectionInsideAnnotatableContent(range: Range): boolean {
  const container =
    range.commonAncestorContainer instanceof HTMLElement
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

  if (!container) {
    return false;
  }

  if (container.closest(".view-header, .workspace-tab-header, .sidebar, .modal-container, input, textarea")) {
    return false;
  }

  return Boolean(
    container.closest(
      ".cm-content, .markdown-preview-view, .pdf-container, .pdf-viewer, .pdf-embed, .workspace-leaf-content[data-type='pdf']",
    ),
  );
}
