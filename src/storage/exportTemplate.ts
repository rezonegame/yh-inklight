/**
 * [INPUT]: 导出条目变量 ExportVars
 * [OUTPUT]: renderTemplate 工具 + 默认导出模板常量
 * [POS]: storage 模块的导出格式化层，把硬编码的 callout 结构改为受限 token 替换
 * [PROTOCOL]: 变更时更新此头部
 *
 * 设计原则（区别于 PDF++ 的 new Function 求值）：
 * - 只做 token 替换，不支持任意 JS 表达式（安全 + 性能）
 * - 语法 {{var}} 或 {{var|filter}}，变量与过滤器均为预定义白名单
 * - 未注册的变量/过滤器保留原文（带 console.warn），不抛错以免中断导出
 */

/** 导出条目可用的变量。所有字段在模板里以 {{fieldName}} 引用。 */
export interface ExportVars {
  /** 完整源文件路径 */
  source: string;
  /** 源文件名（不含扩展名） */
  sourceName: string;
  /** 格式：md / pdf / epub */
  mode: "md" | "pdf" | "epub";
  /** 颜色 key（yellow/orange/...） */
  color: string;
  /** 颜色中文标签 */
  colorLabel: string;
  /** 原文引用（多行字符串） */
  text: string;
  /** 想法/笔记内容（多行字符串，可为空） */
  note: string;
  /** EPUB 章节（仅 epub） */
  chapter: string;
  /** PDF 页码（仅 pdf，MD/EPUB 为空字符串） */
  pageNumber: string;
  /** EPUB CFI（仅 epub） */
  cfi: string;
  /** 唯一块 id，用于 ^blockId 引用 */
  blockId: string;
  /** 创建时间 ISO */
  createdAt: string;
  /** 创建日期 YYYY-MM-DD */
  createdAtDate: string;
  /** 创建时间 HH:MM */
  createdAtTime: string;
  /** callout 类型 inklight-md / inklight-pdf / inklight-epub */
  calloutType: string;
  /** 渲染好的回链 markdown（如 [[file#page=N|Back to source]]），可为空 */
  backLink: string;
  /** 渲染好的 hidden anchor span（含 data-yh-* 属性），可为空 */
  anchor: string;
}

/** 预定义过滤器（纯函数，用户只能引用名字不能自定义逻辑）。 */
const FILTERS: Record<string, (value: string) => string> = {
  trim: (v) => v.trim(),
  upper: (v) => v.toUpperCase(),
  lower: (v) => v.toLowerCase(),
  escape: (v) => v.replace(/["&<>]/g, (c) => ({ '"': "&quot;", "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string)),
};

const TOKEN_RE = /\{\{\s*([\w.]+)(?:\|(\w+))?\s*\}\}/g;

/**
 * 渲染模板：把 {{var}} / {{var|filter}} 替换为 vars 中的值。
 * 未注册变量/过滤器保留原文（不中断导出）。
 */
export function renderTemplate(template: string, vars: ExportVars): string {
  return template.replace(TOKEN_RE, (match, varName: string, filterName?: string) => {
    const raw = (vars as unknown as Record<string, string>)[varName];
    if (raw === undefined) {
      console.warn(`yh-inklight: unknown template variable {{${varName}}}`);
      return match;
    }
    const value = raw ?? "";
    if (filterName && FILTERS[filterName]) {
      return FILTERS[filterName](value);
    }
    if (filterName) {
      console.warn(`yh-inklight: unknown template filter |${filterName}`);
    }
    return value;
  });
}
