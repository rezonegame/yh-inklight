/**
 * EPUB 书内搜索的纯逻辑与侧栏控制器。
 * [PROTOCOL]: 搜索结果只作为导航投影，不写入 sidecar。
 */

import { FoliateViewHandle } from "./EpubFoliateLoader";

export interface EpubSearchResult {
	cfi: string;
	excerpt: string;
	label?: string;
}

export interface EpubSearchContent {
	doc?: Document | null;
}

export interface EpubSearchControllerHost {
	getFoliateView: () => FoliateViewHandle | null;
	getSearchContents: () => EpubSearchContent[];
	onNavigate: (cfi: string) => void;
}

export function normalizeEpubSearchResult(raw: unknown, label = ""): EpubSearchResult | null {
	if (!raw || typeof raw !== "object") {
		return null;
	}

	const item = raw as Record<string, unknown>;
	const cfi = typeof item.cfi === "string"
		? item.cfi
		: typeof item.value === "string" ? item.value : "";
	const excerptValue = item.excerpt;
	let excerpt = "";
	if (typeof excerptValue === "string") {
		excerpt = excerptValue;
	} else if (excerptValue && typeof excerptValue === "object") {
		const parts = excerptValue as Record<string, unknown>;
		excerpt = [parts.pre, parts.match, parts.post]
			.filter((part): part is string => typeof part === "string")
			.join("");
	} else if (typeof item.text === "string") {
		excerpt = item.text;
	}

	if (!cfi && !excerpt) {
		return null;
	}

	return {
		cfi,
		excerpt,
		label: label || (typeof item.label === "string" ? item.label : undefined),
	};
}

export function normalizeEpubSearchResults(raw: unknown, label = ""): EpubSearchResult[] {
	if (Array.isArray(raw)) {
		return raw.flatMap((item) => normalizeEpubSearchResults(item, label));
	}

	if (!raw || typeof raw !== "object") {
		return [];
	}

	const item = raw as Record<string, unknown>;
	const itemLabel = typeof item.label === "string" ? item.label : label;
	if (Array.isArray(item.subitems)) {
		return item.subitems.flatMap((subitem) => normalizeEpubSearchResults(subitem, itemLabel));
	}
	if (Array.isArray(item.results)) {
		return item.results.flatMap((result) => normalizeEpubSearchResults(result, itemLabel));
	}

	const result = normalizeEpubSearchResult(raw, itemLabel);
	return result ? [result] : [];
}

export function isEpubSearchTokenCurrent(token: number, currentToken: number): boolean {
	return token === currentToken;
}

export class EpubSearchController {
	private inputEl: HTMLInputElement | null = null;
	private resultsEl: HTMLElement | null = null;
	private searchTimer: number | null = null;
	private searchToken = 0;
	private disposed = false;

	constructor(
		private readonly containerEl: HTMLElement,
		private readonly host: EpubSearchControllerHost,
	) {}

	render(initialQuery = ""): void {
		this.containerEl.empty();
		const box = this.containerEl.createDiv({ cls: "yh-epub-search-box" });
		this.inputEl = box.createEl("input", {
			cls: "yh-epub-search-input",
			attr: { type: "text", placeholder: "搜索全文…" },
		}) as HTMLInputElement;
		this.inputEl.value = initialQuery;
		this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
			event.stopPropagation();
			if (event.key === "Enter") {
				void this.search();
			}
		}, { capture: true });
		this.resultsEl = box.createDiv({ cls: "yh-epub-search-results" });
		this.inputEl.addEventListener("input", () => this.scheduleSearch(), { passive: true });
	}

	focus(): void {
		this.inputEl?.focus();
		this.inputEl?.select();
	}

	dispose(): void {
		this.disposed = true;
		this.searchToken += 1;
		if (this.searchTimer !== null) {
			window.clearTimeout(this.searchTimer);
			this.searchTimer = null;
		}
		this.inputEl = null;
		this.resultsEl = null;
	}

	private scheduleSearch(): void {
		if (this.searchTimer !== null) {
			window.clearTimeout(this.searchTimer);
		}
		this.searchTimer = window.setTimeout(() => {
			this.searchTimer = null;
			void this.search();
		}, 300);
	}

	private async search(): Promise<void> {
		const input = this.inputEl;
		const resultsEl = this.resultsEl;
		const view = this.host.getFoliateView();
		if (!input || !resultsEl || !view || this.disposed) {
			return;
		}

		const query = input.value.trim().toLowerCase();
		const token = ++this.searchToken;
		resultsEl.empty();
		if (query.length < 2) {
			return;
		}

		let results = await this.searchWithFoliate(view, query, token, resultsEl);
		if (!isEpubSearchTokenCurrent(token, this.searchToken) || this.disposed) {
			return;
		}
		if (results.length === 0) {
			results = this.searchVisibleContents(query);
		}
		if (!isEpubSearchTokenCurrent(token, this.searchToken) || this.disposed) {
			return;
		}

		if (results.length === 0) {
			resultsEl.createDiv({ cls: "yh-epub-search-empty", text: "未找到匹配" });
			return;
		}

		let currentLabel = "";
		for (const result of results.slice(0, 100)) {
			if (result.label && result.label !== currentLabel) {
				currentLabel = result.label;
				resultsEl.createDiv({ cls: "yh-epub-search-chapter", text: currentLabel });
			}
			const item = resultsEl.createEl("button", {
				cls: "yh-epub-search-result",
				attr: { type: "button" },
			});
			item.createSpan({ cls: "yh-epub-search-text", text: result.excerpt.slice(0, 160) });
			if (result.cfi) {
				item.addEventListener("click", () => this.host.onNavigate(result.cfi));
			}
		}
	}

	private async searchWithFoliate(
		view: FoliateViewHandle,
		query: string,
		token: number,
		resultsEl: HTMLElement,
	): Promise<EpubSearchResult[]> {
		const searcher = (view as unknown as { search?: (query: unknown) => unknown }).search;
		if (typeof searcher !== "function") {
			return [];
		}

		for (const argument of [query, { query }]) {
			try {
				const results = await this.consumeSearchResult(searcher.call(view, argument), token, resultsEl);
				if (results.length > 0 || !isEpubSearchTokenCurrent(token, this.searchToken)) {
					return results;
				}
			} catch (error) {
				console.warn("yh-inklight: EPUB search failed", error);
			}
		}
		return [];
	}

	private async consumeSearchResult(raw: unknown, token: number, resultsEl: HTMLElement): Promise<EpubSearchResult[]> {
		const resolved = await raw;
		if (resolved && typeof (resolved as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
			const results: EpubSearchResult[] = [];
			const progressEl = resultsEl.createDiv({ cls: "yh-epub-search-progress", text: "搜索中…" });
			try {
				for await (const item of resolved as AsyncIterable<unknown>) {
					if (!isEpubSearchTokenCurrent(token, this.searchToken) || this.disposed) {
						return [];
					}
					if (item === "done") {
						break;
					}
					if (item && typeof item === "object" && typeof (item as Record<string, unknown>).progress === "number") {
						progressEl.textContent = `搜索中 ${Math.round(Number((item as Record<string, unknown>).progress) * 100)}%`;
						continue;
					}
					results.push(...normalizeEpubSearchResults(item));
					if (results.length >= 100) {
						break;
					}
				}
				return results;
			} finally {
				progressEl.remove();
			}
		}

		return normalizeEpubSearchResults(resolved);
	}

	private searchVisibleContents(query: string): EpubSearchResult[] {
		const results: EpubSearchResult[] = [];
		for (const content of this.host.getSearchContents()) {
			if (!content.doc?.body) {
				continue;
			}
			const text = content.doc.body.textContent || "";
			const lower = text.toLowerCase();
			let index = lower.indexOf(query);
			while (index >= 0 && results.length < 50) {
				const start = Math.max(0, index - 40);
				const end = Math.min(text.length, index + query.length + 60);
				let excerpt = text.slice(start, end).replace(/\n/g, " ");
				if (start > 0) excerpt = `…${excerpt}`;
				if (end < text.length) excerpt = `${excerpt}…`;
				results.push({ cfi: "", excerpt });
				index = lower.indexOf(query, index + query.length);
			}
			if (results.length > 0) {
				break;
			}
		}
		return results;
	}
}
