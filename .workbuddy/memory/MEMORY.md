# MEMORY.md - obsidian-book-note (Book Note) 项目长期记忆

## 项目概况
- 插件名：Book Note（id: `book-note`），作者 `hellokunzai`。
- 功能：非侵入式阅读批注插件，支持 Markdown / PDF / EPUB；批注存储在 sidecar 文件，原文不动。
- 仓库：`D:\WorkSprace\gitee\obsidian-book-note`，远程 `gitee.com/hellokunzai/obsidian-book-note`（GitHub 同名镜像 `github.com/hellokunzai/obsidian-book-note`，SSH 别名 `github.com-hellokunzai`）。
- 2026-08-21 完成全量重命名（原 yh-inklight / 墨光批注 / Inklight → Book Note / book-note）。

## 技术栈与构建
- 构建：`node esbuild.config.mjs production` → `main.js`（esbuild，TypeScript → IIFE）。
- 测试：`node scripts/test.mjs`（esbuild bundle + node --test），8/8 pass。
- `obsidian` 是 types-only 包（`"main": ""`），production 构建标记 external；测试构建需要 `alias` 指向 `tests/obsidian-shim.ts`。
- `isDesktopOnly: false`（支持移动端），禁止 Node-only 模块（fs/path/crypto）。

## i18n 约定（2026-08-21 建立）
- 模块：`src/i18n/index.ts`，导出 `t(key, params?)`。
- 语言检测：`moment.locale()`，zh-cn 为主 UI 语言，其他语言回退到 en。
- 所有用户可见字符串必须通过 `t()` 调用，禁止硬编码中文/英文字面量。
- 新增 UI 字符串时：同步在 `en` 和 `zh` 两个 Dict 中添加 key。
- key 命名：`模块.功能`，如 `settings.defaultColor`、`notice.pdfNoOutline`、`tag.duplicateName`。

## 合规红线（obsidian-plugin-dev 阶段四）
1. manifest.json：id 全小写、name Title Case、author 与 GitHub 用户名一致、description 英文且以句号结尾、minAppVersion ≥ 1.4.0。
2. versions.json：当前版本的 minAppVersion 必须与 manifest.json 一致。
3. 安全：禁止 `eval` / `createContextualFragment` / `new Function`。
4. i18n：必须有 en + zh-cn 两份翻译，所有用户可见字符串走 `t()`。
5. styles.css 必须存在（可以为空）。
