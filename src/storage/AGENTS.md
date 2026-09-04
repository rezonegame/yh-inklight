# storage/
> L2 | 父级: /Users/epiphanyxiao/Documents/Playground/obsidian-annotation-plugin/src/AGENTS.md

成员清单
types.ts: sidecar JSON、注释、便签、代码选区标记、EPUB 阅读排版 profile、设置和索引的类型真相源。
annotationStore.ts: .obsidian-annotations 持久化入口，负责文件 JSON、index、导出与迁移；写入前备份并严格回读校验。
documentMerge.ts: 纯逻辑三方合并器，按稳定 ID 应用本地操作并保留磁盘上的并发记录。

法则: Markdown 只读·sidecar 持久·缓存加速·索引导航·损坏不覆盖·写前备份

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
