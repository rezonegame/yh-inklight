/**
 * [INPUT]: 依赖 AnnotationStore 的 sidecar 读写、EpubReadingProgress 类型和 normalizeCfi/normalizePercent 工具
 * [OUTPUT]: 提供 EpubProgressManager，管理 EPUB 阅读进度保存和阅读时间追踪
 * [POS]: EPUB 进度持久化的唯一入口
 */

import { Notice, TFile } from "obsidian";
import { AnnotationStore } from "../storage/annotationStore";
import { AnnotationPluginSettings, EpubReadingProgress } from "../storage/types";
import { normalizeCfi, normalizePercent } from "./EpubChapterResolver";

export class EpubProgressManager {
  private store: AnnotationStore;
  private settings: AnnotationPluginSettings;

  private persistedReadingSeconds = 0;
  private unsavedReadingSeconds = 0;
  private readingSessionStart: number | null = null;
  private readingTimeTrackingActive = false;
  private currentFile: TFile | null = null;

  private onVisibilityChange: (() => void) | null = null;
  private onWindowBlur: (() => void) | null = null;
  private onWindowFocus: (() => void) | null = null;
  private readingTimePeriodicTimer: ReturnType<typeof setInterval> | null = null;

  constructor(store: AnnotationStore, settings: AnnotationPluginSettings) {
    this.store = store;
    this.settings = settings;
  }

  updateSettings(settings: AnnotationPluginSettings): void {
    this.settings = settings;
  }

  /** 保存阅读进度 */
  async saveProgress(file: TFile, cfi: string, chapter: string, percent: number): Promise<void> {
    const cfiStr = normalizeCfi(cfi);
    if (!cfiStr) {
      return;
    }

    const normalizedPercent = normalizePercent(percent);
    const existing = await this.store.getEpubProgress(file);

    const estimatedRemaining = this.estimateRemaining(normalizedPercent, existing?.readingTimeSeconds ?? 0);

    const entry: EpubReadingProgress = {
      cfi: cfiStr,
      chapter,
      percent: normalizedPercent,
      lastRead: new Date().toISOString(),
      readingTimeSeconds: existing?.readingTimeSeconds ?? 0,
      estimatedRemainingMinutes: estimatedRemaining,
    };

    try {
      await this.store.saveEpubProgress(file, entry);
    } catch (err) {
      console.error("book-note: epub progress save failed", err);
    }
  }

  /** 获取进度 */
  async getProgress(file: TFile): Promise<EpubReadingProgress | null> {
    return this.store.getEpubProgress(file);
  }

  /** 开始阅读时间追踪 */
  beginTracking(file: TFile): void {
    const existing = this.store.getCachedDocument(file.path)?.epubProgress;
    this.persistedReadingSeconds = existing?.readingTimeSeconds ?? 0;
    this.unsavedReadingSeconds = 0;
    this.readingSessionStart = null;
    this.currentFile = file;
    this.setupTracking();
    this.startTimer();
  }

  /** 暂停追踪 */
  pauseTracking(): void {
    if (this.readingSessionStart == null) {
      return;
    }
    const elapsed = Math.floor((Date.now() - this.readingSessionStart) / 1000);
    if (elapsed > 0) {
      this.unsavedReadingSeconds += elapsed;
    }
    this.readingSessionStart = null;
  }

  /** Flush 阅读时间到存储 */
  async flushReadingTime(resumeAfter = false): Promise<void> {
    if (!this.currentFile) {
      return;
    }
    const wasTracking = this.readingSessionStart != null;
    this.pauseTracking();
    if (this.unsavedReadingSeconds <= 0) {
      if (resumeAfter && wasTracking && this.canTrack()) {
        this.startTimer();
      }
      return;
    }

    const total = this.persistedReadingSeconds + this.unsavedReadingSeconds;
    const unsaved = this.unsavedReadingSeconds;
    this.unsavedReadingSeconds = 0;

    try {
      const existing = await this.store.getEpubProgress(this.currentFile);
      const cfi = existing?.cfi ?? "";
      const chapter = existing?.chapter ?? "";
      const percent = existing?.percent ?? 0;

      await this.store.saveEpubProgress(this.currentFile, {
        cfi,
        chapter,
        percent,
        lastRead: existing?.lastRead ?? new Date().toISOString(),
        readingTimeSeconds: total,
        estimatedRemainingMinutes: this.estimateRemaining(percent, total),
      });
      this.persistedReadingSeconds = total;
    } catch (err) {
      this.unsavedReadingSeconds = unsaved;
      console.error("book-note: epub reading time flush failed", err);
    }

    if (resumeAfter && this.canTrack()) {
      this.startTimer();
    }
  }

  /** 获取累计阅读秒数 */
  getTotalReadingSeconds(): number {
    return this.persistedReadingSeconds + this.unsavedReadingSeconds;
  }

  /** 停止并清理追踪 */
  teardownTracking(): void {
    if (this.readingTimePeriodicTimer) {
      clearInterval(this.readingTimePeriodicTimer);
      this.readingTimePeriodicTimer = null;
    }
    if (this.onVisibilityChange) {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.onVisibilityChange = null;
    }
    if (this.onWindowBlur) {
      window.removeEventListener("blur", this.onWindowBlur);
      this.onWindowBlur = null;
    }
    if (this.onWindowFocus) {
      window.removeEventListener("focus", this.onWindowFocus);
      this.onWindowFocus = null;
    }
    this.readingTimeTrackingActive = false;
    this.readingSessionStart = null;
    this.unsavedReadingSeconds = 0;
    this.persistedReadingSeconds = 0;
    this.currentFile = null;
  }

  private setupTracking(): void {
    if (this.readingTimeTrackingActive) {
      return;
    }
    this.readingTimeTrackingActive = true;

    this.onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void this.flushReadingTime(false);
      } else if (this.canTrack()) {
        this.startTimer();
      }
    };

    this.onWindowBlur = () => {
      void this.flushReadingTime(false);
    };

    this.onWindowFocus = () => {
      if (this.canTrack()) {
        this.startTimer();
      }
    };

    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("blur", this.onWindowBlur);
    window.addEventListener("focus", this.onWindowFocus);

    this.readingTimePeriodicTimer = setInterval(() => {
      void this.flushReadingTime(true);
    }, 60_000);
  }

  private startTimer(): void {
    if (!this.canTrack()) {
      return;
    }
    if (this.readingSessionStart != null) {
      return;
    }
    this.readingSessionStart = Date.now();
  }

  private canTrack(): boolean {
    return (
      !!this.currentFile &&
      document.visibilityState === "visible" &&
      document.hasFocus()
    );
  }

  /** 估算剩余阅读时间（分钟） */
  private estimateRemaining(percent: number, totalSeconds: number): number | undefined {
    if (percent <= 0 || percent >= 1 || totalSeconds <= 0) {
      return undefined;
    }
    const estimatedTotalSeconds = totalSeconds / percent;
    const remainingSeconds = estimatedTotalSeconds * (1 - percent);
    return Math.ceil(remainingSeconds / 60);
  }
}
