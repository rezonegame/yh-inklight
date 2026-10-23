// Immutable matching oracle derived from 0.23.7; do not optimize alongside production.
const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
function distance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    for (let j = 0; j <= b.length; j++) previous[j] = current[j];
  }
  return previous[b.length];
}
function scan(source: string, target: string, start: number, end: number) {
  const min = Math.max(1, Math.floor(target.length * 0.75));
  const max = Math.max(min, Math.ceil(target.length * 1.35));
  let best: { startOffset: number; endOffset: number; confidence: number } | null = null;
  for (let offset = start; offset < end; offset += Math.max(1, Math.floor(target.length / 8))) {
    for (let length = min; length <= max; length += Math.max(1, Math.floor(target.length / 6))) {
      const finish = Math.min(source.length, offset + length);
      if (finish <= offset) continue;
      const a = normalize(target), b = normalize(source.slice(offset, finish));
      const confidence = !a || !b ? 0 : 1 - distance(a, b) / Math.max(a.length, b.length);
      if (!best || confidence > best.confidence) best = { startOffset: offset, endOffset: finish, confidence };
    }
  }
  return best && best.confidence >= 0.55 ? best : null;
}
export function referenceFuzzyMatch(source: string, target: string, expectedStart: number) {
  if (!normalize(target)) return null;
  const exact = source.indexOf(target);
  if (exact >= 0) return { startOffset: exact, endOffset: exact + target.length, confidence: 1 };
  const radius = Math.max(300, target.length * 8);
  const local = scan(source, target, Math.max(0, expectedStart - radius), Math.min(source.length, expectedStart + radius + target.length));
  return local && local.confidence >= 0.6 ? local : scan(source, target, 0, source.length);
}
