/**
 * [INPUT]: 依赖注释锚点的垂直坐标与用户便签偏移设置
 * [OUTPUT]: 对外提供 layoutStickyNotes，用于便签栏避让排列
 * [POS]: utils 模块的便签排版算法，当前保留为后续便签栏实验的纯函数工具
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

export interface StickyLayoutInput {
  id: string;
  anchorTop: number;
  height: number;
  offsetY: number;
}

export interface StickyLayoutOutput {
  id: string;
  top: number;
}

const GAP = 10;

export function layoutStickyNotes(items: StickyLayoutInput[]): StickyLayoutOutput[] {
  const sorted = [...items].sort((a, b) => a.anchorTop - b.anchorTop);
  const output: StickyLayoutOutput[] = [];
  let cursor = 0;

  for (const item of sorted) {
    const preferred = Math.max(0, item.anchorTop + item.offsetY);
    const top = Math.max(preferred, cursor);
    output.push({ id: item.id, top });
    cursor = top + item.height + GAP;
  }

  return output;
}
