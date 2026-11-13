export type GiftCodeEventRef = { scene: number; room: number; group: number };
export type GiftCodeReward = { id: number; quantity: number };
export type GiftCodeDefinition = {
  code: string;
  active: boolean;
  minTask: number;
  maxTask: number;
  minBadges: number;
  requiredEvents: GiftCodeEventRef[];
  forbiddenEvents: GiftCodeEventRef[];
  startsAtEpochMillis: number;
  expiresAtEpochMillis: number;
  money: number;
  badges: number;
  bagItems: GiftCodeReward[];
  materials: GiftCodeReward[];
  specialRewards: GiftCodeReward[];
  progressionBadges: number[];
  description: string;
};
export type GiftCodeDocument = { profileVersion: string; codes: GiftCodeDefinition[] };
export type GiftCodeOutcome =
  | "redeemed"
  | "empty"
  | "invalid"
  | "inactive"
  | "already_redeemed"
  | "not_started"
  | "expired"
  | "task_condition"
  | "badge_condition"
  | "story_condition"
  | "reward_overflow";
export type GiftCodeResult = { outcome: GiftCodeOutcome; code: string; message: string };

export type GiftCodeInventory = {
  currency: { money: number; badges: number };
  items: Record<string, number>;
  materials: Record<string, number>;
  specials: number[];
  redeemed: string[];
  mainTask: number;
  achievedBadgeCount: number;
  eventComplete: (event: GiftCodeEventRef) => boolean;
  grantBadge: (id: number) => void;
};

const result = (outcome: GiftCodeOutcome, code: string, message: string): GiftCodeResult => ({
  outcome,
  code,
  message,
});
export const normalizeGiftCode = (value: string): string => value.trim().toUpperCase();

/** JavaSE GiftCodeService: a local, build-packaged catalog; no network lookup is performed. */
export function redeemGiftCode(
  definitions: readonly GiftCodeDefinition[],
  inventory: GiftCodeInventory,
  rawCode: string,
  nowEpochMillis: number,
): GiftCodeResult {
  const code = normalizeGiftCode(rawCode);
  if (!code) return result("empty", code, "Hãy nhập mã Giftcode.");
  if (!/^[A-Z0-9_-]{4,32}$/.test(code))
    return result("invalid", code, "Mã chỉ gồm A-Z, 0-9, dấu gạch ngang hoặc gạch dưới.");
  if (inventory.redeemed.includes(code))
    return result("already_redeemed", code, "Giftcode này đã được sử dụng trong save hiện tại.");
  const definition = definitions.find((entry) => entry.code === code);
  if (!definition) return result("invalid", code, "Giftcode không tồn tại.");
  if (!definition.active) return result("inactive", code, "Giftcode hiện không hoạt động.");
  if (nowEpochMillis < definition.startsAtEpochMillis)
    return result("not_started", code, "Giftcode chưa đến thời gian sử dụng.");
  if (definition.expiresAtEpochMillis >= 0 && nowEpochMillis > definition.expiresAtEpochMillis)
    return result("expired", code, "Giftcode đã hết hạn.");
  if (definition.forbiddenEvents.some(inventory.eventComplete))
    return result(
      "story_condition",
      code,
      "Giftcode đã hết hiệu lực do bạn đã vượt qua mốc cốt truyện quy định.",
    );
  if (!definition.requiredEvents.every(inventory.eventComplete))
    return result("story_condition", code, "Giftcode chưa được mở ở tiến độ cốt truyện hiện tại.");
  if (inventory.mainTask < definition.minTask)
    return result(
      "task_condition",
      code,
      `Cần đạt nhiệm vụ chính ${definition.minTask} để dùng mã.`,
    );
  if (definition.maxTask >= 0 && inventory.mainTask > definition.maxTask)
    return result("task_condition", code, "Giftcode không còn phù hợp với tiến độ hiện tại.");
  if (inventory.achievedBadgeCount < definition.minBadges)
    return result(
      "badge_condition",
      code,
      `Cần sở hữu ít nhất ${definition.minBadges} huy chương.`,
    );

  const max = 0x7fffffff,
    materialAdds = new Map<number, number>();
  if (
    inventory.currency.money + definition.money > max ||
    inventory.currency.badges + definition.badges > max
  )
    return result(
      "reward_overflow",
      code,
      "Không thể nhận quà vì một số lượng trong hành trang đã đạt giới hạn.",
    );
  for (const reward of definition.bagItems) {
    const current = inventory.items[String(reward.id)] ?? 0,
      overflow = Math.max(0, current + reward.quantity - 99);
    if (overflow) materialAdds.set(1000 + reward.id, overflow);
  }
  for (const reward of definition.materials)
    materialAdds.set(reward.id, (materialAdds.get(reward.id) ?? 0) + reward.quantity);
  if (
    [...materialAdds].some(
      ([id, quantity]) => (inventory.materials[String(id)] ?? 0) + quantity > max,
    ) ||
    definition.specialRewards.some(
      ({ id, quantity }) =>
        inventory.specials.filter((value) => value === id).length + quantity > 99,
    )
  )
    return result(
      "reward_overflow",
      code,
      "Không thể nhận quà vì một số lượng trong hành trang đã đạt giới hạn.",
    );

  inventory.currency.money += definition.money;
  inventory.currency.badges += definition.badges;
  for (const reward of definition.bagItems) {
    const key = String(reward.id),
      capacity = Math.max(0, 99 - (inventory.items[key] ?? 0)),
      inBag = Math.min(capacity, reward.quantity),
      overflow = reward.quantity - inBag;
    if (inBag) inventory.items[key] = (inventory.items[key] ?? 0) + inBag;
    if (overflow) {
      const overflowKey = String(1000 + reward.id);
      inventory.materials[overflowKey] = (inventory.materials[overflowKey] ?? 0) + overflow;
    }
  }
  for (const reward of definition.materials) {
    const key = String(reward.id);
    inventory.materials[key] = (inventory.materials[key] ?? 0) + reward.quantity;
  }
  for (const reward of definition.specialRewards)
    for (let i = 0; i < reward.quantity; i++) inventory.specials.push(reward.id);
  for (const badge of definition.progressionBadges) inventory.grantBadge(badge);
  inventory.redeemed.push(code);
  return result("redeemed", code, `Đã nhận quà: ${definition.description}`);
}
