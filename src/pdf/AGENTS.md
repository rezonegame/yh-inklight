# pdf/
> L2 | 父级: /Users/epiphanyxiao/Documents/Playground/obsidian-annotation-plugin/src/AGENTS.md

成员清单
pdfAnnotationLayer.ts: PDF 选区和可见页投影，局部观察当前 viewer，复用页坐标并隔离自身绘制，取消过期异步回写。
pdfViewerAdapter.ts: Obsidian 原生 PDF viewer 适配层，封装当前文件、当前页、页面跳转、pdf.js eventBus 与页面生命周期。

法则: PDF 坐标独立·文件不写入·矩形投影·DOM 适配保守

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
