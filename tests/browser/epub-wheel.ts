import { createFoliateView } from "../../src/epub/EpubFoliateLoader";
import { EpubLayoutController } from "../../src/epub/EpubLayoutController";
import { EpubNavigationController } from "../../src/epub/EpubNavigationController";
import type { EpubFlowMode } from "../../src/storage/types";

Object.assign(globalThis, { activeDocument: document });
const container = document.getElementById("reader")!;
const flow = document.getElementById("flow") as HTMLSelectElement;
const status = document.getElementById("status")!;
let section = 0;
let pageTurns = 0;

async function main() {
	const view = await createFoliateView(container);
	const layout = new EpubLayoutController(view, "scrolled");
	const navigation = new EpubNavigationController({
		getView: () => view,
		getFlow: () => flow.value as EpubFlowMode,
		onNavigate: () => undefined,
		onWheel: event => {
			event.preventDefault();
			pageTurns++;
			void (event.deltaY < 0 ? view.prev?.() : view.next?.());
		},
	});
	navigation.attachContainer(container);
	view.addEventListener("load", ((event: CustomEvent) => {
		section = event.detail.index;
		navigation.attachDocument(event.detail.doc);
	}) as EventListener);
	layout.initialize();
	const urls = [0, 1].map(index => URL.createObjectURL(new Blob([
		`<!doctype html><html><head><meta charset="utf-8"><style>body{font:20px/1.8 serif}p{margin:0 0 16px}</style></head><body><h1>Chapter ${index + 1}</h1>`
		+ Array.from({ length: 100 }, (_, n) => `<p>Paragraph ${n + 1}. This is a long reading fixture for checking continuous scrolling, wheel distances, chapter navigation and keyboard input without changing any real book or annotation.</p>`).join("")
		+ '<input aria-label="Book input"><p>End of chapter.</p></body></html>',
	], { type: "text/html" })));
	await view.open({
		sections: urls.map((url, index) => ({ id: `${index}`, size: 25000, load: () => url, unload() {} })),
		rendering: {}, rendition: {}, metadata: { title: "Wheel fixture" }, dir: "ltr",
	});
	layout.apply();
	await view.goTo(0);
	flow.addEventListener("change", () => layout.setFlow(flow.value as EpubFlowMode));
	const wheel = (deltaY: number, deltaMode = 0) => {
		view.renderer?.getContents?.()[0]?.doc?.body.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode, bubbles: true, cancelable: true }));
	};
	document.getElementById("small")!.onclick = () => wheel(24);
	document.getElementById("back")!.onclick = () => wheel(-24);
	document.getElementById("large")!.onclick = () => wheel(900);
	document.getElementById("page")!.onclick = () => wheel(1, 2);
	document.getElementById("burst")!.onclick = () => { for (let i = 0; i < 20; i++) wheel(2); };
	document.getElementById("edge")!.onclick = () => {
		const renderer = view.renderer!;
		renderer.containerPosition = renderer.viewSize! - renderer.size!;
	};
	const refresh = () => {
		const renderer = view.renderer;
		const doc = renderer?.getContents?.()[0]?.doc;
		const columnWidth = doc?.documentElement ? doc.defaultView?.getComputedStyle(doc.documentElement).columnWidth : undefined;
		status.textContent = JSON.stringify({ flow: flow.value, scrolled: renderer?.scrolled, section, position: renderer?.containerPosition, viewport: renderer?.size, extent: renderer?.viewSize, columnWidth, pageTurns });
		requestAnimationFrame(refresh);
	};
	refresh();
	window.addEventListener("pagehide", () => {
		navigation.dispose();
		view.close?.();
		for (const url of urls) URL.revokeObjectURL(url);
	}, { once: true });
}

void main().catch(error => { status.textContent = String(error); });
