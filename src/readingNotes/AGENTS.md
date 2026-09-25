# readingNotes/
> L2 | 父级: src/AGENTS.md

成员清单
readingNoteBinding.ts: PDF/电子书阅读笔记显式绑定，创建安全的初始 Markdown 并将路径持久化到 sidecar。
readingNoteProjection.ts: PDF/电子书批注按页/章节生成稳定 Markdown 投影，只替换完整受管标记之间的内容。
readingNoteSync.ts: sidecar 批注成功写入后防抖并按 notePath 串行调用 Vault.process，失败提示但不回滚 sidecar。

法则: sidecar 唯一事实源·不认领同名旧文件·手写区原样保留·进度不触发笔记写入

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
