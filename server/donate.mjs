/**
 * Web only (owner, 2026-11-18): the support rates the "Ủng hộ" panel lists ("10.000đ → 10 Lượng").
 * An admin edits them on the admin page's "Nạp tiền" view; transfers are read and thanked by hand.
 */
export const DONATE_RATES_KEY = 'donate_rates';
export const MAX_DONATE_RATES = 10;
export const DEFAULT_DONATE_RATES = [
  { vnd: 10000, luong: 10 },
  { vnd: 20000, luong: 30 },
];

/** `[{ vnd, luong }]`, 1..10 rows of whole positive numbers, sorted by amount; null if not. */
export function normalizeDonateRates(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_DONATE_RATES) return null;
  const rows = [];
  for (const row of input) {
    const vnd = Number(row?.vnd), luong = Number(row?.luong);
    if (!Number.isSafeInteger(vnd) || vnd < 1000 || vnd > 1_000_000_000) return null;
    if (!Number.isSafeInteger(luong) || luong < 1 || luong > 1_000_000) return null;
    if (rows.some(r => r.vnd === vnd)) return null;
    rows.push({ vnd, luong });
  }
  return rows.sort((a, b) => a.vnd - b.vnd);
}
