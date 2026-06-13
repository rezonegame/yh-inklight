/**
 * [INPUT]: HTMLIFrameElement 原型、obsidian Platform
 * [OUTPUT]: installDesktopFoliateIframeSandboxPatch + installFoliateBlobIframePatch
 * [POS]: epub 模块 foliate 引擎基础设施，移植自 weave foliate-runtime-patches（简化 blob 读取依赖）
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 *
 * 作用：Obsidian 桌面端 CSP 下，foliate 的 blob iframe stylesheet 会被拦截。
 * 当前正式启用的补丁只处理 iframe.src = blob:URL：
 * - 读取 blob HTML
 * - 在 srcdoc 注入前内联 blob stylesheet
 * - 用 srcdoc 替代 blob src，绕过 style-src 限制
 *
 * ⚠️ 历史踩坑：不要启用 sandbox patch 移除 allow-scripts。foliate iframe 依赖脚本渲染，
 * 移除 allow-scripts 会造成 Modal/阅读区空白，且 prototype patch 需要重启 Obsidian 才能清掉。
 */

import { Platform } from "obsidian";

/** 判断 sandbox 属性是否来自 foliate 的 iframe，是则返回去除 allow-scripts 的新值。 */
function normalizeDesktopFoliateSandboxValue(
	attributeName: string,
	value: string,
	stack: string | null | undefined,
	iframeElement: Element | null | undefined,
): string | null {
	if (Platform.isMobile || attributeName.toLowerCase() !== "sandbox") {
		return null;
	}
	const normalizedValue = String(value || "").trim();
	if (!normalizedValue || !/allow-scripts/i.test(normalizedValue)) {
		return null;
	}
	const normalizedStack = String(stack || "").toLowerCase();
	const iframePart = String(iframeElement?.getAttribute("part") || "").toLowerCase();
	const shadowHostTagName = String(
		iframeElement?.getRootNode() instanceof ShadowRoot
			? (iframeElement.getRootNode() as ShadowRoot).host?.tagName
			: "",
	).toLowerCase();
	// esbuild bundle 后 stack 不含 node_modules/foliate-js 路径，主要靠 part/shadowHost 判断。
	const isFoliateDesktopFrame =
		normalizedStack.includes("foliate-js/paginator.js") ||
		normalizedStack.includes("foliate-js/fixed-layout.js") ||
		normalizedStack.includes("foliate") ||
		iframePart.split(/\s+/).includes("filter") ||
		shadowHostTagName === "foliate-view";
	if (!isFoliateDesktopFrame) {
		return null;
	}
	const seenTokens = new Set<string>();
	const filteredTokens = normalizedValue
		.split(/\s+/)
		.filter(Boolean)
		.filter((token) => {
			const normalizedToken = token.toLowerCase();
			if (normalizedToken === "allow-scripts" || seenTokens.has(normalizedToken)) {
				return false;
			}
			seenTokens.add(normalizedToken);
			return true;
		});
	return filteredTokens.join(" ");
}

let desktopFoliateIframeSandboxPatchInstalled = false;
let foliateBlobIframePatchInstalled = false;
let foliateBlobIframeLoadTokens = new WeakMap<HTMLIFrameElement, number>();

/** 拦截 iframe.setAttribute('sandbox', ...)：foliate iframe 移除 allow-scripts。 */
export function installDesktopFoliateIframeSandboxPatch(): void {
	if (desktopFoliateIframeSandboxPatchInstalled || typeof HTMLIFrameElement === "undefined") {
		return;
	}
	const setAttributeDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "setAttribute");
	const originalSetAttribute = setAttributeDescriptor?.value as
		| ((this: Element, qualifiedName: string, value: string) => void)
		| undefined;
	if (!originalSetAttribute) {
		desktopFoliateIframeSandboxPatchInstalled = true;
		return;
	}
	HTMLIFrameElement.prototype.setAttribute = function patchedSetAttribute(
		this: HTMLIFrameElement,
		name: string,
		value: string,
	): void {
		const patchedValue = normalizeDesktopFoliateSandboxValue(
			name,
			String(value || ""),
			new Error().stack,
			this,
		);
		Reflect.apply(originalSetAttribute, this, [name, patchedValue ?? value]);
	};
	desktopFoliateIframeSandboxPatchInstalled = true;
}

/** blob: URL 内容读取（浏览器 fetch 可直接读 blob:）。 */
async function readBlobUrlAsText(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText}`);
	}
	return response.text();
}

/**
 * 把 section HTML 里的 `<link rel="stylesheet" href="blob:">` 内联成 `<style>`。
 * 必须在 srcdoc 注入前完成——foliate 的 render 紧跟 iframe load，依赖 CSS 算分栏尺寸，
 * 若 CSS 被 CSP 拦截、又不在 render 前内联，会按 0 尺寸渲染导致空白。
 */
async function inlineBlobStylesheetsInHtml(html: string): Promise<string> {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
	await Promise.all(
		links.map(async (link) => {
			const href = link.getAttribute("href") || "";
			if (!href.startsWith("blob:")) {
				return;
			}
			try {
				const response = await fetch(href);
				const css = await response.text();
				const style = doc.createElement("style");
				style.textContent = css;
				link.replaceWith(style);
			} catch (error) {
				console.warn("yh-inklight: inline blob css failed", href, error);
			}
		}),
	);
	return doc.documentElement.outerHTML;
}

/**
 * 拦截 iframe.src setter：blob: URL 改读内容用 srcdoc 注入，绕过 CSP 对 blob stylesheet 的拦截。
 * 非 blob: 的 src 原样设置。
 */
export function installFoliateBlobIframePatch(onLoadError: (error: unknown) => void): void {
	if (foliateBlobIframePatchInstalled || typeof HTMLIFrameElement === "undefined") {
		return;
	}
	const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
	if (!srcDescriptor?.set) {
		foliateBlobIframePatchInstalled = true;
		return;
	}
	const getIframeSrc = (iframe: HTMLIFrameElement): string => {
		if (!srcDescriptor.get) {
			return iframe.getAttribute("src") || "";
		}
		return (srcDescriptor.get as (this: HTMLIFrameElement) => string).call(iframe);
	};
	const setIframeSrc = (iframe: HTMLIFrameElement, value: string): void => {
		if (!srcDescriptor.set) {
			return;
		}
		(srcDescriptor.set as (this: HTMLIFrameElement, value: string) => void).call(iframe, value);
	};
	Object.defineProperty(HTMLIFrameElement.prototype, "src", {
		configurable: true,
		enumerable: srcDescriptor.enumerable ?? true,
		get(this: HTMLIFrameElement): string {
			return getIframeSrc(this);
		},
		set(this: HTMLIFrameElement, value: string): void {
			const normalizedValue = String(value || "");
			if (!normalizedValue.startsWith("blob:")) {
				setIframeSrc(this, normalizedValue);
				return;
			}
			const loadToken = (foliateBlobIframeLoadTokens.get(this) || 0) + 1;
			foliateBlobIframeLoadTokens.set(this, loadToken);
			void readBlobUrlAsText(normalizedValue)
				.then((html) => inlineBlobStylesheetsInHtml(html))
				.then((inlined) => {
					if (foliateBlobIframeLoadTokens.get(this) !== loadToken) {
						return;
					}
					this.srcdoc = inlined;
				})
				.catch((error) => {
					try {
						setIframeSrc(this, normalizedValue);
					} catch {
						// 保留原始加载错误作为主信号。
					}
					onLoadError(error);
				});
		},
	});
	foliateBlobIframePatchInstalled = true;
}
