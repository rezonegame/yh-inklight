/**
 * EPUB iframe 选区控制器。
 * [PROTOCOL]: 只向视图发送带 CFI 和视口坐标的选区快照，不创建批注。
 */

import { FoliateViewHandle } from "./EpubFoliateLoader";
import { normalizeCfi } from "./EpubChapterResolver";

export interface EpubSelectionSnapshot {
	doc: Document;
	range: Range;
	text: string;
	cfiRange: string;
	rect: DOMRect;
}

export interface EpubSelectionControllerHost {
	getFoliateView: () => FoliateViewHandle | null;
	getIframeForDocument: (doc: Document) => HTMLIFrameElement | null;
	onSelection: (snapshot: EpubSelectionSnapshot) => void;
}

const SELECTION_SYNC_RETRY_DELAY_MS = 120;

export class EpubSelectionController {
	private readonly cleanups = new Map<Document, () => void>();

	constructor(private readonly host: EpubSelectionControllerHost) {}

	attach(doc: Document, sectionIndex: number): void {
		if (this.cleanups.has(doc)) {
			return;
		}

		let pendingFrame = 0;
		let pendingRetry = 0;
		const scheduleEmit = () => {
			if (pendingFrame) {
				window.cancelAnimationFrame(pendingFrame);
			}
			pendingFrame = window.requestAnimationFrame(() => {
				pendingFrame = 0;
				if (!this.emit(doc, sectionIndex)) {
					if (pendingRetry) {
						window.clearTimeout(pendingRetry);
					}
					pendingRetry = window.setTimeout(() => {
						pendingRetry = 0;
						this.emit(doc, sectionIndex);
					}, SELECTION_SYNC_RETRY_DELAY_MS);
				}
			});
		};

		const eventOptions: AddEventListenerOptions = { capture: true };
		const win = doc.defaultView;
		for (const eventName of ["selectionchange", "mouseup", "pointerup", "touchend", "keyup", "contextmenu"]) {
			doc.addEventListener(eventName, scheduleEmit, eventOptions);
		}
		for (const eventName of ["mouseup", "pointerup", "touchend"]) {
			win?.addEventListener(eventName, scheduleEmit, eventOptions);
		}

		this.cleanups.set(doc, () => {
			if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
			if (pendingRetry) window.clearTimeout(pendingRetry);
			for (const eventName of ["selectionchange", "mouseup", "pointerup", "touchend", "keyup", "contextmenu"]) {
				doc.removeEventListener(eventName, scheduleEmit, true);
			}
			for (const eventName of ["mouseup", "pointerup", "touchend"]) {
				win?.removeEventListener(eventName, scheduleEmit, true);
			}
		});
	}

	dispose(): void {
		for (const cleanup of this.cleanups.values()) {
			cleanup();
		}
		this.cleanups.clear();
	}

	private emit(doc: Document, sectionIndex: number): boolean {
		const view = this.host.getFoliateView();
		const selection = doc.getSelection?.() ?? doc.defaultView?.getSelection?.();
		if (!view?.getCFI || !selection || selection.isCollapsed || selection.rangeCount === 0) {
			return false;
		}
		const range = selection.getRangeAt(0);
		const text = selection.toString().trim();
		if (!text) {
			return false;
		}
		let cfiRange = "";
		try {
			cfiRange = normalizeCfi(view.getCFI(sectionIndex, range.cloneRange()));
		} catch (error) {
			console.warn("yh-inklight: EPUB selection CFI failed", { sectionIndex, error });
		}
		if (!cfiRange) {
			return false;
		}

		const rect = this.createViewportRect(doc, range);
		if (!rect) {
			return false;
		}
		this.host.onSelection({ doc, range: range.cloneRange(), text, cfiRange, rect });
		return true;
	}

	private createViewportRect(doc: Document, range: Range): DOMRect | null {
		const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
		const rawRect = rects[rects.length - 1] ?? range.getBoundingClientRect();
		if (!rawRect || rawRect.width <= 0 || rawRect.height <= 0) {
			return null;
		}

		const frame = this.host.getIframeForDocument(doc);
		const frameRect = frame?.getBoundingClientRect();
		if (!frameRect) {
			return new DOMRect(rawRect.left, rawRect.top, rawRect.width, rawRect.height);
		}
		return new DOMRect(
			rawRect.left + frameRect.left,
			rawRect.top + frameRect.top,
			rawRect.width,
			rawRect.height,
		);
	}
}
