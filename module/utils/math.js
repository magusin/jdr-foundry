export function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) n = 0;
  return Math.min(max, Math.max(min, n));
}

export function randInt(min, max) {
  min = Math.floor(Number(min));
  max = Math.floor(Number(max));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  if (max < min) [min, max] = [max, min];
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randFromRange(range, fallback = 0) {
  if (!Array.isArray(range) || range.length < 2) return fallback;
  return randInt(range[0], range[1]);
}

/**
 * Score -> % réduction (progression lente + cap)
 * Ajustable : K plus grand = montée plus lente, CAP plus bas = limite plus stricte.
 */
export function scoreToPct(score, { K = 160, CAP = 70 } = {}) {
  const S = Math.max(0, Number(score) || 0);
  const pct = (S / (S + K)) * 100;
  return Math.min(CAP, Math.round(pct));
}

export function parseCsvInts(csv) {
  return String(csv ?? "")
    .split(",")
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n > 0);
}
