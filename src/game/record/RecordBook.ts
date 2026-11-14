import type { PackSpeciesRow } from "../../data/GameData";
import type { BadgeProgression } from "../world/WorldFlags";
import type { PetCollection } from "../pet/PetCollection";
import { COLLECTION_SNAPSHOT_LENGTH, collectionFamily } from "../pet/PetCollection";
import type { BadgeEntry, PetmapRow, RecordStats } from "../world/WorldPanel";

/**
 * The data behind JavaSE's Đồ giám (`VqsvPanelRuntime.renderRecord`, `petmapRows`,
 * `badgeDisplayIds`, `badgeName`, `badgeDescription`, `badgeStatusText`). Pure: the host hands in
 * the species table, the collection, the badges and the currency.
 */

/** `public/pack/story/badge-catalog.json` (ExportWebBadgeCatalog): the eight source badges. */
export type BadgeCatalogDocument = {
  schema: "vqsv-badge-catalog-v1";
  source: { id: number; name: string; description: string; enhancedDescription: string }[];
};
/** One `data/battle/badges.json` row (`UnifiedBadgeCatalog.Record`). */
export type UnifiedBadgeRecord = {
  runtimeId: number;
  stableKey: string;
  name: string;
  description: string;
  enhanceable: boolean;
  hiddenUntilOwned: boolean;
};

/** `PetmapRow` list for one element tab: species 0..201 that are valid for battle, by id. */
export function petmapRows(
  species: (id: number) => PackSpeciesRow | undefined,
  collection: PetCollection,
  tab: number,
  family = 0,
  variant = 0,
): PetmapRow[] {
  const rows: PetmapRow[] = [];
  for (let id = 0; id < COLLECTION_SNAPSHOT_LENGTH; id++) {
    const row = species(id);
    if (!row || !row.validForBattle || row.element !== tab || collectionFamily(id) !== family) continue;
    const status = collection.status(id, variant === 0 ? 0 : variant + 6);
    rows.push({
      speciesId: id,
      name: row.name || `Pet ${id}`,
      spriteId: row.spriteId,
      seen: status > 0,
      owned: status === 2,
    });
  }
  return rows;
}

/** `renderRecord`'s numbers. */
export function recordStats(input: {
  ownedPets: number;
  collection: PetCollection;
  species: (id: number) => PackSpeciesRow | undefined;
  badges: number;
  playTimeMillis: number;
}): RecordStats {
  const byRelation = (relation: number) =>
    input.collection.countCollected((id) => input.species(id)?.relationClass === relation);
  return {
    owned: input.ownedPets,
    collected: input.collection.allCollectedSpeciesCount(),
    rare: byRelation(1),
    divine: byRelation(2),
    badges: input.badges,
    playTimeMillis: input.playTimeMillis,
  };
}

/** `sourcePlayTime`: `h'm"ss`. */
export function sourcePlayTime(millis: number): string {
  const total = Math.trunc(Math.max(0, millis) / 1000),
    seconds = total % 60,
    minutes = Math.trunc(total / 60) % 60,
    hours = Math.trunc(total / 3600);
  return `${hours}'${minutes}"${seconds < 10 ? "0" : ""}${seconds}`;
}

/** `badgeStatusText`. */
export function badgeStatusText(badges: BadgeProgression, id: number): string {
  if (id === 7 && badges.achieved(id)) return `Bậc ${badges.goldenTier()}`;
  if (!badges.achieved(id)) return "Chưa đạt";
  if (!badges.enhanceable(id)) return "Đã đạt - Không thể cường hóa";
  return badges.enhanced(id) ? "Đã đạt - Đã cường hóa" : "Đã đạt - Chưa cường hóa";
}

/**
 * `badgeDisplayIds`: the eight source badges, then every unified badge that is not hidden until
 * owned or is already owned, each with `badgeName`, `badgeDescription` and its status.
 */
export function badgeEntries(
  badges: BadgeProgression,
  source: BadgeCatalogDocument | undefined,
  unified: readonly UnifiedBadgeRecord[],
): BadgeEntry[] {
  const entries: BadgeEntry[] = [];
  for (let id = 0; id < 8; id++) {
    const row = source?.source.find((badge) => badge.id === id);
    entries.push({
      id,
      name: id === 7 ? "Hoàng Kim Chương" : row?.name ?? `Huy hiệu ${id + 1}`,
      description: id === 7 ? goldenBadgeDescription(badges) : (badges.enhanced(id) ? row?.enhancedDescription : row?.description) ?? "",
      status: badgeStatusText(badges, id),
      achieved: badges.achieved(id),
      goldenRank: id === 7 ? badges.goldenTier() : undefined,
    });
  }
  for (const badge of unified) {
    if (badge.hiddenUntilOwned && !badges.achieved(badge.runtimeId)) continue;
    entries.push({
      id: badge.runtimeId,
      name: badge.name,
      description: badge.description,
      status: badgeStatusText(badges, badge.runtimeId),
      achieved: badges.achieved(badge.runtimeId),
      icon: badge.stableKey,
    });
  }
  return entries;
}

function goldenBadgeDescription(badges: BadgeProgression): string {
  switch (badges.goldenTier()) {
    case 2: return "Toàn bộ pet\nngân hàng\nlên 5 sao,\nkể cả gửi sau.";
    case 1: return "Pet dự bị\ntrong đội\nnhận 30% EXP.";
    default: return "Đủ 281 loài:\nLiệt Hỏa,\nCầu Vồng, V4.";
  }
}
