import type { EpubReadingProgress, PdfReadingProgress } from "../storage/types";

export type ReadingStatus = "unstarted" | "reading" | "finished" | "untracked";

export interface ReadingLibraryItem {
  path: string;
  basename: string;
  extension: string;
  kind: "ebook" | "pdf";
  parentPath: string;
  progress: number | null;
  status: ReadingStatus;
  lastRead: string | null;
  readingTimeSeconds: number | null;
  estimatedRemainingMinutes: number | null;
}

export type LibraryStatusFilter = ReadingStatus | "all" | "recent";
export type LibrarySort = "recent" | "title" | "progress";

export interface ReadingLibraryQuery {
  search: string;
  status: LibraryStatusFilter;
  format: string;
  parentPath: string | null;
  sort: LibrarySort;
}

export const DEFAULT_READING_LIBRARY_QUERY: ReadingLibraryQuery = {
  search: "",
  status: "all",
  format: "all",
  parentPath: null,
  sort: "recent",
};

export function queryReadingLibrary(items: readonly ReadingLibraryItem[], query: ReadingLibraryQuery): ReadingLibraryItem[] {
  const search = query.search.trim().toLocaleLowerCase();
  const filtered = items.filter((item) =>
    (!search || item.basename.toLocaleLowerCase().includes(search) || item.path.toLocaleLowerCase().includes(search))
    && (query.status === "all" || query.status === "recent" || item.status === query.status)
    && (query.format === "all" || item.extension.toLowerCase() === query.format)
    && (query.parentPath === null || item.parentPath === query.parentPath)
    && (query.status !== "recent" || !!item.lastRead));

  if (query.status === "recent") {
    return filtered.sort((a, b) => compareLastRead(b, a) || a.path.localeCompare(b.path)).slice(0, 20);
  }
  return filtered.sort((a, b) => {
    if (query.sort === "title") {
      return a.basename.localeCompare(b.basename) || a.path.localeCompare(b.path);
    }
    if (query.sort === "progress") {
      return compareNullableDescending(a.progress, b.progress) || a.path.localeCompare(b.path);
    }
    return compareLastRead(b, a) || a.path.localeCompare(b.path);
  });
}

function compareLastRead(a: ReadingLibraryItem, b: ReadingLibraryItem): number {
  return (a.lastRead ?? "").localeCompare(b.lastRead ?? "");
}

function compareNullableDescending(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
}

export function createReadingLibraryItem(
  file: { path: string; basename: string; extension: string; parentPath: string },
  epubProgress: EpubReadingProgress | undefined,
  pdfProgress: PdfReadingProgress | undefined,
  pdfProgressTracking: boolean,
): ReadingLibraryItem {
  const kind = file.extension.toLowerCase() === "pdf" ? "pdf" : "ebook";
  const tracked = kind === "ebook" || pdfProgressTracking;
  const saved = kind === "pdf" ? pdfProgress : epubProgress;
  const rawProgress = saved?.percent;
  const progress = tracked && typeof rawProgress === "number" && Number.isFinite(rawProgress)
    ? Math.max(0, Math.min(1, rawProgress))
    : null;
  const status: ReadingStatus = !tracked ? "untracked" : progress === null || progress === 0
    ? "unstarted" : progress >= 0.99 ? "finished" : "reading";
  return {
    ...file,
    kind,
    progress,
    status,
    lastRead: tracked && saved?.lastRead ? saved.lastRead : null,
    readingTimeSeconds: kind === "ebook" && epubProgress && Number.isFinite(epubProgress.readingTimeSeconds)
      ? Math.max(0, epubProgress.readingTimeSeconds) : null,
    estimatedRemainingMinutes: kind === "ebook" && epubProgress?.estimatedRemainingMinutes != null
      && Number.isFinite(epubProgress.estimatedRemainingMinutes)
      ? Math.max(0, epubProgress.estimatedRemainingMinutes) : null,
  };
}
