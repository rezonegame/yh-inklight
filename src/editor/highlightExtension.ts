/**
 * [INPUT]: 依赖 CodeMirror Decoration API、obsidian editorInfoField、storage/types 的注释文档
 * [OUTPUT]: 对外提供 createHighlightExtension，在编辑器中渲染非侵入式高亮
 * [POS]: editor 模块的 CM6 高亮投影层，只画视觉效果不修改 doc
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { editorInfoField } from "obsidian";

import { FileAnnotationDocument } from "../storage/types";
import { highlightBackground } from "./highlightColors";

interface HighlightExtensionOptions {
  getDocument: (filePath: string) => FileAnnotationDocument | null;
  getVersion: () => number;
  rememberSelection: (filePath: string, startOffset: number, endOffset: number, text: string) => void;
}

export function createHighlightExtension(options: HighlightExtensionOptions) {
  return ViewPlugin.fromClass(
    class HighlightPlugin {
      decorations: DecorationSet;
      private version = -1;

      constructor(private readonly view: EditorView) {
        this.decorations = this.buildDecorations();
        this.version = options.getVersion();
        this.captureSelection();
      }

      update(update: ViewUpdate): void {
        const nextVersion = options.getVersion();
        if (update.docChanged || update.viewportChanged || update.selectionSet || this.version !== nextVersion) {
          this.version = nextVersion;
          this.decorations = this.buildDecorations();
        }

        if (update.selectionSet) {
          this.captureSelection();
        }
      }

      private buildDecorations(): DecorationSet {
        const filePath = this.filePath();
        if (!filePath) {
          return Decoration.none;
        }

        const document = options.getDocument(filePath);
        if (!document) {
          return Decoration.none;
        }

        const builder = new RangeSetBuilder<Decoration>();
        const docLength = this.view.state.doc.length;
        const marks = [
          ...document.highlights.map((highlight) => ({
            id: highlight.id,
            color: highlight.color,
            anchor: highlight.anchor,
            orphaned: highlight.orphaned,
          })),
          ...document.comments.map((comment) => ({
            id: comment.id,
            color: comment.color,
            anchor: comment.anchor,
            orphaned: comment.orphaned,
          })),
        ].sort((a, b) => a.anchor.startOffset - b.anchor.startOffset);

        for (const mark of marks) {
          if (mark.orphaned) {
            continue;
          }

          const from = Math.max(0, Math.min(mark.anchor.startOffset, docLength));
          const to = Math.max(from, Math.min(mark.anchor.endOffset, docLength));
          if (from === to) {
            continue;
          }

          builder.add(
            from,
            to,
            Decoration.mark({
              class: `yh-highlight yh-highlight--${mark.color}`,
              attributes: {
                "data-yh-color": mark.color,
                "data-yh-id": mark.id,
                style: `background-color: ${highlightBackground(mark.color)} !important;`,
              },
            }),
          );
        }

        return builder.finish();
      }

      private captureSelection(): void {
        const filePath = this.filePath();
        if (!filePath) {
          return;
        }

        const selection = this.view.state.selection.main;
        if (selection.empty) {
          return;
        }

        options.rememberSelection(
          filePath,
          selection.from,
          selection.to,
          this.view.state.sliceDoc(selection.from, selection.to),
        );
      }

      private filePath(): string | null {
        return this.view.state.field(editorInfoField).file?.path ?? null;
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}
