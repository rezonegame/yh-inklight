import { App, Notice, TFile } from "obsidian";

import { resolveTextAnchor } from "../anchor/textAnchor";
import { AnnotationStore, StoredAnnotationTarget } from "../storage/annotationStore";
import { EpubCfiAnchor, PdfAnchor, TextAnchor } from "../storage/types";
import { AnnotationLinkParams, createAnnotationUri } from "./annotationLink";

export interface AnnotationLinkNavigator {
  openMarkdown(file: TFile, anchor: TextAnchor, annotationId: string): Promise<boolean>;
  openPdf(file: TFile, anchor: PdfAnchor): Promise<boolean>;
  openEpub(file: TFile, anchor: EpubCfiAnchor, annotationId: string): Promise<boolean>;
}

export class AnnotationLinkService {
  constructor(
    private readonly app: App,
    private readonly store: AnnotationStore,
    private readonly navigator: AnnotationLinkNavigator,
  ) {}

  createUri(filePath: string, annotationId: string): string {
    return createAnnotationUri(filePath, annotationId);
  }

  async open(params: AnnotationLinkParams): Promise<boolean> {
    if (!params.file || !params.id) {
      new Notice("墨光批注链接无效");
      return false;
    }

    let target = await this.store.findAnnotationTarget(params.file, params.id);
    if (!target) {
      const candidates = await this.store.findAnnotationTargets(params.id);
      if (candidates.length === 1) {
        target = candidates[0];
      } else if (candidates.length > 1) {
        new Notice("找到多个同 ID 批注，已停止跳转以保护数据");
        return false;
      }
    }

    if (!target) {
      const file = this.app.vault.getAbstractFileByPath(params.file);
      if (file instanceof TFile) {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        this.app.workspace.revealLeaf(leaf);
        new Notice("批注已删除或尚未同步");
      } else {
        new Notice("找不到批注来源文件");
      }
      return false;
    }

    return this.openTarget(target);
  }

  async openLegacyEpub(filePath: string, cfi: string): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      new Notice("找不到对应电子书文件");
      return false;
    }
    return this.navigator.openEpub(file, { cfiRange: cfi, selectedText: "", chapter: "" }, "");
  }

  private async openTarget(target: StoredAnnotationTarget): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(target.filePath);
    if (!(file instanceof TFile)) {
      new Notice("找不到批注来源文件");
      return false;
    }

    if (target.mode === "md") {
      const source = await this.app.vault.cachedRead(file);
      const resolved = resolveTextAnchor(source, target.anchor as TextAnchor);
      if (resolved.orphaned) {
        new Notice("原文已变化，无法可靠定位该批注");
        return false;
      }
      return this.navigator.openMarkdown(file, resolved.anchor, target.id);
    }
    if (target.mode === "pdf") {
      return this.navigator.openPdf(file, target.anchor as PdfAnchor);
    }
    return this.navigator.openEpub(file, target.anchor as EpubCfiAnchor, target.id);
  }
}
