# 墨光批注

墨光批注是一款非侵入式 Obsidian 阅读批注插件，支持 Markdown 和 PDF 文件。它提供覆盖层高亮、便签栏、批注概览、搜索跳转和 Markdown 导出功能，同时保持原始文档不变。

**本插件绝不会修改你的 Markdown 或 PDF 文件。** 批注数据单独存储在 `.obsidian-annotations/` 目录下的 sidecar JSON 文件中。

> 本插件基于 [Axl Light](https://github.com/rezonegame/axl-light) 开发，在原有功能基础上增加了编辑器旁便签栏和行内编辑功能。

## 最新版本：v0.5.5

### v0.5.5 长路径 sidecar 修复

- ✅ **长路径可保存**：新文档 sidecar 文件名过长时自动使用“文件名前缀 + 路径 hash”的紧凑命名
- ✅ **兼容旧数据**：已有短 sidecar 文件继续按原路径读写，不迁移、不改 schema
- ✅ **修复新增失败**：解决长中文目录或长 PDF 文件名导致新批注无法创建 JSON 的问题

### v0.5.4 持久化可靠性修复

- ✅ **保存后验证**：批注写入 sidecar 后会立即读回验证，避免“重启前可见、重启后消失”
- ✅ **内存状态保护**：只有磁盘保存成功后才更新内存缓存和索引，写入失败不再伪装成功
- ✅ **存储诊断命令**：新增“测试墨光批注存储”命令，可检查 `.obsidian-annotations/` 是否真实可写

### v0.5.3 侧栏刷新修复

- ✅ **即时刷新更稳定**：侧栏刷新请求会合并执行，避免旧的异步渲染覆盖新结果
- ✅ **手动刷新按钮**：批注侧栏标题栏新增刷新按钮，不重置搜索、筛选、排序和导出模板
- ✅ **关闭按钮修正**：标题栏关闭按钮明确显示为 X 图标

### v0.5.2 功能升级

- ✅ **全库批注总览**：侧栏支持在“当前文件”和“全库”之间切换，跨 Markdown/PDF 搜索、筛选、排序和跳转
- ✅ **导出模板**：支持默认摘要、按颜色分组、只导出笔记、阅读笔记四种 Markdown 导出格式
- ✅ **全库导出**：全库模式下可导出 `inklight-all-notes*.md` 汇总文件
- ✅ **创建便签快捷键**：首次添加便签弹窗支持 `Cmd/Ctrl + Enter` 保存、`Esc` 取消

### v0.5.1 最小升级

- ✅ **自动备份 sidecar 批注**：根据“数据备份频率”设置，将 `.obsidian-annotations/` 下的批注 JSON 快照保存到 `.obsidian-annotations/backups/`
- ✅ **选区复用保护**：切换文件后不会继续使用旧文件选区，避免批注写入错误文档
- ✅ **sidecar 读取保护**：批注 JSON 损坏时停止写入并提示，避免静默覆盖为空数据
- ✅ **重复文本定位优化**：阅读视图中重复文本会优先使用上下文和原始位置匹配
- ✅ **便签栏细节修复**：连接线设置生效，并兼容更多高亮 DOM 形态

### v0.5.0 新增功能

- ✅ **编辑器旁便签栏**：在 Markdown 编辑器右侧显示便签卡片，支持 Markdown 渲染
- ✅ **便签行内编辑**：点击铅笔按钮直接编辑便签内容，按 `Cmd/Ctrl + Enter` 保存
- ✅ **窄屏自动隐藏**：当编辑器宽度低于设定阈值时，便签栏自动隐藏，由弹层接管
- ✅ **六种颜色主题**：便签支持黄色、橙色、粉色、绿色、蓝色、紫色六种颜色
- ✅ **暗色模式支持**：便签样式适配 Obsidian 暗色主题

### 技术改进

- 新增 `StickyNoteLane` 类管理便签栏生命周期
- 整合 `positioning.ts` 避让算法和 `stickyNoteView.ts` 卡片组件
- 监听 `active-leaf-change` 和 `layout-change` 事件自动渲染

## 功能特性

- 覆盖层高亮：支持 Markdown 实时预览、源码模式、阅读视图和 PDF
- 移动端友好的阅读视图高亮恢复，支持延迟渲染和 DOM 观察
- 浮动工具栏：六种颜色、便签、复制和批注概览操作
- 编辑器旁便签栏：支持 Markdown 渲染笔记，窄屏自动隐藏
- 便签和侧栏笔记的行内编辑：按 `Cmd/Ctrl + Enter` 快捷保存
- 侧栏批注概览：搜索、颜色筛选、排序、跳转、删除、添加笔记和导出
- 全库批注总览：跨文件查看、搜索、筛选和导出所有 sidecar 批注
- 导出模板：默认摘要、按颜色分组、只导出笔记、阅读笔记
- Sidecar JSON 存储，支持模糊文本锚点重定位
- Windows 安全路径规范化和重命名迁移处理

## 安装方式

### BRAT 安装

1. 安装 Obsidian BRAT 插件
2. 运行 `BRAT: Add a beta plugin for testing`
3. 粘贴本仓库 URL：

```text
https://github.com/rezonegame/yh-inklight
```

4. 在 `设置 → 第三方插件` 中启用 `墨光批注`

### 快速安装

在终端中运行以下命令，将路径替换为你的 Obsidian 仓库路径：

```bash
curl -fsSL https://raw.githubusercontent.com/rezonegame/yh-inklight/main/scripts/install.sh | bash -s -- "$HOME/Documents/Obsidian Vault"
```

然后重启 Obsidian，打开 设置 → 第三方插件，启用 墨光批注。

![从终端安装墨光批注](docs/images/install-axl-light-command.png)

### 手动安装

1. 从最新 Release 下载以下三个文件：
   https://github.com/rezonegame/yh-inklight/releases/latest

   - `main.js`
   - `manifest.json`
   - `styles.css`

2. 将它们移动到：
    `<你的仓库>/.obsidian/plugins/yh-inklight/`

3. 重启 Obsidian

4. 设置 → 第三方插件 → 启用 "墨光批注"

**不要**从绿色 `Code` 按钮下载源代码 ZIP。Obsidian 需要的是构建后的 Release 文件。

### 测试版下载

如果你只想测试指定版本，可以打开：

```text
https://github.com/rezonegame/yh-inklight/releases/tag/v0.5.5
```

下载该版本的 `main.js`、`manifest.json` 和 `styles.css`，放入 `<你的仓库>/.obsidian/plugins/yh-inklight/` 后重启 Obsidian。

## 使用方法

### 高亮文本

在 Markdown 或 PDF 中选择文本，使用浮动工具栏选择颜色、添加便签、复制选区或打开批注概览。

**操作步骤：**
1. 在文档中选择要高亮的文本
2. 浮动工具栏会自动出现在选区上方
3. 点击颜色按钮（黄色、橙色、粉色、绿色、蓝色、紫色）创建高亮
4. 点击便签图标添加笔记，或点击复制图标复制选区
5. 点击概览图标打开批注总览面板

![使用墨光批注高亮](docs/images/highlight-with-axl-light.png)

### 编辑器旁便签栏

在 Markdown 编辑器中，便签会自动显示在编辑器右侧，与对应的高亮位置对齐。

**功能说明：**
- 便签卡片显示引用文本、笔记内容、作者和时间
- 点击铅笔按钮进入编辑模式，按 `Cmd/Ctrl + Enter` 保存
- 点击折叠按钮收起/展开便签内容
- 点击删除按钮移除便签
- 窄屏时便签栏自动隐藏，由弹层接管

### 编辑便签

在便签栏或批注概览中，点击铅笔按钮进入编辑模式。

**编辑操作：**
1. 点击铅笔按钮打开编辑器
2. 在文本框中输入或修改笔记内容（支持 Markdown）
3. 可选：修改便签标题（类型）
4. 按 `Cmd/Ctrl + Enter` 保存，或按 `Esc` 取消

![便签栏和批注概览](docs/images/sticky-notes-overview.png)

### 批注概览

通过侧栏面板查看、搜索、筛选和管理所有批注。

**面板功能：**
- **范围切换**：在当前文件和全库批注之间切换
- **搜索**：输入关键词搜索高亮和笔记内容
- **颜色筛选**：按颜色过滤批注
- **类型筛选**：查看全部/高亮/笔记
- **排序**：按文档顺序/最新/最早排序
- **跳转**：点击跳转按钮定位到原文位置
- **删除**：点击删除按钮移除批注
- **添加笔记**：为已有高亮添加笔记
- **导出**：将所有批注导出为 Markdown 文件

### 搜索、跳转和导出

**搜索功能：**
- 在搜索框输入关键词，实时过滤匹配的批注
- 搜索范围包括引用文本和笔记内容

**跳转功能：**
- 点击跳转按钮，编辑器自动滚动到高亮位置
- PDF 文件会跳转到对应页面
- 目标位置会有闪烁提示

**导出功能：**
- 点击底部的 "↑ 导出批注" 按钮
- 选择导出模板：默认摘要、按颜色分组、只导出笔记、阅读笔记
- 当前文件模式导出 `<原文件名>-notes.md` 或带模板后缀的 Markdown 文件
- 全库模式导出 `inklight-all-notes.md` 或带模板后缀的全库汇总文件

## 快捷键

- `高亮选中文本`：`Cmd/Ctrl + Shift + H`
- `为选区添加便签`：`Cmd/Ctrl + Alt + M`
- `切换便签栏`：`Cmd/Ctrl + Shift + N`
- `打开批注概览`：通过命令面板或侧栏按钮

## 设置选项

在 `设置 → 墨光批注` 中可以配置以下选项：

- **默认高亮颜色**：选择创建高亮时的默认颜色
- **便签宽度**：调整便签卡片的宽度（220-420px）
- **便签显示位置**：选择便签栏显示在左侧或右侧
- **窄屏折叠阈值**：设置便签栏自动隐藏的宽度阈值（640-1200px）
- **显示连接线**：显示/隐藏便签与高亮之间的连接线
- **默认作者**：设置便签的默认作者名称
- **数据备份频率**：自动备份间隔（分钟）
- **重命名时迁移批注**：重命名文件时自动迁移批注数据
- **显示便签**：全局开关便签栏显示

## 数据存储

墨光批注将批注存储在你的仓库中：

```text
.obsidian-annotations/
  index.json
  notes__reading__book.md.json
  papers__example.pdf.json
  backups/
    2026-05-17T12-00-00-000Z/
      notes__reading__book.md.json
```

Sidecar 文件包含锚点、选中文本、颜色、便签内容、可选标题、时间戳和 PDF 页面矩形信息。

`backups/` 目录只保存 sidecar JSON 的历史快照，用于防止批注数据误删或损坏；它不会备份或修改你的原始 Markdown/PDF 文件。

你的原始 `.md` 和 `.pdf` 文件保持不变。即使禁用或卸载插件，文档也不会被修改。

## 已知限制

- 阅读视图的高亮基于渲染后的 DOM 文本匹配，因此不常见的主题或大量重写渲染 HTML 的插件可能会影响高亮位置。
- PDF 支持依赖于 Obsidian 内置 PDF 查看器的 DOM 结构。
- PDF 文本选择和矩形锚点在旋转页面或特殊 PDF 布局下可能需要改进重定位。
- 大量批注集目前直接在侧栏中渲染，虚拟滚动计划中。

## 开发

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

将 `main.js`、`manifest.json` 和 `styles.css` 复制到：

```text
<你的仓库>/.obsidian/plugins/yh-inklight/
```

## 许可证

MIT。详见 [LICENSE](LICENSE)。

## 原始项目

本插件基于 [Axl Light](https://github.com/rezonegame/axl-light) 开发，感谢原作者的贡献。

## 参考项目

本插件的功能实现参考了以下开源项目的设计理念：

- [Obsidian Highlighter](https://github.com/chrisgrieser/obsidian-highlighter) — 非侵入式高亮和侧边栏批注
- [Obsidian Annotator](https://github.com/ivan-lednev/obsidian-annotator) — PDF 注释和便签管理
- [Obsidian Sticky Notes](https://github.com/DeathAwe/obsidian-sticky-notes) — 便签卡片和排版算法
