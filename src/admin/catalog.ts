import type { AdminItemKind } from "../account/AdminApi";
import {
  ADMIN_KIND_LABELS,
  adminItemChoices,
  adminSpeciesChoices,
  type AdminItemChoice,
  type AdminSpeciesChoice,
} from "../game/admin/AdminTool";
import { GameAssets } from "../game/story/GameAssets";
import { Pack } from "../pack/Pack";

/**
 * The names the admin page shows: every item and species the in-game Admin Tool lists, read from
 * the same game pack and built by the same functions, so an id here is the id the game uses.
 */
export type AdminCatalog = {
  items: AdminItemChoice[];
  species: AdminSpeciesChoice[];
  itemName: (kind: AdminItemKind, id: number) => string;
  speciesName: (id: number) => string;
  kindLabel: (kind: AdminItemKind) => string;
  /** The text a datalist option shows for an item, and the item an option's text names. */
  itemLabel: (kind: AdminItemKind, id: number) => string;
  parseItem: (text: string) => AdminItemChoice | undefined;
  speciesLabel: (id: number) => string;
  parseSpecies: (text: string) => number | undefined;
  /** The rooms an admin may move a player to (server/live.mjs accepts the same set). */
  rooms: { scene: number; room: number; label: string }[];
  roomLabel: (scene: number, room: number) => string;
  mainTasks: { index: number; name: string }[];
  branchTasks: { id: number; name: string }[];
  branchName: (id: number) => string;
};

export async function loadAdminCatalog(): Promise<AdminCatalog> {
  const pack = await Pack.load();
  const assets = await GameAssets.fromPack(pack);
  const items = assets.bagItems ? adminItemChoices(assets.bagItems, assets.campaignSystems?.eggs ?? []) : [];
  const species = adminSpeciesChoices(assets.petStats.allSpecies());
  const byItem = new Map(items.map((item) => [`${item.kind}:${item.id}`, item]));
  const itemLabel = (kind: AdminItemKind, id: number) =>
    `${byItem.get(`${kind}:${id}`)?.name ?? "?"} · ${ADMIN_KIND_LABELS[kind]} #${id}`;
  const byLabel = new Map(items.map((item) => [itemLabel(item.kind, item.id), item]));
  const speciesName = (id: number) =>
    assets.petStats.speciesRow(id)?.name?.trim() || `Pet #${id}`;
  const speciesLabel = (id: number) => `${speciesName(id)} #${id}`;
  const roomLabel = (scene: number, room: number) =>
    `${assets.roomName(scene, room) || (scene === 98 ? "Cầu Vồng" : "Phòng")} · ${scene}:${room}`;
  const rooms = Object.keys(assets.rooms)
    .map((key) => key.split(":").map(Number))
    .filter(([scene, room]) => scene >= 1 && scene <= 98 && room >= 0 && room <= 99)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([scene, room]) => ({ scene, room, label: roomLabel(scene, room) }));
  const quests = assets.quests;
  return {
    rooms,
    roomLabel,
    mainTasks: (quests?.mainTasks ?? []).map((task, index) => ({ index, name: task.name })),
    branchTasks: (quests?.branchTasks ?? []).map((task) => ({ id: task.id, name: task.name })),
    branchName: (id) => quests?.branch(id)?.name ?? `Nhiệm vụ phụ #${id}`,
    items,
    species,
    itemName: (kind, id) => byItem.get(`${kind}:${id}`)?.name ?? `${ADMIN_KIND_LABELS[kind]} #${id}`,
    speciesName,
    kindLabel: (kind) => ADMIN_KIND_LABELS[kind],
    itemLabel,
    parseItem: (text) => {
      const exact = byLabel.get(text.trim());
      if (exact) return exact;
      // "Vật phẩm #12" or "BAG 12" typed by hand.
      const match = /(Vật phẩm|Trang sức|Nguyên liệu|Đặc biệt|BAG|EQUIPMENT|MATERIAL|SPECIAL)\s*[#:]?\s*(\d+)\s*$/i.exec(text.trim());
      if (!match) return undefined;
      const word = match[1].toUpperCase();
      const kind = (Object.entries(ADMIN_KIND_LABELS).find(([, label]) => label.toUpperCase() === word)?.[0] ??
        word) as AdminItemKind;
      return byItem.get(`${kind}:${Number(match[2])}`);
    },
    speciesLabel,
    parseSpecies: (text) => {
      const id = Number(/#\s*(\d+)\s*$/.exec(text.trim())?.[1] ?? NaN);
      return species.some((row) => row.speciesId === id) ? id : undefined;
    },
  };
}
