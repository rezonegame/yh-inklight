import assert from "node:assert/strict";
import test from "node:test";

import {
	detectReaderDeviceClass,
	EpubDeviceProfileStorage,
	EpubDeviceProfileStore,
	getEpubDeviceProfileStorageKey,
} from "../src/epub/EpubDeviceProfileStore";
import { DEFAULT_EPUB_READING_PROFILE } from "../src/storage/types";

class MemoryStorage implements EpubDeviceProfileStorage {
	private values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}
}

test("keeps narrow desktop windows in the desktop profile", () => {
	assert.equal(detectReaderDeviceClass({ isDesktop: true, isMobile: false }, 420), "desktop");
	assert.equal(detectReaderDeviceClass({ isPhone: true, isMobile: true }, 900), "phone");
	assert.equal(detectReaderDeviceClass({ isMobile: true }, 800), "tablet");
	assert.equal(detectReaderDeviceClass({ isMobile: true }, 500), "phone");
});

test("builds a vault-scoped local storage key", () => {
	assert.equal(
		getEpubDeviceProfileStorageKey("yh-inklight", "My Vault / 中文"),
		"yh-inklight:epub-reading-profiles:v1:My%20Vault%20%2F%20%E4%B8%AD%E6%96%87",
	);
});

test("isolates profiles by device while sharing one local record", () => {
	const storage = new MemoryStorage();
	const key = "profile-key";
	const desktop = new EpubDeviceProfileStore("desktop", storage, key);
	const phone = new EpubDeviceProfileStore("phone", storage, key);
	const desktopProfile = {
		...DEFAULT_EPUB_READING_PROFILE,
		fontSize: 21,
		customFontEnabled: true,
		customFontFamily: "Microsoft YaHei",
	};
	const phoneProfile = { ...DEFAULT_EPUB_READING_PROFILE, fontSize: 17 };

	assert.equal(desktop.getProfile(DEFAULT_EPUB_READING_PROFILE).fontSize, 16);
	assert.equal(desktop.setProfile(desktopProfile), true);
	assert.equal(phone.getProfile(DEFAULT_EPUB_READING_PROFILE).fontSize, 16);
	assert.equal(phone.setProfile(phoneProfile), true);
	assert.equal(desktop.getProfile(DEFAULT_EPUB_READING_PROFILE).fontSize, 21);
	assert.equal(desktop.getProfile(DEFAULT_EPUB_READING_PROFILE).customFontFamily, "Microsoft YaHei");
	assert.equal(phone.getProfile(DEFAULT_EPUB_READING_PROFILE).fontSize, 17);

	assert.equal(phone.resetCurrentProfile(), true);
	assert.equal(phone.getProfile(DEFAULT_EPUB_READING_PROFILE).fontSize, 16);
	assert.equal(desktop.getProfile(DEFAULT_EPUB_READING_PROFILE).fontSize, 21);
});

test("falls back from corrupt local data and reports the problem once", () => {
	const storage = new MemoryStorage();
	const key = "corrupt-key";
	storage.setItem(key, "{broken");
	const messages: string[] = [];
	const store = new EpubDeviceProfileStore("desktop", storage, key, (message) => messages.push(message));

	assert.deepEqual(store.getProfile(DEFAULT_EPUB_READING_PROFILE), DEFAULT_EPUB_READING_PROFILE);
	assert.deepEqual(store.getProfile(DEFAULT_EPUB_READING_PROFILE), DEFAULT_EPUB_READING_PROFILE);
	assert.equal(messages.length, 1);
	assert.equal(store.setProfile({ ...DEFAULT_EPUB_READING_PROFILE, fontSize: 20 }), true);
	assert.equal(store.getProfile(DEFAULT_EPUB_READING_PROFILE).fontSize, 20);
});

test("falls back cleanly when local storage is unavailable", () => {
	const messages: string[] = [];
	const store = new EpubDeviceProfileStore("desktop", null, "missing-key", (message) => messages.push(message));

	assert.equal(store.getProfile(DEFAULT_EPUB_READING_PROFILE).fontSize, 16);
	assert.equal(store.setProfile({ ...DEFAULT_EPUB_READING_PROFILE, fontSize: 20 }), false);
	assert.equal(messages.length, 1);
});
