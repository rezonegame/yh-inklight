/**
 * EPUB foliate 布局属性控制器。
 * [PROTOCOL]: 只负责 renderer/host 的布局属性，不保存阅读状态。
 */

import { EpubFlowMode, EpubFontFamily, EpubTextAlign } from "../storage/types";
import { FoliateViewHandle } from "./EpubFoliateLoader";
import { ThemeColors } from "./EpubThemeManager";

export type EpubLayoutAttributes = Record<string, string>;

export function getEpubLayoutAttributes(flow: EpubFlowMode, contentWidth = 760): EpubLayoutAttributes {
	return {
		flow,
		margin: flow === "paginated" ? "28px" : "0px",
		gap: "8%",
		"max-inline-size": `${contentWidth}px`,
	};
}

export function escapeEpubFontFamilyCss(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\r/g, "\\A ")
		.replace(/\n/g, "\\A ");
}

export function getEpubFontFamilyCss(
	fontFamily: EpubFontFamily,
	customFontEnabled = false,
	customFontFamily = "",
): string {
	let preset = "";
	switch (fontFamily) {
		case "serif": preset = "Georgia, 'Noto Serif SC', 'Source Han Serif SC', serif"; break;
		case "sans": preset = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', sans-serif"; break;
		case "kaiti": preset = "'KaiTi', 'STKaiti', 'Noto Serif CJK SC', serif"; break;
		default: break;
	}
	if (!customFontEnabled || !customFontFamily) {
		return preset;
	}
	const custom = `"${escapeEpubFontFamilyCss(customFontFamily)}"`;
	return `${custom}, ${preset || "serif"}`;
}

export class EpubLayoutController {
	constructor(
		private readonly view: FoliateViewHandle,
		private flow: EpubFlowMode,
		private contentWidth = 760,
	) {}

	initialize(): void {
		(this.view as unknown as HTMLElement).classList.add("yh-epub-foliate-view");
		this.apply();
	}

	setFlow(flow: EpubFlowMode): void {
		this.setLayout(flow, this.contentWidth);
	}

	setContentWidth(contentWidth: number): void {
		this.setLayout(this.flow, contentWidth);
	}

	setLayout(flow: EpubFlowMode, contentWidth: number): void {
		this.flow = flow;
		this.contentWidth = contentWidth;
		this.apply();
	}

	apply(): void {
		const attrs = getEpubLayoutAttributes(this.flow, this.contentWidth);
		const host = this.view as unknown as HTMLElement;
		const renderer = this.view.renderer as unknown as HTMLElement | undefined;
		for (const [name, value] of Object.entries(attrs)) {
			host.setAttribute(name, value);
			renderer?.setAttribute?.(name, value);
		}
		this.view.renderer?.render?.();
	}

	applyAppearance(
		colors: ThemeColors,
		size: number,
		lineHeight: number,
		fontFamily: EpubFontFamily,
		customFontEnabled: boolean,
		customFontFamily: string,
		textAlign: EpubTextAlign,
		readerContainer: HTMLElement,
	): void {
		const fontFamilyCss = getEpubFontFamilyCss(fontFamily, customFontEnabled, customFontFamily);
		const customFontSelectors = "body, body p, body div, body span, body li, body h1, body h2, body h3, body h4, body h5, body h6, body blockquote, body td, body th, body dt, body dd";
		const css = [
			":root { color-scheme: light dark; }",
			"body {",
			`  background-color: ${colors.background} !important;`,
			`  color: ${colors.textColor} !important;`,
			`  font-size: ${size}px !important;`,
			`  line-height: ${lineHeight} !important;`,
			fontFamilyCss ? `  font-family: ${fontFamilyCss} !important;` : "",
			`  text-align: ${textAlign};`,
			"}",
			"p, div, span, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dt, dd {",
			`  color: ${colors.textColor} !important;`,
			"}",
			`a, a:link, a:visited { color: ${colors.linkColor} !important; }`,
			`::selection { background: ${colors.selectionBg} !important; }`,
			"img { max-width: 100% !important; height: auto !important; }",
			customFontEnabled && customFontFamily
				? `${customFontSelectors} { font-family: ${fontFamilyCss} !important; }\nbody pre, body pre *, body code, body code *, body kbd, body kbd *, body samp, body samp *, body math, body math *, body svg, body svg * { font-family: revert !important; }`
				: "",
		].join("\n");
		this.view.renderer?.setStyles?.(css);
		this.view.renderer?.render?.();
		(this.view as unknown as HTMLElement).style.backgroundColor = colors.background;
		readerContainer.style.backgroundColor = colors.background;
	}
}
