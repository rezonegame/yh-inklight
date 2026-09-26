/**
 * [INPUT]: 阅读笔记原文与显式绑定的源文件路径
 * [OUTPUT]: 校验来源身份，并在源文件改名时最小改写来源字段、来源链接和受管区
 * [POS]: readingNotes 纯逻辑保护层；不猜测、不认领旧导出文件
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { normalizePath, parseYaml } from "obsidian";

import { managedRange, replaceManagedSection } from "./readingNoteProjection";

export interface ReadingNoteIdentity {
  sourcePath: string;
  sourceType: "pdf" | "ebook";
}

function frontmatterBlock(content: string): { header: string; length: number } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) throw new Error("阅读笔记缺少墨光 frontmatter，已停止写入");
  return { header: match[1], length: match[0].length };
}

export function readReadingNoteIdentity(content: string): ReadingNoteIdentity {
  const { header } = frontmatterBlock(content);
  const lines = header.split(/\r?\n/);
  if (["type:", "inklight-source:", "inklight-source-type:", "inklight-schema:"].some((key) =>
    lines.filter((line) => line.startsWith(key)).length !== 1)) {
    throw new Error("阅读笔记来源字段缺失或重复，已停止写入");
  }
  let metadata: unknown;
  try {
    metadata = parseYaml(header);
  } catch {
    throw new Error("阅读笔记 frontmatter 无法解析，已停止写入");
  }
  const value = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  if (value.type !== "inklight-reading-note" || value["inklight-schema"] !== 1
    || typeof value["inklight-source"] !== "string" || !value["inklight-source"].trim()
    || (value["inklight-source-type"] !== "pdf" && value["inklight-source-type"] !== "ebook")) {
    throw new Error("文件不是有效的墨光阅读笔记，已停止写入");
  }
  return { sourcePath: value["inklight-source"], sourceType: value["inklight-source-type"] };
}

export function assertReadingNoteIdentity(content: string, sourcePath: string): void {
  const identity = readReadingNoteIdentity(content);
  const expectedType = sourcePath.toLowerCase().endsWith(".pdf") ? "pdf" : "ebook";
  if (identity.sourcePath !== normalizePath(sourcePath) || identity.sourceType !== expectedType) {
    throw new Error("阅读笔记来源与 sidecar 绑定不一致，已停止同步；请通过命令确认绑定");
  }
  managedRange(content);
}

export function rewriteReadingNoteSource(
  content: string, oldPath: string, newPath: string, projection: string | null,
): string {
  assertReadingNoteIdentity(content, oldPath);
  const { header, length } = frontmatterBlock(content);
  const sourceLines = header.split(/\r?\n/).filter((line) => line.startsWith("inklight-source:"));
  if (sourceLines.length !== 1) throw new Error("阅读笔记来源字段重复或不在单行，已停止迁移");
  const sourceLine = sourceLines[0];
  const oldLink = `来源：[[${oldPath}]]`;
  const linkPosition = content.indexOf(oldLink, length);
  const newLink = `来源：[[${newPath}]]`;
  const newLinkPosition = content.indexOf(newLink, length);
  const userSection = content.indexOf("## 我的笔记", length);
  const boundary = userSection >= 0 && userSection < managedRange(content).start ? userSection : -1;
  const linkIsOld = linkPosition >= 0 && boundary >= 0 && linkPosition < boundary;
  const linkIsAlreadyNew = newLinkPosition >= 0 && boundary >= 0 && newLinkPosition < boundary;
  if (!linkIsOld && !linkIsAlreadyNew) {
    throw new Error("阅读笔记来源链接已修改，已停止迁移以保护手写内容");
  }
  const changedHeader = header.replace(sourceLine, `inklight-source: ${JSON.stringify(normalizePath(newPath))}`);
  const updatedFrontmatter = content.slice(0, length).replace(header, changedHeader);
  const withHeader = updatedFrontmatter + content.slice(length);
  const adjustedLinkPosition = linkPosition + changedHeader.length - header.length;
  const changedLink = linkIsOld
    ? `${withHeader.slice(0, adjustedLinkPosition)}${newLink}${withHeader.slice(adjustedLinkPosition + oldLink.length)}`
    : withHeader;
  return projection === null ? changedLink : replaceManagedSection(changedLink, projection);
}
