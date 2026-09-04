/**
 * [INPUT]: 依赖 Obsidian 插件设置与 sidecar JSON 存储协议的领域约束
 * [OUTPUT]: 对外提供 Markdown/PDF 注释、高亮、标签、响应式阅读设置、索引与存储文档类型
 * [POS]: storage 模块的类型真相源，被 editor、views、anchor、settings 和 store 共享
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { AnnotationTagDefinition, cloneDefaultAnnotationTags } from "../tags/tagDomain";

export type { AnnotationTagDefinition } from "../tags/tagDomain";

export const ANNOTATION_COLORS = [
  "yellow",
  "green",
  "blue",
  "pink",
  "orange",
  "purple",
] as const;

export const COLOR_LABELS: Record<AnnotationColor, string> = {
  yellow: "黄色",
  green: "绿色",
  blue: "蓝色",
  pink: "粉色",
  orange: "橙色",
  purple: "紫色",
};

export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];
export type AnnotationSortMode = "newest" | "oldest" | "document";
export type AnnotationExportFormat = "summary" | "by-color" | "notes-only" | "reading-notes";

export interface TextAnchor {
  startOffset: number;
  endOffset: number;
  selectedText: string;
  prefix: string;
  suffix: string;
  isCode?: boolean;
}

export interface LocatedAnchor {
  anchor: TextAnchor;
  orphaned: boolean;
  confidence: number;
}

export interface HighlightAnnotation {
  id: string;
  color: AnnotationColor;
  anchor: TextAnchor;
  createdAt: string;
  orphaned?: boolean;
}

export interface PdfRectAnchor {
  pageNumber: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** PDF textLayer offsets used when geometry alone is no longer reliable. */
export interface PdfTextRange {
  beginIndex: number;
  beginOffset: number;
  endIndex: number;
  endOffset: number;
}

export interface PdfAnchor {
  pageNumber: number;
  selectedText: string;
  rects: PdfRectAnchor[];
  textRange?: PdfTextRange;
}

export interface PdfHighlightAnnotation {
  id: string;
  color: AnnotationColor;
  anchor: PdfAnchor;
  createdAt: string;
  orphaned?: boolean;
}

export interface ReplyAnnotation {
  id: string;
  content: string;
  createdAt: string;
}

export interface StickyPosition {
  offsetX: number;
  offsetY: number;
}

export interface CommentAnnotation {
  id: string;
  highlightId?: string;
  anchor: TextAnchor;
  title?: string;
  tagId?: string;
  tagLabelSnapshot?: string;
  content: string;
  color: AnnotationColor;
  position: StickyPosition;
  collapsed: boolean;
  author: string;
  createdAt: string;
  updatedAt: string;
  replies: ReplyAnnotation[];
  resolved: boolean;
  orphaned?: boolean;
}

export interface PdfCommentAnnotation {
  id: string;
  highlightId?: string;
  anchor: PdfAnchor;
  title?: string;
  tagId?: string;
  tagLabelSnapshot?: string;
  content: string;
  color: AnnotationColor;
  position: StickyPosition;
  collapsed: boolean;
  author: string;
  createdAt: string;
  updatedAt: string;
  replies: ReplyAnnotation[];
  resolved: boolean;
  orphaned?: boolean;
}

export interface FileAnnotationDocument {
  filePath: string;
  fileHash: string;
  lastModified: string;
  highlights: HighlightAnnotation[];
  comments: CommentAnnotation[];
  pdfHighlights: PdfHighlightAnnotation[];
  pdfComments: PdfCommentAnnotation[];
  epubHighlights: EpubHighlightAnnotation[];
  epubComments: EpubCommentAnnotation[];
  epubProgress?: EpubReadingProgress;
  pdfProgress?: PdfReadingProgress;
  /** @deprecated Read-only legacy data kept for existing sidecars. */
  bookmarks: ReadingBookmark[];
  /** @deprecated Read-only legacy data kept for existing sidecars. */
  canvasBinding?: CanvasBinding;
  /** @deprecated Read-only legacy data kept for existing sidecars. */
  canvasNodes: CanvasExcerptNode[];
}

export interface AnnotationIndexEntry {
  filePath: string;
  sidecarPath: string;
  fileHash: string;
  highlightCount: number;
  commentCount: number;
  epubHighlightCount: number;
  epubCommentCount: number;
  bookmarkCount: number;
  updatedAt: string;
}

export interface AnnotationIndex {
  version: number;
  files: Record<string, AnnotationIndexEntry>;
}

// ===== EPUB 阅读排版 =====

export type EpubReadingTheme = "obsidian" | "white" | "warm" | "green" | "sepia" | "dark";
export type EpubFlowMode = "paginated" | "scrolled";
export type EpubFontFamily = "publisher" | "serif" | "sans" | "kaiti";
export type EpubTextAlign = "start" | "justify";

export interface EpubReadingProfile {
  fontFamily: EpubFontFamily;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  textAlign: EpubTextAlign;
  flow: EpubFlowMode;
  theme: EpubReadingTheme;
}

export const DEFAULT_EPUB_READING_PROFILE: EpubReadingProfile = {
  fontFamily: "publisher",
  fontSize: 16,
  lineHeight: 1.7,
  contentWidth: 760,
  textAlign: "start",
  flow: "scrolled",
  theme: "obsidian",
};

function clampNumber(value: unknown, fallback: number, min: number, max: number, step?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, value));
  return step ? Math.round(clamped / step) * step : clamped;
}

export function createEpubReadingProfileFromLegacy(settings: Partial<Pick<AnnotationPluginSettings, "epubDefaultFlow" | "epubFontSize" | "epubReadingTheme">>): EpubReadingProfile {
  return {
    ...DEFAULT_EPUB_READING_PROFILE,
    fontSize: clampNumber(settings.epubFontSize, DEFAULT_EPUB_READING_PROFILE.fontSize, 12, 28, 1),
    flow: settings.epubDefaultFlow === "paginated" || settings.epubDefaultFlow === "scrolled"
      ? settings.epubDefaultFlow
      : DEFAULT_EPUB_READING_PROFILE.flow,
    theme: isEpubReadingTheme(settings.epubReadingTheme)
      ? settings.epubReadingTheme
      : DEFAULT_EPUB_READING_PROFILE.theme,
  };
}

export function normalizeEpubReadingProfile(raw: unknown, fallback = DEFAULT_EPUB_READING_PROFILE): EpubReadingProfile {
  const value = raw && typeof raw === "object" ? raw as Partial<EpubReadingProfile> : {};
  return {
    fontFamily: isEpubFontFamily(value.fontFamily) ? value.fontFamily : fallback.fontFamily,
    fontSize: clampNumber(value.fontSize, fallback.fontSize, 12, 28, 1),
    lineHeight: clampNumber(value.lineHeight, fallback.lineHeight, 1.4, 2.2, 0.1),
    contentWidth: clampNumber(value.contentWidth, fallback.contentWidth, 520, 1000, 10),
    textAlign: value.textAlign === "justify" ? "justify" : value.textAlign === "start" ? "start" : fallback.textAlign,
    flow: value.flow === "paginated" || value.flow === "scrolled" ? value.flow : fallback.flow,
    theme: isEpubReadingTheme(value.theme) ? value.theme : fallback.theme,
  };
}

function isEpubFontFamily(value: unknown): value is EpubFontFamily {
  return value === "publisher" || value === "serif" || value === "sans" || value === "kaiti";
}

function isEpubReadingTheme(value: unknown): value is EpubReadingTheme {
  return value === "obsidian" || value === "white" || value === "warm" || value === "green" || value === "sepia" || value === "dark";
}

export interface AnnotationPluginSettings {
  defaultHighlightColor: AnnotationColor;
  defaultAuthor: string;
  migrateOnRename: boolean;
  annotationTags: AnnotationTagDefinition[];
  // --- EPUB 阅读 ---
  epubDefaultFlow: EpubFlowMode;
  epubFontSize: number;
  epubReadingTheme: EpubReadingTheme;
  epubHighlightStyle: EpubHighlightStyle;
  /** 0.21.0 unified EPUB layout profile; old fields remain for downgrade compatibility. */
  epubReadingProfile?: EpubReadingProfile;
  // --- PDF 增强 ---
  pdfProgressTracking: boolean;
}

export interface SelectionSnapshot {
  filePath: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
}

export const DEFAULT_SETTINGS: AnnotationPluginSettings = {
  defaultHighlightColor: "yellow",
  defaultAuthor: "读者",
  migrateOnRename: true,
  annotationTags: cloneDefaultAnnotationTags(),
  // EPUB
  epubDefaultFlow: "scrolled",
  epubFontSize: 16,
  epubReadingTheme: "obsidian",
  epubHighlightStyle: "fill",
  epubReadingProfile: DEFAULT_EPUB_READING_PROFILE,
  // PDF 增强
  pdfProgressTracking: true,
};

export const EMPTY_INDEX: AnnotationIndex = {
  version: 1,
  files: {},
};

// ===== EPUB / 电子书锚点与标注 =====

export interface EpubCfiAnchor {
  cfiRange: string;
  chapter: string;
  selectedText: string;
}

export type EpubHighlightStyle = "fill" | "underline" | "wavy";

export interface EpubHighlightAnnotation {
  id: string;
  type: "epub-highlight";
  color: AnnotationColor;
  style: EpubHighlightStyle;
  anchor: EpubCfiAnchor;
  createdAt: string;
  orphaned?: boolean;
}

export interface EpubCommentAnnotation {
  id: string;
  type: "epub-comment";
  color: AnnotationColor;
  style: EpubHighlightStyle;
  anchor: EpubCfiAnchor;
  note: string;
  noteType?: "insight" | "question" | "reminder";
  tagId?: string;
  tagLabelSnapshot?: string;
  createdAt: string;
  collapsed: boolean;
  author: string;
  updatedAt: string;
  replies: ReplyAnnotation[];
  resolved: boolean;
  orphaned?: boolean;
}

export interface EpubReadingProgress {
  cfi: string;
  chapter: string;
  percent: number;
  lastRead: string;
  readingTimeSeconds: number;
  estimatedRemainingMinutes?: number;
}

// ===== PDF 进度 =====

export interface PdfReadingProgress {
  pageNumber: number;
  totalPages: number;
  percent: number;
  lastRead: string;
}

// ===== 旧版书签兼容字段（EPUB/PDF 通用）=====

export interface ReadingBookmark {
  id: string;
  type: "epub-bookmark" | "pdf-bookmark";
  label: string;
  position: string;
  chapter?: string;
  createdAt: string;
  color?: AnnotationColor;
}

// ===== Canvas 集成 =====

export interface CanvasBinding {
  bookPath: string;
  canvasPath: string;
  autoCreate: boolean;
  layoutDirection: "horizontal" | "vertical";
}

export interface CanvasExcerptNode {
  annotationId: string;
  nodeId: string;
  position: { x: number; y: number };
}

export const EPUB_READING_THEMES: { id: EpubReadingTheme; label: string; background: string; text: string; swatch: string }[] = [
  { id: "obsidian", label: "跟随 Obsidian", background: "", text: "", swatch: "linear-gradient(135deg, #ffffff 50%, #1e1e1e 50%)" },
  { id: "white", label: "默认白", background: "#FFFFFF", text: "#333333", swatch: "#FFFFFF" },
  { id: "warm", label: "暖光", background: "#FAF9DE", text: "#333333", swatch: "#FAF9DE" },
  { id: "green", label: "护眼绿", background: "#E3EDCD", text: "#333333", swatch: "#E3EDCD" },
  { id: "sepia", label: "羊皮纸", background: "#F4ECD8", text: "#5C4B37", swatch: "#F4ECD8" },
  { id: "dark", label: "夜间", background: "#1C1C1E", text: "#A8A8A8", swatch: "#1C1C1E" },
];

export const EPUB_HIGHLIGHT_STYLES: { id: EpubHighlightStyle; label: string }[] = [
  { id: "fill", label: "填充" },
  { id: "underline", label: "下划线" },
  { id: "wavy", label: "波浪线" },
];

export const EPUB_COLOR_MAP: Record<AnnotationColor, string> = {
  yellow: "rgba(245, 197, 24, 0.38)",
  green: "rgba(82, 196, 26, 0.38)",
  blue: "rgba(22, 119, 255, 0.38)",
  pink: "rgba(255, 105, 180, 0.38)",
  orange: "rgba(255, 140, 0, 0.38)",
  purple: "rgba(114, 46, 209, 0.38)",
};

export const SUPPORTED_BOOK_EXTENSIONS = ["epub", "mobi", "azw3", "fb2", "fbz", "cbz", "txt"] as const;
export type BookFileExtension = (typeof SUPPORTED_BOOK_EXTENSIONS)[number];
