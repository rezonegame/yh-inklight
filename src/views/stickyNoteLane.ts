/**
 * [INPUT]: 依赖 Obsidian App/Component/MarkdownView、AnnotationStore 数据、stickyNoteView 卡片组件、positioning 排版算法
 * [OUTPUT]: 对外提供 StickyNoteLane，在编辑器旁渲染可折叠、可编辑的便签栏，支持窄屏自动隐藏
 * [POS]: views 模块的便签栏管理器，被 main.ts 装配并调用
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { App, Component, MarkdownView, TFile } from "obsidian";

import { CommentAnnotation, FileAnnotationDocument } from "../storage/types";
import { layoutStickyNotes, type StickyLayoutInput, type StickyLayoutOutput } from "../utils/positioning";
import { renderStickyNoteCard } from "./stickyNoteView";

interface StickyNoteLaneOptions {
  app: App;
  component: Component;
  getSettings: () => { stickyWidth: number; stickySide: "left" | "right"; stickyCollapseWidth: number; stickyNotesVisible: boolean };
  getCachedDocument: (filePath: string) => FileAnnotationDocument | null;
  onUpdateComment: (file: TFile, comment: CommentAnnotation, content: string, title?: string) => Promise<void>;
  onDeleteAnnotation: (file: TFile, annotationId: string) => Promise<void>;
  onToggleCollapse: (file: TFile, comment: CommentAnnotation) => Promise<void>;
  refreshAnnotations: () => Promise<void>;
}

export class StickyNoteLane {
  private container: HTMLElement | null = null;
  private lane: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;

  constructor(private readonly options: StickyNoteLaneOptions) {}

  register(): void {
    this.options.component.registerEvent(
      this.options.app.workspace.on("active-leaf-change", () => this.render()),
    );
    this.options.component.registerEvent(
      this.options.app.workspace.on("layout-change", () => this.render()),
    );

    this.observer = new ResizeObserver(() => this.render());
    this.options.component.register(() => this.destroy());
  }

  async render(): Promise<void> {
    const view = this.options.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file || view.file.extension !== "md") {
      this.hide();
      return;
    }

    const settings = this.options.getSettings();
    if (!settings.stickyNotesVisible) {
      this.hide();
      return;
    }

    const document = this.options.getCachedDocument(view.file.path);
    if (!document || document.comments.length === 0) {
      this.hide();
      return;
    }

    const visibleComments = document.comments.filter((comment) => !comment.orphaned);
    if (visibleComments.length === 0) {
      this.hide();
      return;
    }

    // 检查是否窄屏
    const editorWidth = view.containerEl.offsetWidth;
    if (editorWidth < settings.stickyCollapseWidth) {
      this.hide();
      return;
    }

    this.ensureContainer(view);
    this.renderLane(view, visibleComments, settings);
  }

  private ensureContainer(view: MarkdownView): void {
    if (this.container && this.container.parentElement === view.containerEl) {
      return;
    }

    this.container?.remove();
    this.container = view.containerEl.createDiv({ cls: "yh-sticky-lane-container" });
    this.lane = this.container.createDiv({ cls: "yh-sticky-lane" });

    if (this.observer) {
      this.observer.observe(view.containerEl);
    }
  }

  private renderLane(view: MarkdownView, comments: CommentAnnotation[], settings: { stickySide: "left" | "right" }): void {
    if (!this.lane) {
      return;
    }

    this.lane.empty();
    this.lane.toggleClass("yh-sticky-lane--left", settings.stickySide === "left");

    const layoutInputs: StickyLayoutInput[] = [];
    const commentElements = new Map<string, HTMLElement>();

    // 收集所有便签的垂直位置
    for (const comment of comments) {
      const anchorTop = this.getAnchorTop(view, comment);
      if (anchorTop === null) {
        continue;
      }

      const tempCard = this.lane.createDiv({ cls: "yh-card yh-card--temp" });
      tempCard.style.visibility = "hidden";
      tempCard.style.position = "absolute";
      renderStickyNoteCard(tempCard, {
        app: this.options.app,
        component: this.options.component,
        sourcePath: view.file!.path,
        comment,
        onToggle: (c) => this.handleToggle(view.file!, c),
        onUpdate: (c, content, title) => this.handleUpdate(view.file!, c, content, title),
        onDelete: (c) => this.handleDelete(view.file!, c),
      });

      const height = tempCard.offsetHeight;
      tempCard.remove();

      layoutInputs.push({
        id: comment.id,
        anchorTop,
        height,
        offsetY: comment.position?.offsetY ?? 0,
      });
    }

    // 计算避让位置
    const layoutOutputs = layoutStickyNotes(layoutInputs);

    // 渲染最终便签
    for (const output of layoutOutputs) {
      const comment = comments.find((c) => c.id === output.id);
      if (!comment) {
        continue;
      }

      const card = this.lane.createDiv({
        cls: `yh-card yh-card--${comment.color} yh-sticky-card`,
        attr: {
          "data-yh-color": comment.color,
          "data-yh-id": comment.id,
          "data-yh-card-id": comment.id,
        },
      });
      card.style.position = "absolute";
      card.style.top = `${output.top}px`;

      renderStickyNoteCard(card, {
        app: this.options.app,
        component: this.options.component,
        sourcePath: view.file!.path,
        comment,
        onToggle: (c) => this.handleToggle(view.file!, c),
        onUpdate: (c, content, title) => this.handleUpdate(view.file!, c, content, title),
        onDelete: (c) => this.handleDelete(view.file!, c),
      });

      // 添加连接线
      if (settings.stickySide === "right") {
        const line = this.lane.createDiv({ cls: "yh-leader-line" });
        line.style.position = "absolute";
        line.style.left = "0";
        line.style.top = `${output.top + 20}px`;
        line.style.width = "20px";
        line.style.height = "1px";
        line.style.background = `var(--yh-${comment.color})`;
      }
    }
  }

  private getAnchorTop(view: MarkdownView, comment: CommentAnnotation): number | null {
    // 在阅读视图中查找高亮元素
    const mark = view.containerEl.querySelector<HTMLElement>(`mark.yh-highlight[data-yh-id="${comment.id}"]`);
    if (mark) {
      const rect = mark.getBoundingClientRect();
      const containerRect = view.containerEl.getBoundingClientRect();
      return rect.top - containerRect.top + view.containerEl.scrollTop;
    }

    // 编辑器模式下，通过行号估算位置（简化实现）
    try {
      const pos = view.editor.offsetToPos(comment.anchor.startOffset);
      const lineHeight = 20; // 估算行高
      return pos.line * lineHeight;
    } catch {
      return null;
    }
  }

  private hide(): void {
    this.container?.remove();
    this.container = null;
    this.lane = null;
  }

  private async handleToggle(file: TFile, comment: CommentAnnotation): Promise<void> {
    await this.options.onToggleCollapse(file, { ...comment, collapsed: !comment.collapsed });
    await this.render();
  }

  private async handleUpdate(file: TFile, comment: CommentAnnotation, content: string, title?: string): Promise<void> {
    await this.options.onUpdateComment(file, comment, content, title);
    await this.render();
  }

  private async handleDelete(file: TFile, comment: CommentAnnotation): Promise<void> {
    await this.options.onDeleteAnnotation(file, comment.id);
    await this.render();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.container?.remove();
    this.container = null;
    this.lane = null;
  }
}