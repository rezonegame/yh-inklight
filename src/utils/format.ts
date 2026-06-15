/**
 * [INPUT]: 无
 * [OUTPUT]: 对外提供 formatTime 等格式化工具
 * [POS]: utils 模块的通用格式化函数，供 sidebarView / stickyNoteView 等复用
 * [PROTOCOL]: 变更时更新此头部
 */

/** 把 ISO 时间字符串格式化为 HH:MM（本地时区）。 */
export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
