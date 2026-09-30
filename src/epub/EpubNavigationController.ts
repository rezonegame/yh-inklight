/**
 * EPUB 正文容器与 iframe 的键盘/滚轮事件桥接。
 * [PROTOCOL]: 仅处理正文导航；编辑控件、组合键及选区快捷键保持原行为，卸载时释放监听。
 */

import type { EpubFlowMode } from "../storage/types";
import type { FoliateViewHandle } from "./EpubFoliateLoader";

interface NavigationHost {
	getView: () => FoliateViewHandle | null;
	getFlow: () => EpubFlowMode;
	onNavigate: () => void;
	onWheel: (event: WheelEvent) => void;
}

const ARROW_SCROLL_DISTANCE = 80;

function isEditingTarget(target: EventTarget | null): boolean {
	const element = target as HTMLElement | null;
	if (typeof element?.closest !== "function") return false;
	return element.isContentEditable || Boolean(element.closest(
		"input, textarea, select, button, [role='textbox'], [role='combobox'], [role='slider']",
	));
}

export class EpubNavigationController {
	private containerCleanup: (() => void) | null = null;
	private readonly documentCleanups = new Map<Document, () => void>();

	constructor(private readonly host: NavigationHost) {}

	attachContainer(container: HTMLElement): void {
		this.containerCleanup?.();
		container.tabIndex = 0;
		this.containerCleanup = this.listen(container);
	}

	attachDocument(doc: Document): void {
		if (this.documentCleanups.has(doc)) return;
		const removeListeners = this.listen(doc);
		const cleanup = () => {
			removeListeners();
			doc.defaultView?.removeEventListener("pagehide", cleanup);
			this.documentCleanups.delete(doc);
		};
		doc.defaultView?.addEventListener("pagehide", cleanup, { once: true });
		this.documentCleanups.set(doc, cleanup);
	}

	disposeDocuments(): void {
		for (const cleanup of this.documentCleanups.values()) cleanup();
		this.documentCleanups.clear();
	}

	dispose(): void {
		this.disposeDocuments();
		this.containerCleanup?.();
		this.containerCleanup = null;
	}

	private listen(target: EventTarget): () => void {
		const keydown = (event: Event) => this.handleKeydown(event as KeyboardEvent);
		const wheel = (event: Event) => {
			const wheelEvent = event as WheelEvent;
			if (!wheelEvent.defaultPrevented && !wheelEvent.ctrlKey && !wheelEvent.metaKey
				&& !isEditingTarget(wheelEvent.target)) this.host.onWheel(wheelEvent);
		};
		target.addEventListener("keydown", keydown, { capture: true });
		target.addEventListener("wheel", wheel, { capture: true, passive: false });
		return () => {
			target.removeEventListener("keydown", keydown, { capture: true });
			target.removeEventListener("wheel", wheel, { capture: true });
		};
	}

	private handleKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey
			|| event.altKey || event.shiftKey || isEditingTarget(event.target)) return;
		const view = this.host.getView();
		if (!view) return;
		const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp";
		const forwards = event.key === "ArrowRight" || event.key === "ArrowDown";
		if (!backwards && !forwards) return;
		const action = backwards ? view.prev ?? view.goLeft : view.next ?? view.goRight;
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		this.host.onNavigate();
		const distance = this.host.getFlow() === "scrolled" ? ARROW_SCROLL_DISTANCE : undefined;
		void Promise.resolve().then(() => action.call(view, distance)).catch((error) => {
			console.warn("yh-inklight: EPUB keyboard navigation failed", error);
		});
	}
}
