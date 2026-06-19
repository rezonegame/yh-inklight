/**
 * [INPUT]: 依赖 Obsidian ItemView、AnnotationStore 数据与插件主类回调
 * [OUTPUT]: 对外提供 AnnotationSidebarView，将当前文件或全库 annotation 合并为可筛选、可跳转、可导出的总览卡片
 * [POS]: views 模块的右侧 Leaf 总览面板，承载搜索、筛选、排序、行内编辑、跳转、删除与导出模板
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { ItemView, MarkdownRenderer, MarkdownView, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";

import type OverlayAnnotationsPlugin from "../../main";
import { formatTime } from "../utils/format";
import {
  ANNOTATION_COLORS,
  AnnotationColor,
  AnnotationExportFormat,
  AnnotationSortMode,
  COLOR_LABELS,
  CommentAnnotation,
  EpubCommentAnnotation,
  EpubHighlightAnnotation,
  FileAnnotationDocument,
  HighlightAnnotation,
  PdfCommentAnnotation,
  PdfHighlightAnnotation,
  ReadingBookmark,
} from "../storage/types";

export const ANNOTATION_SIDEBAR_VIEW = "yh-inklight-sidebar";

type AnnotationKind = "highlight" | "note";
type AnnotationMode = "md" | "pdf" | "epub";
type AnnotationScope = "current" | "all";
type TypeFilter = "all" | AnnotationKind;

type SidebarCard =
  | {
      id: string;
      kind: "highlight";
      mode: AnnotationMode;
      sourcePath: string;
      color: AnnotationColor;
      text: string;
      content: string;
      createdAt: string;
      startOffset: number;
      pageNumber: number | null;
      cfiRange?: string;
      chapter?: string;
      orphaned?: boolean;
      isCode: boolean;
      highlight: HighlightAnnotation | PdfHighlightAnnotation | EpubHighlightAnnotation;
      note: CommentAnnotation | PdfCommentAnnotation | EpubCommentAnnotation | null;
    }
  | {
      id: string;
      kind: "note";
      mode: AnnotationMode;
      sourcePath: string;
      color: AnnotationColor;
      text: string;
      content: string;
      createdAt: string;
      startOffset: number;
      pageNumber: number | null;
      cfiRange?: string;
      chapter?: string;
      orphaned?: boolean;
      isCode: boolean;
      highlight: null;
      note: CommentAnnotation | PdfCommentAnnotation | EpubCommentAnnotation;
    };

export class AnnotationSidebarView extends ItemView {
  private annotationScope: AnnotationScope = "current";
  private query = "";
  private color: AnnotationColor | "all" = "all";
  private type: TypeFilter = "all";
  private sort: AnnotationSortMode = "document";
  /** 位置过滤：开启后只显示当前页/章/区域的批注（仅 current 文件作用域有意义）。 */
  private positionFilter = false;
  /** 当前位置上下文（由活动文件的阅读器广播）。 */
  private currentPosition: { mode: AnnotationMode; page?: number; chapter?: string } | null = null;
  /** 位置轮询定时器（positionFilter 开启时启用，检测 PDF 翻页/EPUB 翻章后刷新）。 */
  private positionPollTimer: number | null = null;
  /** 上次轮询到的位置签名，用于检测变化。 */
  private lastPositionKey = "";
  private exportFormat: AnnotationExportFormat = "summary";
  private renderToken = 0;
  private renderTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: OverlayAnnotationsPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return ANNOTATION_SIDEBAR_VIEW;
  }

  getDisplayText(): string {
    return "墨光批注";
  }

  getIcon(): string {
    return "yh-inklight-icon";
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass("yh-sidebar");
    this.registerHoverSync();
    await this.render();
  }

  /**
   * 反向 hover 联动：悬停侧栏卡片 → 源文档对应高亮闪烁。
   * 用容器级事件委托（非逐卡片绑定），避免卡片重建时监听器泄漏。
   */
  private registerHoverSync(): void {
    const container = this.containerEl;
    this.registerDomEvent(container, "mouseover", (event) => {
      const target = event.target as HTMLElement;
      const card = target.closest<HTMLElement>(".yh-ov-card");
      // 取批注主键（高亮优先，其次便签），书签行不触发源闪烁
      const id = card?.dataset.highlightId ?? card?.dataset.noteId;
      if (!id) {
        return;
      }
      this.highlightInSourceDocument(id);
    });
    this.registerDomEvent(container, "mouseout", (event) => {
      const target = event.target as HTMLElement;
      const related = event.relatedTarget as HTMLElement | null;
      // 仅当真正离开卡片时清除
      if (related && container.contains(related)) {
        return;
      }
      this.clearSourceDocumentHighlight();
      void target;
    });
  }

  /** 在源文档（当前活动 view）查找 [data-yh-id=id] 并加闪烁 class。 */
  private highlightInSourceDocument(id: string): void {
    this.clearSourceDocumentHighlight();
    const els = document.querySelectorAll(`[data-yh-id="${CSS.escape(id)}"]`);
    els.forEach((el) => el.classList.add("yh-hover-sync"));
  }

  private clearSourceDocumentHighlight(): void {
    document.querySelectorAll(".yh-hover-sync").forEach((el) => el.classList.remove("yh-hover-sync"));
  }

  async onClose(): Promise<void> {
    this.stopPositionPolling();
  }

  requestRender(): void {
    if (this.renderTimer !== null) {
      window.clearTimeout(this.renderTimer);
    }
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      void this.render();
    }, 0);
  }

  async render(): Promise<void> {
    const token = ++this.renderToken;
    const container = this.containerEl.children[1] ?? this.containerEl;
    container.empty();
    container.addClass("yh-overview");

    const file = this.app.workspace.getActiveFile();
    this.refreshCurrentPosition(file);
    this.renderHeader(container);
    this.renderControls(container);

    if (this.annotationScope === "current" && !file) {
      container.createDiv({ cls: "yh-empty", text: "Open a Markdown or PDF file to inspect annotations." });
      this.renderExportFooter(container, null);
      return;
    }

    const documents =
      this.annotationScope === "all" ? await this.plugin.store.getIndexedDocuments() : [await this.plugin.store.getDocument(file!)];
    if (token !== this.renderToken) {
      return;
    }
    const rawCards = documents.flatMap((document) => this.buildCards(document));
    const cards = this.filterCards(rawCards);
    const highlightCount = rawCards.filter((card) => card.kind === "highlight" && !card.orphaned).length;
    const noteCount = rawCards.filter((card) => card.note && !card.orphaned).length;
    const scopeLabel = this.annotationScope === "all" ? `${documents.length} files` : "current file";
    container.createDiv({ cls: "yh-ov-count", text: `${scopeLabel} · ${highlightCount} highlights · ${noteCount} notes` });

    const list = container.createDiv({ cls: "yh-ov-list" });
    if (!cards.length) {
      list.createDiv({ cls: "yh-empty", text: "No matching annotations." });
    } else {
      for (const card of cards) {
        this.renderCard(list, card);
      }
    }

    // 三格式统一书签区：仅显示当前文件的书签
    if (this.annotationScope === "current" && file) {
      this.renderBookmarks(container, file);
    }

    this.renderExportFooter(container, this.annotationScope === "current" ? file : null);
  }

  /**
   * 只刷新卡片列表（不重建搜索框等控件），用于搜索输入时保持焦点。
   */
  private async refreshList(): Promise<void> {
    const root = this.containerEl.children[1] ?? this.containerEl;
    const list = root.querySelector<HTMLElement>(".yh-ov-list");
    if (!list) {
      await this.render();
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (this.annotationScope === "current" && !file) {
      await this.render();
      return;
    }
    const documents =
      this.annotationScope === "all"
        ? await this.plugin.store.getIndexedDocuments()
        : [await this.plugin.store.getDocument(file!)];
    const rawCards = documents.flatMap((document) => this.buildCards(document));
    const cards = this.filterCards(rawCards);

    list.empty();
    if (!cards.length) {
      list.createDiv({ cls: "yh-empty", text: "No matching annotations." });
    } else {
      for (const card of cards) {
        this.renderCard(list, card);
      }
    }

    const countEl = root.querySelector<HTMLElement>(".yh-ov-count");
    if (countEl) {
      const highlightCount = rawCards.filter((card) => card.kind === "highlight" && !card.orphaned).length;
      const noteCount = rawCards.filter((card) => card.note && !card.orphaned).length;
      const scopeLabel = this.annotationScope === "all" ? `${documents.length} files` : "current file";
      countEl.textContent = `${scopeLabel} · ${highlightCount} highlights · ${noteCount} notes`;
    }
  }

  private buildCards(document: FileAnnotationDocument): SidebarCard[] {
    const usedNotes = new Set<string>();
    const cards: SidebarCard[] = [];

    for (const highlight of document.highlights) {
      const note = this.findAttachedMarkdownNote(highlight, document.comments, usedNotes);
      if (note) {
        usedNotes.add(note.id);
      }
      cards.push({
        id: highlight.id,
        kind: "highlight",
        mode: "md",
        sourcePath: document.filePath,
        color: highlight.color,
        text: highlight.anchor.selectedText,
        content: note?.content ?? "",
        createdAt: highlight.createdAt,
        startOffset: highlight.anchor.startOffset,
        pageNumber: null,
        orphaned: highlight.orphaned || note?.orphaned,
        isCode: isCodeAnchor(highlight.anchor),
        highlight,
        note,
      });
    }

    for (const highlight of document.pdfHighlights) {
      const note = this.findAttachedPdfNote(highlight, document.pdfComments, usedNotes);
      if (note) {
        usedNotes.add(note.id);
      }
      cards.push({
        id: highlight.id,
        kind: "highlight",
        mode: "pdf",
        sourcePath: document.filePath,
        color: highlight.color,
        text: highlight.anchor.selectedText,
        content: note?.content ?? "",
        createdAt: highlight.createdAt,
        startOffset: Number.MAX_SAFE_INTEGER,
        pageNumber: highlight.anchor.pageNumber,
        orphaned: highlight.orphaned || note?.orphaned,
        isCode: false,
        highlight,
        note,
      });
    }

    for (const highlight of document.epubHighlights) {
      const note = this.findAttachedEpubNote(highlight, document.epubComments, usedNotes);
      if (note) {
        usedNotes.add(note.id);
      }
      cards.push({
        id: highlight.id,
        kind: "highlight",
        mode: "epub",
        sourcePath: document.filePath,
        color: highlight.color,
        text: highlight.anchor.selectedText,
        content: note?.note ?? "",
        createdAt: highlight.createdAt,
        startOffset: Number.MAX_SAFE_INTEGER,
        pageNumber: null,
        cfiRange: highlight.anchor.cfiRange,
        chapter: highlight.anchor.chapter,
        orphaned: highlight.orphaned || note?.orphaned,
        isCode: false,
        highlight,
        note,
      });
    }

    for (const note of document.comments.filter((item) => !usedNotes.has(item.id))) {
      cards.push({
        id: note.id,
        kind: "note",
        mode: "md",
        sourcePath: document.filePath,
        color: note.color,
        text: note.anchor.selectedText,
        content: note.content,
        createdAt: note.createdAt,
        startOffset: note.anchor.startOffset,
        pageNumber: null,
        orphaned: note.orphaned,
        isCode: isCodeAnchor(note.anchor),
        highlight: null,
        note,
      });
    }

    for (const note of document.pdfComments.filter((item) => !usedNotes.has(item.id))) {
      cards.push({
        id: note.id,
        kind: "note",
        mode: "pdf",
        sourcePath: document.filePath,
        color: note.color,
        text: note.anchor.selectedText,
        content: note.content,
        createdAt: note.createdAt,
        startOffset: Number.MAX_SAFE_INTEGER,
        pageNumber: note.anchor.pageNumber,
        orphaned: note.orphaned,
        isCode: false,
        highlight: null,
        note,
      });
    }

    for (const note of document.epubComments.filter((item) => !usedNotes.has(item.id))) {
      cards.push({
        id: note.id,
        kind: "note",
        mode: "epub",
        sourcePath: document.filePath,
        color: note.color,
        text: note.anchor.selectedText,
        content: note.note,
        createdAt: note.createdAt,
        startOffset: Number.MAX_SAFE_INTEGER,
        pageNumber: null,
        cfiRange: note.anchor.cfiRange,
        chapter: note.anchor.chapter,
        orphaned: note.orphaned,
        isCode: false,
        highlight: null,
        note,
      });
    }

    return cards;
  }

  private findAttachedMarkdownNote(
    highlight: HighlightAnnotation,
    comments: CommentAnnotation[],
    usedNotes: Set<string>,
  ): CommentAnnotation | null {
    return (
      comments.find((note) => !usedNotes.has(note.id) && note.highlightId === highlight.id) ??
      comments.find((note) => {
        return (
          !usedNotes.has(note.id) &&
          !note.highlightId &&
          note.anchor.startOffset === highlight.anchor.startOffset &&
          note.anchor.selectedText === highlight.anchor.selectedText
        );
      }) ??
      null
    );
  }

  private findAttachedPdfNote(
    highlight: PdfHighlightAnnotation,
    comments: PdfCommentAnnotation[],
    usedNotes: Set<string>,
  ): PdfCommentAnnotation | null {
    return (
      comments.find((note) => !usedNotes.has(note.id) && note.highlightId === highlight.id) ??
      comments.find((note) => {
        return (
          !usedNotes.has(note.id) &&
          !note.highlightId &&
          note.anchor.pageNumber === highlight.anchor.pageNumber &&
          note.anchor.selectedText === highlight.anchor.selectedText
        );
      }) ??
      null
    );
  }

  private findAttachedEpubNote(
    highlight: EpubHighlightAnnotation,
    comments: EpubCommentAnnotation[],
    usedNotes: Set<string>,
  ): EpubCommentAnnotation | null {
    return (
      comments.find((note) => !usedNotes.has(note.id) && note.anchor.cfiRange === highlight.anchor.cfiRange) ??
      null
    );
  }

  private renderHeader(container: Element): void {
    const header = container.createDiv({ cls: "yh-ov-head" });
    header.createSpan({ cls: "yh-ov-title", text: "Inklight" });
    const actions = header.createDiv({ cls: "yh-ov-head-actions" });

    const refresh = actions.createEl("button", {
      cls: "yh-icon-btn yh-ov-refresh",
      attr: { type: "button", title: "Refresh", "aria-label": "Refresh annotations" },
    });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => this.requestRender());

    const close = actions.createEl("button", {
      cls: "yh-icon-btn yh-ov-close",
      attr: { type: "button", title: "Close panel", "aria-label": "Close panel" },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => {
      void this.leaf.detach();
    });
  }

  private renderControls(container: Element): void {
    const searchRow = container.createDiv({ cls: "yh-ov-search-row" });
    const search = searchRow.createEl("input", {
      cls: "yh-ov-search",
      attr: { type: "search", placeholder: "搜索批注..." },
    });
    search.value = this.query;
    let searchTimer: number | null = null;
    search.addEventListener("input", () => {
      this.query = search.value;
      if (searchTimer !== null) {
        window.clearTimeout(searchTimer);
      }
      searchTimer = window.setTimeout(() => {
        searchTimer = null;
        void this.refreshList();
      }, 200);
    });

    const scope = searchRow.createEl("select", { cls: "yh-filter-select" });
    scope.createEl("option", { text: "当前文件", value: "current" });
    scope.createEl("option", { text: "全库", value: "all" });
    scope.value = this.annotationScope;
    scope.addEventListener("change", async () => {
      this.annotationScope = scope.value as AnnotationScope;
      await this.render();
    });

    const filterButton = searchRow.createEl("button", { cls: "yh-icon-btn", attr: { type: "button", title: "筛选" } });
    setIcon(filterButton, "filter");

    // 位置过滤 toggle：开启后只显示当前页/章的批注
    const posButton = searchRow.createEl("button", {
      cls: "yh-icon-btn yh-ov-pos-toggle",
      attr: { type: "button", title: "仅显示当前位置" },
    });
    setIcon(posButton, "target");
    posButton.toggleClass("is-active", this.positionFilter);
    posButton.addEventListener("click", async () => {
      // MD 文件无可靠位置维度，提示用户
      const activeFile = this.app.workspace.getActiveFile();
      if (!this.positionFilter && activeFile && activeFile.extension.toLowerCase() === "md") {
        new Notice("位置过滤仅对 PDF/EPUB 生效（Markdown 无统一位置维度）");
      }
      this.positionFilter = !this.positionFilter;
      if (this.positionFilter) {
        this.startPositionPolling();
      } else {
        this.stopPositionPolling();
      }
      await this.render();
    });

    const filterRow = container.createDiv({ cls: "yh-ov-filter-row" });
    const color = filterRow.createEl("select", { cls: "yh-filter-select" });
    color.createEl("option", { text: "全部颜色", value: "all" });
    for (const item of ANNOTATION_COLORS) {
      color.createEl("option", { text: COLOR_LABELS[item], value: item });
    }
    color.value = this.color;
    color.addEventListener("change", async () => {
      this.color = color.value as AnnotationColor | "all";
      await this.render();
    });

    const type = filterRow.createEl("select", { cls: "yh-filter-select" });
    type.createEl("option", { text: "全部类型", value: "all" });
    type.createEl("option", { text: "高亮", value: "highlight" });
    type.createEl("option", { text: "笔记", value: "note" });
    type.value = this.type;
    type.addEventListener("change", async () => {
      this.type = type.value as TypeFilter;
      await this.render();
    });

    const sort = filterRow.createEl("select", { cls: "yh-filter-select" });
    const sortOptions = { document: "文档顺序", newest: "最新优先", oldest: "最早优先" } as const;
    for (const item of ["document", "newest", "oldest"] as const) {
      sort.createEl("option", { text: sortOptions[item], value: item });
    }
    sort.value = this.sort;
    sort.addEventListener("change", async () => {
      this.sort = sort.value as AnnotationSortMode;
      await this.render();
    });

    const exportFormat = filterRow.createEl("select", { cls: "yh-filter-select" });
    exportFormat.createEl("option", { text: "默认摘要", value: "summary" });
    exportFormat.createEl("option", { text: "按颜色分组", value: "by-color" });
    exportFormat.createEl("option", { text: "只导出笔记", value: "notes-only" });
    exportFormat.createEl("option", { text: "阅读笔记", value: "reading-notes" });
    exportFormat.value = this.exportFormat;
    exportFormat.addEventListener("change", async () => {
      this.exportFormat = exportFormat.value as AnnotationExportFormat;
      await this.render();
    });
  }

  private renderCard(list: Element, cardData: SidebarCard): void {
    const file = this.fileForCard(cardData);
    const card = list.createDiv({
      cls: `yh-ov-card yh-ov-card--${cardData.color}`,
      attr: this.cardAttributes(cardData),
    });
    card.toggleClass("is-orphaned", !!cardData.orphaned);

    const head = card.createDiv({ cls: "yh-ov-card-head" });
    head.createSpan({ cls: `yh-ov-label yh-label--${cardData.color}`, text: COLOR_LABELS[cardData.color] });
    head.createSpan({ cls: "yh-ov-meta", text: cardData.mode === "md" ? "Markdown" : cardData.mode === "pdf" ? "PDF" : "EPUB" });
    head.createSpan({ cls: "yh-ov-dot", text: "·" });
    const title = (cardData.note && "title" in cardData.note ? cardData.note.title : "") ?? "";
    const kindLabel = cardData.kind === "highlight" ? "高亮" : "笔记";
    const type = head.createSpan({
      cls: "yh-ov-type",
      text: title ? getTitleLabel(title) : kindLabel,
    });
    if (title) {
      type.dataset.title = title;
    }
    // EPUB 想法分类标签（insight/question/reminder），仅 EpubCommentAnnotation 有 noteType
    const note = cardData.note;
    const epubNoteType = note && "noteType" in note ? note.noteType : undefined;
    if (epubNoteType) {
      const labelMap: Record<string, string> = { insight: "💡洞见", question: "❓疑问", reminder: "🔔提醒" };
      head.createSpan({ cls: "yh-ov-note-type", text: labelMap[epubNoteType] ?? epubNoteType });
    }
    head.createSpan({ cls: "yh-ov-time", text: formatTime(cardData.createdAt) });

    const quote = card.createDiv({ cls: "yh-ov-quote" });
    quote.textContent = cardData.text;
    quote.toggleClass("is-code", cardData.isCode || isCodeLikeText(cardData.text));
    this.addExpandToggle(quote, card);
    if (cardData.content) {
      const content = card.createDiv({ cls: "yh-ov-content" });
      void MarkdownRenderer.render(this.app, cardData.content, content, cardData.sourcePath, this).then(() => {
        this.addExpandToggle(content, card);
      });
    }

    const source = card.createDiv({ cls: "yh-ov-source" });
    source.createSpan({ cls: "yh-ov-file", text: file?.name ?? cardData.sourcePath });
    source.createSpan({
      cls: "yh-ov-mode",
      text: cardData.mode === "epub"
        ? (cardData.chapter ?? "EPUB")
        : cardData.pageNumber
          ? `p.${cardData.pageNumber}`
          : "Markdown",
    });

    const actions = card.createDiv({ cls: "yh-ov-actions" });
    if (cardData.note) {
      const edit = actions.createEl("button", {
        cls: "yh-ov-btn yh-ov-btn--icon",
        attr: { type: "button", title: "编辑笔记", "data-action": "edit-note" },
      });
      setIcon(edit, "pencil");
      edit.disabled = !file;
      edit.addEventListener("click", () => {
        if (file) {
          this.openInlineEditor(card, file, cardData, cardData.content);
        }
      });
    } else if (cardData.highlight) {
      const addNote = actions.createEl("button", {
        cls: "yh-ov-btn",
        text: "添加笔记",
        attr: { type: "button", "data-action": "add-note" },
      });
      addNote.disabled = !file;
      addNote.addEventListener("click", () => {
        if (file) {
          addNote.addClass("hidden");
          this.openInlineEditor(card, file, cardData, "");
        }
      });
    }

    const jump = actions.createEl("button", {
      cls: "yh-ov-btn",
      text: "跳转",
      attr: { type: "button", "data-action": "jump" },
    });
    jump.disabled = !file;
    jump.addEventListener("click", () => {
      if (file) {
        this.jumpTo(file, cardData.startOffset, cardData.pageNumber, cardData.mode, cardData.cfiRange);
      }
    });

    const remove = actions.createEl("button", {
      cls: "yh-ov-btn yh-ov-btn--danger",
      text: "删除",
      attr: { type: "button", "data-action": "delete" },
    });
    remove.disabled = !file;
    remove.addEventListener("click", async () => {
      if (file) {
        await this.deleteCard(file, cardData);
        new Notice("批注已删除");
        await this.plugin.refreshAnnotations();
      }
    });

    const edit = card.createDiv({ cls: "yh-ov-edit hidden" });
    const textarea = edit.createEl("textarea", {
      cls: "yh-ov-textarea",
      attr: { placeholder: "写下你的想法..." },
    });
    const editActions = edit.createDiv({ cls: "yh-ov-edit-actions" });
    editActions.createEl("button", { cls: "yh-ov-save", text: "保存", attr: { type: "button" } });
    editActions.createEl("button", { cls: "yh-ov-cancel", text: "取消", attr: { type: "button" } });
  }

  private cardAttributes(card: SidebarCard): Record<string, string> {
    const attrs: Record<string, string> = { "data-id": card.id, "data-source-path": card.sourcePath };
    if (card.highlight) {
      attrs["data-highlight-id"] = card.highlight.id;
    }
    if (card.note) {
      attrs["data-note-id"] = card.note.id;
    }
    return attrs;
  }

  private openInlineEditor(card: HTMLElement, file: TFile, cardData: SidebarCard, initialValue: string): void {
    const edit = card.querySelector<HTMLElement>(".yh-ov-edit");
    const textarea = card.querySelector<HTMLTextAreaElement>(".yh-ov-textarea");
    const save = card.querySelector<HTMLButtonElement>(".yh-ov-save");
    const cancel = card.querySelector<HTMLButtonElement>(".yh-ov-cancel");
    const addNote = card.querySelector<HTMLElement>('[data-action="add-note"]');
    if (!edit || !textarea || !save || !cancel) {
      return;
    }

    textarea.value = initialValue;
    edit.removeClass("hidden");
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    const saveContent = async (): Promise<void> => {
      await this.saveCardContent(file, cardData, textarea.value);
      await this.plugin.refreshAnnotations();
    };

    save.onclick = () => {
      void saveContent();
    };
    cancel.onclick = () => {
      textarea.value = initialValue;
      edit.addClass("hidden");
      addNote?.removeClass("hidden");
    };
    textarea.onkeydown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void saveContent();
      }
      if (event.key === "Escape") {
        textarea.value = initialValue;
        edit.addClass("hidden");
        addNote?.removeClass("hidden");
      }
    };
  }

  private addExpandToggle(contentEl: HTMLElement, wrapperEl: HTMLElement): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const lineHeight = parseFloat(getComputedStyle(contentEl).lineHeight);
        const threshold = lineHeight * 3 + 10;
        if (contentEl.scrollHeight <= threshold + 2) {
          return;
        }

        const button = document.createElement("span");
        button.className = "yh-ov-expand-btn";
        button.textContent = "展开";
        button.tabIndex = 0;
        button.setAttribute("role", "button");
        contentEl.insertAdjacentElement("afterend", button);
        const toggle = (): void => {
          const expanded = contentEl.hasClass("expanded");
          contentEl.toggleClass("expanded", !expanded);
          button.setText(expanded ? "展开" : "收起");
        };
        button.addEventListener("click", toggle);
        button.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        });
      });
    });
  }

  private async saveCardContent(file: TFile, card: SidebarCard, content: string): Promise<void> {
    if (card.note && card.mode === "pdf") {
      await this.plugin.store.updatePdfComment(file, {
        ...(card.note as PdfCommentAnnotation),
        content,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (card.note && card.mode === "md") {
      await this.plugin.store.updateComment(file, {
        ...(card.note as CommentAnnotation),
        content,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (card.note && card.mode === "epub") {
      await this.plugin.store.updateEpubComment(file, {
        ...(card.note as EpubCommentAnnotation),
        note: content,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (card.highlight && card.mode === "pdf") {
      const now = new Date().toISOString();
      const highlight = card.highlight as PdfHighlightAnnotation;
      await this.plugin.store.addPdfComment(file, {
        id: crypto.randomUUID(),
        highlightId: highlight.id,
        anchor: highlight.anchor,
        content,
        color: highlight.color,
        position: { offsetX: 20, offsetY: 0 },
        collapsed: false,
        author: this.plugin.settings.defaultAuthor,
        createdAt: now,
        updatedAt: now,
        replies: [],
        resolved: false,
      });
      return;
    }

    if (card.highlight && card.mode === "md") {
      const now = new Date().toISOString();
      const highlight = card.highlight as HighlightAnnotation;
      await this.plugin.store.addComment(file, {
        id: crypto.randomUUID(),
        highlightId: highlight.id,
        anchor: highlight.anchor,
        content,
        color: highlight.color,
        position: { offsetX: 20, offsetY: 0 },
        collapsed: false,
        author: this.plugin.settings.defaultAuthor,
        createdAt: now,
        updatedAt: now,
        replies: [],
        resolved: false,
      });
      return;
    }

    if (card.highlight && card.mode === "epub") {
      const now = new Date().toISOString();
      const highlight = card.highlight as EpubHighlightAnnotation;
      await this.plugin.store.addEpubComment(file, {
        id: crypto.randomUUID(),
        type: "epub-comment",
        color: highlight.color,
        style: highlight.style,
        anchor: highlight.anchor,
        note: content,
        createdAt: now,
        collapsed: false,
        author: this.plugin.settings.defaultAuthor,
        updatedAt: now,
        replies: [],
        resolved: false,
      });
    }
  }

  private async deleteCard(file: TFile, card: SidebarCard): Promise<void> {
    if (card.highlight) {
      await this.plugin.store.removeAnnotation(file, card.highlight.id);
    }
    if (card.note) {
      await this.plugin.store.removeAnnotation(file, card.note.id);
    }
  }

  private fileForCard(card: SidebarCard): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(card.sourcePath);
    return file instanceof TFile ? file : null;
  }

  private filterCards(cards: SidebarCard[]): SidebarCard[] {
    return cards
      .filter((card) => this.color === "all" || card.color === this.color)
      .filter((card) => {
        if (this.type === "all") {
          return true;
        }
        if (this.type === "highlight") {
          return card.kind === "highlight";
        }
        return Boolean(card.note);
      })
      .filter((card) => {
        const haystack = `${card.sourcePath} ${card.text} ${card.content}`.toLowerCase();
        return haystack.includes(this.query.toLowerCase());
      })
      .filter((card) => {
        // 位置过滤：仅当开启且有当前位置上下文时生效
        if (!this.positionFilter || !this.currentPosition) {
          return true;
        }
        if (this.currentPosition.mode !== card.mode) {
          return true; // 不同格式不互相过滤（避免 PDF 卡片被 EPUB 位置过滤掉）
        }
        if (this.currentPosition.mode === "pdf") {
          return card.pageNumber != null && this.currentPosition.page != null && card.pageNumber === this.currentPosition.page;
        }
        if (this.currentPosition.mode === "epub") {
          // chapter 为空时不过滤（容错）
          if (!this.currentPosition.chapter) {
            return true;
          }
          return (card.chapter ?? "") === this.currentPosition.chapter;
        }
        // MD：无可靠位置过滤维度，不过滤（粗粒度策略）
        return true;
      })
      .sort((a, b) => {
        if (this.sort === "newest") {
          return this.cardUpdatedAt(b).localeCompare(this.cardUpdatedAt(a));
        }
        if (this.sort === "oldest") {
          return this.cardUpdatedAt(a).localeCompare(this.cardUpdatedAt(b));
        }
        return a.sourcePath.localeCompare(b.sourcePath) || (a.pageNumber ?? 0) - (b.pageNumber ?? 0) || a.startOffset - b.startOffset;
      });
  }

  private cardUpdatedAt(card: SidebarCard): string {
    return card.note?.updatedAt ?? card.createdAt;
  }

  private renderExportFooter(container: Element, file: TFile | null): void {
    const footer = container.createDiv({ cls: "yh-ov-foot" });
    const exportButton = footer.createEl("button", { cls: "yh-export-btn", text: "↑ 导出批注", attr: { type: "button" } });
    exportButton.disabled = this.annotationScope === "current" && !file;
    exportButton.addEventListener("click", async () => {
      if (this.annotationScope === "current" && !file) {
        return;
      }
      const customTemplate = this.plugin.settings.exportAnnotationTemplate;
      const exported =
        this.annotationScope === "all"
          ? await this.plugin.store.exportAllNotes(this.exportFormat, customTemplate)
          : await this.plugin.store.exportNotes(file!, this.exportFormat, customTemplate);
      new Notice(`已导出笔记至 ${exported.path}`);
    });
    footer.createDiv({ cls: "yh-ov-export-note", text: this.exportFormatLabel() });
  }

  private exportFormatLabel(): string {
    const labels: Record<AnnotationExportFormat, string> = {
      summary: "导出为 Markdown 摘要",
      "by-color": "按颜色分组导出",
      "notes-only": "只导出带笔记的批注",
      "reading-notes": "导出为阅读笔记格式",
    };
    return labels[this.exportFormat];
  }

  /**
   * 渲染三格式统一书签区（仅当前文件）。
   * MD/PDF/EPUB 书签统一展示，点击跳转、✕ 删除，操作逻辑完全一致。
   */
  private renderBookmarks(container: Element, file: TFile): void {
    const doc = this.plugin.store.getCachedDocument(file.path);
    const bookmarks = doc?.bookmarks ?? [];
    if (!bookmarks.length) {
      return; // 无书签时不渲染整块，避免空区域噪音
    }

    const section = container.createDiv({ cls: "yh-ov-bookmarks" });
    section.createDiv({ cls: "yh-ov-bookmarks-title", text: `书签 · ${bookmarks.length}` });

    for (const bm of bookmarks) {
      const row = section.createDiv({ cls: "yh-ov-bookmark-row" });
      // 类型图标（md/pdf/epub）
      const icon = row.createSpan({ cls: "yh-ov-bookmark-icon" });
      icon.textContent = bm.type === "pdf-bookmark" ? "📄" : bm.type === "epub-bookmark" ? "📖" : "📝";

      const label = row.createSpan({ cls: "yh-ov-bookmark-label", text: bm.label });
      if (bm.preview) {
        label.setAttribute("title", bm.preview);
      }

      row.createSpan({ cls: "yh-ov-bookmark-time", text: formatTime(bm.createdAt) });

      // 点击跳转（三格式统一入口）
      row.addEventListener("click", () => {
        void this.plugin.jumpToBookmark(file, bm);
      });

      // 删除按钮
      const del = row.createEl("button", {
        cls: "yh-icon-btn yh-ov-bookmark-del",
        attr: { type: "button", title: "删除书签", "aria-label": "删除书签" },
      });
      setIcon(del, "trash");
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.plugin.store.removeBookmark(file, bm.id);
        await this.plugin.refreshAnnotations();
      });
    }
  }

  /**
   * 采集活动文件的当前位置上下文（PDF 页码 / EPUB 章节）。
   * MD 无可靠位置维度，不采集（位置过滤对 MD 不生效）。
   */
  private refreshCurrentPosition(file: TFile | null): void {
    if (!file) {
      this.currentPosition = null;
      return;
    }
    const ext = file.extension.toLowerCase();
    if (ext === "pdf") {
      const page = this.plugin.getCurrentPdfPageNumber();
      this.currentPosition = page > 0 ? { mode: "pdf", page } : null;
      return;
    }
    if (this.plugin.isBookExtension(ext)) {
      const chapter = this.plugin.getCurrentEpubChapter(file);
      this.currentPosition = chapter ? { mode: "epub", chapter } : null;
      return;
    }
    this.currentPosition = null;
  }

  /** 开启位置轮询：检测 PDF 翻页/EPUB 翻章后自动刷新卡片列表。 */
  private startPositionPolling(): void {
    this.stopPositionPolling();
    this.positionPollTimer = window.setInterval(() => {
      const file = this.app.workspace.getActiveFile();
      this.refreshCurrentPosition(file);
      const key = this.currentPosition ? `${this.currentPosition.mode}:${this.currentPosition.page ?? this.currentPosition.chapter ?? ""}` : "";
      if (key !== this.lastPositionKey) {
        this.lastPositionKey = key;
        void this.refreshList();
      }
    }, 800);
  }

  private stopPositionPolling(): void {
    if (this.positionPollTimer !== null) {
      window.clearInterval(this.positionPollTimer);
      this.positionPollTimer = null;
    }
  }

  private async jumpTo(
    file: TFile,
    offset: number,
    pageNumber: number | null,
    mode: AnnotationMode = "md",
    cfiRange?: string,
  ): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);

    if (mode === "epub" && cfiRange) {
      // 统一走 plugin 的跳转入口（含轮询重试），不再自行 setTimeout 查 leaf
      this.plugin.navigateEpubToCfi(file, cfiRange);
      return;
    }

    if (file.extension.toLowerCase() === "pdf") {
      window.setTimeout(() => {
        document.dispatchEvent(new CustomEvent("yh-pdf-goto-page", { detail: { page: pageNumber } }));
      }, 120);
      return;
    }

    const view = leaf.view instanceof MarkdownView ? leaf.view : this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      return;
    }

    const pos = view.editor.offsetToPos(offset);
    view.editor.setCursor(pos);
    view.editor.scrollIntoView({ from: pos, to: pos }, true);
    view.containerEl.addClass("yh-flash-target");
    window.setTimeout(() => view.containerEl.removeClass("yh-flash-target"), 850);
  }
}

function getTitleLabel(title: string): string {
  const labels: Record<string, string> = {
    Insight: "洞察",
    Question: "疑问",
    Reminder: "提醒",
  };
  return labels[title] ?? title;
}

function isCodeAnchor(anchor: HighlightAnnotation["anchor"] | PdfHighlightAnnotation["anchor"]): boolean {
  return "isCode" in anchor && Boolean(anchor.isCode);
}

function isCodeLikeText(text: string): boolean {
  return /^[ \t]{2,}/m.test(text) || /\n[ \t]{2,}\S/.test(text);
}
