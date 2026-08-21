/**
 * [INPUT]: 依赖 Obsidian PluginSettingTab/Setting 与 storage/types 的设置模型
 * [OUTPUT]: 对外提供 AnnotationSettingsTab，负责默认颜色、统一标签、阅读与迁移设置
 * [POS]: settings 模块的用户配置界面，被 main.ts 注册
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import { t } from "../i18n";

import type OverlayAnnotationsPlugin from "../../main";
import {
  ANNOTATION_COLORS,
  AnnotationColor,
  COLOR_LABELS,
  EPUB_HIGHLIGHT_STYLES,
  EPUB_READING_THEMES,
  EpubFlowMode,
  EpubHighlightStyle,
  EpubReadingTheme,
} from "../storage/types";
import {
  cloneDefaultAnnotationTags,
  createCustomAnnotationTag,
  MAX_ENABLED_ANNOTATION_TAGS,
  normalizeTagLabel,
  TAG_ICON_OPTIONS,
  validateAnnotationTags,
} from "../tags/tagDomain";

export class AnnotationSettingsTab extends PluginSettingTab {
  constructor(private readonly plugin: OverlayAnnotationsPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: t("settings.header") });

    new Setting(containerEl)
      .setName(t("settings.defaultColor"))
      .addDropdown((dropdown) => {
        for (const color of ANNOTATION_COLORS) {
          dropdown.addOption(color, COLOR_LABELS[color]);
        }
        dropdown.setValue(this.plugin.settings.defaultHighlightColor).onChange(async (value) => {
          this.plugin.settings.defaultHighlightColor = value as AnnotationColor;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.defaultAuthor"))
      .addText((text) => {
        text.setValue(this.plugin.settings.defaultAuthor).onChange(async (value) => {
          this.plugin.settings.defaultAuthor = value.trim() || "读者";
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.migrateOnRename"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.migrateOnRename).onChange(async (value) => {
          this.plugin.settings.migrateOnRename = value;
          await this.plugin.saveSettings();
        });
      });

    this.renderTagSettings();
    this.renderEpubSettings();
    this.renderPdfSettings();
  }

  private renderTagSettings(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: t("settings.tags.heading") });
    containerEl.createDiv({
      cls: "setting-item-description",
      text: t("settings.tags.desc", { max: MAX_ENABLED_ANNOTATION_TAGS }),
    });

    const section = containerEl.createDiv({ cls: "book-note-tag-settings" });
    let draft = this.plugin.settings.annotationTags.map((tag) => ({ ...tag }));
    const error = section.createDiv({ cls: "book-note-tag-settings-error hidden" });
    const list = section.createDiv({ cls: "book-note-tag-settings-list" });
    const actions = section.createDiv({ cls: "book-note-tag-settings-actions" });
    const add = actions.createEl("button", { text: t("settings.tags.add"), attr: { type: "button" } });
    const reset = actions.createEl("button", { attr: { type: "button", title: t("settings.tags.reset"), "aria-label": t("settings.tags.reset") } });
    setIcon(reset, "rotate-ccw");
    const save = actions.createEl("button", { text: t("settings.tags.save"), cls: "mod-cta", attr: { type: "button" } });

    const refreshValidation = (): void => {
      const validation = validateAnnotationTags(draft);
      error.toggleClass("hidden", !validation);
      error.setText(validation ?? "");
      save.disabled = Boolean(validation);
      add.disabled = draft.filter((tag) => tag.enabled).length >= MAX_ENABLED_ANNOTATION_TAGS;
    };

    const renderRows = (): void => {
      list.empty();
      draft.forEach((tag, index) => {
        const row = list.createDiv({ cls: "book-note-tag-settings-row" });
        const icon = row.createEl("select", { cls: "dropdown", attr: { "aria-label": `${t("aria.tagIcon", { name: tag.name })}` } });
        for (const option of TAG_ICON_OPTIONS) {
          icon.createEl("option", { text: option.label, value: option.id });
        }
        icon.value = tag.icon;
        icon.addEventListener("change", () => {
          tag.icon = icon.value;
          refreshValidation();
        });

        const name = row.createEl("input", { cls: "text", attr: { type: "text", maxlength: "20", "aria-label": t("aria.tagName") } });
        name.value = tag.name;
        name.addEventListener("input", () => {
          tag.name = name.value;
          refreshValidation();
        });
        name.addEventListener("change", () => {
          tag.name = normalizeTagLabel(name.value);
          name.value = tag.name;
          refreshValidation();
        });

        const enabled = row.createEl("input", { attr: { type: "checkbox", "aria-label": `${t("aria.tagEnabled", { name: tag.name })}` } });
        enabled.checked = tag.enabled;
        enabled.addEventListener("change", () => {
          tag.enabled = enabled.checked;
          refreshValidation();
        });

        const up = row.createEl("button", { attr: { type: "button", title: t("common.moveUp"), "aria-label": t("common.moveUp") } });
        setIcon(up, "chevron-up");
        up.disabled = index === 0;
        up.addEventListener("click", () => {
          [draft[index - 1], draft[index]] = [draft[index], draft[index - 1]];
          renderRows();
          refreshValidation();
        });

        const down = row.createEl("button", { attr: { type: "button", title: t("common.moveDown"), "aria-label": t("common.moveDown") } });
        setIcon(down, "chevron-down");
        down.disabled = index === draft.length - 1;
        down.addEventListener("click", () => {
          [draft[index], draft[index + 1]] = [draft[index + 1], draft[index]];
          renderRows();
          refreshValidation();
        });
      });
    };

    add.addEventListener("click", () => {
      draft.push(createCustomAnnotationTag(`custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`));
      renderRows();
      refreshValidation();
    });

    reset.addEventListener("click", () => {
      if (!window.confirm(t("settings.tags.resetConfirm"))) {
        return;
      }
      const customTags = draft.filter((tag) => !tag.builtIn);
      const candidate = [...cloneDefaultAnnotationTags(), ...customTags];
      const validation = validateAnnotationTags(candidate);
      if (validation) {
        new Notice(t("notice.resetTagsFailed", { validation }));
        return;
      }
      draft = candidate;
      renderRows();
      refreshValidation();
    });

    save.addEventListener("click", async () => {
      const validation = validateAnnotationTags(draft);
      if (validation) {
        new Notice(validation);
        refreshValidation();
        return;
      }
      this.plugin.settings.annotationTags = draft.map((tag) => ({ ...tag, name: normalizeTagLabel(tag.name) }));
      await this.plugin.saveSettings();
      new Notice(t("settings.tags.saved"));
      this.display();
    });

    renderRows();
    refreshValidation();
  }

  /** EPUB 阅读相关设置：字号 / 主题 / 翻页 / 高亮样式 / 摘录目录 / 段落模式 / 脚注 / 回显 */
  private renderEpubSettings(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: t("settings.epub.heading") });

    new Setting(containerEl)
      .setName(t("settings.epub.fontSize.name"))
      .setDesc(t("settings.epub.fontSize.desc"))
      .addSlider((slider) => {
        slider
          .setLimits(12, 28, 1)
          .setValue(this.plugin.settings.epubFontSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.epubFontSize = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.epub.theme.name"))
      .setDesc(t("settings.epub.theme.desc"))
      .addDropdown((dropdown) => {
        for (const theme of EPUB_READING_THEMES) {
          dropdown.addOption(theme.id, theme.label);
        }
        dropdown.setValue(this.plugin.settings.epubReadingTheme).onChange(async (value) => {
          this.plugin.settings.epubReadingTheme = value as EpubReadingTheme;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.epub.flow.name"))
      .setDesc(t("settings.epub.flow.desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("paginated", "翻页");
        dropdown.addOption("scrolled", "滚动");
        dropdown.setValue(this.plugin.settings.epubDefaultFlow).onChange(async (value) => {
          this.plugin.settings.epubDefaultFlow = value as EpubFlowMode;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("settings.epub.highlightStyle.name"))
      .setDesc(t("settings.epub.highlightStyle.desc"))
      .addDropdown((dropdown) => {
        for (const style of EPUB_HIGHLIGHT_STYLES) {
          dropdown.addOption(style.id, style.label);
        }
        dropdown.setValue(this.plugin.settings.epubHighlightStyle).onChange(async (value) => {
          this.plugin.settings.epubHighlightStyle = value as EpubHighlightStyle;
          await this.plugin.saveSettings();
        });
      });
  }

  private renderPdfSettings(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: t("settings.pdf.heading") });
    new Setting(containerEl)
      .setName(t("settings.pdf.progress.name"))
      .setDesc(t("settings.pdf.progress.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.pdfProgressTracking).onChange(async (value) => {
          this.plugin.settings.pdfProgressTracking = value;
          await this.plugin.saveSettings();
        });
      });
  }
}
