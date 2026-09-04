/**
 * [INPUT]: 依赖 storage/types 的 EpubReadingTheme 与 EPUB_READING_THEMES 领域约束
 * [OUTPUT]: 对外提供 EpubThemeManager，负责 EPUB 阅读器 6 种阅读主题的注册、应用与颜色解析
 * [POS]: epub 模块的主题真相源，被 EpubReader 等视图消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import {
	EpubReadingTheme,
	EPUB_READING_THEMES,
} from "../storage/types";

// ---- Obsidian CSS 变量名 ----

const OBSIDIAN_CSS_VARS = {
	background: "--background-primary",
	text: "--text-normal",
	link: "--link-color",
	selection: "--text-selection",
	accent: "--interactive-accent",
} as const;

// ---- 静态主题颜色定义 ----

export interface ThemeColors {
	background: string;
	textColor: string;
	linkColor: string;
	selectionBg: string;
	accent: string;
}

const STATIC_THEME_COLORS: Record<Exclude<EpubReadingTheme, "obsidian">, ThemeColors> = {
	white: {
		background: "#FFFFFF",
		textColor: "#333333",
		linkColor: "#7B2D8E",
		selectionBg: "rgba(0, 100, 200, 0.25)",
		accent: "#7B2D8E",
	},
	warm: {
		background: "#FAF9DE",
		textColor: "#333333",
		linkColor: "#8B6914",
		selectionBg: "rgba(139, 105, 20, 0.2)",
		accent: "#B8860B",
	},
	green: {
		background: "#E3EDCD",
		textColor: "#333333",
		linkColor: "#2E7D32",
		selectionBg: "rgba(46, 125, 50, 0.2)",
		accent: "#388E3C",
	},
	sepia: {
		background: "#F4ECD8",
		textColor: "#5C4B37",
		linkColor: "#8B4513",
		selectionBg: "rgba(139, 69, 19, 0.2)",
		accent: "#A0522D",
	},
	dark: {
		background: "#1C1C1E",
		textColor: "#A8A8A8",
		linkColor: "#9CA3AF",
		selectionBg: "rgba(100, 100, 120, 0.35)",
		accent: "#6B7280",
	},
};

// ---- 辅助函数 ----

function getCssVariable(name: string): string {
	return getComputedStyle(document.body).getPropertyValue(name).trim();
}

/**
 * 将任意 hex / rgb / CSS 值转换为可被 epub.js themes 注册使用的格式。
 * epub.js 的 `rendition.themes.register()` 接受标准 CSS 字符串。
 */
function toCssValue(raw: string): string {
	if (!raw) {
		return "";
	}
	return raw;
}

// ---- EpubThemeManager ----

export class EpubThemeManager {
	private fontFamily: string;

	constructor(fontFamily?: string) {
		this.fontFamily = fontFamily ?? "";
	}

	// ------ 公共 API ------

	/**
	 * 将所有 6 种主题注册到 epub.js rendition 的主题系统。
	 * 必须在 rendition 初始化后、首次 applyTheme 之前调用一次。
	 */
	registerThemes(rendition: any): void {
		for (const themeDef of EPUB_READING_THEMES) {
			const colors = this.resolveThemeColors(themeDef.id);
			const rules = this.buildCssRules(colors);

			rendition.themes.register(themeDef.id, rules);
		}
	}

	/**
	 * 将指定主题应用到 rendition，同时更新 iframe 外层容器的背景色。
	 */
	applyTheme(rendition: any, themeId: EpubReadingTheme): void {
		const colors = this.resolveThemeColors(themeId);

		rendition.themes.select(themeId);

		// 同步外层容器背景，避免 epub 翻页时出现白色闪烁
		const container = this.findRenditionContainer(rendition);
		if (container) {
			container.style.backgroundColor = colors.background;
		}

		// 对 obsidian 主题注册一个 MutationObserver，在 Obsidian 主题切换时自动同步
		if (themeId === "obsidian") {
			this.watchObsidianThemeChanges(rendition, container);
		}
	}

	/**
	 * 解析指定主题的完整颜色集。
	 * obsidian 主题从 CSS 变量实时读取；其余主题返回静态预设值。
	 */
	resolveThemeColors(themeId: EpubReadingTheme): ThemeColors {
		if (themeId === "obsidian") {
			return this.resolveObsidianColors();
		}

		return STATIC_THEME_COLORS[themeId];
	}

	// ------ 私有方法 ------

	private resolveObsidianColors(): ThemeColors {
		const background = toCssValue(getCssVariable(OBSIDIAN_CSS_VARS.background)) || "#ffffff";
		const textColor = toCssValue(getCssVariable(OBSIDIAN_CSS_VARS.text)) || "#333333";
		const linkColor = toCssValue(getCssVariable(OBSIDIAN_CSS_VARS.link)) || "#7B2D8E";
		const selectionRaw = toCssValue(getCssVariable(OBSIDIAN_CSS_VARS.selection)) || "rgba(0, 100, 200, 0.25)";
		const accent = toCssValue(getCssVariable(OBSIDIAN_CSS_VARS.accent)) || "#7B2D8E";

		return {
			background,
			textColor,
			linkColor,
			selectionBg: selectionRaw,
			accent,
		};
	}

	private buildCssRules(colors: ThemeColors): Record<string, string> {
		const rules: Record<string, string> = {
			"body": [
				`background-color: ${colors.background} !important`,
				`color: ${colors.textColor} !important`,
				this.fontFamily ? `font-family: "${this.fontFamily}", serif !important` : "",
			].filter(Boolean).join("; "),
			"p, div, span, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dt, dd": [
				`color: ${colors.textColor} !important`,
			].join("; "),
			"a, a:link, a:visited": [
				`color: ${colors.linkColor} !important`,
			].join("; "),
			"::selection": [
				`background: ${colors.selectionBg} !important`,
			].join("; "),
			"img": [
				"max-width: 100% !important",
				"height: auto !important",
			].join("; "),
		};

		return rules;
	}

	/**
	 * 尝试从 rendition 内部找到外层 iframe 容器元素。
	 * epub.js v0.3 的 rendition 对象结构: rendition.manager?.view?.element 或
	 * 直接从 rendition 的 DOM 容器取 iframe 父级。
	 */
	private findRenditionContainer(rendition: any): HTMLElement | null {
		// epub.js 通常将 rendition 绑定到一个 DOM element
		if (typeof rendition?.manager?.view?.container === "object") {
			const el = rendition.manager.view.container as HTMLElement;
			return el.parentElement ?? el;
		}

		// fallback: 通过 iframe 查找
		if (rendition?.manager?.views) {
			const firstView = rendition.manager.views()[0];
			if (firstView?.iframe?.parentElement) {
				return firstView.iframe.parentElement as HTMLElement;
			}
		}

		return null;
	}

	/**
	 * 监听 Obsidian 原生主题变化（亮/暗切换或 CSS snippet 变更），
	 * 自动刷新 epub rendition 的颜色。
	 */
	private watchObsidianThemeChanges(rendition: any, container: HTMLElement | null): void {
		const observer = new MutationObserver(() => {
			const colors = this.resolveObsidianColors();
			const rules = this.buildCssRules(colors);

			// 重新注册 obsidian 主题以刷新颜色
			rendition.themes.register("obsidian", rules);
			rendition.themes.select("obsidian");

			if (container) {
				container.style.backgroundColor = colors.background;
			}
		});

		observer.observe(document.body, {
			attributes: true,
			attributeFilter: ["class"],
		});

		// 在 rendition 销毁时自动断开
		if (typeof rendition.on === "function") {
			rendition.on("destroyed", () => {
				observer.disconnect();
			});
		}
	}
}
