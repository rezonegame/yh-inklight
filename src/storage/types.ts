/**
 * [INPUT]: 依赖 Obsidian 插件设置与 sidecar JSON 存储协议的领域约束
 * [OUTPUT]: 对外提供 Markdown/PDF 注释、高亮、锚点、响应式阅读设置、索引与存储文档类型
 * [POS]: storage 模块的类型真相源，被 editor、views、anchor、settings 和 store 共享
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

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
export type SidebarSide = "left" | "right";
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

export interface PdfAnchor {
  pageNumber: number;
  selectedText: string;
  rects: PdfRectAnchor[];
  createdScale: number;
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
}

export interface AnnotationIndexEntry {
  filePath: string;
  sidecarPath: string;
  fileHash: string;
  highlightCount: number;
  commentCount: number;
  updatedAt: string;
}

export interface AnnotationIndex {
  version: number;
  files: Record<string, AnnotationIndexEntry>;
}

export interface AnnotationPluginSettings {
  defaultHighlightColor: AnnotationColor;
  stickyWidth: number;
  stickySide: SidebarSide;
  stickyCollapseWidth: number;
  showLeaderLines: boolean;
  defaultAuthor: string;
  migrateOnRename: boolean;
  stickyNotesVisible: boolean;
}

export interface SelectionSnapshot {
  filePath: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
}

export interface AnnotationStoreSnapshot {
  version: number;
  documents: Map<string, FileAnnotationDocument>;
}

export const DEFAULT_SETTINGS: AnnotationPluginSettings = {
  defaultHighlightColor: "yellow",
  stickyWidth: 280,
  stickySide: "right",
  stickyCollapseWidth: 800,
  showLeaderLines: true,
  defaultAuthor: "读者",
  migrateOnRename: true,
  stickyNotesVisible: true,
};

export const EMPTY_INDEX: AnnotationIndex = {
  version: 1,
  files: {},
};
