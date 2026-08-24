# -*- coding: utf-8 -*-
"""
Deterministic i18n migration for the Book Note plugin.

Strategy:
  1. TEMPLATED replacements first (dynamic / template-literal strings).
  2. LITERALS replacements (exact quoted string literals -> t("key")).
  3. Inject `import { t } from "<import_path>";` after the first import line
     for every file that was modified.

Robustness:
  - Each target file is mapped to its real on-disk path and the correct
    relative import path for the i18n module.
  - Literal replacements match the *complete* quoted string and compare for
    exact equality, so substrings like "笔记" inside "编辑笔记" never collide.
"""
import os
import re

ROOT = r"D:/WorkSprace/gitee/obsidian-book-note"
SRC = os.path.join(ROOT, "src")

# rel-key -> (path relative to ROOT, import path for t)
FILES = {
    "main.ts": ("main.ts", "./src/i18n"),
    "settingsTab.ts": (os.path.join("src", "settings", "settingsTab.ts"), "../i18n"),
    "annotationLinkService.ts": (os.path.join("src", "links", "annotationLinkService.ts"), "../i18n"),
    "sidebarView.ts": (os.path.join("src", "views", "sidebarView.ts"), "../i18n"),
    "annotationStore.ts": (os.path.join("src", "storage", "annotationStore.ts"), "../i18n"),
    "EpubReaderView.ts": (os.path.join("src", "epub", "EpubReaderView.ts"), "../i18n"),
    "EpubBookshelfView.ts": (os.path.join("src", "epub", "EpubBookshelfView.ts"), "../i18n"),
    "EpubNoteModal.ts": (os.path.join("src", "epub", "EpubNoteModal.ts"), "../i18n"),
    "EpubGotoHandler.ts": (os.path.join("src", "epub", "EpubGotoHandler.ts"), "../i18n"),
    "selectionToolbar.ts": (os.path.join("src", "editor", "selectionToolbar.ts"), "../i18n"),
    "annotationPopover.ts": (os.path.join("src", "views", "annotationPopover.ts"), "../i18n"),
    "pdfAnnotationLayer.ts": (os.path.join("src", "pdf", "pdfAnnotationLayer.ts"), "../i18n"),
    "types.ts": (os.path.join("src", "storage", "types.ts"), "../i18n"),
    "tagDomain.ts": (os.path.join("src", "tags", "tagDomain.ts"), "../i18n"),
}

# Templated/dynamic replacements (run FIRST). (search, replace)
TEMPLATED = {
    "main.ts": [
        (r'new Notice(`未找到第 ${pageNumber} 页`);',
         'new Notice(t("notice.pageNotFound", { page: pageNumber }));'),
        (r'new Notice(`PDF 目录（${outline.length} 项）：\n${lines.slice(0, 8).join("\n")}`);',
         'new Notice(t("notice.pdfOutline", { count: outline.length, lines: lines.slice(0, 8).join("\\n") }));'),
    ],
    "settingsTab.ts": [
        (r'`标签用于分类笔记和想法。最多启用 ${MAX_ENABLED_ANNOTATION_TAGS} 个；修改名称会立即同步显示，不会批量改写批注文件。`',
         't("settings.tags.desc", { max: MAX_ENABLED_ANNOTATION_TAGS })'),
        (r'"${tag.name} 图标"', 't("aria.tagIcon", { name: tag.name })'),
        (r'"${tag.name} 已启用"', 't("aria.tagEnabled", { name: tag.name })'),
        (r'new Notice(`无法恢复默认标签：${validation}`);', 'new Notice(t("notice.resetTagsFailed", { validation }));'),
    ],
    "sidebarView.ts": [
        (r'${scopeLabel} · ${highlightCount} highlights · ${noteCount} notes',
         't("sidebar.count", { scope: scopeLabel, highlights: highlightCount, notes: noteCount })'),
        (r'new Notice(`已导出笔记至 ${exported.path}`);', 'new Notice(t("notice.exported", { path: exported.path }));'),
    ],
    "EpubReaderView.ts": [
        (r'new Notice(`墨光 EPUB 加载失败: ${error instanceof Error ? error.message : String(error)}`);',
         'new Notice(t("epub.loadFailed", { error: error instanceof Error ? error.message : String(error) }));'),
        (r'new Notice(`已添加${COLOR_LABELS[color]}画线`);', 'new Notice(t("epub.highlightAdded", { color: COLOR_LABELS[color] }));'),
        (r'"主题: ${theme.label}"', 't("aria.theme", { label: theme.label })'),
        (r'`${COLOR_LABELS[color]}画线`', 't("aria.colorHighlight", { color: COLOR_LABELS[color] })'),
    ],
    "EpubBookshelfView.ts": [
        (r'上次阅读：${progress.chapter || "未知章节"} · ${progress.lastRead.slice(0, 10)}',
         't("bookshelf.lastRead", { chapter: progress.chapter || t("common.unknownChapter"), date: progress.lastRead.slice(0, 10) })'),
        (r'已读 ${this.formatReadingTime(readingSeconds)}', 't("bookshelf.readTime", { time: this.formatReadingTime(readingSeconds) })'),
        (r'剩余约 ${Math.ceil(progress.estimatedRemainingMinutes)} 分钟', 't("bookshelf.remaining", { minutes: Math.ceil(progress.estimatedRemainingMinutes) })'),
    ],
    "pdfAnnotationLayer.ts": [
        (r'PDF 第 ${annotation.anchor.pageNumber} 页', 't("pdf.popoverTitle", { page: annotation.anchor.pageNumber })'),
    ],
    "selectionToolbar.ts": [
        (r'高亮 ${COLOR_LABELS[color]}', 't("selection.highlight", { color: COLOR_LABELS[color] })'),
    ],
    "annotationStore.ts": [
        (r'new Notice(`Book Note未保存，请检查写入权限或同步状态：${sidecarPath}`);',
         'new Notice(t("notice.notSaved", { path: sidecarPath }));'),
        (r'new Notice(`Book Note存储测试失败：${testPath}`);',
         'new Notice(t("notice.storageTestFailed", { path: testPath }));'),
        (r'new Notice(`Book Note无法读取 ${normalizedPath}，已停止写入以保护批注数据。`);',
         'new Notice(t("notice.cannotRead", { path: normalizedPath }));'),
    ],
}

# Literal string replacements: (exact quoted literal, key). Replace all occurrences.
LITERALS = {
    "main.ts": [
        ('"高亮选中文本"', "command.highlight"),
        ('"为选中文本添加便签"', "command.addNote"),
        ('"打开批注总览"', "command.openSidebar"),
        ('"打开 EPUB 书架"', "command.openBookshelf"),
        ('"显示 PDF 目录"', "command.showPdfOutline"),
        ('"测试Book Note存储"', "command.testStorage"),
        ('"打开Book Note"', "ribbon.open"),
        ('"请先选中文本。"', "notice.selectTextFirst"),
        ('"已复制批注链接"', "notice.annotationLinkCopied"),
        ('"PDF 阅读视图未能及时就绪"', "notice.pdfViewNotReady"),
        ('"无法找到对应的电子书文件"', "notice.epubFileNotFound"),
        ('"电子书阅读视图未能及时就绪"', "notice.epubViewNotReady"),
        ('"Copied selection"', "notice.selectionCopied"),
        ('"便签"', "modal.sticky.title"),
        ('"标签"', "common.tag"),
        ('"笔记"', "modal.sticky.note"),
        ('"写下你的想法..."', "modal.sticky.placeholder"),
        ('"取消"', "common.cancel"),
        ('"保存"', "common.save"),
        ('"（已停用）"', "modal.sticky.disabledSuffix"),
    ],
    "settingsTab.ts": [
        ('"Book Note"', "settings.header"),
        ('"默认高亮颜色"', "settings.defaultColor"),
        ('"默认作者"', "settings.defaultAuthor"),
        ('"重命名时迁移批注"', "settings.migrateOnRename"),
        ('"批注标签"', "settings.tags.heading"),
        ('"添加标签"', "settings.tags.add"),
        ('"恢复默认标签"', "settings.tags.reset"),
        ('"保存标签"', "settings.tags.save"),
        ('"标签名称"', "aria.tagName"),
        ('"上移"', "common.moveUp"),
        ('"下移"', "common.moveDown"),
        ('"EPUB 阅读"', "settings.epub.heading"),
        ('"阅读字号"', "settings.epub.fontSize.name"),
        ('"EPUB 正文基础字号（px）。修改后重新打开电子书生效。"', "settings.epub.fontSize.desc"),
        ('"阅读主题"', "settings.epub.theme.name"),
        ('"EPUB 阅读区背景与文字配色。"', "settings.epub.theme.desc"),
        ('"翻页模式"', "settings.epub.flow.name"),
        ('"翻页为分页布局；滚动为连续滚动阅读。"', "settings.epub.flow.desc"),
        ('"高亮样式"', "settings.epub.highlightStyle.name"),
        ('"EPUB 文本标注的默认呈现样式。"', "settings.epub.highlightStyle.desc"),
        ('"PDF 阅读"', "settings.pdf.heading"),
        ('"记录 PDF 阅读进度"', "settings.pdf.progress.name"),
        ('"保存当前页和阅读进度；关闭后不会删除已有进度。"', "settings.pdf.progress.desc"),
        ('"批注标签已保存"', "settings.tags.saved"),
        ('"恢复默认标签名称、图标和顺序？自定义标签会保留。"', "settings.tags.resetConfirm"),
        ('"（已停用）"', "modal.sticky.disabledSuffix"),
    ],
    "annotationLinkService.ts": [
        ('"Book Note链接无效"', "notice.invalidLink"),
        ('"找到多个同 ID 批注，已停止跳转以保护数据"', "notice.multipleSameId"),
        ('"批注已删除或尚未同步"', "notice.annotationGone"),
        ('"找不到批注来源文件"', "notice.sourceFileMissing"),
        ('"找不到对应电子书文件"', "notice.epubSourceMissing"),
        ('"原文已变化，无法可靠定位该批注"', "notice.originalChanged"),
    ],
    "sidebarView.ts": [
        ('"Open a Markdown or PDF file to inspect annotations."', "sidebar.emptyHint"),
        ('"No matching annotations."', "sidebar.noMatch"),
        ('"Inklight"', "sidebar.title"),
        ('"搜索批注..."', "sidebar.searchPlaceholder"),
        ('"当前文件"', "sidebar.scope.current"),
        ('"全库"', "sidebar.scope.all"),
        ('"筛选"', "sidebar.filter"),
        ('"全部颜色"', "sidebar.filterColor.all"),
        ('"全部类型"', "sidebar.filterType.all"),
        ('"高亮"', "sidebar.filterType.highlight"),
        ('"笔记"', "sidebar.filterType.note"),
        ('"按标签筛选"', "sidebar.filterTag"),
        ('"全部标签"', "sidebar.filterTag.all"),
        ('"未分类"', "common.untagged"),
        ('"默认摘要"', "sidebar.export.summary"),
        ('"按颜色分组"', "sidebar.export.byColor"),
        ('"只导出笔记"', "sidebar.export.notesOnly"),
        ('"阅读笔记"', "sidebar.export.readingNotes"),
        ('"编辑笔记"', "common.edit"),
        ('"添加笔记"', "common.addNote"),
        ('"跳转"', "common.jump"),
        ('"More annotation actions"', "aria.moreActions"),
        ('"笔记标签"', "sidebar.noteTag"),
        ('"写下你的想法..."', "sidebar.notePlaceholder"),
        ('"保存"', "common.save"),
        ('"取消"', "common.cancel"),
        ('"复制批注链接"', "common.copyLink"),
        ('"删除批注"', "common.delete"),
        ('"↑ 导出批注"', "sidebar.exportButton"),
        ('"导出为 Markdown 摘要"', "export.summary"),
        ('"按颜色分组导出"', "export.byColor"),
        ('"只导出带笔记的批注"', "export.notesOnly"),
        ('"导出为阅读笔记格式"', "export.readingNotes"),
        ('"Refresh"', "common.refresh"),
        ('"Refresh annotations"', "aria.refreshAnnotations"),
        ('"Close panel"', "aria.closePanel"),
        ('"文档顺序"', "sort.document"),
        ('"最新优先"', "sort.newest"),
        ('"最早优先"', "sort.oldest"),
        ('"（已停用）"', "modal.sticky.disabledSuffix"),
    ],
    "EpubReaderView.ts": [
        ('"目录"', "epub.toc"),
        ('"未找到目录信息。"', "epub.emptyToc"),
        ('"未找到匹配"', "epub.searchEmpty"),
        ('"搜索功能不支持"', "epub.searchUnsupported"),
        ('"搜索中..."', "epub.searching"),
        ('"未找到匹配内容"', "epub.searchNoMatch"),
        ('"画线创建失败"', "epub.highlightCreateFailed"),
        ('"已添加标注"', "epub.noteAdded"),
        ('"标注创建失败"', "epub.noteCreateFailed"),
        ('"标注已删除"', "epub.noteDeleted"),
        ('"标注删除失败"', "epub.noteDeleteFailed"),
        ('"点按翻页已开启"', "epub.tapPageOn"),
        ('"滑动翻页已开启"', "epub.swipePageOn"),
        ('"键盘翻页已开启"', "epub.keyboardPageOn"),
        ('"滚轮翻页已开启"', "epub.scrollPageOn"),
        ('"切换侧边栏"', "aria.toggleSidebar"),
        ('"缩小字号"', "aria.decreaseFont"),
        ('"放大字号"', "aria.increaseFont"),
        ('"搜索全文"', "aria.searchFull"),
        ('"切换为滚动"', "epub.toggleScroll"),
        ('"切换为分页"', "epub.togglePaginate"),
        ('"上一页"', "aria.prevPage"),
        ('"下一页"', "aria.nextPage"),
        ('"更多"', "common.more"),
        ('"添加标注"', "aria.addAnnotation"),
        ('"搜索全文…"', "aria.searchPlaceholder"),
        ('"搜索正文…"', "aria.searchBody"),
    ],
    "EpubBookshelfView.ts": [
        ('"📚 电子书书架"', "bookshelf.title"),
        ('"Vault 中没有找到电子书文件。"', "bookshelf.empty"),
        ('"未知章节"', "common.unknownChapter"),
    ],
    "EpubNoteModal.ts": [
        ('"画线颜色"', "epubNote.color"),
        ('"标注样式"', "epubNote.style"),
        ('"标签"', "common.tag"),
        ('"取消"', "common.cancel"),
        ('"保存"', "common.save"),
        ('"写下你的想法"', "epubNote.title"),
    ],
    "EpubGotoHandler.ts": [
        ('"Unable to resolve source annotation"', "notice.unableResolve"),
    ],
    "selectionToolbar.ts": [
        ('"添加便签"', "common.addNote"),
        ('"复制"', "common.copy"),
        ('"打开总览"', "common.openOverview"),
    ],
    "annotationPopover.ts": [
        ('"批注"', "popover.title"),
        ('"关闭批注弹层"', "aria.closePopover"),
        ('"读者"', "common.reader"),
        ('"仅高亮"', "popover.onlyHighlight"),
        ('"暂无附加便签。"', "popover.emptyNote"),
    ],
    "pdfAnnotationLayer.ts": [
        ('"请先在 PDF 中选中文本。"', "pdf.selectTextFirst"),
        ('"关闭"', "common.close"),
    ],
    "types.ts": [
        ('"黄色"', "color.yellow"),
        ('"绿色"', "color.green"),
        ('"蓝色"', "color.blue"),
        ('"粉色"', "color.pink"),
        ('"橙色"', "color.orange"),
        ('"紫色"', "color.purple"),
        ('"跟随 Obsidian"', "theme.follow"),
        ('"默认白"', "theme.white"),
        ('"暖光"', "theme.warm"),
        ('"护眼绿"', "theme.green"),
        ('"羊皮纸"', "theme.sepia"),
        ('"夜间"', "theme.dark"),
        ('"填充"', "style.fill"),
        ('"下划线"', "style.underline"),
        ('"波浪线"', "style.wavy"),
    ],
    "tagDomain.ts": [
        ('"灯泡"', "icon.lightbulb"),
        ('"问号"', "icon.help"),
        ('"铃铛"', "icon.bell"),
        ('"书签"', "icon.bookmark"),
        ('"星标"', "icon.star"),
        ('"旗帜"', "icon.flag"),
        ('"心形"', "icon.heart"),
        ('"请至少保留一个标签。"', "tag.atLeastOne"),
        ('"请至少启用一个标签。"', "tag.atLeastOneEnabled"),
        ('"标签 ID 无效。"', "tag.invalidId"),
        ('"标签 ID 重复。"', "tag.duplicateId"),
        ('"标签名称不能为空。"', "tag.emptyName"),
        ('"标签名称已存在。"', "tag.duplicateName"),
        ('"标签图标无效。"', "tag.invalidIcon"),
    ],
    "annotationStore.ts": [
        ('"Book Note全库汇总"', "export.heading"),
    ],
}

QUOTED_RE = re.compile(r'"(?:[^"\\]|\\.)*"')


def replace_literal(content, literal, key):
    """Replace the complete quoted string `literal` with t("key") everywhere."""
    def repl(m):
        if m.group(0) == literal:
            return 't("%s")' % key
        return m.group(0)
    return QUOTED_RE.sub(repl, content)


def inject_import(content, imp):
    if 'from "../i18n"' in content or 'from "./i18n"' in content or 'from "./src/i18n"' in content:
        return content, False
    lines = content.split("\n")
    for i, line in enumerate(lines):
        if line.startswith("import "):
            lines.insert(i + 1, 'import { t } from "%s";' % imp)
            return "\n".join(lines), True
    return content, False


changed_files = set()

# 1) TEMPLATED
for rel, pairs in TEMPLATED.items():
    relpath, imp = FILES[rel]
    path = os.path.join(ROOT, relpath)
    with open(path, encoding="utf-8") as f:
        content = f.read()
    original = content
    for search, replace in pairs:
        if search not in content:
            print("WARN[templated] not found in %s: %s" % (rel, search[:60]))
            continue
        content = content.replace(search, replace, 1)
        changed_files.add(rel)
    if content != original:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

# 2) LITERALS
for rel, pairs in LITERALS.items():
    relpath, imp = FILES[rel]
    path = os.path.join(ROOT, relpath)
    with open(path, encoding="utf-8") as f:
        content = f.read()
    original = content
    for literal, key in pairs:
        if literal not in content:
            print("WARN[literal] not found in %s: %s" % (rel, literal))
            continue
        content = replace_literal(content, literal, key)
        changed_files.add(rel)
    if content != original:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

# 3) inject imports
for rel in sorted(changed_files):
    relpath, imp = FILES[rel]
    path = os.path.join(ROOT, relpath)
    with open(path, encoding="utf-8") as f:
        content = f.read()
    new_content, did = inject_import(content, imp)
    if did:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)

print("DONE. changed files (%d):" % len(changed_files))
for rel in sorted(changed_files):
    print("  - %s" % FILES[rel][0])
