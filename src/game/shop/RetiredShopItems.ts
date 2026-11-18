/**
 * Web only (owner, 2026-11-18): "Đại sư cầu" is sold by no in-game shop. Liệt Hỏa's shopbuy lists
 * it as bag item 3; Cầu Vồng's badge exchange sells bag item 0 (the sure-catch ball) under that
 * name. The baked stocks still carry both rows (a re-export from Java brings them back), so the
 * shops drop them when they list their stock. Selling one back and the Shop Donate are untouched.
 */
const MASTER_BALL_NAME = "đại sư cầu";
const MASTER_BALL_BAG_ID = 3;

export function isRetiredShopRow(row: { kind: string; name: string; id: number }): boolean {
  const bag = row.kind === "BAG" || row.kind === "BAG_ITEM" || row.kind === "item";
  return (
    bag && (row.id === MASTER_BALL_BAG_ID || row.name.trim().toLowerCase() === MASTER_BALL_NAME)
  );
}
