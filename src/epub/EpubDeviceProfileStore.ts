/**
 * EPUB 设备独立排版 profile 存储。
 * [PROTOCOL]: 只读写当前设备的 localStorage；全局同步设置由插件 data.json 保存。
 */

import { EpubReadingProfile, normalizeEpubReadingProfile } from "../storage/types";

export type ReaderDeviceClass = "desktop" | "tablet" | "phone";

export interface ReaderPlatformFlags {
	isDesktop?: boolean;
	isMobile?: boolean;
	isPhone?: boolean;
	isTablet?: boolean;
}

export interface EpubDeviceProfileStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

interface StoredDeviceProfiles {
	schemaVersion: 1;
	profiles: Partial<Record<ReaderDeviceClass, EpubReadingProfile>>;
}

const STORAGE_SCHEMA_VERSION = 1 as const;
const DEVICE_CLASSES: ReaderDeviceClass[] = ["desktop", "tablet", "phone"];

export const READER_DEVICE_LABELS: Record<ReaderDeviceClass, string> = {
	desktop: "桌面",
	tablet: "平板",
	phone: "手机",
};

export function detectReaderDeviceClass(flags: ReaderPlatformFlags, viewportWidth = 0): ReaderDeviceClass {
	if (flags.isPhone) {
		return "phone";
	}
	if (flags.isTablet) {
		return "tablet";
	}
	if (flags.isDesktop || !flags.isMobile) {
		return "desktop";
	}
	return viewportWidth >= 720 ? "tablet" : "phone";
}

export function getEpubDeviceProfileStorageKey(pluginId: string, vaultName: string): string {
	const encodedVaultName = encodeURIComponent(vaultName.trim() || "vault");
	return pluginId + ":epub-reading-profiles:v" + STORAGE_SCHEMA_VERSION + ":" + encodedVaultName;
}

export class EpubDeviceProfileStore {
	private loaded = false;
	private record: StoredDeviceProfiles = this.emptyRecord();
	private storageBroken = false;
	private hasNotified = false;

	constructor(
		private readonly deviceClass: ReaderDeviceClass,
		private readonly storage: EpubDeviceProfileStorage | null,
		private readonly storageKey: string,
		private readonly onStorageProblem?: (message: string) => void,
	) {}

	getDeviceClass(): ReaderDeviceClass {
		return this.deviceClass;
	}

	getDeviceLabel(): string {
		return READER_DEVICE_LABELS[this.deviceClass];
	}

	getProfile(globalProfile: EpubReadingProfile): EpubReadingProfile {
		this.load();
		const fallback = normalizeEpubReadingProfile(globalProfile);
		const stored = this.record.profiles[this.deviceClass];
		return stored ? normalizeEpubReadingProfile({ ...fallback, ...stored }, fallback) : fallback;
	}

	setProfile(profile: EpubReadingProfile): boolean {
		this.load();
		if (this.storageBroken) {
			return false;
		}
		const previous = this.record;
		this.record = {
			...this.record,
			profiles: { ...this.record.profiles, [this.deviceClass]: normalizeEpubReadingProfile(profile) },
		};
		if (this.persist()) {
			return true;
		}
		this.record = previous;
		return false;
	}

	resetCurrentProfile(): boolean {
		this.load();
		if (this.storageBroken) {
			return false;
		}
		if (!this.record.profiles[this.deviceClass]) {
			return true;
		}
		const previous = this.record;
		const profiles = { ...this.record.profiles };
		delete profiles[this.deviceClass];
		this.record = { ...this.record, profiles };
		if (Object.keys(profiles).length === 0) {
			try {
				this.storage?.removeItem(this.storageKey);
				return true;
			} catch (error) {
				this.record = previous;
				this.markStorageProblem("当前设备排版设置无法清除，已继续使用现有设置。", error);
				return false;
			}
		}
		if (this.persist()) {
			return true;
		}
		this.record = previous;
		return false;
	}

	private load(): void {
		if (this.loaded) {
			return;
		}
		this.loaded = true;
		if (!this.storage) {
			this.markStorageProblem("无法使用本机排版设置，当前 EPUB 将使用同步默认值。", new Error("localStorage unavailable"));
			return;
		}
		try {
			const raw = this.storage.getItem(this.storageKey);
			if (!raw) {
				return;
			}
			const parsed: unknown = JSON.parse(raw);
			if (!this.isStoredDeviceProfiles(parsed)) {
				throw new Error("invalid device profile record");
			}
			this.record = {
				schemaVersion: STORAGE_SCHEMA_VERSION,
				profiles: this.pickKnownProfiles(parsed.profiles),
			};
		} catch (error) {
			this.record = this.emptyRecord();
			this.markStorageProblem("本机排版设置已损坏，当前 EPUB 将使用同步默认值。", error, false);
		}
	}

	private persist(): boolean {
		if (!this.storage) {
			this.markStorageProblem("无法保存本机排版设置，当前修改仅在本次阅读中生效。", new Error("localStorage unavailable"));
			return false;
		}
		try {
			this.storage.setItem(this.storageKey, JSON.stringify(this.record));
			return true;
		} catch (error) {
			this.markStorageProblem("本机排版设置保存失败，当前修改仅在本次阅读中生效。", error);
			return false;
		}
	}

	private markStorageProblem(message: string, error: unknown, disableWrites = true): void {
		if (disableWrites) {
			this.storageBroken = true;
		}
		if (!this.hasNotified) {
			this.hasNotified = true;
			this.onStorageProblem?.(message);
		}
		console.warn("yh-inklight: device profile storage problem", error);
	}

	private emptyRecord(): StoredDeviceProfiles {
		return { schemaVersion: STORAGE_SCHEMA_VERSION, profiles: {} };
	}

	private pickKnownProfiles(profiles: Partial<Record<ReaderDeviceClass, EpubReadingProfile>>): Partial<Record<ReaderDeviceClass, EpubReadingProfile>> {
		const known: Partial<Record<ReaderDeviceClass, EpubReadingProfile>> = {};
		for (const deviceClass of DEVICE_CLASSES) {
			const profile = profiles[deviceClass];
			if (profile && typeof profile === "object") {
				known[deviceClass] = profile;
			}
		}
		return known;
	}

	private isStoredDeviceProfiles(value: unknown): value is StoredDeviceProfiles {
		if (!value || typeof value !== "object") {
			return false;
		}
		const candidate = value as Partial<StoredDeviceProfiles>;
		return candidate.schemaVersion === STORAGE_SCHEMA_VERSION
			&& Boolean(candidate.profiles)
			&& typeof candidate.profiles === "object"
			&& !Array.isArray(candidate.profiles);
	}
}
