import { App, Notice, TFile } from "obsidian";
import { t } from "../i18n";

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
      new Notice(t("notice.invalidLink"));
      return false;
    }

    let target = await this.store.findAnnotationTarget(params.file, params.id);
    if (!target) {
      const candidates = await this.store.findAnnotationTargets(params.id);
      if (candidates.length === 1) {
        target = candidates[0];
      } else if (candidates.length > 1) {
        new Notice(t("notice.multipleSameId"));
        return false;
      }
    }

    if (!target) {
      const file = this.app.vault.getAbstractFileByPath(params.file);
      if (file instanceof TFile) {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        this.app.workspace.revealLeaf(leaf);
        new Notice(t("notice.annotationGone"));
      } else {
        new Notice(t("notice.sourceFileMissing"));
      }
      return false;
    }

    return this.openTarget(target);
  }

  async openLegacyEpub(filePath: string, cfi: string): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      new Notice(t("notice.epubSourceMissing"));
      return false;
    }
    return this.navigator.openEpub(file, { cfiRange: cfi, selectedText: "", chapter: "" }, "");
  }

  private async openTarget(target: StoredAnnotationTarget): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(target.filePath);
    if (!(file instanceof TFile)) {
      new Notice(t("notice.sourceFileMissing"));
      return false;
    }

    if (target.mode === "md") {
      const source = await this.app.vault.cachedRead(file);
      const resolved = resolveTextAnchor(source, target.anchor as TextAnchor);
      if (resolved.orphaned) {
        new Notice(t("notice.originalChanged"));
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
