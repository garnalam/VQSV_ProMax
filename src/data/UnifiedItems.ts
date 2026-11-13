/**
 * The JavaSE unified Item catalog (`vqsv.data.UnifiedItemCatalog`, unified-item-v1), baked by
 * `rebuild_game/tools/ExportWebUnifiedItems.java` into `public/pack/items/catalog.json`: one list of
 * the 87 active Items of both games (52 Liệt Hỏa, 35 Cầu Vồng), the aliases older keys resolve to,
 * and each record's icon (a sprite-258 cell, or a pack image for the Cầu Vồng ones).
 */

/** `UnifiedItemInventoryKind`: which inventory list an Item lives in. */
export type UnifiedItemKind = "BAG" | "MATERIAL" | "EQUIPMENT" | "SPECIAL" | "BADGE";

/** One `UnifiedItemRecord`. */
export type UnifiedItemRecord = {
  key: string;
  source: string;
  table: number;
  sourceId: number;
  kind: UnifiedItemKind;
  runtimeId: number;
  name: string;
  description: string;
  category: string;
  mechanic: string;
  usage: string;
  slot: string;
  /** Sprite-258 cell (`frameId`), when `icon` is empty. */
  frame: number;
  /** The record's own icon image, relative to the `items` domain; "" draws `frame`. */
  icon: string;
  implemented: boolean;
  /** `rainbowImported()`: the record came from Cầu Vồng. */
  rainbowImported: boolean;
  effect: Record<string, unknown> | null;
};

export type UnifiedShopAlias = {
  key: string;
  canonical: string;
  sourceId: number;
  name: string;
  description: string;
  frame: number;
  icon: string;
};

export type UnifiedItemsDocument = {
  schema: "vqsv-unified-items-v1";
  balanceVersion: string;
  snapshotSha256: string;
  unsupportedMessage: string;
  records: UnifiedItemRecord[];
  aliases: Record<string, string>;
  shopAliases: UnifiedShopAlias[];
  removed: { key: string; name: string; rationale: string }[];
};

export class UnifiedItemCatalog {
  private readonly byKey = new Map<string, UnifiedItemRecord>();
  private readonly byIdentity = new Map<string, UnifiedItemRecord>();

  constructor(readonly document: UnifiedItemsDocument) {
    for (const record of document.records) {
      this.byKey.set(record.key, record);
      this.byIdentity.set(`${record.kind}:${record.runtimeId}`, record);
    }
  }

  get records(): readonly UnifiedItemRecord[] {
    return this.document.records;
  }

  /** `byStableKey`: an alias resolves to its canonical record. */
  byStableKey(key: string): UnifiedItemRecord | undefined {
    return this.byKey.get(this.document.aliases[key] ?? key);
  }

  /** `requireActive`: as `byStableKey`, but an unknown or removed key is an error. */
  requireActive(key: string): UnifiedItemRecord {
    const record = this.byStableKey(key);
    if (!record) throw new Error(`Unknown, removed or inactive unified Item: ${key}`);
    return record;
  }

  /** `byRuntime(kind, id)`. */
  byRuntime(kind: UnifiedItemKind, runtimeId: number): UnifiedItemRecord | undefined {
    return this.byIdentity.get(`${kind}:${runtimeId}`);
  }

  /** The pack image key of a record's own icon, or null when it draws a sprite-258 cell. */
  static iconKey(record: { icon: string }): string | null {
    return record.icon ? `items.${record.icon}` : null;
  }
}

/** `CauVongOpeningSideQuests.item(source)`: Cầu Vồng item `source` as `CV-ITEM-0-NN`. */
export const cauVongItemKey = (source: number): string =>
  `CV-ITEM-0-${String(source).padStart(2, "0")}`;
