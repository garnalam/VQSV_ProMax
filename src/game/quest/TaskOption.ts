import type { PackItem, PackTaskOffer } from "../../data/GameData";

/** One reward line of `taskOption.ui`: an icon from sheet 258 (items) or 257 (the UI cells). */
export type TaskOptionReward = { sheet: 257 | 258; cell: number; label: string };

/**
 * `VqsvPanelRuntime.TaskOptionData`: what `taskOption.ui` shows for one branch task offer — the two
 * answers, up to two reward rows and the line under them.
 */
export type TaskOptionView = {
  taskId: number;
  options: readonly string[];
  rewards: readonly TaskOptionReward[];
  summary: string;
};

/** `TaskOptionReward.fixedUiIcon`'s sheet-257 cell (the coin) for kim tiền and fixed icons. */
const FIXED_UI_ICON = 84;
const NO_ITEM_REWARD = "Không có phần thưởng vật phẩm";

const INVENTORY = {
  "RewardType.ITEM": "UnifiedItemInventoryKind.BAG",
  "RewardType.MATERIAL": "UnifiedItemInventoryKind.MATERIAL",
  "RewardType.SPECIAL_REWARD": "UnifiedItemInventoryKind.SPECIAL",
} as const;

/**
 * `SourceTaskOfferCatalog` (baked as `quest/task-offers.json`) resolved the way
 * `TaskOptionData.branchTask` does: an item, material or special reward shows the Liệt Hỏa unified
 * item's icon and name with `×quantity`, money and fixed icons use the coin cell, and a pet reward
 * becomes the summary line.
 */
export class TaskOptionCatalog {
  private readonly items = new Map<string, PackItem>();

  constructor(
    private readonly offers: Readonly<Record<string, PackTaskOffer>>,
    items: readonly PackItem[],
    private readonly speciesName: (speciesId: number) => string | undefined,
  ) {
    for (const item of items)
      if (item.sourceKey === "liet-hoa")
        this.items.set(`${item.inventoryKind}:${item.runtimeId}`, item);
  }

  view(taskId: number): TaskOptionView | undefined {
    const offer = this.offers[String(taskId)];
    if (!offer) return undefined;
    const rewards: TaskOptionReward[] = [];
    let summary = "";
    for (const reward of offer.rewards) {
      const kind = INVENTORY[reward.type as keyof typeof INVENTORY];
      if (kind) {
        const item = this.items.get(`${kind}:${reward.id}`);
        rewards.push({
          sheet: 258,
          cell: Math.max(0, item?.frameId ?? 0),
          label: `${item?.name ?? ""} ×${reward.quantity}`,
        });
      } else if (reward.type === "RewardType.FIXED_UI_ICON")
        rewards.push({ sheet: 257, cell: FIXED_UI_ICON, label: `×${reward.quantity}` });
      else if (reward.type === "RewardType.MONEY")
        rewards.push({ sheet: 257, cell: FIXED_UI_ICON, label: `${reward.quantity} kim tiền` });
      else if (reward.type === "RewardType.PET_SPECIES")
        summary = `#2${this.speciesName(reward.id) ?? `Pet ${reward.id}`} #0x${reward.quantity}`;
    }
    if (offer.rewards.length === 0) summary = NO_ITEM_REWARD;
    return { taskId, options: offer.options, rewards, summary };
  }
}
