/**
 * EPUB foliate 布局属性控制器。
 * [PROTOCOL]: 只负责 renderer/host 的布局属性，不保存阅读状态。
 */

import { EpubFlowMode } from "../storage/types";
import { FoliateViewHandle } from "./EpubFoliateLoader";
import { ThemeColors } from "./EpubThemeManager";

export type EpubLayoutAttributes = Record<string, string>;

export function getEpubLayoutAttributes(flow: EpubFlowMode): EpubLayoutAttributes {
	return {
		flow,
		margin: flow === "paginated" ? "28px" : "0px",
		gap: "8%",
		"max-inline-size": "760px",
	};
}

export class EpubLayoutController {
	constructor(
		private readonly view: FoliateViewHandle,
		private flow: EpubFlowMode,
	) {}

	initialize(): void {
		(this.view as unknown as HTMLElement).classList.add("yh-epub-foliate-view");
		this.apply();
	}

	setFlow(flow: EpubFlowMode): void {
		this.flow = flow;
		this.apply();
	}

	apply(): void {
		const attrs = getEpubLayoutAttributes(this.flow);
		const host = this.view as unknown as HTMLElement;
		const renderer = this.view.renderer as unknown as HTMLElement | undefined;
		for (const [name, value] of Object.entries(attrs)) {
			host.setAttribute(name, value);
			renderer?.setAttribute?.(name, value);
		}
		this.view.renderer?.render?.();
	}

	applyAppearance(colors: ThemeColors, size: number, readerContainer: HTMLElement): void {
		const css = [
			":root { color-scheme: light dark; }",
			"body {",
			`  background-color: ${colors.background} !important;`,
			`  color: ${colors.textColor} !important;`,
			`  font-size: ${size}px !important;`,
			"  line-height: 1.72 !important;",
			"}",
			"p, div, span, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dt, dd {",
			`  color: ${colors.textColor} !important;`,
			"}",
			`a, a:link, a:visited { color: ${colors.linkColor} !important; }`,
			`::selection { background: ${colors.selectionBg} !important; }`,
			"img { max-width: 100% !important; height: auto !important; }",
		].join("\n");
		this.view.renderer?.setStyles?.(css);
		this.view.renderer?.render?.();
		(this.view as unknown as HTMLElement).style.backgroundColor = colors.background;
		readerContainer.style.backgroundColor = colors.background;
	}
}
