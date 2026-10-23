# anchor/
> L2 | 父级: /Users/epiphanyxiao/Documents/Playground/obsidian-annotation-plugin/src/AGENTS.md

成员清单
textAnchor.ts: 文本锚点核心，生成 offset+quote+context 并恢复轻微漂移后的定位。
fuzzyMatch.ts: 保守字符计数剪枝和带状编辑距离；视觉层可选共享预算，持久化阈值与搜索窗口不变。

法则: offset 优先·quote 兜底·context 判别·失败显式 orphaned

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
