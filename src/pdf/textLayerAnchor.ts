/**
 * [INPUT]: PDF 选区 (Selection/Range) + textLayer DOM
 * [OUTPUT]: PdfTextRange 文本锚点 {beginIndex, beginOffset, endIndex, endOffset}
 * [POS]: PDF 模块的文本锚点提取层，移植自 PDF++ utils/index.ts:116-146
 *        解决纯 viewport 百分比 rect 在旋转/重排后高亮漂移的问题
 * [PROTOCOL]: 变更时更新此头部
 *
 * 核心算法（参考 PDF++ getTextSelectionRange）：
 * 1. 从 range.startContainer/endContainer 向上找带 textLayerNode class 的元素
 * 2. 读 data-idx（pdf.js 给每个 textLayer div 编的序号）
 * 3. 用 NodeIterator 累加 textContent.length 得到 node 内字符偏移
 */

/** textLayer 文本范围（pdf.js 的 data-idx + 字符偏移）。 */
export interface PdfTextRange {
  beginIndex: number;
  beginOffset: number;
  endIndex: number;
  endOffset: number;
}

/**
 * Obsidian 1.8.0 起 pdf.js 的 textLayer div 的 data-idx 从 1 开始，之前从 0 开始。
 * 这里做版本适配：实际运行时通过探测修正，默认 0。
 */
let textDivFirstIdx = 0;

export function setTextDivFirstIdx(value: number): void {
  textDivFirstIdx = value;
}

/**
 * 从一个 DOM 节点向上查找所属的 textLayerNode 元素（带 textLayerNode class 的 span）。
 * 跨页时返回 null（textLayerNode 只存在于单页内）。
 */
function getTextLayerNode(pageEl: HTMLElement, node: Node): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== pageEl) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as HTMLElement;
      // pdf.js 1.8+ 用 data-idx 标记每个文本 div
      if (el.dataset.idx !== undefined) {
        return el;
      }
    }
    current = current.parentNode;
  }
  return null;
}

/**
 * 计算一个 textNode 在其所属 textLayerNode 内的字符偏移。
 * 用 NodeIterator 遍历 textLayerNode 内所有文本节点，累加 textContent.length。
 */
function getOffsetInTextLayerNode(textLayerNode: HTMLElement, targetNode: Node, rangeOffset: number): number {
  let offset = 0;
  const iterator = document.createNodeIterator(textLayerNode, NodeFilter.SHOW_TEXT, null);
  let current = iterator.nextNode();
  while (current) {
    if (current === targetNode) {
      return offset + rangeOffset;
    }
    offset += (current.textContent?.length ?? 0);
    current = iterator.nextNode();
  }
  return offset + rangeOffset;
}

/**
 * 从 DOM Selection 提取 textLayer 文本范围。
 * @param pageEl 当前页元素（含 .textLayer）
 * @param range 选区 Range
 * @returns PdfTextRange 或 null（跨页/无 textLayer 时）
 */
export function getTextRangeFromSelection(pageEl: HTMLElement, range: Range): PdfTextRange | null {
  const startNode = getTextLayerNode(pageEl, range.startContainer);
  const endNode = getTextLayerNode(pageEl, range.endContainer);

  if (!startNode || !endNode) {
    return null; // 跨页或不在 textLayer 内
  }

  const startIdx = Number.parseInt(startNode.dataset.idx ?? "0", 10);
  const endIdx = Number.parseInt(endNode.dataset.idx ?? "0", 10);

  if (Number.isNaN(startIdx) || Number.isNaN(endIdx)) {
    return null;
  }

  const beginOffset = getOffsetInTextLayerNode(startNode, range.startContainer, range.startOffset);
  const endOffset = getOffsetInTextLayerNode(endNode, range.endContainer, range.endOffset);

  return {
    beginIndex: startIdx - textDivFirstIdx,
    beginOffset,
    endIndex: endIdx - textDivFirstIdx,
    endOffset,
  };
}

/**
 * 把 PdfTextRange 序列化为紧凑字符串（用于 data-yh-pdf-selection 属性）。
 */
export function serializeTextRange(tr: PdfTextRange): string {
  return `${tr.beginIndex},${tr.beginOffset},${tr.endIndex},${tr.endOffset}`;
}

/**
 * 反序列化 PdfTextRange。
 */
export function parseTextRange(s: string): PdfTextRange | null {
  const parts = s.split(",").map((p) => Number.parseInt(p.trim(), 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  return { beginIndex: parts[0], beginOffset: parts[1], endIndex: parts[2], endOffset: parts[3] };
}
