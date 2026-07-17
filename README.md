# 墨光批注（yh-inklight）

一款非侵入式的 Obsidian 阅读 + 批注插件，支持 **EPUB / PDF / Markdown** 三种格式。高亮与笔记存储在独立 sidecar JSON 中，所有批注都汇入右侧统一面板——**绝不会修改你的原始文档**。

> 从单一的「Markdown/PDF 批注」工具，演进为覆盖 EPUB 全文阅读（foliate-js 引擎）+ 统一批注面板 + 摘录导出 + 双向溯源的综合阅读平台。

---

## ✨ 核心特性

### 📖 EPUB 阅读（foliate-js 引擎）
- **完整阅读体验**：渲染 / 翻页 / 滚动 / 字号 / 6 种主题（跟随 Obsidian、白、暖光、护眼绿、羊皮纸、夜间）
- **6 色高亮 + 想法标注**：选中文本弹出浮动菜单，画线或写想法
- **全文搜索**：工具栏搜索图标，搜索当前章节正文
- **阅读进度**：自动保存位置 + 阅读时间统计 + 剩余时间估算
- **多格式支持**：foliate 原生支持 EPUB / MOBI / AZW3 / FB2 / CBZ / TXT

### 📝 统一批注面板（墨光批注侧栏）
- **三格式统一**：Markdown / PDF / EPUB 批注汇入同一个总览面板
- **筛选与搜索**：按颜色 / 类型 / 标签筛选，关键词搜索批注内容
- **语义标签**：默认提供洞见、疑问、提醒；最多启用 5 个标签，可改名、排序、停用和自定义预设图标
- **行内编辑**：直接在面板编辑想法、添加笔记
- **跳转**：点卡片跳回原文对应位置（Markdown 偏移 / PDF 页码 / EPUB CFI）
- **导出**：Markdown 摘要 / 按颜色分组 / 阅读笔记等多种格式

### 🔗 统一导出 + 双向溯源（EPUB）
- **导出批注**：侧栏底部「导出批注」统一导出 Markdown / PDF / EPUB 标注
- **统一深链**：摘录和侧栏均可生成 `obsidian://inklight` 链接，点击后精确回到 Markdown、PDF 或 EPUB 批注
- **兼容回链**：保留旧 EPUB/PDF 导出中的隐藏定位锚点，升级后旧摘录仍可使用

### 📌 PDF 批注
- 覆盖层高亮矩形 + 便签
- 选区检测 + 颜色标注
- 汇入统一批注面板

### ✍️ Markdown 批注
- CM6 编辑模式高亮扩展
- 阅读模式高亮后处理
- 点击高亮弹出便签

---

## 🚀 安装

### 通过 BRAT（推荐）
1. 安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件
2. BRAT → Add Plugin → 填入仓库地址：`rezonegame/yh-inklight`
3. 安装后启用「墨光批注」
4. **重要**：更新后请**完全退出 Obsidian 再重开**（不是 reload 插件）

### 手动
1. 从 [Releases](https://github.com/rezonegame/yh-inklight/releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 放入 `<vault>/.obsidian/plugins/yh-inklight/`
3. 设置 → 第三方插件 → 启用「墨光批注」

### 打开 EPUB 的前置条件
- 设置 → 文件与链接 → 开启**「检测所有文件扩展名」**
- 这样 `.epub` 等格式才会在文件树显示

---

## ⚙️ 设置

在 设置 → 墨光批注 中配置：

| 设置 | 说明 |
|------|------|
| 默认高亮颜色 | 新建高亮的默认色 |
| 默认作者 | 批注署名 |
| 批注标签 | 管理笔记标签；最多启用 5 个，禁止重复名称 |
| EPUB 默认排版 | 分页 / 滚动 |
| EPUB 字号 | 初始字号 |
| EPUB 高亮样式 | 填充 / 下划线 / 波浪线 |
| EPUB 阅读主题 | 6 种主题 |
| PDF 阅读进度 | 是否记录当前 PDF 页码与阅读进度 |

---

## 📂 数据存储

所有批注数据存储在 `<vault>/.obsidian-annotations/` 目录下的 sidecar JSON 文件中：
- 每个被批注的文件对应一个 `<filename>.json`
- 包含：高亮、笔记、阅读进度，以及为兼容旧版保留的历史字段
- **原始文档零修改**，可随时删除 sidecar 还原

```text
.obsidian-annotations/
  index.json
  notes__reading__book.md.json      # Markdown 批注
  papers__example.pdf.json           # PDF 批注
  books__novel.epub.json             # EPUB 批注（含 CFI 锚点和阅读进度）
```

---

## ⌨️ 命令与快捷键

| 命令 | 快捷键 | 功能 |
|------|--------|------|
| 高亮选中文本 | `Ctrl+Shift+H` | Markdown/PDF 选区高亮 |
| 为选中文本添加便签 | `Ctrl+Alt+M` | 添加想法 |
| 打开批注总览 | — | 打开墨光批注侧栏 |
| 打开 EPUB 书架 | — | 浏览 vault 内电子书 |
| 导出批注 | — | 在墨光批注侧栏底部统一导出当前文件或全库批注 |

---

## 🛠 技术架构

- **EPUB 引擎**：[foliate-js](https://github.com/johnfactotz/foliate-js) 1.0.1（单引擎，原生多格式）
- **渲染**：foliate-view 自定义元素嵌入 Obsidian leaf，CSP/sandbox 补丁适配桌面端
- **数据层**：sidecar JSON（`AnnotationStore`），统一 `FileAnnotationDocument`
- **标注同步**：`renderedAnnotationMeta` 跟踪 foliate 高亮层，保证增删即时刷新
- **非侵入**：所有批注 overlay 叠加，不触碰原文

---

## 📋 版本历史

### v0.20.1
- Fixed: After creating a Markdown highlight, a seven-second "Undo" action is shown. Undoing refreshes both Reading View and the annotation sidebar.
- Fixed: The selection toolbar now responds only to Markdown editor and Reading View body text, excluding note titles, sidebars, search, settings, and other input controls.

### v0.20.0
- 新增：Markdown、PDF、EPUB 共用的语义标签系统；默认提供洞见、疑问、提醒，最多启用 5 个标签
- 新增：设置页支持标签改名、排序、停用、启用、预设图标与恢复默认；名称会进行空格、全半角、大小写归一化并强制禁止重复
- 新增：右侧墨光批注侧栏可按标签统一筛选当前文件或全库批注，未分类和已停用标签也可追溯
- 调整：标签改名即时同步显示到批注卡片、编辑器和后续导出，不批量改写 sidecar；已经导出的 Markdown 仅在再次导出时更新标签文字
- 兼容：旧 Markdown/PDF `title` 与 EPUB `noteType` 自动映射到默认标签；自定义标签以稳定 ID 保存，旧数据不强制迁移
- 导出：四种统一导出格式均包含笔记标签，同时保留深链和旧版定位锚点
- 工程：新增纯逻辑测试，覆盖标签校验、旧分类映射和深链编码；加入 PDF 阅读进度设置开关

### v0.19.1
- 维护：文档、设置和运行时描述与实际功能对齐；清理不再使用的便签避让工具

### v0.19.0
- 重构：统一 Markdown / PDF / EPUB 批注深链；侧栏和导出均可使用同一条 `obsidian://inklight` 回跳链接
- 修复：批注与阅读进度的写入改为串行队列，避免并发保存覆盖 sidecar 与索引
- 修复：重命名迁移覆盖 PDF，跨目录移动时能迁移导出文件并更新 URL 编码路径
- 清理：下线 EPUB 书签运行时入口和残留样式；旧书签与 Canvas 数据继续只读保留
- 体验：侧栏卡片将复制链接和删除操作收进溢出菜单，阅读界面不新增工具栏按钮
- 发布：BRAT 更新使用精确标签 `0.19.0`，Release 提供 `main.js`、`manifest.json` 和 `styles.css`

### v0.18.2
- 修复：Markdown 有批注时，正文下方出现冗余的便签泳道（StickyNoteLane）卡片堆叠并撑出大块空白、遮挡后续内容的问题。右侧墨光批注侧栏已完整覆盖全部功能，故彻底停用泳道
- 清理：移除泳道相关的 4 个设置项（便签宽度 / 显示位置 / 窄屏折叠阈值 / 显示连接线）及对应 CSS、孤立代码文件
- 兼容：`types.ts` 中相关设置字段保留为 optional，旧 `data.json` 升级后不报错

### v0.17.0
- 修复：EPUB 想法标注的 noteType 分类（洞见/疑问/提醒）此前被丢弃，现已持久化并在侧栏卡片显示分类标签
- 修复：从侧栏删除 Markdown 批注后，阅读视图高亮现在即时同步移除（此前需手动 rerender）
- 修复：重命名/移动源文件时，对应的摘录导出文件（`*-notes.md`）现在跟随迁移并更新内部 source 引用
- 修复：`yh-pdf-goto-page` 事件监听器此前未解绑，热重载时会累积泄漏，现已通过 register 正确解绑
- 清理：移除从未被调用的 Canvas 集成死代码（bindCanvas/sendToCanvas 等）；types 字段保留为 optional 兼容旧 sidecar
- 清理：移除 EPUB AI 占位符（AI 按钮 + 「即将上线」提示 + 5 个未使用的 AI 设置字段）
- 清理：移除 PDF 书签 4 个死方法、PdfAnchor.createdScale 等多处死代码
- 重构：抽取共享 Markdown 高亮颜色表、formatTime 工具函数；合并 EPUB CFI 跳转逻辑到统一入口

### v0.16.3
- 迁移：旧摘录导出的 callout、EPUB CFI hidden anchor、Back to source 回跳能力并入统一「导出批注」
- 增强：统一导出为 Markdown/PDF/EPUB 批注生成可定位 callout；PDF 使用 page link，EPUB 使用 CFI 回跳
- 清理：删除废弃 `EpubExcerptExporter`、独立摘录目录/回链设置，以及主类中的旧 exporter 引用

### v0.16.2
- 调整：PDF/EPUB 不再显示额外导出摘录入口，统一走侧栏底部「导出批注」
- 调整：暂时下线 PDF 书签相关侧栏按钮和命令，避免当前页码获取不稳定影响阅读
- 修复：统一导出批注现在同时收集 Markdown、PDF、EPUB 标注

### v0.16.1
- 重构：PDF 书签/列表/删除/导出入口收拢到「墨光批注」侧栏，不再依赖临时 Menu 或 document 事件
- 新增：侧栏内固定 PDF bookmarks 面板，支持点击跳转、当前页提示、逐条删除
- 修复：PDF 摘录导出改为 PDF/EPUB 分支，PDF comment 使用 content 字段并生成 page anchor

### v0.16.0
- 新增：PDF Viewer Adapter，统一当前 PDF、当前页、页数、页面元素、跳转与 pdf.js 生命周期入口
- 优化：PDF 进度恢复、侧栏批注跳转、书签跳转统一走 adapter
- 修复：PDF 添加书签增加写入后校验，降低偶发“点了但没加上”的不确定性

### v0.11.5
- 修复工具栏搜索框 CSS `position: relative`（v0.11.4 脚本静默失败导致定位错误）

### v0.11.4
- 搜索框移到工具栏下方（贴工具栏，非容器底部）
- 搜索功能：缓存当前 section doc，`getContents` 不可靠时回退到缓存
- 菜单消失：标注框 / 删除框点击外部立即关闭（不再死等 8 秒或依赖 mouseleave）
- 段落模式：移除工具栏按钮（作用不大）
- 侧栏搜索：改为只刷新列表不重建搜索框，保持输入焦点

### v0.11.0 ~ v0.11.3
- **Phase 4-B 完成**：摘录导出 / 双向溯源 / 书签 / 脚注预览 / 全文搜索 / Canvas 集成
- 搜索移到工具栏，回链跳转修复（HTML 注释 → hidden span）

### v0.9.0 ~ v0.10.1
- **Phase 4-A 完成**：epubjs → foliate-js 单引擎迁移，移除 epubjs 依赖
- 统一批注系统：EPUB 批注接入墨光批注面板（与 Markdown/PDF 统一）
- 书签系统、想法 Modal、删除链路

### v0.6.0 ~ v0.8.2
- EPUB 核心阅读（foliate 引擎接入、CSP/sandbox 修复、选区菜单、坐标映射）
- 统一标注面板、即时刷新、颜色点修复

### v0.5.x 及更早
- Markdown / PDF 批注基础（高亮、便签栏、侧栏总览、全库搜索、导出模板）

---

## 🔧 开发

```bash
npm install
npm run dev      # 开发构建
npm run build    # 生产构建
```

类型检查：`npx tsc --noEmit`

将 `main.js`、`manifest.json`、`styles.css` 复制到 `<vault>/.obsidian/plugins/yh-inklight/` 测试。

---

## 📝 许可

MIT

## 🙏 致谢与参考

- [foliate-js](https://github.com/johnfactotz/foliate-js) — EPUB 渲染引擎
- [obsidian-weave-reader](https://github.com/) — foliate 集成、脚注/搜索/Canvas 参考
- [ob-epub-reader](https://github.com/) — 摘录回跳、深链方案参考
- [Axl Light](https://github.com/rezonegame/axl-light) — 原始项目基础
