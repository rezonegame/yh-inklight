/**
 * [INPUT]: sidecar 文档的旧快照、本地修改结果与磁盘最新快照
 * [OUTPUT]: 保留并发新增、按稳定 ID 合并修改的安全文档
 * [POS]: storage 纯逻辑层，不依赖 Obsidian runtime
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { FileAnnotationDocument } from "./types";

const ARRAY_FIELDS = [
  "highlights",
  "comments",
  "pdfHighlights",
  "pdfComments",
  "epubHighlights",
  "epubComments",
  "bookmarks",
  "canvasNodes",
] as const;

type WithId = { id: string };

/**
 * Merge one updater result onto the document that was actually on disk.
 * The updater result is treated as a set of explicit local operations when
 * compared with base, so unrelated records written by another device survive.
 */
export function mergeAnnotationDocuments(
  base: FileAnnotationDocument,
  intended: FileAnnotationDocument,
  disk: FileAnnotationDocument,
): FileAnnotationDocument {
  const merged = cloneDocument(disk);

  for (const field of ARRAY_FIELDS) {
    merged[field] = mergeIdArray(
      base[field] as WithId[],
      intended[field] as WithId[],
      disk[field] as WithId[],
    ) as never;
  }

  merged.filePath = intended.filePath || disk.filePath || base.filePath;
  merged.fileHash = intended.fileHash !== base.fileHash ? intended.fileHash : disk.fileHash || intended.fileHash;
  merged.lastModified = latestTimestamp(intended.lastModified, disk.lastModified, base.lastModified);

  if (!documentsEqual(intended.epubProgress, base.epubProgress)) {
    merged.epubProgress = latestProgress(intended.epubProgress, disk.epubProgress);
  } else {
    merged.epubProgress = disk.epubProgress;
  }

  if (!documentsEqual(intended.pdfProgress, base.pdfProgress)) {
    merged.pdfProgress = latestProgress(intended.pdfProgress, disk.pdfProgress);
  } else {
    merged.pdfProgress = disk.pdfProgress;
  }

  if (!documentsEqual(intended.canvasBinding, base.canvasBinding)) {
    merged.canvasBinding = intended.canvasBinding;
  } else {
    merged.canvasBinding = disk.canvasBinding;
  }

  return merged;
}

function mergeIdArray<T extends WithId>(base: T[], intended: T[], disk: T[]): T[] {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const intendedById = new Map(intended.map((item) => [item.id, item]));
  const diskById = new Map(disk.map((item) => [item.id, item]));
  const localRemoved = new Set<string>();
  const localChanged = new Map<string, T>();

  for (const [id] of baseById) {
    if (!intendedById.has(id)) {
      localRemoved.add(id);
    }
  }

  for (const [id, item] of intendedById) {
    const baseItem = baseById.get(id);
    if (!baseItem || !documentsEqual(item, baseItem)) {
      localChanged.set(id, item);
    }
  }

  const result = new Map(diskById);
  for (const id of localRemoved) {
    result.delete(id);
  }
  for (const [id, item] of localChanged) {
    result.set(id, item);
  }

  const orderedIds: string[] = [];
  for (const item of intended) {
    if (!orderedIds.includes(item.id) && result.has(item.id)) {
      orderedIds.push(item.id);
    }
  }
  for (const item of disk) {
    if (!orderedIds.includes(item.id) && result.has(item.id)) {
      orderedIds.push(item.id);
    }
  }

  return orderedIds.map((id) => result.get(id)!);
}

function latestProgress<T extends { lastRead?: string }>(intended: T | undefined, disk: T | undefined): T | undefined {
  if (!intended) return disk;
  if (!disk) return intended;
  return timestampValue(intended.lastRead) >= timestampValue(disk.lastRead) ? intended : disk;
}

function latestTimestamp(...values: Array<string | undefined>): string {
  return values.reduce<string>((latest, value) => {
    if (!value) return latest;
    return timestampValue(value) >= timestampValue(latest) ? value! : latest;
  }, "");
}

function timestampValue(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function documentsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneDocument(document: FileAnnotationDocument): FileAnnotationDocument {
  return JSON.parse(JSON.stringify(document)) as FileAnnotationDocument;
}
