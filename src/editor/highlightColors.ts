/**
 * [INPUT]: 无
 * [OUTPUT]: 对外提供 HIGHLIGHT_BACKGROUND 颜色表与 highlightBackground 工具函数
 * [POS]: editor 模块共享的颜色常量，CM6 编辑层与 Reading 视图层共用同一份 rgba 配色
 * [PROTOCOL]: 变更时更新此头部
 *
 * 注意：这是 Markdown 高亮的配色（alpha 0.28~0.42）。
 * EPUB 的高亮用 storage/types.ts 的 EPUB_COLOR_MAP（alpha 0.38），用途不同，不合并。
 */

import type { AnnotationColor } from "../storage/types";

/** Markdown 高亮背景色表（CM6 编辑层 + Reading 视图层共用）。 */
export const HIGHLIGHT_BACKGROUND: Record<AnnotationColor, string> = {
  yellow: "rgba(245, 197, 24, 0.42)",
  orange: "rgba(255, 140, 0, 0.36)",
  pink: "rgba(255, 105, 180, 0.32)",
  green: "rgba(82, 196, 26, 0.30)",
  blue: "rgba(22, 119, 255, 0.28)",
  purple: "rgba(114, 46, 209, 0.30)",
};

/** 按 color 名取背景色，未知值回退黄色。 */
export function highlightBackground(color: string): string {
  return (HIGHLIGHT_BACKGROUND as Record<string, string>)[color] ?? HIGHLIGHT_BACKGROUND.yellow;
}
