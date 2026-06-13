/**
 * [INPUT]: 依赖 Obsidian vault API、storage/types 的 EPUB 标注类型、AnnotationStore 读取 sidecar
 * [OUTPUT]: 对外提供 EpubExcerptExporter，将 EPUB 标注导出为 Markdown 摘录文件
 * [POS]: epub 模块的摘录导出入口，Phase 4-B P1「摘录导出」核心
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 *
 * 导出格式（与 EpubGotoHandler 约定一致，参考 ob-epub AnnotationVaultStore.buildBlock）：
 *   ---
 *   title: 《书名》摘录
 *   source: path/to/book.epub
 *   ---
 *
 *   > [!inklight-epub|yellow] 章节 · 2026-06-13 14:30 ^epub-<id>
 *   > 选中的原文
 *   >
 *   > 💡 想法内容（仅 comment 标注）
 *   >
 *   > [回到原文](#^epub-<id>)
 *
 *   <!-- yh-epub-cfi: epubcfi(...) -->
 *   ---
 *
 * 回链机制：EpubGotoHandler 拦截「回到原文」点击 → 找附近 CFI 注释 → 从文件名推断 epub → openAtCfi。
 */

import { App, Notice, TFile, TFolder, normalizePath } from "obsidian";

import {
	AnnotationColor,
	COLOR_LABELS,
	EpubCommentAnnotation,
	EpubHighlightAnnotation,
	FileAnnotationDocument,
} from "../storage/types";
import { AnnotationStore } from "../storage/annotationStore";

export interface EpubExcerptExporterOptions {
	app: App;
	store: AnnotationStore;
	/** 摘录导出目录（vault 相对路径），默认 epub-excerpts */
	excerptFolder: string;
	/** 是否生成回链（兑现 epubBacklinkRendering） */
	backlinkRendering: boolean;
	/** 默认作者 */
	defaultAuthor: string;
}

/** 高亮颜色 → Obsidian callout 元数据色名（1-6） */
const COLOR_TO_CALLOUT_META: Record<AnnotationColor, string> = {
	yellow: "yellow",
	green: "green",
	blue: "blue",
	pink: "pink",
	orange: "orange",
	purple: "purple",
};

export class EpubExcerptExporter {
	constructor(private readonly options: EpubExcerptExporterOptions) {}

	/**
	 * 导出指定 EPUB 文件的所有标注为 Markdown 摘录。
	 * 文件路径：`${excerptFolder}/《书名》摘录.md`。
	 *
	 * @param file - EPUB 源文件
	 * @returns 导出的文件路径，无标注时返回 null
	 */
	async exportToFile(file: TFile): Promise<TFile | null> {
		const document = await this.options.store.getDocument(file);
		const highlights = document.epubHighlights;
		const comments = document.epubComments;

		if (highlights.length === 0 && comments.length === 0) {
			new Notice("该书暂无标注，无需导出。");
			return null;
		}

		const markdown = this.buildMarkdown(file, document);
		const targetPath = await this.resolveExportPath(file);
		await this.ensureFolder(targetPath);

		const existing = this.options.app.vault.getAbstractFileByPath(targetPath);
		if (existing instanceof TFile) {
			await this.options.app.vault.modify(existing, markdown);
			new Notice(`摘录已更新：${targetPath}`);
			return existing;
		}
		const created = await this.options.app.vault.create(targetPath, markdown);
		new Notice(`摘录已导出：${targetPath}`);
		return created;
	}

	/** 构建完整的 Markdown 摘录文本。 */
	private buildMarkdown(file: TFile, document: FileAnnotationDocument): string {
		const title = file.basename;
		const now = new Date();
		const parts: string[] = [];

		parts.push("---");
		parts.push(`title: 《${title}》摘录`);
		parts.push(`source: ${file.path}`);
		parts.push(`exportedAt: ${now.toISOString()}`);
		parts.push(`highlights: ${document.epubHighlights.length}`);
		parts.push(`notes: ${document.epubComments.length}`);
		parts.push("---");
		parts.push("");
		parts.push(`# 《${title}》摘录`);
		parts.push("");

		// 合并并按创建时间倒序（最新的在前）
		const entries = this.collectEntries(document);
		for (const entry of entries) {
			parts.push(this.buildEntryBlock(entry));
			parts.push("");
		}

		if (entries.length === 0) {
			parts.push("（暂无标注）");
			parts.push("");
		}

		return parts.join("\n");
	}

	private collectEntries(document: FileAnnotationDocument): ExcerptEntry[] {
		const highlights: ExcerptEntry[] = document.epubHighlights.map((h) => ({
			id: h.id,
			kind: "highlight",
			color: h.color,
			selectedText: h.anchor.selectedText,
			chapter: h.anchor.chapter,
			cfiRange: h.anchor.cfiRange,
			note: "",
			createdAt: h.createdAt,
		}));
		const comments: ExcerptEntry[] = document.epubComments.map((c) => ({
			id: c.id,
			kind: "comment",
			color: c.color,
			selectedText: c.anchor.selectedText,
			chapter: c.anchor.chapter,
			cfiRange: c.anchor.cfiRange,
			note: c.note,
			createdAt: c.createdAt,
		}));
		return [...highlights, ...comments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	/** 构建单条标注的 callout 块（含 CFI 注释 + 回链）。 */
	private buildEntryBlock(entry: ExcerptEntry): string {
		const blockId = `epub-${entry.id}`;
		const colorMeta = COLOR_TO_CALLOUT_META[entry.color] ?? "yellow";
		const dateLabel = this.formatDate(new Date(entry.createdAt));
		const chapterLabel = entry.chapter?.trim() || "未分类章节";
		const header = `> [!inklight-epub|${colorMeta}] ${chapterLabel} · ${dateLabel} ^${blockId}`;

		const lines: string[] = [header];
		for (const line of entry.selectedText.split(/\r?\n/)) {
			lines.push(`> ${line}`);
		}

		if (entry.kind === "comment" && entry.note.trim()) {
			lines.push(">");
			for (const line of entry.note.split(/\r?\n/)) {
				lines.push(`> 💡 ${line}`);
			}
		}

		if (this.options.backlinkRendering) {
			lines.push(">");
			lines.push(`> [回到原文](#^${blockId})`);
		}

		// CFI 嵌入 callout 内隐藏 span, EpubGotoHandler 据此定位
		const cfiLine = `> <span style="display:none" data-yh-cfi="${entry.cfiRange}"></span>`;

		return `${lines.join("\n")}\n${cfiLine}\n\n---`;
	}

	/** 解析导出目标路径：`${excerptFolder}/《书名》摘录.md`。 */
	private async resolveExportPath(file: TFile): Promise<string> {
		const folder = this.options.excerptFolder.trim() || "epub-excerpts";
		const safeTitle = file.basename.replace(/[\\/:*?"<>|]/g, "_");
		return normalizePath(`${folder}/《${safeTitle}》摘录.md`);
	}

	/** 确保导出目录存在。 */
	private async ensureFolder(filePath: string): Promise<void> {
		const folderPath = filePath.split("/").slice(0, -1).join("/");
		if (!folderPath) {
			return;
		}
		const existing = this.options.app.vault.getAbstractFileByPath(folderPath);
		if (existing instanceof TFolder) {
			return;
		}
		await this.options.app.vault.createFolder(folderPath).catch(() => {
			/* 目录可能已被并发创建 */
		});
	}

	private formatDate(date: Date): string {
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}
}

interface ExcerptEntry {
	id: string;
	kind: "highlight" | "comment";
	color: AnnotationColor;
	selectedText: string;
	chapter: string;
	cfiRange: string;
	note: string;
	createdAt: string;
}
