/**
 * [INPUT]: 依赖 Obsidian Modal API 和 storage/types 的标注颜色/想法类型定义
 * [OUTPUT]: 提供 EpubNoteModal，用于 EPUB 阅读器中创建/编辑想法
 * [POS]: EPUB 想法输入 UI，与 yh-inklight 的 CommentModal 保持一致的风格
 */

import { App, Modal, setIcon } from "obsidian";
import {
  AnnotationColor,
  ANNOTATION_COLORS,
  COLOR_LABELS,
  EPUB_COLOR_MAP,
  EpubHighlightStyle,
  EPUB_HIGHLIGHT_STYLES,
} from "../storage/types";
import { AnnotationTagDefinition, resolveAnnotationTag } from "../tags/tagDomain";

export interface EpubNoteResult {
  note: string;
  color: AnnotationColor;
  style: EpubHighlightStyle;
  tagId?: string;
  tagLabelSnapshot?: string;
}

/**
 * Modal for writing a personal note (想法) attached to an EPUB text selection.
 */
export class EpubNoteModal extends Modal {
  private selectedText: string;
  private note: string;
  private color: AnnotationColor;
  private style: EpubHighlightStyle;
  private tagId: string;
  private onSubmit: (result: EpubNoteResult) => void;
  private titleText: string;

  constructor(
    app: App,
    selectedText: string,
    private readonly tags: AnnotationTagDefinition[],
    initial: {
      note?: string;
      color?: AnnotationColor;
      style?: EpubHighlightStyle;
      tagId?: string;
      tagLabelSnapshot?: string;
      noteType?: string;
    },
    onSubmit: (result: EpubNoteResult) => void,
    titleText = "写下你的想法",
  ) {
    super(app);
    this.selectedText = selectedText;
    this.note = initial.note ?? "";
    this.color = initial.color ?? "yellow";
    this.style = initial.style ?? "fill";
    this.tagId = resolveAnnotationTag(tags, initial)?.id ?? tags.find((tag) => tag.enabled)?.id ?? "";
    this.onSubmit = onSubmit;
    this.titleText = titleText;
  }

  private submit(ta: HTMLTextAreaElement): void {
    this.note = ta.value.trim();
    this.close();
    this.onSubmit({
      note: this.note,
      color: this.color,
      style: this.style,
      tagId: this.note ? this.tagId : undefined,
      tagLabelSnapshot: this.note ? this.tags.find((tag) => tag.id === this.tagId)?.name : undefined,
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("yh-epub-note-modal");

    contentEl.createEl("h3", { text: this.titleText });

    // 引用选中文本
    const quote = contentEl.createDiv({ cls: "yh-epub-note-quote" });
    quote.setText(
      this.selectedText.length > 240
        ? this.selectedText.slice(0, 240) + "…"
        : this.selectedText,
    );

    // 颜色选择行
    const colorRow = contentEl.createDiv({ cls: "yh-epub-note-colors" });
    colorRow.createEl("span", { cls: "yh-epub-note-label", text: "画线颜色" });
    const dots = colorRow.createDiv({ cls: "yh-epub-color-dots" });
    const dotEls: Record<string, HTMLElement> = {};
    for (const c of ANNOTATION_COLORS) {
      const dot = dots.createDiv({ cls: "yh-epub-color-dot" });
      dot.setAttribute("data-color", c);
      dot.style.background = EPUB_COLOR_MAP[c];
      dot.title = COLOR_LABELS[c];
      if (c === this.color) {
        dot.addClass("is-active");
      }
      dot.addEventListener("click", () => {
        this.color = c;
        Object.values(dotEls).forEach((d) => d.removeClass("is-active"));
        dot.addClass("is-active");
      });
      dotEls[c] = dot;
    }

    // 高亮样式选择行
    const styleRow = contentEl.createDiv({ cls: "yh-epub-note-styles" });
    styleRow.createEl("span", { cls: "yh-epub-note-label", text: "标注样式" });
    const styleChips = styleRow.createDiv({ cls: "yh-epub-style-chips" });
    const styleEls: Record<string, HTMLElement> = {};
    for (const s of EPUB_HIGHLIGHT_STYLES) {
      const chip = styleChips.createDiv({ cls: "yh-epub-style-chip" });
      chip.setText(s.label);
      chip.title = s.label;
      chip.setAttribute("data-style", s.id);
      if (s.id === this.style) {
        chip.addClass("is-active");
      }
      chip.addEventListener("click", () => {
        this.style = s.id;
        Object.values(styleEls).forEach((c) => c.removeClass("is-active"));
        chip.addClass("is-active");
      });
      styleEls[s.id] = chip;
    }

    // 语义标签选择行
    const typeRow = contentEl.createDiv({ cls: "yh-epub-note-type-row" });
    typeRow.createEl("span", { cls: "yh-epub-note-label", text: "标签" });
    const chips = typeRow.createDiv({ cls: "yh-epub-note-type-chips" });
    const chipEls: Record<string, HTMLElement> = {};
    for (const tag of this.tags.filter((item) => item.enabled || item.id === this.tagId)) {
      const chip = chips.createDiv({ cls: "yh-epub-note-type-chip" });
      chip.title = tag.enabled ? tag.name : `${tag.name}（已停用）`;
      chip.setAttribute("data-tag-id", tag.id);
      const icon = chip.createSpan({ cls: "yh-epub-note-type-icon" });
      setIcon(icon, tag.icon);
      chip.createSpan({ text: tag.name });
      if (tag.id === this.tagId) {
        chip.addClass("is-active");
      }
      chip.addEventListener("click", () => {
        this.tagId = tag.id;
        Object.values(chipEls).forEach((c) => c.removeClass("is-active"));
        chip.addClass("is-active");
      });
      chipEls[tag.id] = chip;
    }

    // 文本输入区域
    const ta = contentEl.createEl("textarea", { cls: "yh-epub-note-textarea" });
    ta.placeholder = "在这里写下你的想法或联想…";
    ta.value = this.note;
    ta.rows = 6;
    window.setTimeout(() => ta.focus(), 30);

    // 按钮行
    const actions = contentEl.createDiv({ cls: "yh-epub-note-actions" });
    const cancelBtn = actions.createEl("button", {
      text: "取消",
      cls: "yh-epub-note-cancel",
    });
    const saveBtn = actions.createEl("button", {
      text: "保存",
      cls: "yh-epub-note-save",
    });
    saveBtn.addClass("mod-cta");

    cancelBtn.addEventListener("click", () => this.close());
    saveBtn.addEventListener("click", () => this.submit(ta));
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        this.submit(ta);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
