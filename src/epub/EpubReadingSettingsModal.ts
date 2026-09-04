/**
 * EPUB 阅读排版设置面板。
 * [PROTOCOL]: 修改通过回调写入插件全局 profile，不直接触碰 sidecar 或原始书籍。
 */

import { App, Modal, Setting, setIcon } from "obsidian";

import {
	DEFAULT_EPUB_READING_PROFILE,
	EPUB_READING_THEMES,
	EpubFontFamily,
	EpubReadingProfile,
	EpubReadingTheme,
	EpubTextAlign,
} from "../storage/types";

const FONT_FAMILIES: Array<{ id: EpubFontFamily; label: string }> = [
	{ id: "publisher", label: "跟随书籍" },
	{ id: "serif", label: "衬线字体" },
	{ id: "sans", label: "无衬线字体" },
	{ id: "kaiti", label: "楷体" },
];

export class EpubReadingSettingsModal extends Modal {
	private draft: EpubReadingProfile;

	constructor(
		app: App,
		profile: EpubReadingProfile,
		private readonly onChange: (profile: EpubReadingProfile) => void | Promise<void>,
	) {
		super(app);
		this.draft = { ...profile };
	}

	onOpen(): void {
		this.titleEl.setText("阅读排版");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createDiv({
			cls: "setting-item-description",
			text: "修改会立即应用到当前 EPUB，并保存为墨光的默认阅读排版。",
		});

		new Setting(contentEl)
			.setName("字体")
			.addDropdown((dropdown) => {
				for (const family of FONT_FAMILIES) dropdown.addOption(family.id, family.label);
				dropdown.setValue(this.draft.fontFamily).onChange((value) => {
					this.update({ fontFamily: value as EpubFontFamily });
				});
			});

		new Setting(contentEl)
			.setName("字号")
			.setDesc(`${this.draft.fontSize}px`)
			.addSlider((slider) => {
				slider.setLimits(12, 28, 1).setValue(this.draft.fontSize).setDynamicTooltip().onChange((value) => {
					this.update({ fontSize: value });
				});
			});

		new Setting(contentEl)
			.setName("行距")
			.setDesc(this.draft.lineHeight.toFixed(1))
			.addSlider((slider) => {
				slider.setLimits(1.4, 2.2, 0.1).setValue(this.draft.lineHeight).setDynamicTooltip().onChange((value) => {
					this.update({ lineHeight: value });
				});
			});

		new Setting(contentEl)
			.setName("正文宽度")
			.setDesc(`${this.draft.contentWidth}px`)
			.addSlider((slider) => {
				slider.setLimits(520, 1000, 10).setValue(this.draft.contentWidth).setDynamicTooltip().onChange((value) => {
					this.update({ contentWidth: value });
				});
			});

		new Setting(contentEl)
			.setName("对齐")
			.addDropdown((dropdown) => {
				dropdown.addOption("start", "跟随书籍");
				dropdown.addOption("justify", "两端对齐");
				dropdown.setValue(this.draft.textAlign).onChange((value) => {
					this.update({ textAlign: value as EpubTextAlign });
				});
			});

		new Setting(contentEl)
			.setName("阅读流模式")
			.addDropdown((dropdown) => {
				dropdown.addOption("scrolled", "滚动");
				dropdown.addOption("paginated", "分页");
				dropdown.setValue(this.draft.flow).onChange((value) => {
					this.update({ flow: value as EpubReadingProfile["flow"] });
				});
			});

		new Setting(contentEl)
			.setName("阅读主题")
			.addDropdown((dropdown) => {
				for (const theme of EPUB_READING_THEMES) dropdown.addOption(theme.id, theme.label);
				dropdown.setValue(this.draft.theme).onChange((value) => {
					this.update({ theme: value as EpubReadingTheme });
				});
			});

		new Setting(contentEl)
			.setName("恢复默认排版")
			.setDesc("恢复为墨光的默认阅读排版")
			.addButton((button) => {
				button.setTooltip("恢复默认排版");
				setIcon(button.buttonEl, "rotate-ccw");
				button.onClick(() => {
					this.draft = { ...DEFAULT_EPUB_READING_PROFILE };
					this.onChange(this.draft);
					this.render();
				});
			});
	}

	private update(patch: Partial<EpubReadingProfile>): void {
		this.draft = { ...this.draft, ...patch };
		void this.onChange(this.draft);
	}
}
