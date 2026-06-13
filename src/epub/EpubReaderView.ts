/**
 * [INPUT]: 依赖 Obsidian FileView/WorkspaceLeaf/TFile、foliate-js view API、
 *          storage/types 的 EPUB 标注/进度/主题类型、AnnotationStore 的 sidecar 持久化、
 *          EpubFoliateLoader 的引擎加载与 EpubStylesheetInliner 的安全过滤、
 *          EpubThemeManager 的主题颜色解析
 * [OUTPUT]: 对外提供 EpubReaderView，将 foliate-js 渲染引擎嵌入 Obsidian leaf，
 *          承载工具栏、侧边栏（目录/标注）、阅读区（iframe）、进度条、
 *          选区上下文菜单、标注 CRUD、进度持久化与阅读时间追踪
 * [POS]: epub 模块的唯一视图入口，由插件主类通过 registerView 注册
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { FileView, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";

import {
	ANNOTATION_COLORS,
	AnnotationColor,
	AnnotationPluginSettings,
	COLOR_LABELS,
	EPUB_COLOR_MAP,
	EPUB_READING_THEMES,
	EpubCfiAnchor,
	EpubCommentAnnotation,
	EpubFlowMode,
	EpubHighlightAnnotation,
	EpubHighlightStyle,
	EpubReadingProgress,
	EpubReadingTheme,
} from "../storage/types";
import { AnnotationStore } from "../storage/annotationStore";
import {
	normalizeCfi,
	normalizePercent,
	resolveChapterLabel,
	TocSpineEntry,
} from "./EpubChapterResolver";
import { inlineBlockedStylesheets, stripScriptsFromDocument } from "./EpubStylesheetInliner";
import { EpubThemeManager } from "./EpubThemeManager";
import {
	createFoliateView,
	FoliateViewHandle,
	openBookFromBuffer,
} from "./EpubFoliateLoader";

// ---- 常量 ----

/** 注册到 Obsidian workspace 的视图类型标识 */
export const EPUB_READER_VIEW_TYPE = "inklight-epub-reader";

/** 阅读时间 flush 间隔（毫秒） */
const READING_TIME_FLUSH_INTERVAL_MS = 60_000;

/** 鼠标滚轮翻页防抖延迟（毫秒） */
const WHEEL_DEBOUNCE_MS = 400;

/** 进度保存防抖延迟（毫秒） */
const PROGRESS_SAVE_DEBOUNCE_MS = 2_000;

/** 浮动上下文菜单消失延迟（毫秒） */
const CONTEXT_MENU_DISMISS_MS = 300;

// ---- 辅助类型 ----

/** 侧边栏当前显示的标签页 */
type SidebarTab = "toc" | "annotations";

/** 阅读时间追踪器状态快照 */
interface ReadingTimeSnapshot {
	readingTimeSeconds: number;
	lastFlushTimestamp: number;
}

interface FoliateTocItem {
	label?: string;
	href?: string;
	subitems?: unknown[];
}

interface FoliateRelocateDetail {
	cfi?: string;
	index?: number;
	fraction?: number;
	range?: Range;
	tocItem?: { label?: string };
}

interface FoliateLoadDetail {
	doc?: Document;
	index?: number;
}

interface FoliateDrawAnnotationDetail {
	annotation?: {
		value?: string;
		color?: AnnotationColor;
		style?: EpubHighlightStyle;
	};
	draw?: (
		drawer: (rects: Array<DOMRect | { left: number; top: number; width: number; height: number }>) => SVGElement,
		options?: unknown,
	) => void;
}

interface FoliateShowAnnotationDetail {
	value?: string;
	index?: number;
	range?: Range;
}

// ---- EpubReaderView ----

/**
 * yh-inklight EPUB 阅读器核心视图。
 *
 * 继承 Obsidian FileView，将 foliate-js <foliate-view> 嵌入 leaf 容器。
 * 负责：
 * - EPUB 文件加载与安全过滤
 * - 工具栏（字号/主题/翻页模式/导航）
 * - 侧边栏（目录/标注列表）
 * - 选区上下文菜单（画线/标注/AI）
 * - 标注 CRUD（通过 AnnotationStore）
 * - 阅读进度持久化与阅读时间追踪
 * - 键盘/滚轮导航
 */
export class EpubReaderView extends FileView {
	// ---- 依赖注入 ----

	private readonly store: AnnotationStore;
	private readonly pluginSettings: AnnotationPluginSettings;
	private readonly themeManager: EpubThemeManager;

	// ---- foliate 实例 ----

	private foliateView: FoliateViewHandle | null = null;
	private loadedSectionDocs = new WeakMap<Document, number>();
	private documentSelectionCleanups = new WeakMap<Document, () => void>();
	private currentCfi = "";
	private currentSectionIndex = 0;

	// ---- 状态 ----

	private tocEntries: TocSpineEntry[] = [];
	private currentChapter = "";
	private currentPercent = 0;
	private currentFlowMode: EpubFlowMode;
	private currentFontSize: number;
	private currentTheme: EpubReadingTheme;
	private sidebarTab: SidebarTab = "toc";
	private sidebarOpen = false;
	private contextMenuEl: HTMLElement | null = null;
	private lastSelectedCfiRange = "";
	private lastSelectedText = "";

	// ---- 定时器 / 追踪 ----

	private readingTimeSeconds = 0;
	private readingTimeFlushTimer: number | null = null;
	private progressSaveTimer: number | null = null;
	private wheelDebounceTimer: number | null = null;
	private contextMenuDismissTimer: number | null = null;
	private visibilityHandler: (() => void) | null = null;
	private blurHandler: (() => void) | null = null;
	private focusHandler: (() => void) | null = null;
	private lastFlushTimestamp = 0;

	// ---- DOM 容器引用 ----

	private toolbarEl!: HTMLElement;
	private sidebarContainerEl!: HTMLElement;
	private sidebarContentEl!: HTMLElement;
	private readerContainerEl!: HTMLElement;
	private progressEl!: HTMLElement;

	// ================================================================
	// 构造 & 生命周期
	// ================================================================

	constructor(
		leaf: WorkspaceLeaf,
		store: AnnotationStore,
		settings: AnnotationPluginSettings,
	) {
		super(leaf);
		this.store = store;
		this.pluginSettings = settings;
		this.themeManager = new EpubThemeManager();
		this.currentFlowMode = settings.epubDefaultFlow;
		this.currentFontSize = settings.epubFontSize;
		this.currentTheme = settings.epubReadingTheme;
	}

	/** 视图类型标识，供 Obsidian workspace 路由 */
	override getViewType(): string {
		return EPUB_READER_VIEW_TYPE;
	}

	/** leaf 标签页显示的标题 */
	override getDisplayText(): string {
		return this.file?.basename ?? "EPUB Reader";
	}

	/** 声明此视图可以打开 epub 文件 */
	override canAcceptExtension(extension: string): boolean {
		return extension === "epub";
	}

	/** 视图打开时构建 DOM 骨架 */
	override async onOpen(): Promise<void> {
		this.containerEl.addClass("yh-epub-reader");
		this.buildLayout();
		this.startReadingTimeTracker();
	}

	/** 视图关闭时释放 foliate 资源与定时器 */
	override async onClose(): Promise<void> {
		this.stopReadingTimeTracker();
		this.dismissContextMenu();
		this.destroyRendition();
	}

	// ================================================================
	// 文件加载（FileView 核心）
	// ================================================================

	/**
	 * Obsidian FileView 文件加载钩子。
	 * 读取 EPUB 二进制内容 → foliate-js 解析 → 渲染 → 恢复进度。
	 *
	 * @param file - 用户打开的 EPUB TFile
	 */
	override async onLoadFile(file: TFile): Promise<void> {
		this.destroyRendition();

		try {
			const arrayBuffer = await this.app.vault.readBinary(file);
			this.foliateView = await createFoliateView(this.readerContainerEl);
			this.configureFoliateView(this.foliateView);
			this.registerFoliateEvents(this.foliateView);
			await openBookFromBuffer(this.foliateView, arrayBuffer, file.name);
			this.applyFoliateLayout();
			this.tocEntries = this.buildFoliateTocEntries(this.foliateView.book?.toc ?? []);
			this.applyFoliateAppearance();

			await this.restoreProgress();

			this.renderToolbar();
			this.renderSidebar();
		} catch (error) {
			console.error("yh-inklight: EPUB load failed", error);
			new Notice(`墨光 EPUB 加载失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Obsidian FileView 文件卸载钩子。
	 * flush 阅读时间并销毁 foliate-view。
	 *
	 * @param _file - 即将卸载的 TFile（未使用）
	 */
	override async onUnloadFile(_file: TFile): Promise<void> {
		await this.flushReadingTime();
		await this.saveCurrentProgress();
		this.destroyRendition();
	}

	// ================================================================
	// 布局构建
	// ================================================================

	/**
	 * 构建完整的 DOM 布局骨架：
	 * 工具栏 → [侧边栏 | 阅读区] → 进度条
	 */
	private buildLayout(): void {
		this.containerEl.empty();

		this.toolbarEl = this.containerEl.createDiv({ cls: "yh-epub-toolbar" });

		const body = this.containerEl.createDiv({ cls: "yh-epub-body" });

		this.sidebarContainerEl = body.createDiv({ cls: "yh-epub-sidebar" });
		this.sidebarContainerEl.toggleClass("is-open", this.sidebarOpen);

		const sidebarTabs = this.sidebarContainerEl.createDiv({ cls: "yh-epub-sidebar-tabs" });
		const tocTab = sidebarTabs.createEl("button", {
			cls: "yh-epub-sidebar-tab",
			text: "目录",
			attr: { type: "button", "data-tab": "toc" },
		});
		const annTab = sidebarTabs.createEl("button", {
			cls: "yh-epub-sidebar-tab",
			text: "标注",
			attr: { type: "button", "data-tab": "annotations" },
		});
		tocTab.addEventListener("click", () => this.switchSidebarTab("toc"));
		annTab.addEventListener("click", () => this.switchSidebarTab("annotations"));

		this.sidebarContentEl = this.sidebarContainerEl.createDiv({ cls: "yh-epub-sidebar-content" });

		this.readerContainerEl = body.createDiv({ cls: "yh-epub-reader-area" });

		this.progressEl = this.containerEl.createDiv({ cls: "yh-epub-progress" });

		this.containerEl.addEventListener("keydown", (event) => this.handleKeydown(event));
		this.readerContainerEl.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });
	}

	// ================================================================
	// 工具栏
	// ================================================================

	/**
	 * 渲染工具栏：侧边栏切换、书名、字号、主题、翻页模式、导航按钮。
	 */
	private renderToolbar(): void {
		this.toolbarEl.empty();

		const toggleBtn = this.toolbarEl.createEl("button", {
			cls: "yh-epub-toolbar-btn",
			attr: { type: "button", title: "切换侧边栏", "aria-label": "切换侧边栏" },
		});
		setIcon(toggleBtn, "menu");
		toggleBtn.addEventListener("click", () => this.toggleSidebar());

		this.toolbarEl.createDiv({
			cls: "yh-epub-toolbar-title",
			text: this.file?.basename ?? "",
		});

		const fontSizeDec = this.toolbarEl.createEl("button", {
			cls: "yh-epub-toolbar-btn",
			attr: { type: "button", title: "缩小字号", "aria-label": "缩小字号" },
			text: "A-",
		});
		fontSizeDec.addEventListener("click", () => this.changeFontSize(-1));

		const fontSizeInc = this.toolbarEl.createEl("button", {
			cls: "yh-epub-toolbar-btn",
			attr: { type: "button", title: "放大字号", "aria-label": "放大字号" },
			text: "A+",
		});
		fontSizeInc.addEventListener("click", () => this.changeFontSize(1));

		this.renderThemeSwatches();

		const flowBtn = this.toolbarEl.createEl("button", {
			cls: "yh-epub-toolbar-btn",
			attr: { type: "button", title: this.currentFlowMode === "paginated" ? "切换为滚动" : "切换为分页" },
		});
		setIcon(flowBtn, this.currentFlowMode === "paginated" ? "lines-of-text" : "sheets");
		flowBtn.addEventListener("click", () => this.toggleFlowMode());

		const prevBtn = this.toolbarEl.createEl("button", {
			cls: "yh-epub-toolbar-btn",
			attr: { type: "button", title: "上一页", "aria-label": "上一页" },
		});
		setIcon(prevBtn, "chevron-left");
		prevBtn.addEventListener("click", () => this.prevPage());

		const nextBtn = this.toolbarEl.createEl("button", {
			cls: "yh-epub-toolbar-btn",
			attr: { type: "button", title: "下一页", "aria-label": "下一页" },
		});
		setIcon(nextBtn, "chevron-right");
		nextBtn.addEventListener("click", () => this.nextPage());
	}

	/**
	 * 在工具栏中渲染主题色块选择器，点击切换阅读主题。
	 */
	private renderThemeSwatches(): void {
		const container = this.toolbarEl.createDiv({ cls: "yh-epub-theme-swatches" });

		for (const theme of EPUB_READING_THEMES) {
			const swatch = container.createEl("button", {
				cls: "yh-epub-theme-swatch",
				attr: {
					type: "button",
					title: theme.label,
					"aria-label": `主题: ${theme.label}`,
					"data-theme": theme.id,
				},
			});
			swatch.style.background = theme.swatch;
			swatch.toggleClass("is-active", theme.id === this.currentTheme);
			swatch.addEventListener("click", () => this.switchTheme(theme.id));
		}
	}

	// ================================================================
	// 侧边栏
	// ================================================================

	/**
	 * 切换侧边栏显示/隐藏。
	 */
	private toggleSidebar(): void {
		this.sidebarOpen = !this.sidebarOpen;
		this.sidebarContainerEl.toggleClass("is-open", this.sidebarOpen);
		if (this.sidebarOpen) {
			this.renderSidebar();
		}
	}

	/**
	 * 切换侧边栏标签页并重新渲染内容。
	 */
	private switchSidebarTab(tab: SidebarTab): void {
		this.sidebarTab = tab;
		const tabs = this.sidebarContainerEl.querySelectorAll<HTMLButtonElement>(".yh-epub-sidebar-tab");
		for (const element of Array.from(tabs)) {
			element.toggleClass("is-active", element.dataset.tab === tab);
		}
		this.renderSidebar();
	}

	/**
	 * 渲染侧边栏内容，根据当前标签页显示目录或标注列表。
	 */
	private renderSidebar(): void {
		this.sidebarContentEl.empty();

		const tabs = this.sidebarContainerEl.querySelectorAll<HTMLButtonElement>(".yh-epub-sidebar-tab");
		for (const element of Array.from(tabs)) {
			element.toggleClass("is-active", element.dataset.tab === this.sidebarTab);
		}

		if (this.sidebarTab === "toc") {
			this.renderTocList();
		} else {
			this.renderAnnotationList();
		}
	}

	/**
	 * 渲染目录列表，点击条目跳转到对应章节。
	 */
	private renderTocList(): void {
		if (this.tocEntries.length === 0) {
			this.sidebarContentEl.createDiv({ cls: "yh-epub-empty", text: "未找到目录信息。" });
			return;
		}

		const list = this.sidebarContentEl.createDiv({ cls: "yh-epub-toc-list" });

		for (const entry of this.tocEntries) {
			const item = list.createEl("button", {
				cls: "yh-epub-toc-item",
				text: entry.label,
				attr: { type: "button" },
			});
			item.addEventListener("click", () => this.navigateToSpineIndex(entry.spineIndex));
		}
	}

	/**
	 * 渲染标注列表，显示当前文件的所有 EPUB 高亮和评论标注。
	 */
	private renderAnnotationList(): void {
		if (!this.file) {
			this.sidebarContentEl.createDiv({ cls: "yh-epub-empty", text: "未打开文件。" });
			return;
		}

		const document = this.store.getCachedDocument(this.file.path);
		if (!document) {
			this.sidebarContentEl.createDiv({ cls: "yh-epub-empty", text: "暂无标注。" });
			return;
		}

		const allAnnotations = [
			...document.epubHighlights.map((highlight) => ({
				id: highlight.id,
				kind: "highlight" as const,
				color: highlight.color,
				style: highlight.style,
				text: highlight.anchor.selectedText,
				chapter: highlight.anchor.chapter,
				createdAt: highlight.createdAt,
			})),
			...document.epubComments.map((comment) => ({
				id: comment.id,
				kind: "comment" as const,
				color: comment.color,
				style: comment.style,
				text: comment.anchor.selectedText,
				chapter: comment.anchor.chapter,
				createdAt: comment.createdAt,
				note: comment.note,
			})),
		].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

		if (allAnnotations.length === 0) {
			this.sidebarContentEl.createDiv({ cls: "yh-epub-empty", text: "暂无标注。" });
			return;
		}

		const list = this.sidebarContentEl.createDiv({ cls: "yh-epub-annotation-list" });

		for (const annotation of allAnnotations) {
			const card = list.createDiv({
				cls: "yh-epub-annotation-card",
				attr: {
					"data-yh-id": annotation.id,
					"data-yh-color": annotation.color,
				},
			});

			const header = card.createDiv({ cls: "yh-epub-annotation-header" });
			header.createSpan({ cls: `yh-epub-color-chip yh-chip--${annotation.color}`, text: COLOR_LABELS[annotation.color] });
			header.createSpan({ cls: "yh-epub-annotation-kind", text: annotation.kind === "comment" ? "标注" : "画线" });

			card.createDiv({ cls: "yh-epub-annotation-text", text: annotation.text });

			if (annotation.kind === "comment" && annotation.note) {
				card.createDiv({ cls: "yh-epub-annotation-note", text: annotation.note });
			}

			card.addEventListener("click", () => this.navigateToAnnotation(annotation.id));
		}
	}

	// ================================================================
	// foliate 事件注册
	// ================================================================

	/**
	 * 配置 foliate-view 的布局属性。
	 */
	private configureFoliateView(view: FoliateViewHandle): void {
		const element = view as unknown as HTMLElement;
		element.addClass("yh-epub-foliate-view");
		element.setAttribute("flow", this.currentFlowMode);
		element.setAttribute("margin", this.currentFlowMode === "paginated" ? "28px" : "0px");
		element.setAttribute("gap", "8%");
		element.setAttribute("max-inline-size", "760px");
	}

	/**
	 * 注册 foliate 事件：section load、位置变更、标注绘制、标注点击。
	 */
	private registerFoliateEvents(view: FoliateViewHandle): void {
		view.addEventListener("load", this.handleFoliateLoad as EventListener);
		view.addEventListener("relocate", this.handleFoliateRelocate as EventListener);
		view.addEventListener("draw-annotation", this.handleFoliateDrawAnnotation as EventListener);
		view.addEventListener("show-annotation", this.handleFoliateShowAnnotation as EventListener);
	}

	// ================================================================
	// 安全处理
	// ================================================================

	// （安全过滤已在 foliate load 事件中处理）

	// ================================================================
	// 选区事件 & 上下文菜单
	// ================================================================

	/**
	 * 处理 foliate 文本选区事件。
	 * 记录选区 CFI 和文本，在选区位置显示浮动上下文菜单。
	 *
	 * @param cfiRange - foliate 由 Range 生成的 CFI 范围字符串
	 * @param doc - foliate load 事件提供的 section document
	 */
	private handleTextSelected(cfiRange: string, doc: Document): void {
		const selection = doc.defaultView?.getSelection?.();
		const text = selection?.toString().trim() ?? "";

		if (!text) {
			this.dismissContextMenu();
			return;
		}

		this.lastSelectedCfiRange = cfiRange;
		this.lastSelectedText = text;

		const range = selection?.getRangeAt(0);
		if (!range) {
			return;
		}

		const selectionRect = range.getBoundingClientRect();
		const iframeRect = this.findIframeForDocument(doc)?.getBoundingClientRect();
		const frameLeft = iframeRect?.left ?? 0;
		const frameTop = iframeRect?.top ?? 0;
		const absoluteTop = frameTop + selectionRect.top;
		const absoluteLeft = frameLeft + selectionRect.left;

		this.showContextMenu(absoluteLeft, absoluteTop + selectionRect.height, text, cfiRange);
	}

	/**
	 * 在指定位置显示浮动上下文菜单。
	 * 包含 5 色画线圆点、标注按钮和 AI 按钮（预留）。
	 *
	 * @param left - 菜单左侧像素位置（相对于视口）
	 * @param top - 菜单顶部像素位置（相对于视口）
	 * @param text - 选中的文本内容
	 * @param cfiRange - 选区的 CFI 范围
	 */
	private showContextMenu(left: number, top: number, text: string, cfiRange: string): void {
		this.dismissContextMenu();

		const menu = document.body.createDiv({ cls: "yh-epub-context-menu" });

		const colorRow = menu.createDiv({ cls: "yh-epub-context-colors" });
		for (const color of ANNOTATION_COLORS) {
			const dot = colorRow.createEl("button", {
				cls: `yh-epub-context-dot yh-dot--${color}`,
				attr: {
					type: "button",
					title: COLOR_LABELS[color],
					"aria-label": `${COLOR_LABELS[color]}画线`,
				},
			});
			dot.style.background = EPUB_COLOR_MAP[color];
			dot.addEventListener("click", () => {
				void this.createHighlight(color, cfiRange, text);
				this.dismissContextMenu();
			});
		}

		const noteBtn = menu.createEl("button", {
			cls: "yh-epub-context-note-btn",
			attr: { type: "button", title: "添加标注" },
			text: "\u{1F4DD}",
		});
		noteBtn.addEventListener("click", () => {
			void this.openNoteModal(cfiRange, text);
			this.dismissContextMenu();
		});

		if (this.pluginSettings.epubAiEnabled) {
			const aiBtn = menu.createEl("button", {
				cls: "yh-epub-context-ai-btn",
				attr: { type: "button", title: "AI 分析" },
				text: "AI",
			});
			aiBtn.addEventListener("click", () => {
				this.handleAiAction(text);
				this.dismissContextMenu();
			});
		}

		const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - 260));
		const clampedTop = top + 8;
		menu.style.left = `${clampedLeft}px`;
		menu.style.top = `${clampedTop}px`;

		document.body.appendChild(menu);
		this.contextMenuEl = menu;

		this.contextMenuDismissTimer = window.setTimeout(() => {
			this.dismissContextMenu();
		}, 8_000);
	}

	/**
	 * 销毁当前浮动上下文菜单。
	 */
	private dismissContextMenu(): void {
		if (this.contextMenuDismissTimer !== null) {
			window.clearTimeout(this.contextMenuDismissTimer);
			this.contextMenuDismissTimer = null;
		}

		if (this.contextMenuEl) {
			this.contextMenuEl.remove();
			this.contextMenuEl = null;
		}
	}

	// ================================================================
	// 标注 CRUD
	// ================================================================

	/**
	 * 在当前选区创建指定颜色的高亮标注。
	 * 将标注保存到 sidecar 并渲染到 foliate 高亮层。
	 *
	 * @param color - 高亮颜色
	 * @param cfiRange - CFI 范围
	 * @param text - 选中的文本
	 */
	private async createHighlight(color: AnnotationColor, cfiRange: string, text: string): Promise<void> {
		if (!this.file || !this.foliateView) {
			return;
		}

		const chapter = this.currentChapter;
		const style = this.pluginSettings.epubHighlightStyle;
		const now = new Date().toISOString();
		const id = crypto.randomUUID();

		const annotation: EpubHighlightAnnotation = {
			id,
			type: "epub-highlight",
			color,
			style,
			anchor: { cfiRange, chapter, selectedText: text },
			createdAt: now,
		};

		try {
			await this.store.addEpubHighlight(this.file, annotation);
			this.renderAnnotationOnRendition(annotation);
			this.renderSidebar();
			new Notice(`已添加${COLOR_LABELS[color]}画线`);
		} catch (error) {
			console.error("yh-inklight: EPUB highlight creation failed", error);
			new Notice("画线创建失败");
		}
	}

	/**
	 * 打开标注弹窗，让用户输入笔记内容后保存为 EpubCommentAnnotation。
	 *
	 * @param cfiRange - CFI 范围
	 * @param text - 选中的文本
	 */
	private async openNoteModal(cfiRange: string, text: string): Promise<void> {
		if (!this.file || !this.foliateView) {
			return;
		}

		const note = prompt(`标注: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`);
		if (note === null || !note.trim()) {
			return;
		}

		const chapter = this.currentChapter;
		const color = this.pluginSettings.defaultHighlightColor;
		const style = this.pluginSettings.epubHighlightStyle;
		const now = new Date().toISOString();
		const id = crypto.randomUUID();

		const annotation: EpubCommentAnnotation = {
			id,
			type: "epub-comment",
			color,
			style,
			anchor: { cfiRange, chapter, selectedText: text },
			note: note.trim(),
			createdAt: now,
			collapsed: false,
			author: this.pluginSettings.defaultAuthor,
			updatedAt: now,
			replies: [],
			resolved: false,
		};

		try {
			await this.store.addEpubComment(this.file, annotation);
			this.renderAnnotationOnRendition(annotation);
			this.renderSidebar();
			new Notice("已添加标注");
		} catch (error) {
			console.error("yh-inklight: EPUB comment creation failed", error);
			new Notice("标注创建失败");
		}
	}

	/**
	 * 将单个标注渲染到 foliate 的高亮层。
	 * 根据 EpubHighlightStyle 选择填充/下划线/波浪线样式。
	 *
	 * @param annotation - 高亮或评论标注
	 */
	private renderAnnotationOnRendition(annotation: { id: string; color: AnnotationColor; style: EpubHighlightStyle; anchor: EpubCfiAnchor }): void {
		if (!this.foliateView) {
			return;
		}

		const cfiRange = annotation.anchor.cfiRange;

		void this.foliateView.addAnnotation({
			value: cfiRange,
			id: annotation.id,
			color: annotation.color,
			style: annotation.style,
		});
	}

	/**
	 * 恢复已保存的所有标注到 foliate 高亮层。
	 * 在 book 加载完成后调用。
	 */
	private restoreAnnotations(): void {
		if (!this.file || !this.foliateView) {
			return;
		}

		const document = this.store.getCachedDocument(this.file.path);
		if (!document) {
			return;
		}

		for (const highlight of document.epubHighlights) {
			this.renderAnnotationOnRendition(highlight);
		}

		for (const comment of document.epubComments) {
			this.renderAnnotationOnRendition(comment);
		}
	}

	/**
	 * 处理 foliate 标注点击事件。
	 * 显示编辑菜单（编辑/删除）。
	 *
	 * @param value - foliate 标注 value（CFI 范围）
	 * @param data - 标注数据，包含 CFI 范围
	 */
	private handleMarkClicked(value: string): void {
		if (!this.file) {
			return;
		}

		const cfiRange = value;
		if (!cfiRange) {
			return;
		}

		const document = this.store.getCachedDocument(this.file.path);
		if (!document) {
			return;
		}

		const highlight = document.epubHighlights.find((item) => item.anchor.cfiRange === cfiRange);
		const comment = document.epubComments.find((item) => item.anchor.cfiRange === cfiRange);
		const annotation = comment ?? highlight;

		if (!annotation) {
			return;
		}

		this.showAnnotationEditMenu(annotation.id, cfiRange);
	}

	/**
	 * 在标注位置显示编辑/删除菜单。
	 *
	 * @param annotationId - 标注 ID
	 * @param _cfiRange - CFI 范围（预留用于定位）
	 */
	private showAnnotationEditMenu(annotationId: string, _cfiRange: string): void {
		if (!this.file) {
			return;
		}

		const menu = document.body.createDiv({ cls: "yh-epub-edit-menu" });

		const deleteBtn = menu.createEl("button", {
			cls: "yh-epub-edit-menu-btn",
			attr: { type: "button", title: "删除标注" },
			text: "删除",
		});

		const close = () => {
			menu.remove();
		};

		deleteBtn.addEventListener("click", async () => {
			await this.deleteAnnotation(annotationId);
			close();
		});

		menu.addEventListener("mouseleave", () => {
			close();
		});

		document.body.appendChild(menu);
		window.setTimeout(() => {
			menu.addEventListener("click", (event) => {
				if (event.target === menu) {
					close();
				}
			});
		}, 50);
	}

	/**
	 * 删除指定标注并从 foliate 高亮层移除。
	 *
	 * @param annotationId - 要删除的标注 ID
	 */
	private async deleteAnnotation(annotationId: string): Promise<void> {
		if (!this.file) {
			return;
		}

		try {
			const document = this.store.getCachedDocument(this.file.path);
			const annotation = document
				? [...document.epubHighlights, ...document.epubComments].find((item) => item.id === annotationId)
				: null;
			await this.store.removeAnnotation(this.file, annotationId);
			if (annotation) {
				this.removeFoliateAnnotation(annotation);
			}
			this.refreshRenditionAnnotations();
			this.renderSidebar();
			new Notice("标注已删除");
		} catch (error) {
			console.error("yh-inklight: EPUB annotation deletion failed", error);
			new Notice("标注删除失败");
		}
	}

	/**
	 * 清除 foliate 上所有标注高亮，然后重新渲染已保存的标注。
	 * 用于标注增删后的全量刷新。
	 */
	private refreshRenditionAnnotations(): void {
		if (!this.foliateView || !this.file) {
			return;
		}

		const document = this.store.getCachedDocument(this.file.path);
		if (document) {
			const allAnnotations = [...document.epubHighlights, ...document.epubComments];
			for (const annotation of allAnnotations) {
				this.removeFoliateAnnotation(annotation);
			}
		}

		this.restoreAnnotations();
	}

	// ================================================================
	// 位置事件 & 进度
	// ================================================================

	/**
	 * 处理 foliate relocate 事件。
	 * 更新当前章节、百分比、进度条显示，并触发进度保存。
	 *
	 * @param detail - foliate relocate event detail
	 */
	private handleRelocated(detail: FoliateRelocateDetail): void {
		const cfi = normalizeCfi(detail?.cfi);
		const percent = normalizePercent(detail?.fraction ?? this.currentPercent);
		const spineIndex = typeof detail.index === "number" ? detail.index : this.currentSectionIndex;

		this.currentCfi = cfi || this.currentCfi;
		this.currentSectionIndex = Number.isFinite(spineIndex) ? spineIndex : 0;
		this.currentChapter = detail?.tocItem?.label ?? resolveChapterLabel(this.tocEntries, this.currentSectionIndex);
		this.currentPercent = percent;

		this.updateProgressBar(percent);
		this.debouncedSaveProgress(this.currentCfi, percent);
	}

	/**
	 * 更新底部进度条的填充和文本。
	 *
	 * @param percent - 当前进度百分比（0-1）
	 */
	private updateProgressBar(percent: number): void {
		this.progressEl.empty();

		const bar = this.progressEl.createDiv({ cls: "yh-epub-progress-bar" });
		bar.createDiv({
			cls: "yh-epub-progress-fill",
		});
		const fill = bar.querySelector<HTMLElement>(".yh-epub-progress-fill");
		if (fill) {
			fill.style.width = `${Math.round(percent * 100)}%`;
		}

		const percentText = `${Math.round(percent * 100)}%`;
		const remaining = this.formatRemainingTime();

		this.progressEl.createDiv({
			cls: "yh-epub-progress-text",
			text: remaining ? `${percentText}  ·  ${remaining}` : percentText,
		});
	}

	/**
	 * 格式化剩余阅读时间文本。
	 * 基于已用阅读时间和当前百分比进行估算。
	 *
	 * @returns 剩余时间字符串，如 "剩余约 23 分钟"；若数据不足则返回空字符串
	 */
	private formatRemainingTime(): string {
		if (this.currentPercent <= 0.01 || this.readingTimeSeconds < 60) {
			return "";
		}

		const remainingFraction = 1 - this.currentPercent;
		if (remainingFraction <= 0) {
			return "已读完";
		}

		const estimatedRemainingSeconds = (this.readingTimeSeconds / this.currentPercent) * remainingFraction;
		const estimatedRemainingMinutes = Math.round(estimatedRemainingSeconds / 60);

		if (estimatedRemainingMinutes < 1) {
			return "剩余不到 1 分钟";
		}

		return `剩余约 ${estimatedRemainingMinutes} 分钟`;
	}

	/**
	 * 防抖保存阅读进度。
	 * 避免高频 relocated 事件导致过多的磁盘写入。
	 *
	 * @param cfi - 当前位置的 CFI 字符串
	 * @param percent - 当前进度百分比
	 */
	private debouncedSaveProgress(cfi: string, percent: number): void {
		if (this.progressSaveTimer !== null) {
			window.clearTimeout(this.progressSaveTimer);
		}

		this.progressSaveTimer = window.setTimeout(() => {
			this.progressSaveTimer = null;
			void this.saveCurrentProgress(cfi, percent);
		}, PROGRESS_SAVE_DEBOUNCE_MS);
	}

	/**
	 * 立即保存当前阅读进度到 sidecar。
	 *
	 * @param cfiOverride - 可选的 CFI 覆盖值
	 * @param percentOverride - 可选的百分比覆盖值
	 */
	private async saveCurrentProgress(cfiOverride?: string, percentOverride?: number): Promise<void> {
		if (!this.file) {
			return;
		}

		const cfi = cfiOverride ?? this.currentCfi;
		const percent = percentOverride ?? this.currentPercent;

		if (!cfi && percent <= 0) {
			return;
		}

		const progress: EpubReadingProgress = {
			cfi,
			chapter: this.currentChapter,
			percent,
			lastRead: new Date().toISOString(),
			readingTimeSeconds: this.readingTimeSeconds,
			estimatedRemainingMinutes: this.estimateRemainingMinutes(),
		};

		try {
			await this.store.saveEpubProgress(this.file, progress);
		} catch (error) {
			console.error("yh-inklight: EPUB progress save failed", error);
		}
	}

	/**
	 * 估算剩余阅读分钟数。
	 *
	 * @returns 估算剩余分钟数；若数据不足则返回 undefined
	 */
	private estimateRemainingMinutes(): number | undefined {
		if (this.currentPercent <= 0.01 || this.readingTimeSeconds < 60) {
			return undefined;
		}

		const remainingFraction = 1 - this.currentPercent;
		if (remainingFraction <= 0) {
			return 0;
		}

		const estimatedRemainingSeconds = (this.readingTimeSeconds / this.currentPercent) * remainingFraction;
		return Math.round(estimatedRemainingSeconds / 60);
	}

	/**
	 * 从 sidecar 恢复上次阅读进度并跳转。
	 */
	private async restoreProgress(): Promise<void> {
		if (!this.file || !this.foliateView) {
			return;
		}

		const document = await this.store.getDocument(this.file);
		const progress = document.epubProgress;
		if (!progress) {
			await this.foliateView.goToTextStart?.();
			this.restoreAnnotations();
			return;
		}

		this.readingTimeSeconds = progress.readingTimeSeconds ?? 0;

		const cfi = normalizeCfi(progress.cfi);
		if (cfi) {
			try {
				await this.foliateView.goTo(cfi);
				this.currentCfi = cfi;
			} catch {
				await this.foliateView.goToTextStart?.();
			}
		} else {
			await this.foliateView.goToTextStart?.();
		}

		this.currentPercent = normalizePercent(progress.percent);
		this.updateProgressBar(this.currentPercent);
		this.restoreAnnotations();
	}

	// ================================================================
	// 渲染事件
	// ================================================================

	/**
	 * 处理 foliate section 加载后的渲染刷新。
	 * 刷新标注渲染（确保标注在章节切换后仍然可见）。
	 */
	private handleRendered(): void {
		this.restoreAnnotations();
	}

	// ================================================================
	// 键盘 & 滚轮导航
	// ================================================================

	/**
	 * 处理键盘导航事件。
	 * 方向键左/上 = 上一页，方向键右/下 = 下一页。
	 *
	 * @param event - 键盘事件
	 */
	private handleKeydown(event: KeyboardEvent): void {
		if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
			return;
		}

		switch (event.key) {
			case "ArrowLeft":
			case "ArrowUp": {
				event.preventDefault();
				this.prevPage();
				break;
			}
			case "ArrowRight":
			case "ArrowDown": {
				event.preventDefault();
				this.nextPage();
				break;
			}
			default:
				break;
		}
	}

	/**
	 * 处理鼠标滚轮事件。
	 * 在分页模式下通过滚轮翻页，带防抖保护。
	 *
	 * @param event - 滚轮事件
	 */
	private handleWheel(event: WheelEvent): void {
		if (this.currentFlowMode !== "paginated") {
			return;
		}

		event.preventDefault();

		if (this.wheelDebounceTimer !== null) {
			return;
		}

		this.wheelDebounceTimer = window.setTimeout(() => {
			this.wheelDebounceTimer = null;
		}, WHEEL_DEBOUNCE_MS);

		if (event.deltaY > 0) {
			this.nextPage();
		} else if (event.deltaY < 0) {
			this.prevPage();
		}
	}

	/**
	 * 翻到下一页。
	 */
	private nextPage(): void {
		if (!this.foliateView) {
			return;
		}
		const action = this.foliateView.next ?? this.foliateView.goRight;
		void action?.call(this.foliateView);
	}

	/**
	 * 翻到上一页。
	 */
	private prevPage(): void {
		if (!this.foliateView) {
			return;
		}
		const action = this.foliateView.prev ?? this.foliateView.goLeft;
		void action?.call(this.foliateView);
	}

	// ================================================================
	// 导航
	// ================================================================

	/**
	 * 导航到指定的 spine index 位置。
	 *
	 * @param spineIndex - 目标章节的 spine 索引
	 */
	private navigateToSpineIndex(spineIndex: number): void {
		if (!this.foliateView) {
			return;
		}
		void this.foliateView.goTo(spineIndex);
	}

	/**
	 * 导航到指定标注的位置。
	 *
	 * @param annotationId - 标注 ID
	 */
	private navigateToAnnotation(annotationId: string): void {
		if (!this.file || !this.foliateView) {
			return;
		}

		const document = this.store.getCachedDocument(this.file.path);
		if (!document) {
			return;
		}

		const allAnnotations = [...document.epubHighlights, ...document.epubComments];
		const annotation = allAnnotations.find((item) => item.id === annotationId);
		if (!annotation?.anchor.cfiRange) {
			return;
		}

		void this.foliateView.goTo(annotation.anchor.cfiRange);
	}

	// ================================================================
	// 字号 & 主题
	// ================================================================

	/**
	 * 调整阅读字号。
	 *
	 * @param delta - 字号变化量（正数增大，负数缩小）
	 */
	private changeFontSize(delta: number): void {
		const nextSize = Math.max(12, Math.min(28, this.currentFontSize + delta));
		if (nextSize === this.currentFontSize) {
			return;
		}

		this.currentFontSize = nextSize;
		this.applyFontSize(nextSize);
		this.renderToolbar();
	}

	/**
	 * 将字号应用到 foliate 主题样式。
	 *
	 * @param size - 字号像素值
	 */
	private applyFontSize(size: number): void {
		this.applyFoliateAppearance(size);
	}

	/**
	 * 切换阅读主题。
	 *
	 * @param themeId - 目标主题 ID
	 */
	private switchTheme(themeId: EpubReadingTheme): void {
		if (themeId === this.currentTheme) {
			return;
		}

		this.currentTheme = themeId;

		this.applyFoliateAppearance();

		this.renderToolbar();
	}

	/**
	 * 切换翻页模式（分页/滚动）。
	 */
	private toggleFlowMode(): void {
		const nextMode: EpubFlowMode = this.currentFlowMode === "paginated" ? "scrolled" : "paginated";
		this.currentFlowMode = nextMode;

		if (!this.foliateView) {
			return;
		}

		const element = this.foliateView as unknown as HTMLElement;
		element.setAttribute("flow", nextMode);
		this.applyFoliateLayout();
		this.applyFoliateAppearance();
		this.renderToolbar();
	}

	// ================================================================
	// 阅读时间追踪
	// ================================================================

	/**
	 * 启动阅读时间追踪。
	 * 注册 visibilitychange/blur/focus 事件监听，启动定期 flush 定时器。
	 */
	private startReadingTimeTracker(): void {
		this.lastFlushTimestamp = Date.now();

		this.readingTimeFlushTimer = window.setInterval(() => {
			void this.flushReadingTime();
		}, READING_TIME_FLUSH_INTERVAL_MS);

		this.visibilityHandler = () => {
			if (document.hidden) {
				void this.flushReadingTime();
			} else {
				this.lastFlushTimestamp = Date.now();
			}
		};
		this.blurHandler = () => {
			void this.flushReadingTime();
		};
		this.focusHandler = () => {
			this.lastFlushTimestamp = Date.now();
		};

		document.addEventListener("visibilitychange", this.visibilityHandler);
		window.addEventListener("blur", this.blurHandler);
		window.addEventListener("focus", this.focusHandler);
	}

	/**
	 * 停止阅读时间追踪。
	 * 执行最后一次 flush，移除所有事件监听和定时器。
	 */
	private stopReadingTimeTracker(): void {
		if (this.readingTimeFlushTimer !== null) {
			window.clearInterval(this.readingTimeFlushTimer);
			this.readingTimeFlushTimer = null;
		}

		if (this.visibilityHandler) {
			document.removeEventListener("visibilitychange", this.visibilityHandler);
			this.visibilityHandler = null;
		}

		if (this.blurHandler) {
			window.removeEventListener("blur", this.blurHandler);
			this.blurHandler = null;
		}

		if (this.focusHandler) {
			window.removeEventListener("focus", this.focusHandler);
			this.focusHandler = null;
		}
	}

	/**
	 * Flush 阅读时间。
	 * 计算自上次 flush 以来的经过时间（仅在页面可见时累计），
	 * 累加到 readingTimeSeconds。
	 */
	private async flushReadingTime(): Promise<void> {
		const now = Date.now();
		const elapsed = Math.round((now - this.lastFlushTimestamp) / 1000);
		this.lastFlushTimestamp = now;

		if (elapsed > 0 && !document.hidden) {
			this.readingTimeSeconds += elapsed;
		}
	}

	/**
	 * 获取当前阅读时间快照。
	 *
	 * @returns 包含累计秒数和上次 flush 时间戳的快照
	 */
	private getReadingTimeSnapshot(): ReadingTimeSnapshot {
		return {
			readingTimeSeconds: this.readingTimeSeconds,
			lastFlushTimestamp: this.lastFlushTimestamp,
		};
	}

	// ================================================================
	// AI 预留
	// ================================================================

	/**
	 * AI 分析动作（预留）。
	 * 当 epubAiEnabled 设置为 true 时，上下文菜单会显示 AI 按钮。
	 * 实际 AI 调用逻辑待后续版本实现。
	 *
	 * @param _text - 选中的文本
	 */
	private handleAiAction(_text: string): void {
		new Notice("AI 分析功能即将上线");
	}

	// ================================================================
	// 资源清理
	// ================================================================

	/**
	 * 销毁 foliate-view 实例，释放资源。
	 */
	private destroyRendition(): void {
		if (this.progressSaveTimer !== null) {
			window.clearTimeout(this.progressSaveTimer);
			this.progressSaveTimer = null;
		}

		if (this.wheelDebounceTimer !== null) {
			window.clearTimeout(this.wheelDebounceTimer);
			this.wheelDebounceTimer = null;
		}

		if (this.foliateView) {
			try {
				this.foliateView.removeEventListener("load", this.handleFoliateLoad as EventListener);
				this.foliateView.removeEventListener("relocate", this.handleFoliateRelocate as EventListener);
				this.foliateView.removeEventListener("draw-annotation", this.handleFoliateDrawAnnotation as EventListener);
				this.foliateView.removeEventListener("show-annotation", this.handleFoliateShowAnnotation as EventListener);
				this.foliateView.close?.();
			} catch {
				/* foliate-view 可能已经销毁 */
			}
			this.foliateView = null;
		}

		if (this.readerContainerEl) {
			this.readerContainerEl.empty();
		}
	}

	private buildFoliateTocEntries(tocItems: FoliateTocItem[]): TocSpineEntry[] {
		const entries: TocSpineEntry[] = [];
		const walk = (items: FoliateTocItem[]) => {
			for (const item of items) {
				const index = this.resolveFoliateHrefIndex(item.href);
				if (index !== null) {
					entries.push({ label: (item.label ?? "").trim() || `章节 ${index + 1}`, spineIndex: index });
				}
				if (item.subitems?.length) {
					walk(item.subitems.filter((child): child is FoliateTocItem => typeof child === "object" && child !== null));
				}
			}
		};
		walk(tocItems);
		return [...entries].sort((a, b) => a.spineIndex - b.spineIndex);
	}

	private resolveFoliateHrefIndex(href: string | undefined): number | null {
		if (!href || !this.foliateView?.book?.sections) {
			return null;
		}
		const normalizedHref = href.split("#")[0];
		const index = this.foliateView.book.sections.findIndex((section) => {
			const id = String(section.id ?? "");
			return id === href || id === normalizedHref || id.endsWith(normalizedHref);
		});
		return index >= 0 ? index : null;
	}

	private handleFoliateLoad = (event: Event): void => {
		const detail = (event as CustomEvent<FoliateLoadDetail>).detail;
		const doc = detail?.doc;
		if (!doc) {
			return;
		}
		const index = typeof detail.index === "number" ? detail.index : this.currentSectionIndex;
		this.loadedSectionDocs.set(doc, index);
		stripScriptsFromDocument(doc);
		void inlineBlockedStylesheets({ document: doc });
		this.attachSelectionListeners(doc);
		this.handleRendered();
	};

	private handleFoliateRelocate = (event: Event): void => {
		this.handleRelocated((event as CustomEvent<FoliateRelocateDetail>).detail ?? {});
	};

	private handleFoliateDrawAnnotation = (event: Event): void => {
		const detail = (event as CustomEvent<FoliateDrawAnnotationDetail>).detail;
		if (!detail?.annotation || typeof detail.draw !== "function") {
			return;
		}
		const color = detail.annotation.color ?? this.pluginSettings.defaultHighlightColor;
		const style = detail.annotation.style ?? this.pluginSettings.epubHighlightStyle;
		detail.draw((rects) => this.createAnnotationOverlay(rects, color, style));
	};

	private handleFoliateShowAnnotation = (event: Event): void => {
		const detail = (event as CustomEvent<FoliateShowAnnotationDetail>).detail;
		if (!detail?.value) {
			return;
		}
		this.handleMarkClicked(detail.value);
	};

	private attachSelectionListeners(doc: Document): void {
		if (this.documentSelectionCleanups.has(doc)) {
			return;
		}

		let pendingFrame = 0;
		const scheduleEmit = () => {
			if (pendingFrame) {
				window.cancelAnimationFrame(pendingFrame);
			}
			pendingFrame = window.requestAnimationFrame(() => {
				pendingFrame = 0;
				this.emitFoliateSelection(doc);
			});
		};

		doc.addEventListener("selectionchange", scheduleEmit);
		doc.addEventListener("mouseup", scheduleEmit);
		doc.addEventListener("touchend", scheduleEmit);
		doc.addEventListener("keyup", scheduleEmit);

		const cleanup = () => {
			if (pendingFrame) {
				window.cancelAnimationFrame(pendingFrame);
			}
			doc.removeEventListener("selectionchange", scheduleEmit);
			doc.removeEventListener("mouseup", scheduleEmit);
			doc.removeEventListener("touchend", scheduleEmit);
			doc.removeEventListener("keyup", scheduleEmit);
		};
		this.documentSelectionCleanups.set(doc, cleanup);
	}

	private emitFoliateSelection(doc: Document): void {
		const selection = doc.defaultView?.getSelection?.();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
			return;
		}
		const range = selection.getRangeAt(0);
		const text = selection.toString().trim();
		if (!text || !this.foliateView?.getCFI) {
			return;
		}
		const index = this.loadedSectionDocs.get(doc) ?? this.currentSectionIndex;
		const cfiRange = normalizeCfi(this.foliateView.getCFI(index, range.cloneRange()));
		if (!cfiRange) {
			return;
		}
		this.handleTextSelected(cfiRange, doc);
	}

	private createAnnotationOverlay(
		rects: Array<DOMRect | { left: number; top: number; width: number; height: number }>,
		color: AnnotationColor,
		style: EpubHighlightStyle,
	): SVGElement {
		const svgNS = "http://www.w3.org/2000/svg";
		const group = activeDocument.createElementNS(svgNS, "g");
		const rgba = EPUB_COLOR_MAP[color];

		for (const rect of rects) {
			const x = Number(rect.left) || 0;
			const y = Number(rect.top) || 0;
			const width = Number(rect.width) || 0;
			const height = Number(rect.height) || 0;
			if (width <= 0 || height <= 0) {
				continue;
			}

			if (style === "fill") {
				const highlight = activeDocument.createElementNS(svgNS, "rect");
				highlight.setAttribute("x", String(x));
				highlight.setAttribute("y", String(y));
				highlight.setAttribute("width", String(width));
				highlight.setAttribute("height", String(height));
				highlight.setAttribute("rx", "2");
				highlight.setAttribute("fill", rgba);
				highlight.setAttribute("style", "mix-blend-mode:multiply;pointer-events:none");
				group.appendChild(highlight);
				continue;
			}

			const line = activeDocument.createElementNS(svgNS, "line");
			line.setAttribute("x1", String(x));
			line.setAttribute("x2", String(x + width));
			line.setAttribute("y1", String(y + height - 2));
			line.setAttribute("y2", String(y + height - 2));
			line.setAttribute("stroke", rgba);
			line.setAttribute("stroke-width", style === "wavy" ? "1.5" : "2");
			line.setAttribute("stroke-linecap", "round");
			if (style === "wavy") {
				line.setAttribute("stroke-dasharray", "2 2");
			}
			line.setAttribute("style", "pointer-events:none");
			group.appendChild(line);
		}

		return group;
	}

	private removeFoliateAnnotation(annotation: { id: string; color: AnnotationColor; style: EpubHighlightStyle; anchor: EpubCfiAnchor }): void {
		if (!this.foliateView) {
			return;
		}
		try {
			this.foliateView.deleteAnnotation({
				value: annotation.anchor.cfiRange,
				id: annotation.id,
				color: annotation.color,
				style: annotation.style,
			});
		} catch {
			/* foliate may already have cleared the visible overlay */
		}
	}

	private applyFoliateAppearance(size = this.currentFontSize): void {
		if (!this.foliateView) {
			return;
		}
		const colors = this.themeManager.resolveThemeColors(this.currentTheme);
		const css = [
			":root { color-scheme: light dark; }",
			"body {",
			`  background-color: ${colors.background} !important;`,
			`  color: ${colors.textColor} !important;`,
			`  font-size: ${size}px !important;`,
			"  line-height: 1.72 !important;",
			"}",
			"p, div, span, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dt, dd {",
			`  color: ${colors.textColor} !important;`,
			"}",
			`a, a:link, a:visited { color: ${colors.linkColor} !important; }`,
			`::selection { background: ${colors.selectionBg} !important; }`,
			"img { max-width: 100% !important; height: auto !important; }",
		].join("\n");
		this.foliateView.renderer?.setStyles?.(css);
		this.foliateView.renderer?.render?.();
		(this.foliateView as unknown as HTMLElement).style.backgroundColor = colors.background;
		this.readerContainerEl.style.backgroundColor = colors.background;
	}

	private applyFoliateLayout(): void {
		if (!this.foliateView) {
			return;
		}
		const attrs: Record<string, string> = {
			flow: this.currentFlowMode,
			margin: this.currentFlowMode === "paginated" ? "28px" : "0px",
			gap: "8%",
			"max-inline-size": "760px",
		};
		const host = this.foliateView as unknown as HTMLElement;
		const renderer = this.foliateView.renderer as unknown as HTMLElement | undefined;
		for (const [name, value] of Object.entries(attrs)) {
			host.setAttribute(name, value);
			renderer?.setAttribute?.(name, value);
		}
		this.foliateView.renderer?.render?.();
	}

	private findIframeForDocument(doc: Document): HTMLIFrameElement | null {
		const visit = (root: ParentNode): HTMLIFrameElement | null => {
			const iframes = Array.from(root.querySelectorAll("iframe"));
			for (const iframe of iframes) {
				try {
					if (iframe.contentDocument === doc) {
						return iframe as HTMLIFrameElement;
					}
				} catch {
					/* cross-origin iframes are not expected, but ignore defensively */
				}
			}
			const elements = Array.from(root.querySelectorAll("*"));
			for (const element of elements) {
				const shadowRoot = (element as HTMLElement).shadowRoot;
				if (!shadowRoot) {
					continue;
				}
				const found = visit(shadowRoot);
				if (found) {
					return found;
				}
			}
			return null;
		};
		return visit(this.readerContainerEl);
	}
}
