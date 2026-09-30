import assert from "node:assert/strict";
import test from "node:test";

import { EpubNavigationController } from "../src/epub/EpubNavigationController";
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
	return { controller, calls, setFlow: (value: EpubFlowMode) => { flow = value; }, getWheels: () => wheels };
}

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
