import { moment } from "obsidian";

/**
 * Internationalization for Book Note.
 * All user-visible strings must go through t(). zh-cn is the default UI language;
 * everything else falls back to English.
 */

type Dict = Record<string, string>;

const locale = moment.locale();
const isZh = locale === "zh-cn" || locale === "zh" || locale.startsWith("zh");

const en: Dict = {
  // Commands
  "command.highlight": "Highlight selection",
  "command.addNote": "Add sticky note to selection",
  "command.openSidebar": "Open annotation overview",
  "command.openBookshelf": "Open EPUB bookshelf",
  "command.showPdfOutline": "Show PDF outline",
  "command.testStorage": "Test Book Note storage",

  // Ribbon
  "ribbon.open": "Open Book Note",

  // Common
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.refresh": "Refresh",
  "common.moveUp": "Move up",
  "common.moveDown": "Move down",
  "common.edit": "Edit note",
  "common.addNote": "Add note",
  "common.jump": "Jump",
  "common.more": "More",
  "common.copyLink": "Copy annotation link",
  "common.delete": "Delete annotation",
  "common.untagged": "Untagged",
  "common.reader": "Reader",
  "common.tag": "Tag",
  "common.unknownChapter": "Unknown chapter",
  "common.copy": "Copy",
  "common.openOverview": "Open overview",
  "common.expand": "Expand",
  "common.collapse": "Collapse",

  // Settings
  "settings.header": "Book Note",
  "settings.defaultColor": "Default highlight color",
  "settings.defaultAuthor": "Default author",
  "settings.migrateOnRename": "Migrate annotations on rename",
  "settings.showRibbonIcon.name": "Show ribbon icon",
  "settings.showRibbonIcon.desc": "Show the highlighter icon in the left ribbon to open the Book Note sidebar.",
  "settings.tags.heading": "Annotation tags",
  "settings.tags.desc": "Tags categorize notes and ideas. Up to {{max}} can be enabled; renaming syncs instantly without rewriting annotation files.",
  "settings.tags.add": "Add tag",
  "settings.tags.reset": "Reset to default tags",
  "settings.tags.save": "Save tags",
  "settings.tags.saved": "Annotation tags saved",
  "settings.tags.resetConfirm": "Reset default tag names, icons and order? Custom tags are kept.",
  "settings.epub.heading": "EPUB reading",
  "settings.epub.fontSize.name": "Reading font size",
  "settings.epub.fontSize.desc": "Base font size (px) for EPUB body text. Reopen the book to apply.",
  "settings.epub.theme.name": "Reading theme",
  "settings.epub.theme.desc": "Background and text colors of the EPUB reading area.",
  "settings.epub.flow.name": "Page mode",
  "settings.epub.flow.desc": "Paginated shows one page; scrolled is continuous.",
  "settings.epub.highlightStyle.name": "Highlight style",
  "settings.epub.highlightStyle.desc": "Default appearance of EPUB text annotations.",
  "settings.pdf.heading": "PDF reading",
  "settings.pdf.progress.name": "Track PDF reading progress",
  "settings.pdf.progress.desc": "Saves current page and progress; existing progress is kept after closing.",
  "settings.storage.heading": "Storage",
  "settings.storageFormat.name": "Annotation storage format",
  "settings.storageFormat.desc": "How annotation data is stored per source file. Markdown stores metadata and reading progress in YAML frontmatter and renders each annotation as a heading; JSON is more compact.",
  "settings.storageFormat.json": "JSON (compact)",
  "settings.storageFormat.md": "Markdown (readable)",
  "settings.storagePath.name": "Storage folder (vault-relative)",
  "settings.storagePath.desc": "Folder inside the vault for sidecar files. Leave empty for the default .obsidian-annotations directory. Only vault-relative paths are allowed.",
  "settings.storagePath.placeholder": "e.g. .obsidian-annotations",
  "settings.storage.test": "Test write access",
  "settings.storage.migrate": "Migrate existing annotations",
  "settings.storage.migrate.desc": "Rewrite all existing annotation sidecars to the current folder and format. Runs automatically when you change the format or folder above.",

  // Sidebar
  "sidebar.emptyHint": "Open a Markdown or PDF file to inspect annotations.",
  "sidebar.noMatch": "No matching annotations.",
  "sidebar.title": "Book Note",
  "sidebar.searchPlaceholder": "Search annotations...",
  "sidebar.scope.current": "Current file",
  "sidebar.scope.all": "All vault",
  "sidebar.filter": "Filter",
  "sidebar.filterColor.all": "All colors",
  "sidebar.filterType.all": "All types",
  "sidebar.filterType.highlight": "Highlight",
  "sidebar.filterType.note": "Note",
  "sidebar.filterTag": "Filter by tag",
  "sidebar.filterTag.all": "All tags",
  "sidebar.export.summary": "Default summary",
  "sidebar.export.byColor": "Group by color",
  "sidebar.export.notesOnly": "Notes only",
  "sidebar.export.readingNotes": "Reading notes",
  "sidebar.exportButton": "↑ Export annotations",
  "sidebar.noteTag": "Note tag",
  "sidebar.notePlaceholder": "Write your thoughts...",
  "sidebar.count": "{{scope}} · {{highlights}} highlights · {{notes}} notes",

  // aria-labels
  "aria.refreshAnnotations": "Refresh annotations",
  "aria.closePanel": "Close panel",
  "aria.tagIcon": "{{name}} icon",
  "aria.tagName": "Tag name",
  "aria.tagEnabled": "{{name}} enabled",
  "aria.colorHighlight": "{{color}} highlight",
  "aria.addAnnotation": "Add annotation",
  "aria.moreActions": "More annotation actions",
  "aria.theme": "Theme: {{label}}",
  "aria.closePopover": "Close annotation popover",
  "aria.searchFull": "Search full text",
  "aria.toggleSidebar": "Toggle sidebar",
  "aria.decreaseFont": "Decrease font size",
  "aria.increaseFont": "Increase font size",
  "aria.prevPage": "Previous page",
  "aria.nextPage": "Next page",
  "aria.searchPlaceholder": "Search full text…",
  "aria.searchBody": "Search body…",

  // EPUB reader
  "epub.toc": "Contents",
  "epub.emptyToc": "No table of contents found.",
  "epub.searchEmpty": "No matches found",
  "epub.searchUnsupported": "Search not supported",
  "epub.searching": "Searching...",
  "epub.searchProgress": "Searching {{percent}}%",
  "epub.searchNoMatch": "No matching content found",
  "epub.loadFailed": "Book Note EPUB failed to load: {{error}}",
  "epub.highlightAdded": "Added {{color}} highlight",
  "epub.highlightCreateFailed": "Failed to create highlight",
  "epub.noteAdded": "Annotation added",
  "epub.noteCreateFailed": "Failed to create annotation",
  "epub.noteDeleted": "Annotation deleted",
  "epub.noteDeleteFailed": "Failed to delete annotation",
  "epub.tapPageOn": "Tap-to-page enabled",
  "epub.swipePageOn": "Swipe-to-page enabled",
  "epub.keyboardPageOn": "Keyboard paging enabled",
  "epub.scrollPageOn": "Scroll paging enabled",
  "epub.toggleScroll": "Switch to scroll",
  "epub.togglePaginate": "Switch to paginated",
  "epub.readDone": "Finished",
  "epub.remainingLessThanMinute": "Less than 1 minute remaining",
  "epub.toggleToSwipe": "Switch to swipe paging",
  "epub.toggleToTap": "Switch to tap paging",
  "epub.toggleToWheel": "Switch to wheel paging",
  "epub.toggleToKeyboard": "Switch to keyboard paging",

  // EPUB note modal
  "epubNote.color": "Highlight color",
  "epubNote.style": "Annotation style",
  "epubNote.title": "Write your thoughts",
  "epubNote.placeholder": "Write down your thoughts or associations here…",

  // PDF
  "pdf.selectTextFirst": "Select text in the PDF first.",
  "pdf.popoverTitle": "PDF page {{page}}",

  // Bookshelf
  "bookshelf.title": "📚 E-book bookshelf",
  "bookshelf.empty": "No e-book files found in the vault.",
  "bookshelf.lastRead": "Last read: {{chapter}} · {{date}}",
  "bookshelf.readTime": "Read {{time}}",
  "bookshelf.remaining": "About {{minutes}} min left",
  "bookshelf.displayName": "EPUB Library",
  "bookshelf.hours": "{{count}} h",
  "bookshelf.minutes": "{{count}} m",
  "bookshelf.seconds": "{{count}} s",

  // Popover
  "popover.title": "Annotation",
  "popover.emptyNote": "No attached note yet.",
  "popover.onlyHighlight": "Highlight only",

  // Selection toolbar
  "selection.highlight": "Highlight {{color}}",

  // Comment modal
  "modal.sticky.title": "Sticky note",
  "modal.sticky.note": "Note",
  "modal.sticky.placeholder": "Write your thoughts...",
  "modal.sticky.disabledSuffix": " (disabled)",

  // Notices
  "notice.pageNotFound": "Page {{page}} not found",
  "notice.openPdfFirst": "Open a PDF file first",
  "notice.pdfNoOutline": "This PDF has no outline",
  "notice.pdfOutline": "PDF outline ({{count}} items):\n{{lines}}",
  "notice.selectTextFirst": "Select some text first.",
  "notice.annotationLinkCopied": "Annotation link copied",
  "notice.pdfViewNotReady": "PDF reader did not become ready in time",
  "notice.epubFileNotFound": "Could not find the e-book file",
  "notice.epubSourceMissing": "Could not find the corresponding e-book file",
  "notice.epubViewNotReady": "E-book reader did not become ready in time",
  "notice.selectionCopied": "Selection copied",
  "notice.invalidLink": "Invalid Book Note link",
  "notice.multipleSameId": "Multiple annotations share this ID; navigation stopped to protect data",
  "notice.annotationGone": "Annotation deleted or not yet synced",
  "notice.onlyPdfEpubAnnotations": "Book Note annotations are available for PDF and EPUB files only.",
  "notice.sourceFileMissing": "Source file of the annotation not found",
  "notice.originalChanged": "Original text changed; cannot reliably locate this annotation",
  "notice.unableResolve": "Unable to resolve source annotation",
  "notice.exported": "Exported notes to {{path}}",
  "notice.resetTagsFailed": "Cannot reset tags: {{validation}}",
  "notice.notSaved": "Book Note failed to save; check write permission or sync status: {{path}}",
  "notice.storageTestFailed": "Book Note storage test failed: {{path}}",
  "notice.cannotRead": "Book Note cannot read {{path}}; writing stopped to protect annotation data.",
  "notice.storageWritable": "Book Note storage is writable: {{path}}",
  "notice.storageNotWritable": "Book Note storage is not writable. Check the .obsidian-annotations directory permissions or sync status.",
  "notice.storageMigrated": "Migrated {{count}} annotation file(s) to the new storage.",
  "notice.storageMigratePartial": "Migrated {{migrated}} file(s); {{failed}} failed.",
  "notice.storageMigrateFailed": "Failed to migrate annotations: {{error}}",

  // Tag validation
  "tag.atLeastOne": "Keep at least one tag.",
  "tag.atLeastOneEnabled": "Enable at least one tag.",
  "tag.invalidId": "Invalid tag ID.",
  "tag.duplicateId": "Duplicate tag ID.",
  "tag.emptyName": "Tag name cannot be empty.",
  "tag.duplicateName": "Tag name already exists.",
  "tag.invalidIcon": "Invalid tag icon.",
  "tag.maxEnabled": "At most {{max}} tags can be enabled.",
  "tag.nameTooLong": "Tag name cannot exceed {{max}} characters.",
  "tag.newTagName": "New tag",

  // Export
  "export.heading": "Book Note All Notes Summary",
  "export.summary": "Export as Markdown summary",
  "export.byColor": "Export grouped by color",
  "export.notesOnly": "Export annotations with notes only",
  "export.readingNotes": "Export as reading-notes format",

  // Colors
  "color.yellow": "Yellow",
  "color.green": "Green",
  "color.blue": "Blue",
  "color.pink": "Pink",
  "color.orange": "Orange",
  "color.purple": "Purple",

  // Themes
  "theme.follow": "Follow Obsidian",
  "theme.white": "White",
  "theme.warm": "Warm",
  "theme.green": "Eye-care green",
  "theme.sepia": "Sepia",
  "theme.dark": "Dark",

  // Highlight styles
  "style.fill": "Fill",
  "style.underline": "Underline",
  "style.wavy": "Wavy",

  // Tag icons
  "icon.lightbulb": "Light bulb",
  "icon.help": "Question",
  "icon.bell": "Bell",
  "icon.bookmark": "Bookmark",
  "icon.star": "Star",
  "icon.flag": "Flag",
  "icon.heart": "Heart",

  // Sort
  "sort.document": "Document order",
  "sort.newest": "Newest first",
  "sort.oldest": "Oldest first",
};

const zh: Dict = {
  // Commands
  "command.highlight": "高亮选中文本",
  "command.addNote": "为选中文本添加便签",
  "command.openSidebar": "打开批注总览",
  "command.openBookshelf": "打开 EPUB 书架",
  "command.showPdfOutline": "显示 PDF 目录",
  "command.testStorage": "测试Book Note存储",

  // Ribbon
  "ribbon.open": "打开Book Note",

  // Common
  "common.save": "保存",
  "common.cancel": "取消",
  "common.close": "关闭",
  "common.refresh": "刷新",
  "common.moveUp": "上移",
  "common.moveDown": "下移",
  "common.edit": "编辑笔记",
  "common.addNote": "添加笔记",
  "common.jump": "跳转",
  "common.more": "更多",
  "common.copyLink": "复制批注链接",
  "common.delete": "删除批注",
  "common.untagged": "未分类",
  "common.reader": "读者",
  "common.tag": "标签",
  "common.unknownChapter": "未知章节",
  "common.copy": "复制",
  "common.openOverview": "打开总览",
  "common.expand": "展开",
  "common.collapse": "收起",

  // Settings
  "settings.header": "Book Note",
  "settings.defaultColor": "默认高亮颜色",
  "settings.defaultAuthor": "默认作者",
  "settings.migrateOnRename": "重命名时迁移批注",
  "settings.showRibbonIcon.name": "显示侧边栏图标",
  "settings.showRibbonIcon.desc": "在左侧栏显示 Book Note 高亮笔图标，点击可打开批注总览面板。",
  "settings.tags.heading": "批注标签",
  "settings.tags.desc": "标签用于分类笔记和想法。最多启用 {{max}} 个；修改名称会立即同步显示，不会批量改写批注文件。",
  "settings.tags.add": "添加标签",
  "settings.tags.reset": "恢复默认标签",
  "settings.tags.save": "保存标签",
  "settings.tags.saved": "批注标签已保存",
  "settings.tags.resetConfirm": "恢复默认标签名称、图标和顺序？自定义标签会保留。",
  "settings.epub.heading": "EPUB 阅读",
  "settings.epub.fontSize.name": "阅读字号",
  "settings.epub.fontSize.desc": "EPUB 正文基础字号（px）。修改后重新打开电子书生效。",
  "settings.epub.theme.name": "阅读主题",
  "settings.epub.theme.desc": "EPUB 阅读区背景与文字配色。",
  "settings.epub.flow.name": "翻页模式",
  "settings.epub.flow.desc": "翻页为分页布局；滚动为连续滚动阅读。",
  "settings.epub.highlightStyle.name": "高亮样式",
  "settings.epub.highlightStyle.desc": "EPUB 文本标注的默认呈现样式。",
  "settings.pdf.heading": "PDF 阅读",
  "settings.pdf.progress.name": "记录 PDF 阅读进度",
  "settings.pdf.progress.desc": "保存当前页和阅读进度；关闭后不会删除已有进度。",
  "settings.storage.heading": "存储",
  "settings.storageFormat.name": "批注存储格式",
  "settings.storageFormat.desc": "每个源文件批注数据的存储方式。Markdown 将元数据和阅读进度存入 YAML frontmatter，每条批注作为一个标题；JSON 更紧凑。",
  "settings.storageFormat.json": "JSON（紧凑）",
  "settings.storageFormat.md": "Markdown（可读）",
  "settings.storagePath.name": "存储目录（Vault 相对路径）",
  "settings.storagePath.desc": "Vault 内用于存放 sidecar 文件的目录，留空使用默认 .obsidian-annotations。仅允许 Vault 内相对路径。",
  "settings.storagePath.placeholder": "例如 .obsidian-annotations",
  "settings.storage.test": "测试写入",
  "settings.storage.migrate": "迁移已有批注",
  "settings.storage.migrate.desc": "将所有已有批注 sidecar 重写到当前目录与格式。修改上方的格式或目录时会自动执行。",

  // Sidebar
  "sidebar.emptyHint": "打开 Markdown 或 PDF 文件以查看批注。",
  "sidebar.noMatch": "没有匹配的批注。",
  "sidebar.title": "Book Note",
  "sidebar.searchPlaceholder": "搜索批注...",
  "sidebar.scope.current": "当前文件",
  "sidebar.scope.all": "全库",
  "sidebar.filter": "筛选",
  "sidebar.filterColor.all": "全部颜色",
  "sidebar.filterType.all": "全部类型",
  "sidebar.filterType.highlight": "高亮",
  "sidebar.filterType.note": "笔记",
  "sidebar.filterTag": "按标签筛选",
  "sidebar.filterTag.all": "全部标签",
  "sidebar.export.summary": "默认摘要",
  "sidebar.export.byColor": "按颜色分组",
  "sidebar.export.notesOnly": "只导出笔记",
  "sidebar.export.readingNotes": "阅读笔记",
  "sidebar.exportButton": "↑ 导出批注",
  "sidebar.noteTag": "笔记标签",
  "sidebar.notePlaceholder": "写下你的想法...",
  "sidebar.count": "{{scope}} · {{highlights}} 个高亮 · {{notes}} 条笔记",

  // aria-labels
  "aria.refreshAnnotations": "刷新批注",
  "aria.closePanel": "关闭面板",
  "aria.tagIcon": "{{name}} 图标",
  "aria.tagName": "标签名称",
  "aria.tagEnabled": "{{name}} 已启用",
  "aria.colorHighlight": "{{color}}画线",
  "aria.addAnnotation": "添加标注",
  "aria.moreActions": "更多批注操作",
  "aria.theme": "主题: {{label}}",
  "aria.closePopover": "关闭批注弹层",
  "aria.searchFull": "搜索全文",
  "aria.toggleSidebar": "切换侧边栏",
  "aria.decreaseFont": "缩小字号",
  "aria.increaseFont": "放大字号",
  "aria.prevPage": "上一页",
  "aria.nextPage": "下一页",
  "aria.searchPlaceholder": "搜索全文…",
  "aria.searchBody": "搜索正文…",

  // EPUB reader
  "epub.toc": "目录",
  "epub.emptyToc": "未找到目录信息。",
  "epub.searchEmpty": "未找到匹配",
  "epub.searchUnsupported": "搜索功能不支持",
  "epub.searching": "搜索中...",
  "epub.searchProgress": "搜索中 {{percent}}%",
  "epub.searchNoMatch": "未找到匹配内容",
  "epub.loadFailed": "Book Note EPUB 加载失败: {{error}}",
  "epub.highlightAdded": "已添加{{color}}画线",
  "epub.highlightCreateFailed": "画线创建失败",
  "epub.noteAdded": "已添加标注",
  "epub.noteCreateFailed": "标注创建失败",
  "epub.noteDeleted": "标注已删除",
  "epub.noteDeleteFailed": "标注删除失败",
  "epub.tapPageOn": "点按翻页已开启",
  "epub.swipePageOn": "滑动翻页已开启",
  "epub.keyboardPageOn": "键盘翻页已开启",
  "epub.scrollPageOn": "滚轮翻页已开启",
  "epub.toggleScroll": "切换为滚动",
  "epub.togglePaginate": "切换为分页",
  "epub.readDone": "已读完",
  "epub.remainingLessThanMinute": "剩余不到 1 分钟",
  "epub.toggleToSwipe": "切换为滑动翻页",
  "epub.toggleToTap": "切换为点按翻页",
  "epub.toggleToWheel": "切换为滚轮翻页",
  "epub.toggleToKeyboard": "切换为键盘翻页",

  // EPUB note modal
  "epubNote.color": "画线颜色",
  "epubNote.style": "标注样式",
  "epubNote.title": "写下你的想法",
  "epubNote.placeholder": "在这里写下你的想法或联想…",

  // PDF
  "pdf.selectTextFirst": "请先在 PDF 中选中文本。",
  "pdf.popoverTitle": "PDF 第 {{page}} 页",

  // Bookshelf
  "bookshelf.title": "📚 电子书书架",
  "bookshelf.empty": "Vault 中没有找到电子书文件。",
  "bookshelf.lastRead": "上次阅读：{{chapter}} · {{date}}",
  "bookshelf.readTime": "已读 {{time}}",
  "bookshelf.remaining": "剩余约 {{minutes}} 分钟",
  "bookshelf.displayName": "EPUB 书架",
  "bookshelf.hours": "{{count}}小时",
  "bookshelf.minutes": "{{count}}分",
  "bookshelf.seconds": "{{count}}秒",

  // Popover
  "popover.title": "批注",
  "popover.emptyNote": "暂无附加便签。",
  "popover.onlyHighlight": "仅高亮",

  // Selection toolbar
  "selection.highlight": "高亮 {{color}}",

  // Comment modal
  "modal.sticky.title": "便签",
  "modal.sticky.note": "笔记",
  "modal.sticky.placeholder": "写下你的想法...",
  "modal.sticky.disabledSuffix": "（已停用）",

  // Notices
  "notice.pageNotFound": "未找到第 {{page}} 页",
  "notice.openPdfFirst": "请先打开一个 PDF 文件",
  "notice.pdfNoOutline": "该 PDF 没有目录",
  "notice.pdfOutline": "PDF 目录（{{count}} 项）：\n{{lines}}",
  "notice.selectTextFirst": "请先选中文本。",
  "notice.annotationLinkCopied": "已复制批注链接",
  "notice.pdfViewNotReady": "PDF 阅读视图未能及时就绪",
  "notice.epubFileNotFound": "无法找到对应的电子书文件",
  "notice.epubSourceMissing": "找不到对应电子书文件",
  "notice.epubViewNotReady": "电子书阅读视图未能及时就绪",
  "notice.selectionCopied": "已复制所选内容",
  "notice.invalidLink": "Book Note链接无效",
  "notice.multipleSameId": "找到多个同 ID 批注，已停止跳转以保护数据",
  "notice.annotationGone": "批注已删除或尚未同步",
  "notice.onlyPdfEpubAnnotations": "Book Note 批注仅支持 PDF 与 EPUB 文件。",
  "notice.sourceFileMissing": "找不到批注来源文件",
  "notice.originalChanged": "原文已变化，无法可靠定位该批注",
  "notice.unableResolve": "无法解析源批注",
  "notice.exported": "已导出笔记至 {{path}}",
  "notice.resetTagsFailed": "无法恢复默认标签：{{validation}}",
  "notice.notSaved": "Book Note未保存，请检查写入权限或同步状态：{{path}}",
  "notice.storageTestFailed": "Book Note存储测试失败：{{path}}",
  "notice.cannotRead": "Book Note无法读取 {{path}}，已停止写入以保护批注数据。",
  "notice.storageWritable": "Book Note存储可写：{{path}}",
  "notice.storageNotWritable": "Book Note存储不可写，请检查 .obsidian-annotations 目录权限或同步状态。",
  "notice.storageMigrated": "已将 {{count}} 个批注文件迁移至新存储。",
  "notice.storageMigratePartial": "已迁移 {{migrated}} 个文件，{{failed}} 个失败。",
  "notice.storageMigrateFailed": "批注迁移失败：{{error}}",

  // Tag validation
  "tag.atLeastOne": "请至少保留一个标签。",
  "tag.atLeastOneEnabled": "请至少启用一个标签。",
  "tag.invalidId": "标签 ID 无效。",
  "tag.duplicateId": "标签 ID 重复。",
  "tag.emptyName": "标签名称不能为空。",
  "tag.duplicateName": "标签名称已存在。",
  "tag.invalidIcon": "标签图标无效。",
  "tag.maxEnabled": "最多只能启用 {{max}} 个标签。",
  "tag.nameTooLong": "标签名称不能超过 {{max}} 个字符。",
  "tag.newTagName": "新标签",

  // Export
  "export.heading": "Book Note全库汇总",
  "export.summary": "导出为 Markdown 摘要",
  "export.byColor": "按颜色分组导出",
  "export.notesOnly": "只导出带笔记的批注",
  "export.readingNotes": "导出为阅读笔记格式",

  // Colors
  "color.yellow": "黄色",
  "color.green": "绿色",
  "color.blue": "蓝色",
  "color.pink": "粉色",
  "color.orange": "橙色",
  "color.purple": "紫色",

  // Themes
  "theme.follow": "跟随 Obsidian",
  "theme.white": "默认白",
  "theme.warm": "暖光",
  "theme.green": "护眼绿",
  "theme.sepia": "羊皮纸",
  "theme.dark": "夜间",

  // Highlight styles
  "style.fill": "填充",
  "style.underline": "下划线",
  "style.wavy": "波浪线",

  // Tag icons
  "icon.lightbulb": "灯泡",
  "icon.help": "问号",
  "icon.bell": "铃铛",
  "icon.bookmark": "书签",
  "icon.star": "星标",
  "icon.flag": "旗帜",
  "icon.heart": "心形",

  // Sort
  "sort.document": "文档顺序",
  "sort.newest": "最新优先",
  "sort.oldest": "最早优先",
};

const strings: Dict = isZh ? zh : en;

export function t(key: string, params?: Record<string, string | number>): string {
  let text = strings[key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`{{${k}}}`, "g"), String(v));
    }
  }
  return text;
}
