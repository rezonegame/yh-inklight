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
