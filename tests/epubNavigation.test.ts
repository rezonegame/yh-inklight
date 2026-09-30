import assert from "node:assert/strict";
import test from "node:test";

import { EpubNavigationController, getEpubWheelDistance } from "../src/epub/EpubNavigationController";
import type { FoliateViewHandle } from "../src/epub/EpubFoliateLoader";
import type { EpubFlowMode } from "../src/storage/types";

class BookTarget extends EventTarget {
	tabIndex = -1;
	defaultView = new EventTarget();
	isContentEditable = false;
	control = false;
	closest(): object | null { return this.control ? {} : null; }
}

function key(target: EventTarget, value: string, modifiers: Record<string, boolean> = {}): Event {
	const event = new Event("keydown", { cancelable: true });
	Object.assign(event, { key: value, ...modifiers });
	target.dispatchEvent(event);
	return event;
}

function setup() {
	let flow: EpubFlowMode = "paginated";
	const calls: Array<{ direction: string; distance?: number }> = [];
	let wheels = 0;
	const view = {
		prev(distance?: number) { assert.equal(this, view); calls.push({ direction: "prev", distance }); },
		next(distance?: number) { assert.equal(this, view); calls.push({ direction: "next", distance }); },
	} as unknown as FoliateViewHandle;
	const controller = new EpubNavigationController({
		getView: () => view,
		getFlow: () => flow,
		onNavigate: () => undefined,
		onWheel: () => { wheels++; },
	});
	return { controller, view, calls, setFlow: (value: EpubFlowMode) => { flow = value; }, getWheels: () => wheels };
}

function wheel(target: EventTarget, deltaY: number, deltaMode = 0, modifiers: Record<string, boolean> = {}): Event {
	const event = new Event("wheel", { cancelable: true });
	Object.assign(event, { deltaY, deltaMode, ...modifiers });
	target.dispatchEvent(event);
	return event;
}

test("wheel distances preserve touchpad pixels and bound line/page inputs below a screen", () => {
	assert.equal(getEpubWheelDistance({ deltaY: 0.25, deltaMode: 0 }, 600), 0.25);
	assert.equal(getEpubWheelDistance({ deltaY: 3, deltaMode: 1 }, 600), 72);
	assert.equal(getEpubWheelDistance({ deltaY: -1, deltaMode: 2 }, 600), -80);
	assert.equal(getEpubWheelDistance({ deltaY: 900, deltaMode: 0 }, 600), 120);
	assert.equal(getEpubWheelDistance({ deltaY: 900, deltaMode: 0 }, 200), 50);
	assert.equal(getEpubWheelDistance({ deltaY: NaN, deltaMode: 0 }, 600), 0);
});

test("scrolled iframe wheels move by distance without page turns or duplicate native scrolling", () => {
	const { controller, view, calls, setFlow, getWheels } = setup();
	setFlow("scrolled");
	view.renderer = { scrolled: true, scrollProp: "scrollTop", size: 600, viewSize: 3000, containerPosition: 500 };
	const doc = new BookTarget();
	controller.attachDocument(doc as unknown as Document);
	assert.equal(wheel(doc, 900).defaultPrevented, true);
	assert.equal(view.renderer.containerPosition, 620);
	wheel(doc, -3, 1);
	assert.equal(view.renderer.containerPosition, 548);
	for (let i = 0; i < 20; i++) wheel(doc, 0.25);
	assert.equal(view.renderer.containerPosition, 553);
	assert.equal(calls.length, 0);
	assert.equal(getWheels(), 0);
	controller.dispose();
});

test("scrolled wheel handles vertical writing and delegates only chapter edges to Foliate", async () => {
	const { controller, view, calls, setFlow } = setup();
	setFlow("scrolled");
	view.renderer = { scrolled: true, scrollProp: "scrollLeft", size: 600, viewSize: 3000, containerPosition: -100 };
	const doc = new BookTarget();
	controller.attachDocument(doc as unknown as Document);
	wheel(doc, 40);
	assert.equal(view.renderer.containerPosition, -140);
	view.renderer.containerPosition = -2400;
	wheel(doc, 100);
	wheel(doc, 100);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(calls, [{ direction: "next", distance: 100 }]);
	view.renderer.containerPosition = 0;
	wheel(doc, -60);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(calls[1], { direction: "prev", distance: 60 });
	controller.dispose();
});

test("modified/control wheels remain native and unsupported renderers do not swallow input", () => {
	const { controller, view, calls, setFlow } = setup();
	setFlow("scrolled");
	view.renderer = { scrolled: true, size: 600, viewSize: 3000, containerPosition: 500 };
	const doc = new BookTarget();
	controller.attachDocument(doc as unknown as Document);
	for (const modifier of ["shiftKey", "ctrlKey", "metaKey", "altKey"]) {
		assert.equal(wheel(doc, 50, 0, { [modifier]: true }).defaultPrevented, false);
	}
	doc.control = true;
	assert.equal(wheel(doc, 50).defaultPrevented, false);
	doc.control = false;
	assert.equal(wheel(doc, 0).defaultPrevented, false);
	view.renderer.viewSize = 0;
	assert.equal(wheel(doc, 50).defaultPrevented, false);
	view.renderer.viewSize = 3000;
	view.renderer.scrolled = false;
	assert.equal(wheel(doc, 50).defaultPrevented, false);
	view.renderer = { scrolled: true };
	assert.equal(wheel(doc, 50).defaultPrevented, false);
	assert.equal(calls.length, 0);
	controller.dispose();
});

test("queued chapter turns are cancelled when the book is unloaded or mode changes", async () => {
	const { controller, view, calls, setFlow } = setup();
	setFlow("scrolled");
	view.renderer = { scrolled: true, size: 600, viewSize: 3000, containerPosition: 2400 };
	const doc = new BookTarget();
	controller.attachDocument(doc as unknown as Document);
	wheel(doc, 100);
	controller.disposeDocuments();
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(calls.length, 0);
	controller.attachDocument(doc as unknown as Document);
	wheel(doc, 100);
	setFlow("paginated");
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(calls.length, 0);
	controller.dispose();
});

test("a rounded fractional chapter tail still allows the next chapter", async () => {
	const { controller, view, calls, setFlow } = setup();
	setFlow("scrolled");
	view.renderer = { scrolled: true, size: 580, viewSize: 12613.59375, containerPosition: 12033.5 };
	const doc = new BookTarget();
	controller.attachDocument(doc as unknown as Document);
	wheel(doc, 24);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(calls, [{ direction: "next", distance: 24 }]);
	controller.dispose();
});

test("arrows navigate inside an iframe document using the current reading flow", async () => {
	const { controller, calls, setFlow } = setup();
	const doc = new BookTarget();
	controller.attachDocument(doc as unknown as Document);
	for (const value of ["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]) {
		assert.equal(key(doc, value).defaultPrevented, true);
	}
	await Promise.resolve();
	assert.deepEqual(calls.map(call => call.direction), ["prev", "prev", "next", "next"]);
	assert.ok(calls.every(call => call.distance === undefined));
	setFlow("scrolled");
	key(doc, "ArrowUp");
	key(doc, "ArrowRight");
	await Promise.resolve();
	assert.deepEqual(calls.slice(-2), [{ direction: "prev", distance: 80 }, { direction: "next", distance: 80 }]);
	controller.dispose();
});

test("editing controls, composition and modified arrows keep their native behavior", async () => {
	const { controller, calls } = setup();
	const doc = new BookTarget();
	controller.attachDocument(doc as unknown as Document);
	for (const modifier of ["shiftKey", "ctrlKey", "metaKey", "altKey", "isComposing"]) {
		assert.equal(key(doc, "ArrowDown", { [modifier]: true }).defaultPrevented, false);
	}
	doc.control = true;
	assert.equal(key(doc, "ArrowDown").defaultPrevented, false);
	doc.control = false;
	doc.isContentEditable = true;
	assert.equal(key(doc, "ArrowDown").defaultPrevented, false);
	await Promise.resolve();
	assert.equal(calls.length, 0);
	controller.dispose();
});

test("iframe listeners are unique and released on pagehide or book replacement", async () => {
	const { controller, calls, getWheels } = setup();
	const doc = new BookTarget();
	const container = new BookTarget();
	controller.attachContainer(container as unknown as HTMLElement);
	controller.attachDocument(doc as unknown as Document);
	controller.attachDocument(doc as unknown as Document);
	key(doc, "ArrowDown");
	doc.dispatchEvent(new Event("wheel"));
	await Promise.resolve();
	assert.equal(calls.length, 1);
	assert.equal(getWheels(), 1);
	doc.defaultView.dispatchEvent(new Event("pagehide"));
	key(doc, "ArrowDown");
	controller.attachDocument(doc as unknown as Document);
	controller.disposeDocuments();
	key(doc, "ArrowDown");
	key(container, "ArrowDown");
	await Promise.resolve();
	assert.equal(calls.length, 2);
	assert.equal(container.tabIndex, 0);
	controller.dispose();
	key(container, "ArrowDown");
	await Promise.resolve();
	assert.equal(calls.length, 2);
});
