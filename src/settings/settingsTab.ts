/**
 * [INPUT]: 依赖 Obsidian PluginSettingTab/Setting 与 storage/types 的设置模型
 * [OUTPUT]: 对外提供 AnnotationSettingsTab，负责默认颜色、便签栏、窄屏折叠、连接线、作者、备份、重命名迁移设置
 * [POS]: settings 模块的用户配置界面，被 main.ts 注册
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { PluginSettingTab, Setting } from "obsidian";

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

export class AnnotationSettingsTab extends PluginSettingTab {
  constructor(private readonly plugin: OverlayAnnotationsPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "墨光批注" });

    new Setting(containerEl)
      .setName("默认高亮颜色")
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
      .setName("默认作者")
      .addText((text) => {
        text.setValue(this.plugin.settings.defaultAuthor).onChange(async (value) => {
          this.plugin.settings.defaultAuthor = value.trim() || "读者";
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("重命名时迁移批注")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.migrateOnRename).onChange(async (value) => {
          this.plugin.settings.migrateOnRename = value;
          await this.plugin.saveSettings();
        });
      });

    this.renderEpubSettings();
  }

  /** EPUB 阅读相关设置：字号 / 主题 / 翻页 / 高亮样式 / 摘录目录 / 段落模式 / 脚注 / 回显 */
  private renderEpubSettings(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "EPUB 阅读" });

    new Setting(containerEl)
      .setName("阅读字号")
      .setDesc("EPUB 正文基础字号（px）。修改后重新打开电子书生效。")
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
      .setName("阅读主题")
      .setDesc("EPUB 阅读区背景与文字配色。")
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
      .setName("翻页模式")
      .setDesc("翻页为分页布局；滚动为连续滚动阅读。")
      .addDropdown((dropdown) => {
        dropdown.addOption("paginated", "翻页");
        dropdown.addOption("scrolled", "滚动");
        dropdown.setValue(this.plugin.settings.epubDefaultFlow).onChange(async (value) => {
          this.plugin.settings.epubDefaultFlow = value as EpubFlowMode;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("高亮样式")
      .setDesc("EPUB 文本标注的默认呈现样式。")
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
}
