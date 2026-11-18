import type { AdminItemKind } from "../account/AdminApi";
import type { AdminCatalog } from "./catalog";
import { el, number } from "./dom";

/** A gift as the server stores it (server/rewards.mjs). */
export type Rewards = {
  money: number;
  badges: number;
  items: { kind: AdminItemKind; id: number; quantity: number }[];
  /** `stars`: phẩm chất 1..5; absent = the species default. */
  /** `talent`: a physical trait runtime id; absent = random. */
  /** `nature`: 7, 8 or 9, which shiny an "always" pet is; absent = one of the three at random. */
  pets: {
    speciesId: number;
    shiny: "never" | "random" | "always";
    nature?: number;
    stars?: number;
    talent?: number;
  }[];
};

export const emptyRewards = (): Rewards => ({ money: 0, badges: 0, items: [], pets: [] });

const SHINY_LABELS = { never: "Thường", random: "50% shiny", always: "Chắc chắn shiny" } as const;
const STAR_CHOICES = [1, 2, 3, 4, 5] as const;
/** What each shiny nature does to the stats (`applyNatureType`): hp, attack, speed. */
const SHINY_KINDS = [
  { nature: 7, short: "Linh xảo", label: "Shiny 7 · Linh xảo +7 (HP −20%, công −10%)" },
  { nature: 8, short: "Sát thương", label: "Shiny 8 · Sát thương +30% (HP −20%, Linh xảo −2)" },
  { nature: 9, short: "HP", label: "Shiny 9 · HP +30% (công −10%, Linh xảo −2)" },
] as const;

const shinyText = (pet: Rewards["pets"][number]): string => {
  const kind = SHINY_KINDS.find((row) => row.nature === pet.nature);
  return pet.shiny === "always" && kind ? `Shiny ${kind.nature} · ${kind.short}` : SHINY_LABELS[pet.shiny];
};

export function rewardSummary(
  rewards: Rewards,
  itemName: (kind: AdminItemKind, id: number) => string,
  speciesName: (id: number) => string,
  talentName: (id: number) => string = (id) => `thiên phú #${id}`,
): string {
  const parts: string[] = [];
  if (rewards.money) parts.push(`${number.format(rewards.money)} tiền`);
  if (rewards.badges) parts.push(`${number.format(rewards.badges)} huy hiệu`);
  for (const item of rewards.items) parts.push(`${item.quantity}× ${itemName(item.kind, item.id)}`);
  for (const pet of rewards.pets)
    parts.push(
      `${speciesName(pet.speciesId)}${pet.stars ? ` ${pet.stars}★` : ""}${pet.shiny === "never" ? "" : ` (${shinyText(pet)})`}` +
        (pet.talent === undefined ? "" : ` [${talentName(pet.talent)}]`),
    );
  return parts.join(", ") || "—";
}

/** Money, badges, up to 20 item lines and 6 pets; `value()` reads it back (throws on a bad line). */
export function rewardEditor(
  initial: Rewards,
  catalog: () => AdminCatalog | null,
): { element: HTMLElement; value: () => Rewards } {
  const moneyInput = el("input", { type: "number", min: "0", value: String(initial.money || "") , placeholder: "0" });
  const badgeInput = el("input", { type: "number", min: "0", value: String(initial.badges || ""), placeholder: "0" });
  const itemLines = el("div", { className: "reward-editor" });
  const petLines = el("div", { className: "reward-editor" });
  const items: { pick: HTMLInputElement; quantity: HTMLInputElement }[] = [];
  const pets: {
    pick: HTMLInputElement;
    shiny: HTMLSelectElement;
    stars: HTMLSelectElement;
    talent: HTMLSelectElement;
    kind: HTMLSelectElement;
  }[] = [];

  const addItem = (value?: Rewards["items"][number]) => {
    if (items.length >= 20) return;
    const pick = el("input", {
      list: "item-list",
      placeholder: "Gõ tên vật phẩm…",
      value: value ? (catalog()?.itemLabel(value.kind, value.id) ?? `${value.kind} #${value.id}`) : "",
    });
    const quantity = el("input", { type: "number", min: "1", value: String(value?.quantity ?? 1) });
    const remove = el("button", { type: "button" }, "✕");
    const line = el("div", { className: "line" }, pick, quantity, remove);
    const entry = { pick, quantity };
    remove.onclick = () => {
      items.splice(items.indexOf(entry), 1);
      line.remove();
    };
    items.push(entry);
    itemLines.append(line);
  };
  const addPet = (value?: Rewards["pets"][number]) => {
    if (pets.length >= 6) return;
    const pick = el("input", {
      list: "species-list",
      placeholder: "Gõ tên pet…",
      value: value ? (catalog()?.speciesLabel(value.speciesId) ?? `#${value.speciesId}`) : "",
    });
    const shiny = el(
      "select",
      {},
      ...Object.entries(SHINY_LABELS).map(([key, label]) =>
        el("option", { value: key, selected: key === (value?.shiny ?? "never") }, label),
      ),
    );
    const stars = el(
      "select",
      { title: "Số sao (phẩm chất)" },
      el("option", { value: "", selected: !value?.stars }, "Sao mặc định"),
      ...STAR_CHOICES.map((n) => el("option", { value: String(n), selected: value?.stars === n }, n + " sao")),
    );
    const known = catalog()?.talents ?? [];
    const talent = el(
      "select",
      { title: "Thiên phú" },
      el("option", { value: "", selected: value?.talent === undefined }, "Thiên phú ngẫu nhiên"),
      ...known.map((row) => el("option", { value: String(row.id), selected: value?.talent === row.id }, row.name)),
      // A saved choice the catalog does not list (not loaded yet) is kept as it was.
      ...(value?.talent !== undefined && !known.some((row) => row.id === value.talent)
        ? [el("option", { value: String(value.talent), selected: true }, `Thiên phú #${value.talent}`)]
        : []),
    );
    const kind = el(
      "select",
      { title: "Loại shiny" },
      el("option", { value: "", selected: value?.nature === undefined }, "Shiny 7/8/9 ngẫu nhiên"),
      ...SHINY_KINDS.map((row) =>
        el("option", { value: String(row.nature), selected: value?.nature === row.nature }, row.label),
      ),
    );
    // Only a sure shiny can be told which one it is.
    const syncKind = () => (kind.hidden = shiny.value !== "always");
    shiny.onchange = syncKind;
    syncKind();
    const remove = el("button", { type: "button" }, "✕");
    const line = el("div", { className: "line pet-line" }, pick, stars, talent, shiny, kind, remove);
    const entry = { pick, shiny, stars, talent, kind };
    remove.onclick = () => {
      pets.splice(pets.indexOf(entry), 1);
      line.remove();
    };
    pets.push(entry);
    petLines.append(line);
  };
  initial.items.forEach(addItem);
  initial.pets.forEach(addPet);
  const moreItem = el("button", { type: "button" }, "+ Vật phẩm");
  moreItem.onclick = () => addItem();
  const morePet = el("button", { type: "button" }, "+ Pet");
  morePet.onclick = () => addPet();

  const element = el(
    "div",
    { className: "reward-editor" },
    el(
      "div",
      { className: "money" },
      el("label", { className: "field" }, "Tiền", moneyInput),
      el("label", { className: "field" }, "Huy hiệu", badgeInput),
    ),
    itemLines,
    el("div", {}, moreItem),
    petLines,
    el("div", {}, morePet, " ", el("small", {}, "Pet vào ngân hàng sủng vật, chọn số sao 1–5 và thiên phú, hoặc để mặc định (sao theo loài, thiên phú ngẫu nhiên).")),
  );
  const value = (): Rewards => {
    const loaded = catalog();
    if (!loaded && (items.length || pets.length))
      throw new Error("Danh sách vật phẩm/pet của game chưa tải xong, hãy đợi vài giây.");
    return {
      money: Math.max(0, Math.trunc(Number(moneyInput.value) || 0)),
      badges: Math.max(0, Math.trunc(Number(badgeInput.value) || 0)),
      items: items
        .filter((line) => line.pick.value.trim())
        .map((line) => {
          const choice = loaded!.parseItem(line.pick.value);
          if (!choice) throw new Error(`Không nhận ra vật phẩm "${line.pick.value}". Hãy chọn trong gợi ý.`);
          return { kind: choice.kind, id: choice.id, quantity: Math.max(1, Math.trunc(Number(line.quantity.value) || 1)) };
        }),
      pets: pets
        .filter((line) => line.pick.value.trim())
        .map((line) => {
          const speciesId = loaded!.parseSpecies(line.pick.value);
          if (speciesId === undefined) throw new Error(`Không nhận ra pet "${line.pick.value}". Hãy chọn trong gợi ý.`);
          const shiny = line.shiny.value as Rewards["pets"][number]["shiny"],
            stars = Number(line.stars.value),
            pet: Rewards["pets"][number] = { speciesId, shiny };
          if (stars) pet.stars = stars;
          if (line.talent.value !== "") pet.talent = Number(line.talent.value);
          if (shiny === "always" && line.kind.value !== "") pet.nature = Number(line.kind.value);
          return pet;
        }),
    };
  };
  return { element, value };
}
