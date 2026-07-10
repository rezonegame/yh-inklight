import type { PdfTextRange } from "../storage/types";

/**
 * Adapted from the text-layer selection approach in obsidian-pdf-plus (MIT).
 * Geometry remains the navigation fallback when a PDF viewer does not expose
 * stable data-idx attributes.
 */
export function textRangeFromSelection(pageEl: HTMLElement, range: Range): PdfTextRange | null {
  const start = textLayerNode(pageEl, range.startContainer);
  const end = textLayerNode(pageEl, range.endContainer);
  if (!start || !end) {
    return null;
  }

  const beginIndex = Number.parseInt(start.dataset.idx ?? "", 10);
  const endIndex = Number.parseInt(end.dataset.idx ?? "", 10);
  if (!Number.isFinite(beginIndex) || !Number.isFinite(endIndex)) {
    return null;
  }

  return {
    beginIndex,
    beginOffset: offsetWithin(start, range.startContainer, range.startOffset),
    endIndex,
    endOffset: offsetWithin(end, range.endContainer, range.endOffset),
  };
}

function textLayerNode(pageEl: HTMLElement, node: Node): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== pageEl) {
    if (current instanceof HTMLElement && current.dataset.idx !== undefined) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function offsetWithin(root: HTMLElement, target: Node, rangeOffset: number): number {
  let offset = 0;
  const iterator = document.createNodeIterator(root, NodeFilter.SHOW_TEXT);
  for (let node = iterator.nextNode(); node; node = iterator.nextNode()) {
    if (node === target) {
      return offset + rangeOffset;
    }
    offset += node.textContent?.length ?? 0;
  }
  return offset + rangeOffset;
}
