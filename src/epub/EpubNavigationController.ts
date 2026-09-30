/**
 * EPUB 正文容器与 iframe 的键盘/滚轮事件桥接，滚动模式按距离限幅并接续章节。
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

export function getEpubWheelDistance(event: Pick<WheelEvent, "deltaY" | "deltaMode">, viewportSize: number): number {
	if (!Number.isFinite(event.deltaY)) return 0;
	const unit = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? 80 : 1;
	const limit = Math.min(120, viewportSize / 4);
	return Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY * unit), limit);
}

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
	private sectionTransition: object | null = null;

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
		this.sectionTransition = null;
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
			if (wheelEvent.defaultPrevented || wheelEvent.ctrlKey || wheelEvent.metaKey
				|| wheelEvent.altKey || wheelEvent.shiftKey || isEditingTarget(wheelEvent.target)) return;
			if (this.host.getFlow() === "scrolled") this.handleScrolledWheel(wheelEvent);
			else this.host.onWheel(wheelEvent);
		};
		target.addEventListener("keydown", keydown, { capture: true });
		target.addEventListener("wheel", wheel, { capture: true, passive: false });
		return () => {
			target.removeEventListener("keydown", keydown, { capture: true });
			target.removeEventListener("wheel", wheel, { capture: true });
		};
	}

	private handleScrolledWheel(event: WheelEvent): void {
		const view = this.host.getView();
		const renderer = view?.renderer;
		if (!view || !renderer?.scrolled) return;
		const { containerPosition: position, size, viewSize } = renderer;
		if (typeof position !== "number" || !Number.isFinite(position)
			|| typeof size !== "number" || !Number.isFinite(size) || size <= 0
			|| typeof viewSize !== "number" || !Number.isFinite(viewSize) || viewSize <= 0) return;
		const distance = getEpubWheelDistance(event, size);
		if (!distance) return;
		event.preventDefault();
		event.stopPropagation();
		if (this.sectionTransition) return;
		this.host.onNavigate();
		const start = Math.abs(position);
		const end = Math.max(0, viewSize - size);
		const next = Math.max(0, Math.min(end, start + distance));
		// Chromium rounds scroll positions; a fractional tail must not trap the wheel at chapter end.
		const atBoundary = distance < 0 ? start <= 1 : end - start <= 1;
		if (!atBoundary) {
			// Foliate's public setter keeps scroll relocation/CFI tracking intact, without its page-turn lock.
			renderer.containerPosition = renderer.scrollProp === "scrollLeft" ? -next : next;
			return;
		}
		const action = distance < 0 ? view.prev : view.next;
		if (!action) return;
		const transition = {};
		this.sectionTransition = transition;
		void Promise.resolve().then(() => {
			if (this.sectionTransition === transition && this.host.getView() === view
				&& this.host.getFlow() === "scrolled") return action.call(view, Math.abs(distance));
		}).catch(error => {
			console.warn("yh-inklight: EPUB wheel chapter navigation failed", error);
		}).finally(() => {
			if (this.sectionTransition === transition) this.sectionTransition = null;
		});
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
