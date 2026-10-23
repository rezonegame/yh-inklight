/**
 * [INPUT]: 依赖原文字符串、目标文本与粗略 offset
 * [OUTPUT]: 保守剪枝的模糊恢复与可选视觉预算；持久化匹配阈值、窗口及最优结果语义不变
 * [POS]: anchor 模块的容错匹配器，被 textAnchor 调用
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

export interface FuzzyMatchResult {
  startOffset: number;
  endOffset: number;
  confidence: number;
}

export interface FuzzyMatchBudget {
  comparisons: number;
  cells: number;
  exhausted?: boolean;
}

export function findBestFuzzyMatch(
  source: string,
  target: string,
  expectedStart: number,
  budget?: FuzzyMatchBudget,
): FuzzyMatchResult | null {
  const needle = normalize(target);
  if (!needle) {
    return null;
  }

  const exact = source.indexOf(target);
  if (exact >= 0) {
    return {
      startOffset: exact,
      endOffset: exact + target.length,
      confidence: 1,
    };
  }

  const radius = Math.max(300, target.length * 8);
  const windowStart = Math.max(0, expectedStart - radius);
  const windowEnd = Math.min(source.length, expectedStart + radius + target.length);
  const local = scanWindow(source, target, windowStart, windowEnd, budget);
  if (local && local.confidence >= 0.6) {
    return local;
  }

  return scanWindow(source, target, 0, source.length, budget);
}

function scanWindow(
  source: string,
  target: string,
  windowStart: number,
  windowEnd: number,
  budget?: FuzzyMatchBudget,
): FuzzyMatchResult | null {
  const targetLength = target.length;
  const minLength = Math.max(1, Math.floor(targetLength * 0.75));
  const maxLength = Math.max(minLength, Math.ceil(targetLength * 1.35));
  let best: FuzzyMatchResult | null = null;
  const normalizedTarget = normalize(target);
  const frequencies = characterCounts(normalizedTarget);

  for (let start = windowStart; start < windowEnd; start += Math.max(1, Math.floor(targetLength / 8))) {
    for (let length = minLength; length <= maxLength; length += Math.max(1, Math.floor(targetLength / 6))) {
      const end = Math.min(source.length, start + length);
      if (end <= start) {
        continue;
      }

      const candidate = source.slice(start, end);
      const confidence = similarity(normalizedTarget, candidate, frequencies, budget);
      if (budget?.exhausted) return null;
      if (!best || confidence > best.confidence) {
        best = { startOffset: start, endOffset: end, confidence };
      }
    }
  }

  return best && best.confidence >= 0.55 ? best : null;
}

function similarity(left: string, b: string, frequencies: Map<string, number>, budget?: FuzzyMatchBudget): number {
  const right = normalize(b);
  if (!left || !right) {
    return 0;
  }

  if (budget) {
    const cells = left.length * right.length;
    if (budget.exhausted || budget.comparisons < 1 || budget.cells < cells) {
      budget.exhausted = true;
      return 0;
    }
    budget.comparisons--;
    budget.cells -= cells;
  }

  // Results below 0.55 are never returned. A conservative 0.50 cutoff keeps
  // every eligible result while cheaply rejecting impossible candidates.
  const maxDistance = Math.floor(Math.max(left.length, right.length) / 2);
  const differences = new Map(frequencies);
  for (let i = 0; i < right.length; i++) differences.set(right[i], (differences.get(right[i]) ?? 0) - 1);
  let missing = 0, extra = 0;
  for (const value of differences.values()) { if (value > 0) missing += value; else extra -= value; }
  if (Math.max(missing, extra) > maxDistance) return 0;
  const distance = levenshtein(left, right, maxDistance);
  return 1 - distance / Math.max(left.length, right.length);
}

function characterCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < value.length; i++) counts.set(value[i], (counts.get(value[i]) ?? 0) + 1);
  return counts;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function levenshtein(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index <= limit ? index : Infinity);
  let current = Array.from({ length: b.length + 1 }, () => Infinity);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    const start = Math.max(1, i - limit), end = Math.min(b.length, i + limit);
    if (start > 1) current[start - 1] = Infinity;
    let minimum = current[0];
    for (let j = start; j <= end; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
      minimum = Math.min(minimum, current[j]);
    }
    if (end < b.length) current[end + 1] = Infinity;
    if (minimum > limit) return limit + 1;
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}
