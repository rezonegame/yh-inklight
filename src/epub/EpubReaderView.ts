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

import { FileView, Notice, Platform, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";

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
	SUPPORTED_BOOK_EXTENSIONS,
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
	showFoliateStart,
} from "./EpubFoliateLoader";
import { EpubNoteModal, EpubNoteResult } from "./EpubNoteModal";
import { legacyNoteTypeForTag } from "../tags/tagDomain";

// ---- 常量 ----

/** 注册到 Obsidian workspace 的视图类型标识 */
export const EPUB_READER_VIEW_TYPE = "book-note-epub-reader";

/** 阅读时间 flush 间隔（毫秒） */
const READING_TIME_FLUSH_INTERVAL_MS = 60_000;

/** 鼠标滚轮翻页防抖延迟（毫秒） */
const WHEEL_DEBOUNCE_MS = 400;

/** 进度保存防抖延迟（毫秒） */
const PROGRESS_SAVE_DEBOUNCE_MS = 2_000;

/** 浮动上下文菜单消失延迟（毫秒） */
const CONTEXT_MENU_DISMISS_MS = 300;

/** foliate iframe 内选区稳定后再同步，参考 weave 的 SelectionToolbar 同步节奏 */
const SELECTION_SYNC_RETRY_DELAY_MS = 120;

// ---- 辅助类型 ----

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
	reason?: string;
	range?: Range;
	tocItem?: { label?: string };
	section?: { current?: number; total?: number };
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

	interface EpubSelectionSnapshot {
	doc: Document;
	range: Range;
	text: string;
	cfiRange: string;
	rect: DOMRect;
}

// ---- EpubReaderView ----

/**
 * book-note EPUB 阅读器核心视图。
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
	private readonly refreshAnnotations: () => void;

	// ---- foliate 实例 ----

	private foliateView: FoliateViewHandle | null = null;
	private loadedSectionDocs = new WeakMap<Document, number>();
	private documentSelectionCleanups = new WeakMap<Document, () => void>();
	/** 清理 iframe 内 keydown 监听（PC 端键盘翻页） */
	private documentKeyboardCleanups = new WeakMap<Document, () => void>();
	/** 最近一次 foliate load 事件的 section doc，供工具栏全文搜索使用（getContents 不可靠时的可靠来源） */
	private currentLoadedDoc: Document | null = null;
	// 跟踪 foliate 高亮层实际已渲染的标注（id → 渲染时传入 foliate 的 meta）。
	// 全量刷新时据此 remove，不依赖 sidecar 缓存——否则外部删除（侧栏）后被删的标注无法从 foliate 层移除。
	private renderedAnnotationMeta = new Map<string, { value: string; id: string; color: AnnotationColor; style: EpubHighlightStyle }>();
	private currentCfi = "";
	private currentSectionIndex = 0;

	// ---- 状态 ----

	private tocEntries: TocSpineEntry[] = [];
	private currentChapter = "";
	private currentPercent = 0;
	private currentFlowMode: EpubFlowMode;
	private currentFontSize: number;
	private currentTheme: EpubReadingTheme;
	private themeObserver: MutationObserver | null = null;
	private sidebarOpen = false;
private contextMenuEl: HTMLElement | null = null;
		private lastSelectedCfiRange = "";
		private lastSelectedText = "";
		private searchInputEl: HTMLInputElement | null = null;
	private searchResultsEl: HTMLElement | null = null;
	private searchTimer: number | null = null;
	private readonly searchDebounce = (): void => {
		if (this.searchTimer !== null) {
			window.clearTimeout(this.searchTimer);
		}
		this.searchTimer = window.setTimeout(() => {
			this.searchTimer = null;
			void this.performSearch();
		}, 300);
	};
	private canvasSendBtn: HTMLElement | null = null;

	// ---- 定时器 / 追踪 ----

	private readingTimeSeconds = 0;
	private readingTimeFlushTimer: number | null = null;
	private progressSaveTimer: number | null = null;
	private wheelDebounceTimer: number | null = null;
	/** 滚动模式下跨章导航进行中标志，防止重入 */
	private scrolledNavigating = false;
	/** 最近一次跨章导航方向，冷却期内阻止反方向触发（防止来回跳） */
	private scrolledNavDirection: "next" | "prev" | null = null;

	/** PC 端翻页模式：键盘翻页 / 滚轮翻页（互斥，默认键盘） */
	private pcNavMode: "keyboard" | "wheel" = "wheel";
	/** 移动端点按翻页开关（true=点按翻页，false=滑动翻页） */
	private mobileTapEnabled = true;
	/** 移动端 readerContainer 点击翻页监听清理函数 */
	private mobileTapZoneCleanup: (() => void) | null = null;
	/** 清理 paginator scroll/touch/wheel 事件监听 */
	private paginatorScrollCleanup: (() => void) | null = null;
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

	// ---- 工具栏溢出菜单 ----

	private toolbarItems: HTMLElement[] = [];
	private toolbarOverflowBtn: HTMLElement | null = null;
	private toolbarOverflowEl: HTMLElement | null = null;
	private toolbarResizeObserver: ResizeObserver | null = null;
	private toolbarOverflowOutsideClickHandler: ((event: MouseEvent) => void) | null = null;

	// ================================================================
	// 构造 & 生命周期
	// ================================================================

	constructor(
		leaf: WorkspaceLeaf,
		store: AnnotationStore,
		settings: AnnotationPluginSettings,
		refreshAnnotations: () => void,
	) {
		super(leaf);
		this.store = store;
		this.pluginSettings = settings;
		this.refreshAnnotations = refreshAnnotations;
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

	/** 声明此视图可以打开 EPUB 及 foliate 支持的所有电子书格式 */
	override canAcceptExtension(extension: string): boolean {
		return (SUPPORTED_BOOK_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
	}

	/** 视图打开时构建 DOM 骨架 */
	override async onOpen(): Promise<void> {
		this.contentEl.addClass("book-note-epub-reader");
		this.buildLayout();
		this.startReadingTimeTracker();
		this.startObsidianThemeWatcher();
	}

	/** 视图关闭时释放 foliate 资源与定时器 */
	override async onClose(): Promise<void> {
		this.stopReadingTimeTracker();
		this.dismissContextMenu();
		this.destroyRendition();
		this.stopObsidianThemeWatcher();
		this.destroyToolbarOverflow();

		// 清理移动端点击翻页监听
		if (this.mobileTapZoneCleanup) {
			this.mobileTapZoneCleanup();
			this.mobileTapZoneCleanup = null;
		}
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
			this.attachPaginatorScrollListener();
			this.applyFoliateLayout();
			this.tocEntries = this.buildFoliateTocEntries(this.foliateView.book?.toc ?? []);
			this.applyFoliateAppearance();

			await this.restoreProgress();

			this.renderToolbar();
			this.renderSidebar();
		} catch (error) {
			console.error("book-note: EPUB load failed", error);
			new Notice(t("epub.loadFailed", { error: error instanceof Error ? error.message : String(error) }));
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
	 *
	 * 使用 this.contentEl 而不是 this.containerEl，保留 Obsidian 原生 view-header
	 *（文件图标 / 标题 / 更多菜单），让 EPUB 工具栏位于标题栏下方，从而支持
	 * 在阅读时切换文件和访问文件选项。
	 */
	private buildLayout(): void {
		this.contentEl.empty();
		this.toolbarItems = [];
		this.toolbarOverflowBtn = null;
		this.toolbarOverflowEl = null;

		this.toolbarEl = this.contentEl.createDiv({ cls: "book-note-epub-toolbar" });
		this.toolbarOverflowEl = this.toolbarEl.createDiv({ cls: "book-note-epub-toolbar-overflow-menu" });

		const body = this.contentEl.createDiv({ cls: "book-note-epub-body" });

		this.sidebarContainerEl = body.createDiv({ cls: "book-note-epub-sidebar" });
		this.sidebarContainerEl.toggleClass("is-open", this.sidebarOpen);

		const sidebarTabs = this.sidebarContainerEl.createDiv({ cls: "book-note-epub-sidebar-tabs" });
		const tocTab = sidebarTabs.createEl("button", {
			cls: "book-note-epub-sidebar-tab is-active",
			text: t("epub.toc"),
			attr: { type: "button", "data-tab": "toc" },
		});
		tocTab.addEventListener("click", () => this.renderSidebar());

		this.sidebarContentEl = this.sidebarContainerEl.createDiv({ cls: "book-note-epub-sidebar-content" });

		this.readerContainerEl = body.createDiv({ cls: "book-note-epub-reader-area" });
		// 脚注预览 popover 元素（Phase 4-B P3）

		this.progressEl = this.contentEl.createDiv({ cls: "book-note-epub-progress" });

		this.contentEl.addEventListener("keydown", (event) => this.handleKeydown(event));
		this.readerContainerEl.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });
		this.readerContainerEl.addEventListener("click", (event) => this.handleReaderAreaClick(event));

		// 移动端：readerContainer 点击翻页（左 1/3 上一页/章，右 1/3 下一页/章）
		if (Platform.isMobile) {
			const tapHandler = (event: MouseEvent) => this.handleTapZone(event);
			this.readerContainerEl.addEventListener("click", tapHandler);
			this.mobileTapZoneCleanup = () => {
				this.readerContainerEl.removeEventListener("click", tapHandler);
			};
		}
	}

	/**
	 * 监听 Obsidian 原生主题变化（亮/暗切换、主题更换、CSS snippet 变更）。
	 *
	 * 当 Obsidian 修改 body 的 class 或 style 时，重新应用当前 EPUB 主题，确保
	 * obsidian 主题下颜色实时同步，同时让 CSS 变量驱动的外层容器/工具栏立刻生效。
	 */
	private startObsidianThemeWatcher(): void {
		this.stopObsidianThemeWatcher();

		this.themeObserver = new MutationObserver(() => {
			this.applyFoliateAppearance();
		});

		this.themeObserver.observe(document.body, {
			attributes: true,
			attributeFilter: ["class", "style"],
		});
	}

	private stopObsidianThemeWatcher(): void {
		if (this.themeObserver) {
			this.themeObserver.disconnect();
			this.themeObserver = null;
		}
	}

	// ================================================================
	// 工具栏
	// ================================================================

	/**
	 * 渲染工具栏：侧边栏切换、字号、主题、翻页模式、导航按钮。
	 *
	 * 书名已由 Obsidian 原生 view-header 显示，因此工具栏内不再重复显示书名。
	 * 工具栏固定为一行，装不下的按钮会自动移入“更多”下拉菜单。
	 */
	private renderToolbar(): void {
		// 只移除已有的按钮和色块容器，保留 overflow menu（它现在是 toolbarEl 的子元素）
		const children = Array.from(this.toolbarEl.children);
		for (const child of children) {
			if (child === this.toolbarOverflowEl) continue;
			if (child.hasClass("book-note-epub-toolbar-btn") || child.hasClass("book-note-epub-theme-swatches")) {
				child.remove();
			}
		}

		this.toolbarItems = [];
		if (this.toolbarOverflowEl) {
			this.toolbarOverflowEl.empty();
			this.toolbarOverflowEl.removeClass("is-open");
		}

		const createBtn = (opts: {
			icon?: string;
			text?: string;
			title: string;
			onClick: () => void;
		}): HTMLElement => {
			const btn = this.toolbarEl.createEl("button", {
				cls: "book-note-epub-toolbar-btn",
				attr: { type: "button", title: opts.title, "aria-label": opts.title },
			});
			if (opts.icon) setIcon(btn, opts.icon);
			if (opts.text) btn.textContent = opts.text;
			btn.addEventListener("click", opts.onClick);
			return btn;
		};

		// 导航模式按钮（PC: 键盘↔滚轮互斥切换；移动端: 点按↔滑动切换）
		const keyNavBtn = createBtn({
			icon: Platform.isMobile
				? (this.mobileTapEnabled ? "hand" : "move")
				: (this.pcNavMode === "keyboard" ? "keyboard" : "mouse"),
			title: Platform.isMobile
				? (this.mobileTapEnabled ? t("epub.toggleToSwipe") : t("epub.toggleToTap"))
				: (this.pcNavMode === "keyboard" ? t("epub.toggleToWheel") : t("epub.toggleToKeyboard")),
			onClick: () => this.toggleKeyNav(),
		});

		this.toolbarItems.push(
			createBtn({ icon: "menu", title: t("aria.toggleSidebar"), onClick: () => this.toggleSidebar() }),
			createBtn({ text: "A-", title: t("aria.decreaseFont"), onClick: () => this.changeFontSize(-1) }),
			createBtn({ text: "A+", title: t("aria.increaseFont"), onClick: () => this.changeFontSize(1) }),
			createBtn({ icon: "search", title: t("aria.searchFull"), onClick: () => this.toggleToolbarSearch() }),
			createBtn({
				icon: this.currentFlowMode === "paginated" ? "lines-of-text" : "scroll",
				title: this.currentFlowMode === "paginated" ? t("epub.toggleScroll") : t("epub.togglePaginate"),
				onClick: () => this.toggleFlowMode(),
			}),
			keyNavBtn,
			createBtn({ icon: "chevron-left", title: t("aria.prevPage"), onClick: () => this.prevPage() }),
			createBtn({ icon: "chevron-right", title: t("aria.nextPage"), onClick: () => this.nextPage() }),
			this.renderThemeSwatches(),
		);

		this.toolbarOverflowBtn = createBtn({
			icon: "more-vertical",
			title: t("common.more"),
			onClick: () => this.toggleToolbarOverflow(),
		});
		this.toolbarOverflowBtn.addClass("book-note-epub-toolbar-overflow-btn");
		this.toolbarItems.push(this.toolbarOverflowBtn);

		// 普通项按顺序插入，溢出按钮固定在最右侧
		for (const item of this.toolbarItems) {
			if (item !== this.toolbarOverflowBtn) {
				this.toolbarEl.appendChild(item);
			}
		}
		if (this.toolbarOverflowBtn) {
			this.toolbarEl.appendChild(this.toolbarOverflowBtn);
		}

		// 确保 overflow menu 始终在最后
		if (this.toolbarOverflowEl) {
			this.toolbarEl.appendChild(this.toolbarOverflowEl);
		}

		this.setupToolbarOverflow();
		this.layoutToolbarOverflow();
	}

	/**
	 * 在工具栏中渲染主题色块选择器，点击切换阅读主题。
	 * @returns 主题色块容器元素
	 */
	private renderThemeSwatches(): HTMLElement {
		const container = this.toolbarEl.createDiv({ cls: "book-note-epub-theme-swatches" });

		for (const theme of EPUB_READING_THEMES) {
			const swatch = container.createEl("button", {
				cls: "book-note-epub-theme-swatch",
				attr: {
					type: "button",
					title: theme.label,
					"aria-label": `${t("aria.theme", { label: theme.label })}`,
					"data-theme": theme.id,
				},
			});
			swatch.style.background = theme.swatch;
			swatch.toggleClass("is-active", theme.id === this.currentTheme);
			swatch.addEventListener("click", () => this.switchTheme(theme.id));
		}
		return container;
	}

	/**
	 * 设置工具栏溢出下拉菜单的 ResizeObserver 与点击外部关闭监听。
	 */
	private setupToolbarOverflow(): void {
		this.destroyToolbarOverflow();

		this.toolbarResizeObserver = new ResizeObserver(() => {
			this.layoutToolbarOverflow();
		});
		this.toolbarResizeObserver.observe(this.toolbarEl);

		this.toolbarOverflowOutsideClickHandler = (event: MouseEvent) => {
			if (!this.toolbarOverflowEl?.hasClass("is-open")) return;
			const target = event.target as Node;
			if (!this.toolbarOverflowEl.contains(target) && !this.toolbarOverflowBtn?.contains(target)) {
				this.toolbarOverflowEl.removeClass("is-open");
			}
		};
		document.addEventListener("click", this.toolbarOverflowOutsideClickHandler);
	}

	/**
	 * 清理工具栏溢出菜单的监听器。
	 */
	private destroyToolbarOverflow(): void {
		if (this.toolbarResizeObserver) {
			this.toolbarResizeObserver.disconnect();
			this.toolbarResizeObserver = null;
		}
		if (this.toolbarOverflowOutsideClickHandler) {
			document.removeEventListener("click", this.toolbarOverflowOutsideClickHandler);
			this.toolbarOverflowOutsideClickHandler = null;
		}
	}

	/**
	 * 切换“更多”下拉菜单的显示/隐藏。
	 */
	private toggleToolbarOverflow(): void {
		if (this.toolbarOverflowEl) {
			this.toolbarOverflowEl.toggleClass("is-open", !this.toolbarOverflowEl.hasClass("is-open"));
		}
	}

	/**
	 * 根据工具栏可用宽度，把放不下的按钮移入“更多”下拉菜单。
	 */
	private layoutToolbarOverflow(): void {
		if (!this.toolbarOverflowEl || !this.toolbarOverflowBtn) return;

		const toolbarWidth = this.toolbarEl.clientWidth;
		if (toolbarWidth === 0) return;

		// 先把所有可溢出项收回工具栏
		for (const item of this.toolbarItems) {
			if (item !== this.toolbarOverflowBtn) {
				this.toolbarEl.appendChild(item);
			}
		}
		// 再把溢出按钮移到最右侧（appendChild 会移动已有元素到末尾）
		this.toolbarEl.appendChild(this.toolbarOverflowBtn);
		this.toolbarOverflowEl.empty();

		const gap = 4;
		const paddingBuffer = 4;
		const availableWidth = toolbarWidth - paddingBuffer;

		// 计算所有普通项的总宽度（不含更多按钮）
		let plainTotal = 0;
		for (let i = 0; i < this.toolbarItems.length; i++) {
			const item = this.toolbarItems[i];
			if (item === this.toolbarOverflowBtn) continue;
			plainTotal += item.offsetWidth + (i > 0 ? gap : 0);
		}

		if (plainTotal <= availableWidth) {
			// 全部装得下，隐藏更多按钮
			this.toolbarOverflowBtn.addClass("is-hidden");
			return;
		}

		this.toolbarOverflowBtn.removeClass("is-hidden");
		const moreBtnWidth = this.toolbarOverflowBtn.offsetWidth;
		let usedWidth = moreBtnWidth + gap;
		let overflowIndex = -1;

		for (let i = 0; i < this.toolbarItems.length; i++) {
			const item = this.toolbarItems[i];
			if (item === this.toolbarOverflowBtn) continue;
			const itemWidth = item.offsetWidth + (i > 0 ? gap : 0);
			if (usedWidth + itemWidth > availableWidth) {
				overflowIndex = i;
				break;
			}
			usedWidth += itemWidth;
		}

		if (overflowIndex !== -1) {
			for (let i = overflowIndex; i < this.toolbarItems.length; i++) {
				const item = this.toolbarItems[i];
				if (item === this.toolbarOverflowBtn) continue;
				this.toolbarOverflowEl.appendChild(item);
			}
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
	 * 移动端：点击阅读区域时关闭目录面板。
	 * 只在 Platform.isMobile 为 true 时生效。
	 */
	private handleReaderAreaClick(event: Event): void {
		if (!Platform.isMobile || !this.sidebarOpen) {
			return;
		}
		// 如果点击的是目录面板内部，不关闭
		if (event.target instanceof Node && this.sidebarContainerEl.contains(event.target as Node)) {
			return;
		}
		this.toggleSidebar();
	}

	/**
	 * 渲染侧边栏内容（目录）。
	 * 标注已统一到「Book Note」共用面板，此处仅保留目录导航。
	 */
	private renderSidebar(): void {
		this.sidebarContentEl.empty();
		this.renderTocList();
	}

	/**
	 * 渲染目录列表，点击条目跳转到对应章节。
	 */
	private renderTocList(): void {
		if (this.tocEntries.length === 0) {
			this.sidebarContentEl.createDiv({ cls: "book-note-epub-empty", text: t("epub.emptyToc") });
			return;
		}

		const list = this.sidebarContentEl.createDiv({ cls: "book-note-epub-toc-list" });

		for (const entry of this.tocEntries) {
			const item = list.createEl("button", {
				cls: "book-note-epub-toc-item",
				text: entry.label,
				attr: { type: "button" },
			});
			item.addEventListener("click", () => this.navigateToSpineIndex(entry.spineIndex));
		}
	}

	// ================================================================
	// 兼容旧版书签数据（运行时入口已下线）
	// ================================================================

	/**
	 * 检查当前 CFI 是否已有书签。
	 */
	// ================================================================
	// foliate 事件注册
	// ================================================================

	/**
	 * 配置 foliate-view 的布局属性。
	 */
	private configureFoliateView(view: FoliateViewHandle): void {
		const element = view as unknown as HTMLElement;
		element.addClass("book-note-epub-foliate-view");
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
	private handleTextSelected(snapshot: EpubSelectionSnapshot): void {
		if (!snapshot.text) {
			this.dismissContextMenu();
			return;
		}

		this.lastSelectedCfiRange = snapshot.cfiRange;
		this.lastSelectedText = snapshot.text;

		this.showContextMenu(
			snapshot.rect.left,
			snapshot.rect.top + snapshot.rect.height,
			snapshot.text,
			snapshot.cfiRange,
		);
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

		const menu = document.body.createDiv({ cls: "book-note-epub-context-menu" });

		const colorRow = menu.createDiv({ cls: "book-note-epub-context-colors" });
		for (const color of ANNOTATION_COLORS) {
			const dot = colorRow.createEl("button", {
				cls: `book-note-epub-context-dot book-note-dot--${color}`,
				attr: {
					type: "button",
					title: COLOR_LABELS[color],
					"aria-label": t("aria.colorHighlight", { color: COLOR_LABELS[color] }),
				},
			});
			dot.style.background = EPUB_COLOR_MAP[color];
			dot.addEventListener("click", () => {
				void this.createHighlight(color, cfiRange, text);
				this.dismissContextMenu();
			});
		}

		const noteBtn = menu.createEl("button", {
			cls: "book-note-epub-context-note-btn",
			attr: { type: "button", title: t("aria.addAnnotation") },
			text: "\u{1F4DD}",
		});
		noteBtn.addEventListener("click", () => {
			void this.openNoteModal(cfiRange, text);
			this.dismissContextMenu();
		});

		const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - 260));
		const clampedTop = Math.max(8, Math.min(top + 8, window.innerHeight - 48));
		menu.style.left = `${clampedLeft}px`;
		menu.style.top = `${clampedTop}px`;

		document.body.appendChild(menu);
		this.contextMenuEl = menu;

		// 点击菜单外部关闭（立即响应，不等 8 秒）
		this.contextMenuOutsideHandler = (ev: PointerEvent) => {
			if (this.contextMenuEl && ev.target instanceof Node && !this.contextMenuEl.contains(ev.target)) {
				this.dismissContextMenu();
			}
		};
		window.setTimeout(() => {
			if (this.contextMenuOutsideHandler) {
				document.addEventListener("pointerdown", this.contextMenuOutsideHandler, true);
			}
		}, 0);

		this.contextMenuDismissTimer = window.setTimeout(() => {
			this.dismissContextMenu();
		}, 8_000);
	}

	/**
	 * 销毁当前浮动上下文菜单。
	 */
	private contextMenuOutsideHandler: ((ev: PointerEvent) => void) | null = null;

	private dismissContextMenu(): void {
		if (this.contextMenuDismissTimer !== null) {
			window.clearTimeout(this.contextMenuDismissTimer);
			this.contextMenuDismissTimer = null;
		}
		if (this.contextMenuOutsideHandler) {
			document.removeEventListener("pointerdown", this.contextMenuOutsideHandler, true);
			this.contextMenuOutsideHandler = null;
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
			this.refreshAnnotations();
			new Notice(t("epub.highlightAdded", { color: COLOR_LABELS[color] }));
		} catch (error) {
			console.error("book-note: EPUB highlight creation failed", error);
			new Notice(t("epub.highlightCreateFailed"));
		}
	}

	/**
	 * 打开标注弹窗，让用户输入笔记内容后保存为 EpubCommentAnnotation。
	 *
	 * @param cfiRange - CFI 范围
	 * @param text - 选中的文本
	 */
	private openNoteModal(cfiRange: string, text: string): void {
		if (!this.file || !this.foliateView) {
			return;
		}

		const chapter = this.currentChapter;

		new EpubNoteModal(
			this.app,
			text,
			this.pluginSettings.annotationTags,
			{
				color: this.pluginSettings.defaultHighlightColor,
				style: this.pluginSettings.epubHighlightStyle,
			},
			async (result: EpubNoteResult) => {
				if (!result.note.trim()) {
					return;
				}
				const now = new Date().toISOString();
				const annotation: EpubCommentAnnotation = {
					id: crypto.randomUUID(),
					type: "epub-comment",
					color: result.color,
					style: result.style,
					anchor: { cfiRange, chapter, selectedText: text },
					note: result.note.trim(),
					tagId: result.tagId,
					tagLabelSnapshot: result.tagLabelSnapshot,
					// 保留旧字段，便于旧版插件读取内置标签。
					noteType: result.tagId ? legacyNoteTypeForTag(result.tagId) : undefined,
					createdAt: now,
					collapsed: false,
					author: this.pluginSettings.defaultAuthor,
					updatedAt: now,
					replies: [],
					resolved: false,
				};

				try {
					await this.store.addEpubComment(this.file!, annotation);
					this.renderAnnotationOnRendition(annotation);
					this.renderSidebar();
					this.refreshAnnotations();
					new Notice(t("epub.noteAdded"));
				} catch (error) {
					console.error("book-note: EPUB comment creation failed", error);
					new Notice(t("epub.noteCreateFailed"));
				}
			},
		).open();
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

		const meta = {
			value: annotation.anchor.cfiRange,
			id: annotation.id,
			color: annotation.color,
			style: annotation.style,
		};
		this.renderedAnnotationMeta.set(annotation.id, meta);

		void this.foliateView.addAnnotation(meta);
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
			this.refreshAnnotations();
			new Notice(t("epub.noteDeleted"));
		} catch (error) {
			console.error("book-note: EPUB annotation deletion failed", error);
			new Notice(t("epub.noteDeleteFailed"));
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

		// 用 tracked meta remove 所有已渲染标注，不依赖 sidecar 缓存——
		// 这样外部删除（侧栏）后被删的标注也能从 foliate 层正确移除，再按当前 sidecar 全量重绘。
		for (const meta of this.renderedAnnotationMeta.values()) {
			try {
				this.foliateView.deleteAnnotation(meta);
			} catch {
				/* foliate may already have cleared the overlay */
			}
		}
		this.renderedAnnotationMeta.clear();

		this.restoreAnnotations();
	}

	// ================================================================
	// 位置事件 & 进度
	// ================================================================

	/**
	 * 处理 foliate relocate 事件。
	 * 更新当前章节、百分比、进度条显示，并触发进度保存。
	 *
	 * 滚动模式下的跨章翻页由 relocate 事件驱动：
	 * foliate-js 在 #container 滚动后经 250ms 防抖触发 #afterScroll('scroll')，
	 * 进而 dispatch CustomEvent('relocate', { detail: { reason, start, end, viewSize } })。
	 * 此时 renderer.start/end/viewSize 已是终值，零时序问题。
	 *
	 * 注意：不能使用 detail.fraction 做边界检测——fraction = start / viewSize，
	 * 当内容 2x viewport 时最大 fraction 仅 0.5，>= 0.98 永远不触发。
	 * 正确做法：直接读 renderer.start/end/viewSize，与 foliate 内部 #scrollPrev/#scrollNext
	 * 使用相同的边界条件（start <= 0 / viewSize - end <= 2）。
	 *
	 * @param detail - foliate relocate event detail
	 */
	private handleRelocated(detail: FoliateRelocateDetail): void {
		const cfi = normalizeCfi(detail?.cfi);
		const percent = normalizePercent(detail?.fraction ?? this.currentPercent);
		// foliate view 的 relocate detail 中，section index 嵌套在 section.current 里
		// （来自 SectionProgress.getProgress 返回的 { section: { current: index } }）
		// paginator 原始 relocate 事件有顶层 index，但 view.js #onRelocate 重新包装后丢失了
		const rawIndex = detail?.section?.current ?? detail?.index;
		const spineIndex = typeof rawIndex === "number" ? rawIndex : this.currentSectionIndex;

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

		const bar = this.progressEl.createDiv({ cls: "book-note-epub-progress-bar" });
		bar.createDiv({
			cls: "book-note-epub-progress-fill",
		});
		const fill = bar.querySelector<HTMLElement>(".book-note-epub-progress-fill");
		if (fill) {
			fill.style.width = `${Math.round(percent * 100)}%`;
		}

		const percentText = `${Math.round(percent * 100)}%`;
		const remaining = this.formatRemainingTime();

		this.progressEl.createDiv({
			cls: "book-note-epub-progress-text",
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
			return t("epub.readDone");
		}

		const estimatedRemainingSeconds = (this.readingTimeSeconds / this.currentPercent) * remainingFraction;
		const estimatedRemainingMinutes = Math.round(estimatedRemainingSeconds / 60);

		if (estimatedRemainingMinutes < 1) {
			return t("epub.remainingLessThanMinute");
		}

		return t("bookshelf.remaining", { minutes: estimatedRemainingMinutes });
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
			console.error("book-note: EPUB progress save failed", error);
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
			await showFoliateStart(this.foliateView);
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
				await showFoliateStart(this.foliateView);
			}
		} else {
			await showFoliateStart(this.foliateView);
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
	 * 处理键盘导航事件（PC 端，键盘/滚轮互斥）。
	 *
	 * pcNavMode === "keyboard" 时生效：
	 *   翻页模式：← 上一页 / → 下一页；Space 下一页 / Shift+Space 上一页；
	 *             PageUp/PageDown 同向翻页；Home 跳到书首，End 跳到书尾。
	 *   滚动模式：↑ 上一章 / ↓ 下一章；Home 跳到书首，End 跳到书尾；
	 *             其余按键交给 iframe 原生滚动。
	 *
	 * pcNavMode === "wheel" 时：preventDefault 所有导航键（含方向键/Space/
	 *   PageUp/Down/Home/End），阻止滚动模式下的原生滚动和分页模式下 foliate
	 *   自身的键盘处理，确保滚轮模式下键盘完全不干预阅读。
	 *
	 * ⚠️ 阅读正文渲染在 foliate iframe 内，iframe 的键盘事件不会冒泡到父文档，
	 *    因此除 contentEl 监听外，还需在 handleFoliateLoad 中把本方法挂到每个
	 *    section document 上（attachKeyboardNavigation），否则阅读时焦点在
	 *    iframe 内、键盘翻页不生效。
	 *
	 * ⚠️ event.target 可能来自 iframe realm，不能用 instanceof 判断标签
	 *    （跨 realm instanceof 不可靠），改用 tagName 字符串比较。
	 *
	 * @param event - 键盘事件
	 */
	private handleKeydown(event: KeyboardEvent): void {
		// 输入框/文本域/下拉框/可编辑区域内不拦截，保证正常打字与表单操作
		const target = event.target as Element | null;
		if (target && typeof target.tagName === "string") {
			const tag = target.tagName.toUpperCase();
			if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || (target as HTMLElement).isContentEditable) {
				return;
			}
		}

		const isPaginated = this.currentFlowMode === "paginated";

		// 滚轮翻页模式下禁用键盘导航（键盘/滚轮互斥）
		if (this.pcNavMode !== "keyboard") {
			// 阻止导航键的原生行为（滚动模式下的原生滚动、分页模式下 foliate 自身处理），
			// 确保滚轮模式下键盘完全不干预阅读
			switch (event.key) {
				case "ArrowUp":
				case "ArrowDown":
				case "ArrowLeft":
				case "ArrowRight":
				case " ":
				case "PageUp":
				case "PageDown":
				case "Home":
				case "End":
					event.preventDefault();
					break;
				default:
					break;
			}
			return;
		}

		switch (event.key) {
			case "ArrowLeft": {
				// 翻页模式：上一页；滚动模式不拦截
				if (isPaginated) {
					event.preventDefault();
					this.prevPage();
				}
				break;
			}
			case "ArrowRight": {
				// 翻页模式：下一页；滚动模式不拦截
				if (isPaginated) {
					event.preventDefault();
					this.nextPage();
				}
				break;
			}
			case "ArrowUp": {
				// 滚动模式：上一章；翻页模式不拦截
				if (!isPaginated) {
					event.preventDefault();
					this.prevPage();
				}
				break;
			}
			case "ArrowDown": {
				// 滚动模式：下一章；翻页模式不拦截
				if (!isPaginated) {
					event.preventDefault();
					this.nextPage();
				}
				break;
			}
			case " ": {
				// Space 下一页 / Shift+Space 上一页；滚动模式交给原生滚动
				if (isPaginated) {
					event.preventDefault();
					if (event.shiftKey) {
						this.prevPage();
					} else {
						this.nextPage();
					}
				}
				break;
			}
			case "PageDown": {
				if (isPaginated) {
					event.preventDefault();
					this.nextPage();
				}
				break;
			}
			case "PageUp": {
				if (isPaginated) {
					event.preventDefault();
					this.prevPage();
				}
				break;
			}
			case "Home": {
				event.preventDefault();
				this.goToBookStart();
				break;
			}
			case "End": {
				event.preventDefault();
				this.goToBookEnd();
				break;
			}
		default:
			break;
		}
	}

	/**
	 * 处理移动端点击翻页（tap zones）。
	 *
	 * 屏幕左 1/3 = 上一页/章，右 1/3 = 下一页/章，中间 1/3 不触发。
	 * 两种模式（分页/滚动）统一使用 prevPage()/nextPage()。
	 *
	 * ⚠️ iframe 内的点击事件不会冒泡到父文档，因此除 readerContainerEl 上的
	 *    监听外，还需在 attachKeyboardNavigation 中给每个 section document
	 *    单独挂 click 监听（capture 阶段，先于 foliate 自身处理器执行）。
	 *
	 * 排除情况：
	 * - mobileTapEnabled 关闭时不拦截（滑动翻页模式）
	 * - 侧边栏打开时不拦截（让 handleReaderAreaClick 先关侧边栏）
	 * - 点击链接/按钮时不拦截（保证正常跳转和交互）
	 * - 有文本选区时不拦截（防止选完文字后误触翻页）
	 *
	 * @param event - 鼠标点击事件（移动端 touchend 后合成）
	 */
	private handleTapZone(event: MouseEvent): void {
		if (!this.mobileTapEnabled) {
			return;
		}

		// 侧边栏打开时让 handleReaderAreaClick 先关闭它
		if (this.sidebarOpen) {
			return;
		}

		// 点击链接/按钮时不拦截
		const target = event.target as Element | null;
		if (target) {
			let el: Element | null = target;
			while (el) {
				const tag = el.tagName;
				if (typeof tag === "string") {
					const upper = tag.toUpperCase();
					if (upper === "A" || upper === "BUTTON") {
						return;
					}
				}
				el = el.parentElement;
			}
		}

		// 有文本选区时不拦截（防止选完文字后误触翻页）
		const doc = target?.ownerDocument ?? document;
		const selection = doc.getSelection?.();
		if (selection && !selection.isCollapsed) {
			return;
		}

		// 计算点击位置占屏幕宽度的比例
		let ratio: number;
		if (event.currentTarget === this.readerContainerEl) {
			const rect = this.readerContainerEl.getBoundingClientRect();
			ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
		} else {
			// iframe document 上下文：clientX 相对于 iframe 视口
			const view = (event.view ?? window) as Window;
			ratio = view.innerWidth > 0 ? event.clientX / view.innerWidth : 0.5;
		}

		if (ratio < 0.33) {
			event.preventDefault();
			event.stopPropagation();
			this.prevPage();
		} else if (ratio > 0.67) {
			event.preventDefault();
			event.stopPropagation();
			this.nextPage();
		}
		// 中间 1/3 不触发，交给 foliate 原生处理
	}

	/**
	 * 处理鼠标滚轮事件（PC 端，键盘/滚轮互斥）。
	 *
	 * pcNavMode === "wheel" 时生效：
	 *   分页模式：滚轮直接翻页，带防抖保护。
	 *   滚动模式：不拦截，交给 foliate 内部 #container 自然滚动；
	 *     跨章翻页由 relocate 事件驱动（handleRelocated 中检测边界）。
	 *
	 * pcNavMode === "keyboard" 时：preventDefault 阻止滚轮在两种模式下的
	 *   原生行为（分页模式无滚动，滚动模式阻止原生滚动），确保键盘模式下
	 *   滚轮完全不干预阅读。
	 *
	 * @param event - 滚轮事件
	 */
	private handleWheel(event: WheelEvent): void {
		// 键盘翻页模式下禁用滚轮（键盘/滚轮互斥）
		if (this.pcNavMode !== "wheel") {
			event.preventDefault();
			return;
		}
		// 滚动模式：交给 foliate 内部自然滚动
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

	/**
	 * 跳转到书籍开头（Home 键）。
	 * 优先使用 foliate 的 goToFraction(0)；不支持时回退到 goTo(0)（首个 spine）。
	 */
	private goToBookStart(): void {
		if (!this.foliateView) {
			return;
		}
		if (typeof this.foliateView.goToFraction === "function") {
			void this.foliateView.goToFraction(0);
		} else {
			void this.foliateView.goTo(0);
		}
	}

	/**
	 * 跳转到书籍结尾（End 键）。
	 * 依赖 foliate 的 goToFraction(1)；不支持时静默放弃（避免误跳到某个 spine）。
	 */
	private goToBookEnd(): void {
		if (!this.foliateView) {
			return;
		}
		if (typeof this.foliateView.goToFraction === "function") {
			void this.foliateView.goToFraction(1);
		}
	}

	/**
	 * 监听 paginator 的 scroll/touchmove/wheel 事件，在滚动模式下驱动跨章翻页。
	 *
	 * 三路信号互补：
	 * - scroll：scrollTop 变化时触发（用户滚动**到**边界）
	 * - touchmove：触摸滑动时触发，即使 scrollTop 不变（用户**已在**边界继续滑）
	 * - wheel：桌面端滚轮，即使 scrollTop 不变（用户**已在**边界继续滚）
	 *
	 * 核心问题：scroll 事件只在 scrollTop 变化时触发。用户已在边界时继续滑动，
	 * scrollTop 不变，无 scroll 事件，handler 不触发——用户必须反方向滑一下再滑
	 * 回来才能翻页。touchmove/wheel 事件不依赖 scrollTop 变化，弥补此盲区。
	 *
	 * foliate #scrollPrev 在 start > 0 时只章内滚动到 0，需第二次 prev() 才跨章。
	 * handler 中用 async 两步调用处理此逻辑。
	 *
	 * 方向冷却：跨章后 300ms 内阻止反方向触发，防止新章节边界事件导致来回跳。
	 */
	private attachPaginatorScrollListener(): void {
		if (!this.foliateView?.renderer) return;

		// 清理旧监听
		if (this.paginatorScrollCleanup) {
			this.paginatorScrollCleanup();
			this.paginatorScrollCleanup = null;
		}

		const renderer = this.foliateView.renderer as unknown as HTMLElement;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const view = this.foliateView as any;
		const prevFn = view.prev ?? view.goLeft;
		const nextFn = view.next ?? view.goRight;

		/** 读取当前边界状态 */
		const getBounds = () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const r = this.foliateView?.renderer as any;
			if (!r || typeof r.start !== "number" || typeof r.end !== "number" || typeof r.viewSize !== "number")
				return null;
			return {
				atBottom: r.viewSize - r.end <= 2,
				atTop: r.start <= 2,
				maxIndex: Array.isArray(this.foliateView?.book?.sections)
					? (this.foliateView!.book!.sections!.length - 1)
					: 0,
			};
		};

		/** 执行跨章导航（next 或 prev），含两步调用和方向冷却 */
		const navigate = (direction: "next" | "prev") => {
			if (this.scrolledNavigating) return;
			if (this.currentFlowMode !== "scrolled") return;

			const bounds = getBounds();
			if (!bounds) return;

			// 方向冷却：刚从反方向翻过来时，忽略此方向
			if (direction === "next") {
				if (!bounds.atBottom || this.currentSectionIndex >= bounds.maxIndex) return;
				if (this.scrolledNavDirection === "prev") return;
				if (typeof nextFn !== "function") return;
			} else {
				if (!bounds.atTop || this.currentSectionIndex <= 0) return;
				if (this.scrolledNavDirection === "next") return;
				if (typeof prevFn !== "function") return;
			}

			this.scrolledNavigating = true;
			this.scrolledNavDirection = direction;

			const fn = direction === "next" ? nextFn : prevFn;
			void (async () => {
				const sectionBefore = this.currentSectionIndex;
				await fn.call(view);
				// 如果第一次没跨章（只是章内滚动到边界），再调一次跨章
				if (this.currentSectionIndex === sectionBefore) {
					await fn.call(view);
				}
				// 跨章完成后设冷却，防止新章节边界事件触发反方向
				window.setTimeout(() => {
					this.scrolledNavigating = false;
					this.scrolledNavDirection = null;
				}, 300);
			})();
		};

		// 1. scroll 事件：scrollTop 变化时触发（滚动到边界）
		const scrollHandler = () => {
			if (this.currentFlowMode !== "scrolled") return;
			if (this.scrolledNavigating) return;
			const bounds = getBounds();
			if (!bounds || (!bounds.atBottom && !bounds.atTop)) return;
			if (bounds.atBottom) navigate("next");
			else if (bounds.atTop) navigate("prev");
		};

		// 2. wheel 事件：桌面端滚轮，即使 scrollTop 不变也触发（已在边界）
		const wheelHandler = (e: WheelEvent) => {
			if (this.currentFlowMode !== "scrolled") return;
			if (this.scrolledNavigating) return;
			const bounds = getBounds();
			if (!bounds || (!bounds.atBottom && !bounds.atTop)) return;
			if (bounds.atBottom && e.deltaY > 0) navigate("next");
			else if (bounds.atTop && e.deltaY < 0) navigate("prev");
		};

		// 3. touchmove 事件：触摸滑动，即使 scrollTop 不变也触发（已在边界）
		let touchStartY = 0;
		let touchActive = false;
		const TOUCH_THRESHOLD = 15;

		const touchStartHandler = (e: TouchEvent) => {
			if (e.touches.length !== 1) {
				touchActive = false;
				return;
			}
			touchStartY = e.touches[0].clientY;
			touchActive = true;
		};
		const touchMoveHandler = (e: TouchEvent) => {
			if (!touchActive || e.touches.length !== 1) return;
			if (this.currentFlowMode !== "scrolled") return;
			if (this.scrolledNavigating) return;
			const bounds = getBounds();
			if (!bounds || (!bounds.atBottom && !bounds.atTop)) return;

			const currentY = e.touches[0].clientY;
			const delta = touchStartY - currentY; // 正=手指上移=向下滚动=下一章

			if (bounds.atBottom && delta > TOUCH_THRESHOLD) {
				touchActive = false; // 防止同一次触摸重复触发
				navigate("next");
			} else if (bounds.atTop && delta < -TOUCH_THRESHOLD) {
				touchActive = false;
				navigate("prev");
			}
		};

		// 注册 renderer 上的监听
		renderer.addEventListener("scroll", scrollHandler);
		renderer.addEventListener("wheel", wheelHandler, { passive: true });
		renderer.addEventListener("touchstart", touchStartHandler, { passive: true });
		renderer.addEventListener("touchmove", touchMoveHandler, { passive: true });

		// iframe 内的 touch/wheel 事件不会冒泡到父文档，需通过 load 事件拿到 doc 后单独监听
		const iframeDocs: Document[] = [];
		const loadHandler = (e: Event) => {
			const doc = (e as CustomEvent).detail?.doc as Document | undefined;
			if (!doc || iframeDocs.includes(doc)) return;
			iframeDocs.push(doc);
			doc.addEventListener("touchstart", touchStartHandler, { passive: true });
			doc.addEventListener("touchmove", touchMoveHandler, { passive: true });
			doc.addEventListener("wheel", wheelHandler, { passive: true });
		};
		renderer.addEventListener("load", loadHandler);

		this.paginatorScrollCleanup = () => {
			renderer.removeEventListener("scroll", scrollHandler);
			renderer.removeEventListener("wheel", wheelHandler);
			renderer.removeEventListener("touchstart", touchStartHandler);
			renderer.removeEventListener("touchmove", touchMoveHandler);
			renderer.removeEventListener("load", loadHandler);
			for (const doc of iframeDocs) {
				doc.removeEventListener("touchstart", touchStartHandler);
				doc.removeEventListener("touchmove", touchMoveHandler);
				doc.removeEventListener("wheel", wheelHandler);
			}
		};
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

	/**
	 * 切换导航模式。
	 * PC 端在键盘翻页 / 滚轮翻页之间互斥切换。
	 * 移动端在点按翻页 / 滑动翻页之间切换。
	 */
	private toggleKeyNav(): void {
		if (Platform.isMobile) {
			this.mobileTapEnabled = !this.mobileTapEnabled;
			this.renderToolbar();
			new Notice(this.mobileTapEnabled ? t("epub.tapPageOn") : t("epub.swipePageOn"));
		} else {
			this.pcNavMode = this.pcNavMode === "keyboard" ? "wheel" : "keyboard";
			this.renderToolbar();
			new Notice(this.pcNavMode === "keyboard" ? t("epub.keyboardPageOn") : t("epub.scrollPageOn"));
		}
	}

	// ================================================================
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
	// 外部跳转（供共用 AnnotationSidebarView 的 jumpTo 调用）
	// ================================================================

	/**
	 * 导航到指定 CFI 位置。
	 * 供共用 AnnotationSidebarView 的「跳转」按钮调用，
	 * 实现从总览面板跳回 EPUB 正文对应位置。
	 *
	 * @param cfiRange - CFI 范围字符串
	 */
	navigateToCfi(cfiRange: string): void {
		if (!this.foliateView) {
			return;
		}
		try {
			void this.foliateView.goTo(cfiRange);
		} catch (error) {
			console.warn("book-note: navigateToCfi failed", error);
		}
	}

	/**
	 * 外部标注变更后刷新本视图。
	 * 供共用 AnnotationSidebarView 删除/编辑 EPUB 标注后调用，
	 * 重新从 sidecar 读取标注并重绘 foliate 高亮层 + 内嵌侧栏。
	 */
	refreshExternalAnnotations(): void {
		if (!this.file || !this.foliateView) {
			return;
		}
		this.refreshRenditionAnnotations();
		this.renderSidebar();
	}

	// ================================================================
	// 书内搜索（Phase 4-B P4）
	// ================================================================

	private renderSearchBox(): void {
		const container = this.sidebarContentEl.createDiv({ cls: "book-note-epub-search-box" });
		this.searchInputEl = container.createEl("input", {
			cls: "book-note-epub-search-input",
			attr: { type: "text", placeholder: t("aria.searchPlaceholder") },
		}) as HTMLInputElement;
		this.searchInputEl.addEventListener("keydown", (ev: KeyboardEvent) => {
			ev.stopPropagation();
		}, { capture: true });
		this.searchResultsEl = container.createDiv({ cls: "book-note-epub-search-results" });
		this.searchInputEl.addEventListener("input", this.searchDebounce, { passive: true });
	}

	private async performSearch(): Promise<void> {
		if (!this.searchResultsEl || !this.searchInputEl || !this.foliateView) return;
		const query = this.searchInputEl.value.trim().toLowerCase();
		this.searchResultsEl.empty();
		if (query.length < 2) return;
		let results: Array<{ cfi: string; excerpt: string }> = [];
		if (typeof (this.foliateView as any).search === "function") {
			try {
				const sr: unknown = await ((this.foliateView as any).search as (q: string) => Promise<unknown>)(query);
				if (Array.isArray(sr)) results = (sr as any[]).map((i: any) => ({ cfi: String(i.cfi || i.value || ""), excerpt: String(i.excerpt || i.text || "") }));
			} catch { /* ignore */ }
		}
		if (results.length === 0) {
			const contents = this.foliateView.renderer?.getContents?.() ?? [];
			for (const c of contents) {
				if (!c.doc?.body) continue;
				const text = c.doc.body.textContent || "";
				const lower = text.toLowerCase();
				let idx = lower.indexOf(query);
				while (idx >= 0 && results.length < 50) {
					const start = Math.max(0, idx - 40);
					const end = Math.min(text.length, idx + query.length + 60);
					let excerpt = text.slice(start, end).replace(/\n/g, " ");
					if (start > 0) excerpt = "…" + excerpt;
					if (end < text.length) excerpt = excerpt + "…";
					results.push({ cfi: "", excerpt });
					idx = lower.indexOf(query, idx + query.length);
				}
				if (results.length > 0) break;
			}
		}
		if (results.length === 0) {
			this.searchResultsEl.createDiv({ cls: "book-note-epub-search-empty", text: t("epub.searchEmpty") });
			return;
		}
		for (const r of results) {
			const item = this.searchResultsEl.createEl("button", { cls: "book-note-epub-search-result", attr: { type: "button" } });
			item.createSpan({ cls: "book-note-epub-search-text", text: r.excerpt.slice(0, 100) });
			if (r.cfi) item.addEventListener("click", () => { if (this.foliateView) void this.foliateView.goTo(r.cfi); });
		}
	}

	// ================================================================
	// 脚注预览 & 段落模式（Phase 4-B P3，均未实现）
	// ================================================================

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
				this.foliateView.close?.();
			} catch {
				/* foliate-view 可能已经销毁 */
			}
			this.foliateView = null;
		}

		if (this.paginatorScrollCleanup) {
			this.paginatorScrollCleanup();
			this.paginatorScrollCleanup = null;
		}

		this.scrolledNavigating = false;
		this.scrolledNavDirection = null;

		this.renderedAnnotationMeta.clear();

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
		this.currentLoadedDoc = doc;
		stripScriptsFromDocument(doc);
		void inlineBlockedStylesheets({ document: doc });
		this.attachSelectionListeners(doc);
		this.attachKeyboardNavigation(doc);
		this.handleRendered();

		// 自动聚焦 iframe，使键盘/滚轮翻页无需先手动点击
		// foliate 每次加载新 section 都会创建/复用 iframe，默认不自动获取焦点
		requestAnimationFrame(() => this.focusActiveIframe());

		// 移动端：点击 iframe 内阅读区域关闭目录面板
		if (Platform.isMobile) {
			doc.addEventListener("click", (e) => this.handleReaderAreaClick(e));
		}
	};

	private handleFoliateRelocate = (event: Event): void => {
		this.handleRelocated((event as CustomEvent<FoliateRelocateDetail>).detail ?? {});

		// 翻页模式下，翻页后重新聚焦 iframe。
		// foliate next/prev 在 paginated 模式下可能导致 iframe 焦点丢失，
		// 而 load 事件只在跨 section 时触发，同一章节内翻页不会重新聚焦。
		// relocate 在每次翻页后都会触发，这里补上焦点恢复。
		if (!Platform.isMobile && this.currentFlowMode === "paginated") {
			requestAnimationFrame(() => this.focusActiveIframe());
		}
	};

	/**
	 * 聚焦当前活动的 foliate iframe，使键盘/滚轮导航无需先手动点击。
	 *
	 * 翻页模式（paginated）下 foliate next/prev 可能导致 iframe 焦点丢失，
	 * 在 load 和 relocate 事件后调用此方法恢复焦点。
	 * 不抢输入框（搜索框等）焦点，仅在安全时聚焦。
	 */
	private focusActiveIframe(): void {
		// 不抢输入框焦点
		const active = document.activeElement;
		if (active) {
			const tag = active.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (active as HTMLElement).isContentEditable) {
				return;
			}
		}

		const doc = this.currentLoadedDoc;
		if (!doc) return;
		const win = doc.defaultView;
		const frame = win?.frameElement;
		if (frame instanceof HTMLIFrameElement) {
			frame.focus();
		}
	}

	private handleFoliateDrawAnnotation = (event: Event): void => {
		const detail = (event as CustomEvent<FoliateDrawAnnotationDetail>).detail;
		if (!detail?.annotation || typeof detail.draw !== "function") {
			return;
		}
		const color = detail.annotation.color ?? this.pluginSettings.defaultHighlightColor;
		const style = detail.annotation.style ?? this.pluginSettings.epubHighlightStyle;
		detail.draw((rects) => this.createAnnotationOverlay(rects, color, style));
	};

	private attachSelectionListeners(doc: Document): void {
		if (this.documentSelectionCleanups.has(doc)) {
			return;
		}

		let pendingFrame = 0;
		let pendingRetry = 0;
		const scheduleEmit = () => {
			if (pendingFrame) {
				window.cancelAnimationFrame(pendingFrame);
			}
			pendingFrame = window.requestAnimationFrame(() => {
				pendingFrame = 0;
				const emitted = this.emitFoliateSelection(doc);
				if (!emitted) {
					if (pendingRetry) {
						window.clearTimeout(pendingRetry);
					}
					pendingRetry = window.setTimeout(() => {
						pendingRetry = 0;
						this.emitFoliateSelection(doc);
					}, SELECTION_SYNC_RETRY_DELAY_MS);
				}
			});
		};

		const eventOptions: AddEventListenerOptions = { capture: true };
		const win = doc.defaultView;

		doc.addEventListener("selectionchange", scheduleEmit, eventOptions);
		doc.addEventListener("mouseup", scheduleEmit, eventOptions);
		doc.addEventListener("pointerup", scheduleEmit, eventOptions);
		doc.addEventListener("touchend", scheduleEmit, eventOptions);
		doc.addEventListener("keyup", scheduleEmit, eventOptions);
		doc.addEventListener("contextmenu", scheduleEmit, eventOptions);
		win?.addEventListener("mouseup", scheduleEmit, eventOptions);
		win?.addEventListener("pointerup", scheduleEmit, eventOptions);
		win?.addEventListener("touchend", scheduleEmit, eventOptions);

		const cleanup = () => {
			if (pendingFrame) {
				window.cancelAnimationFrame(pendingFrame);
			}
			if (pendingRetry) {
				window.clearTimeout(pendingRetry);
			}
			doc.removeEventListener("selectionchange", scheduleEmit, true);
			doc.removeEventListener("mouseup", scheduleEmit, true);
			doc.removeEventListener("pointerup", scheduleEmit, true);
			doc.removeEventListener("touchend", scheduleEmit, true);
			doc.removeEventListener("keyup", scheduleEmit, true);
			doc.removeEventListener("contextmenu", scheduleEmit, true);
			win?.removeEventListener("mouseup", scheduleEmit, true);
			win?.removeEventListener("pointerup", scheduleEmit, true);
			win?.removeEventListener("touchend", scheduleEmit, true);
		};
		this.documentSelectionCleanups.set(doc, cleanup);
	}

	/**
	 * 为 foliate section iframe 挂载导航监听。
	 *
	 * - PC 端：挂 keydown，使阅读时（焦点在 iframe 内）键盘翻页生效。
	 *   iframe 的键盘事件不会冒泡到父文档，contentEl 上的监听在阅读时
	 *   收不到事件，故需逐 section document 单独挂载。
	 * - 移动端：挂 click（capture 阶段），使点击翻页区在 iframe 内生效。
	 *   capture 阶段先于 foliate 自身的 click 处理器执行，配合
	 *   stopPropagation 避免双重翻页。
	 *
	 * 幂等：同一 doc 只挂一次，cleanup 存入 WeakMap（iframe 销毁时随 GC 回收）。
	 */
	private attachKeyboardNavigation(doc: Document): void {
		if (this.documentKeyboardCleanups.has(doc)) {
			return;
		}

		const cleanups: (() => void)[] = [];

	// PC 端：键盘翻页
	const keyHandler = (event: KeyboardEvent) => this.handleKeydown(event);
	doc.addEventListener("keydown", keyHandler);
	cleanups.push(() => doc.removeEventListener("keydown", keyHandler));

	// PC 端：滚轮翻页（passive: false 以便 handleWheel 中 preventDefault 生效）
	const wheelHandler = (event: WheelEvent) => this.handleWheel(event);
	doc.addEventListener("wheel", wheelHandler, { passive: false });
	cleanups.push(() => doc.removeEventListener("wheel", wheelHandler));

		// 移动端：点击翻页（capture 阶段，先于 foliate 自身处理器）
		if (Platform.isMobile) {
			const tapHandler = (event: MouseEvent) => this.handleTapZone(event);
			doc.addEventListener("click", tapHandler, true);
			cleanups.push(() => doc.removeEventListener("click", tapHandler, true));
		}

		this.documentKeyboardCleanups.set(doc, () => {
			for (const fn of cleanups) fn();
		});
	}

	private emitFoliateSelection(doc: Document): boolean {
		const selection = doc.getSelection?.() ?? doc.defaultView?.getSelection?.();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
			return false;
		}
		const range = selection.getRangeAt(0);
		const text = selection.toString().trim();
		if (!text || !this.foliateView?.getCFI) {
			return false;
		}
		const cfiRange = this.resolveSelectionCfi(doc, range);
		if (!cfiRange) {
			return false;
		}
		const rect = this.createSelectionViewportRect(doc, range);
		if (!rect) {
			return false;
		}
		this.handleTextSelected({ doc, range: range.cloneRange(), text, cfiRange, rect });
		return true;
	}

	private resolveSelectionCfi(doc: Document, range: Range): string {
		if (!this.foliateView?.getCFI) {
			return "";
		}

		const knownIndex = this.loadedSectionDocs.get(doc);
		const contentsIndex = this.foliateView.renderer?.getContents?.()
			.find((content) => content.doc === doc)?.index;
		const index = knownIndex ?? contentsIndex ?? this.currentSectionIndex;

		try {
			return normalizeCfi(this.foliateView.getCFI(index, range.cloneRange()));
		} catch (error) {
			console.warn("book-note: EPUB selection CFI failed", { index, error });
			return "";
		}
	}

	private createSelectionViewportRect(doc: Document, range: Range): DOMRect | null {
		const rawRect = this.extractVisibleRangeRect(range);
		if (!rawRect) {
			return null;
		}

		const frame = this.findIframeForDocument(doc);
		const frameRect = frame?.getBoundingClientRect();
		if (!frameRect) {
			return rawRect;
		}

		return new DOMRect(
			rawRect.left + frameRect.left,
			rawRect.top + frameRect.top,
			rawRect.width,
			rawRect.height,
		);
	}

	private extractVisibleRangeRect(range: Range): DOMRect | null {
		const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
		const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
		if (!rect || rect.width <= 0 || rect.height <= 0) {
			return null;
		}
		return new DOMRect(rect.left, rect.top, rect.width, rect.height);
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
		const meta = this.renderedAnnotationMeta.get(annotation.id) ?? {
			value: annotation.anchor.cfiRange,
			id: annotation.id,
			color: annotation.color,
			style: annotation.style,
		};
		try {
			this.foliateView.deleteAnnotation(meta);
		} catch {
			/* foliate may already have cleared the visible overlay */
		}
		this.renderedAnnotationMeta.delete(annotation.id);
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

		// obsidian 主题下，外层容器背景使用 CSS 变量，确保 Obsidian 主题切换时
		// readerContainerEl 能实时跟随，无需等待 JS 重新解析。
		const containerBg = this.currentTheme === "obsidian"
			? "var(--background-primary)"
			: colors.background;
		(this.foliateView as unknown as HTMLElement).style.backgroundColor = containerBg;
		this.readerContainerEl.style.backgroundColor = containerBg;
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
		const frameElement = doc.defaultView?.frameElement;
		if (frameElement instanceof HTMLIFrameElement) {
			return frameElement;
		}

		const contentFrame = this.foliateView?.renderer?.getContents?.()
			.find((content) => content.doc === doc)?.doc?.defaultView?.frameElement;
		if (contentFrame instanceof HTMLIFrameElement) {
			return contentFrame;
		}

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

	/**
	 * 穿透 shadow DOM 收集所有 foliate iframe 的 contentDocument，供全文搜索使用。
	 * currentLoadedDoc 可能因翻页被 foliate 清空，这里实时遍历最可靠。
	 */
	private collectFoliateDocs(): Document[] {
		const docs: Document[] = [];
		const seen = new Set<Document>();
		const visit = (root: ParentNode): void => {
			const iframes = Array.from(root.querySelectorAll("iframe"));
			for (const iframe of iframes) {
				try {
					const d = (iframe as HTMLIFrameElement).contentDocument;
					if (d && d.body && !seen.has(d)) {
						seen.add(d);
						docs.push(d);
					}
				} catch {
					/* cross-origin iframe, ignore */
				}
			}
			const elements = Array.from(root.querySelectorAll("*"));
			for (const element of elements) {
				const shadowRoot = (element as HTMLElement).shadowRoot;
				if (shadowRoot) {
					visit(shadowRoot);
				}
			}
		};
		visit(this.readerContainerEl);
		// 加上缓存的 currentLoadedDoc 兜底
		if (this.currentLoadedDoc?.body && !seen.has(this.currentLoadedDoc)) {
			docs.push(this.currentLoadedDoc);
		}
		return docs;
	}

	// ================================================================
	// 工具栏搜索（从侧栏移到工具栏）
	// ================================================================

	private toggleToolbarSearch(): void {
		const existing = this.toolbarEl.querySelector(".book-note-epub-toolbar-search");
		if (existing) { existing.remove(); return; }
		const container = this.toolbarEl.createDiv({ cls: "book-note-epub-toolbar-search" });
		const input = container.createEl("input", {
			cls: "book-note-epub-toolbar-search-input",
			attr: { type: "text", placeholder: t("aria.searchBody") },
		}) as HTMLInputElement;
		const results = container.createDiv({ cls: "book-note-epub-toolbar-search-results" });
		input.addEventListener("keydown", (ev: KeyboardEvent) => { ev.stopPropagation(); }, { capture: true });
		let timer: number | null = null;
		input.addEventListener("input", () => {
			if (timer !== null) window.clearTimeout(timer);
			timer = window.setTimeout(() => { timer = null; void this.doToolbarSearch(input.value, results); }, 300);
		}, { passive: true });
		input.addEventListener("keydown", (ev) => {
			if (ev.key === "Escape") { container.remove(); }
			if (ev.key === "Enter") { void this.doToolbarSearch(input.value, results); }
		});
		input.focus();
	}

	private async doToolbarSearch(query: string, resultsEl: HTMLElement): Promise<void> {
		resultsEl.empty();
		if (!query.trim() || query.trim().length < 2 || !this.foliateView) return;

		// 使用 foliate 内置全书搜索（支持跨章节、返回 CFI 可直接导航）
		const searchGen = (this.foliateView as any).search?.({ query: query.trim() });
		if (!searchGen || typeof searchGen[Symbol.asyncIterator] !== 'function') {
			// foliate 不支持 search，回退到当前 section
			resultsEl.createDiv({ cls: "book-note-epub-toolbar-search-empty", text: t("epub.searchUnsupported") });
			return;
		}

		const hits: Array<{ cfi: string; label: string; excerpt: { pre: string; match: string; post: string } }> = [];
		let searching = true;

		// 添加进度指示
		const progressEl = resultsEl.createDiv({ cls: "book-note-epub-toolbar-search-progress", text: t("epub.searching") });

		try {
			for await (const result of searchGen) {
				if (result === 'done') break;
				if (result.progress !== undefined) {
					progressEl.textContent = t("epub.searchProgress", { percent: Math.round(result.progress * 100) });
					continue;
				}
				if (result.subitems) {
					for (const item of result.subitems) {
						hits.push({ cfi: item.cfi, label: result.label || '', excerpt: item.excerpt });
						if (hits.length >= 100) break;
					}
				} else if (result.cfi) {
					hits.push({ cfi: result.cfi, label: result.label || '', excerpt: result.excerpt });
				}
				if (hits.length >= 100) break;
			}
		} catch (e) {
			console.error("book-note: search error", e);
		}

		progressEl.remove();

		if (hits.length === 0) {
			resultsEl.createDiv({ cls: "book-note-epub-toolbar-search-empty", text: t("epub.searchNoMatch") });
			return;
		}

		// 按章节分组显示
		let currentLabel = '';
		for (const h of hits) {
			if (h.label && h.label !== currentLabel) {
				currentLabel = h.label;
				resultsEl.createDiv({ cls: "book-note-epub-toolbar-search-chapter", text: currentLabel });
			}
			const btn = resultsEl.createEl("button", { cls: "book-note-epub-toolbar-search-hit", attr: { type: "button" } });
			btn.innerHTML = `${this.escapeHtml(h.excerpt.pre)}<strong>${this.escapeHtml(h.excerpt.match)}</strong>${this.escapeHtml(h.excerpt.post)}`;
			btn.addEventListener("click", () => {
				if (this.foliateView) {
					void this.foliateView.goTo(h.cfi);
				}
			});
		}
	}

	private escapeHtml(text: string): string {
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
}
