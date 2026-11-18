import { Pack } from "../pack/Pack";
import { GameData } from "../data/GameData";
import { PetStatCalculator, type PetCoreStats } from "../game/battle/PetStatCalculator";
import { TraitMechanicRegistry } from "../game/battle/PhysicalTraits";
import { DivinePetSeal, type DivineSealDocument } from "../game/pet/DivinePetSeal";
import { ShinyRecolorCache, type ShinyPaletteDocument } from "../rendering/PetShinyPalette";
import { SHINY_THEMES } from "../rendering/ShinyDesigns";
import type {
  PackDesignTraitBalanceTable,
  PackSpeciesCatalog,
  PackSpeciesRow,
} from "../data/GameData";
import "./wiki.css";

type SpriteIndex = { sprites: Record<string, { states: Record<string, { file: string }[]> }> };
type Skill = {
  skillId: number;
  name: string;
  elementFamily: number;
  powerPercent: number;
  ppMax: number;
  learnTier: number;
  damageBranch: string;
};
type SkillPool = [skillId: number, unlockLevel: number, source: string, sourceName: string];
type EvolutionRule = {
  key: string;
  kind: string;
  from: number;
  to: number;
  requiredLevel: number;
  requiredQuality: number;
  ingredients: [runtimeId: number, itemKey: string, name: string, quantity: number][];
};
type SkillDetails = {
  runtimeId: number;
  description: string;
  combatCategory: string;
  targetPattern: string;
};
type Item = {
  key: string;
  name: string;
  description: string;
  kind: string;
  category: string;
  icon: string;
  runtimeId: number;
  source: string;
  usage: string;
  slot: string;
  implemented: boolean;
};
type Section = "home" | "pets" | "skills" | "items" | "world";

const elementNames = ["Hỏa", "Mộc", "Thổ", "Thủy", "Điện", "Quỷ", "Phong"];
const elementIcons = ["✦", "❧", "◆", "≈", "ϟ", "☾", "↝"];
const elementClasses = ["fire", "wood", "earth", "water", "electric", "ghost", "wind"];
const root = document.querySelector<HTMLDivElement>("#wiki-app")!;
const count = new Intl.NumberFormat("vi-VN");

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
const norm = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** A colour's name: the original form, or the shiny theme's. */
function colorName(color: number): string {
  return color < 0 ? "Màu gốc" : SHINY_THEMES[color].name;
}
function colorKind(color: number): string {
  if (color < 0) return "Không Shiny";
  const theme = SHINY_THEMES[color],
    kind = theme.kind === "light" ? "Tông sáng" : theme.kind === "dark" ? "Tông tối" : "Rực rỡ";
  return theme.metal ? `${kind} · ánh kim` : kind;
}
/** The theme's three roles (main, second, accent), each at its mid-light stop. */
function swatch(color: number): string {
  const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, "0")}`;
  const [main, second, accent] = SHINY_THEMES[color].ramps.map((ramp) => hex(ramp[3]));
  return `linear-gradient(90deg, ${main} 0 50%, ${second} 50% 80%, ${accent} 80%)`;
}
function colorCaption(color: number): string {
  return color < 0 ? "Màu gốc · VQSV" : `Shiny · ${SHINY_THEMES[color].name}`;
}

function getHash(): { section: Section; id?: number; key?: string } {
  const [, route = "", rawId] = location.hash.split("/");
  const section: Section = (["pets", "skills", "items", "world"] as Section[]).includes(
    route as Section,
  )
    ? (route as Section)
    : "home";
  return {
    section,
    id: rawId && /^\d+$/.test(rawId) ? Number(rawId) : undefined,
    key: rawId ? decodeURIComponent(rawId) : undefined,
  };
}

async function start() {
  root.innerHTML = '<div class="wiki-loading">Đang mở đại thư VQSV…</div>';
  const pack = await Pack.load();
  for (const [property, file] of [
    ["--wiki-header-art", "header-v2.png"],
    ["--wiki-detail-art", "pet-detail-toolkit.png"],
    ["--wiki-card-art", "pet-card-toolkit.png"],
    ["--wiki-controls-art", "pet-controls-toolkit.png"],
  ]) {
    root.style.setProperty(property, `url("${pack.url(`wiki.${file}`)}")`);
  }
  const gameData = new GameData(pack);
  const [
    speciesDoc,
    skillDoc,
    itemDoc,
    evolutionDoc,
    skillPoolDoc,
    traitBalance,
    physicalTraits,
    traitDescriptionBalance,
    skillDetails,
    worldSprites,
    petSprites,
    v4Sprites,
    petStats,
    shinyPalette,
    traitRegistry,
    northSea,
  ] = await Promise.all([
    pack.json<PackSpeciesCatalog>("data.battle/species.json"),
    pack.json<{ rows: Skill[] }>("data.battle/skill-rows.json"),
    pack.json<{ records: Item[] }>("items.catalog"),
    pack.json<{ rules: EvolutionRule[] }>("story.pet-evolutions"),
    pack.json<{ pools: Record<string, SkillPool[]> }>("story.pet-skill-pools"),
    pack.json<PackDesignTraitBalanceTable>("balance.pet-design-traits"),
    gameData.physicalTraits(),
    pack.json<{ overrides: { stableKey: string; value: string }[] }>(
      "balance.pet-trait-descriptions",
    ),
    Promise.all(
      [
        "data.battle/skills-liet-hoa.json",
        "data.battle/skills.json",
        "data.battle/skills-pet-design.json",
        "data.battle/skills-user-authored.json",
      ].map((key) => pack.json<SkillDetails[]>(key)),
    ).then((tables) => tables.flat()),
    pack.json<SpriteIndex>("world.sprites"),
    pack.json<SpriteIndex>("pet-sprites.sprites"),
    pack.json<SpriteIndex>("v4-sprites.sprites"),
    PetStatCalculator.load(gameData),
    pack.json<ShinyPaletteDocument>("shiny.palette"),
    TraitMechanicRegistry.load(gameData),
    pack.json<{ divine: DivineSealDocument }>("cau-vong-world.north-sea"),
  ]);
  const shinyRecolor = new ShinyRecolorCache(shinyPalette);
  const divineSeal = new DivinePetSeal(northSea.divine);
  const species = speciesDoc.rows;
  const skills = skillDoc.rows;
  const items = itemDoc.records;
  const evolutionRules = evolutionDoc.rules;
  const skillPools = skillPoolDoc.pools;
  const byId = new Map(species.map((pet) => [pet.speciesId, pet]));
  const skillById = new Map(skills.map((skill) => [skill.skillId, skill]));
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  const traitBySpecies = new Map(traitBalance.traits.map((trait) => [trait.speciesId, trait]));
  const traitOverrides = new Map(
    traitDescriptionBalance.overrides.map((row) => [row.stableKey, row.value]),
  );
  const rollableTraits = physicalTraits.filter((trait) => trait.rollWeight > 0);
  const skillDetailsById = new Map(skillDetails.map((detail) => [detail.runtimeId, detail]));
  const spriteSources = [
    ["world", worldSprites],
    ["pet-sprites", petSprites],
    ["v4-sprites", v4Sprites],
  ] as const;
  const spriteKey = (pet: PackSpeciesRow): string | undefined => {
    for (const [domain, index] of spriteSources) {
      const states = index.sprites[String(pet.spriteId)]?.states;
      const frame = states?.["0"]?.[0] ?? (states ? Object.values(states)[0]?.[0] : undefined);
      if (frame) return `${domain}.${frame.file}`;
    }
  };
  const spriteUrl = (pet: PackSpeciesRow): string | undefined => {
    const key = spriteKey(pet);
    return key ? pack.url(key) : undefined;
  };
  const itemCategoryLabel = (category: string) =>
    (
      ({
        accessory: "Phụ kiện",
        evolution_material: "Nguyên liệu tiến hóa",
        capture_ball: "Phong ấn cầu",
        exploration: "Khám phá",
        passive_equipment: "Trang bị nội tại",
        pet_egg: "Trứng Pet",
        quest_item: "Vật phẩm nhiệm vụ",
        recovery: "Hồi phục",
        stat_modifier: "Tăng chỉ số",
        badge: "Huy hiệu",
      }) as Record<string, string>
    )[category] ?? category.replaceAll("_", " ");
  const itemKindLabel = (kind: string) =>
    (
      ({
        MATERIAL: "Nguyên liệu",
        BAG: "Đạo cụ",
        EQUIPMENT: "Trang bị",
        SPECIAL: "Đặc biệt",
        BADGE: "Huy hiệu",
      }) as Record<string, string>
    )[kind] ?? kind;
  const itemUsageLabel = (usage: string) =>
    (
      ({
        account_passive: "Tài khoản",
        battle_consumable: "Dùng trong trận",
        consumable: "Tiêu hao",
        crafting: "Chế tạo",
        exploration: "Khám phá",
        exploration_consumable: "Tiêu hao khi khám phá",
        held_passive: "Pet mang theo",
        incubation: "Ấp trứng",
        key_item: "Vật phẩm chủ chốt",
        quest: "Nhiệm vụ",
      }) as Record<string, string>
    )[usage] ?? "Theo vật phẩm";
  const skillCategoryLabel = (category: string) =>
    (
      ({
        buff: "Tăng cường",
        control: "Khống chế",
        damage: "Sát thương",
        defense: "Phòng thủ",
        heal: "Hồi phục",
        hybrid: "Kết hợp",
      }) as Record<string, string>
    )[category] ?? category;
  const learnedSkills = (speciesId: number) => {
    const levels = new Map<number, number>();
    for (const [skillId, level] of skillPools[String(speciesId)] ?? []) {
      if (skillById.has(skillId))
        levels.set(skillId, Math.min(levels.get(skillId) ?? level, level));
    }
    return [...levels].sort((left, right) => left[1] - right[1] || left[0] - right[0]);
  };
  const petMini = (pet: PackSpeciesRow) =>
    `<a class="mini-pet" href="#/pets/${pet.speciesId}"><span class="mini-pet-art ${elementClasses[pet.element] ?? ""}">${spriteUrl(pet) ? `<img src="${spriteUrl(pet)}" alt="" loading="lazy" />` : "✦"}</span><span><small>#${String(pet.speciesId).padStart(3, "0")}</small><strong>${escapeHtml(pet.name)}</strong></span></a>`;
  const ingredientLink = ([, key, name, quantity]: EvolutionRule["ingredients"][number]) => {
    const item = itemByKey.get(key);
    return item
      ? `<a class="ingredient" href="#/items/${encodeURIComponent(item.key)}">${item.icon ? `<img src="${pack.url(`items.${item.icon}`)}" alt="" loading="lazy" />` : "✧"}<span>${escapeHtml(item.name)} <b>×${quantity}</b></span></a>`
      : `<span class="ingredient"><span>${escapeHtml(name)} <b>×${quantity}</b></span></span>`;
  };
  const recipeCard = (rule: EvolutionRule) => {
    const from = byId.get(rule.from);
    const to = byId.get(rule.to);
    if (!from || !to) return "";
    return `<article class="recipe-card">${petMini(from)}<div class="recipe-center"><span class="recipe-arrow">→</span><strong>Cấp ${rule.requiredLevel}${rule.requiredQuality > 1 ? ` · Phẩm ${rule.requiredQuality}` : ""}</strong><div class="recipe-ingredients">${rule.ingredients.map(ingredientLink).join("")}</div></div>${petMini(to)}</article>`;
  };
  const favorites = new Set<number>(
    JSON.parse(localStorage.getItem("vqsv-wiki-favorites") ?? "[]") as number[],
  );
  let query = "";
  let element = -1;
  let rarity = -1;
  let itemKind = "all";
  let onlyFavorites = false;
  let page = 1;
  let petLevel = 50;
  let petQuality = 3;
  let petNature = 0;
  /** The colour shown: -1 the original, else an index into `SHINY_THEMES`. */
  let petColor = -1;
  let physicalTrait = -1;
  let divinePercent = 100;
  let selectedPetId = -1;
  const pageSize = 36;

  const nav = (section: Section, label: string) =>
    `<a href="#/${section}" class="nav-link ${getHash().section === section ? "active" : ""}">${label}</a>`;
  const badge = (index: number) =>
    `<span class="element-badge ${elementClasses[index] ?? ""}">${elementIcons[index] ?? "✧"} ${elementNames[index] ?? "Khác"}</span>`;
  const petCard = (pet: PackSpeciesRow) => `<a class="pet-card" href="#/pets/${pet.speciesId}">
    <span class="pet-card-top"><span>#${String(pet.speciesId).padStart(3, "0")}</span><span>${favorites.has(pet.speciesId) ? "♥" : "✧"}</span></span>
    <span class="pet-art ${elementClasses[pet.element] ?? ""}">${spriteUrl(pet) ? `<img src="${spriteUrl(pet)}" alt="" loading="lazy" />` : "✦"}</span>
    <strong>${escapeHtml(pet.name)}</strong><span class="pet-card-bottom">${badge(pet.element)}<span>★ ${pet.rarity}</span></span>
  </a>`;
  const skillCard = (skill: Skill) =>
    `<a class="catalog-row" href="#/skills/${skill.skillId}"><div class="catalog-icon ${elementClasses[skill.elementFamily] ?? ""}">${elementIcons[skill.elementFamily] ?? "✦"}</div><div><small>#${skill.skillId} · ${elementNames[skill.elementFamily] ?? "Đặc biệt"}</small><h3>${escapeHtml(skill.name)}</h3><p>${skill.damageBranch === "liet-hoa" ? "Kỹ năng Liệt Hỏa" : "Kỹ năng chiến đấu"}</p></div><div class="catalog-meta"><b>${skill.powerPercent > 0 ? `${skill.powerPercent}%` : "Hiệu ứng"}</b><span>Sức mạnh</span><b>${skill.ppMax}</b><span>PP</span></div></a>`;
  const itemCard = (item: Item) =>
    `<a class="catalog-row" href="#/items/${encodeURIComponent(item.key)}"><div class="catalog-icon item-icon">${item.icon ? `<img src="${pack.url(`items.${item.icon}`)}" alt="" loading="lazy" />` : "✧"}</div><div><small>${escapeHtml(itemCategoryLabel(item.category))} · #${item.runtimeId}</small><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description)}</p></div></a>`;
  const search = (placeholder: string) =>
    `<label class="search-box"><span>⌕</span><input id="wiki-search" type="search" placeholder="${placeholder}" value="${escapeHtml(query)}" autocomplete="off" aria-label="Tìm kiếm" /><kbd>/</kbd></label>`;
  const sectionHeader = (eyebrow: string, title: string, description: string) =>
    `<header class="section-head"><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></header>`;

  function shell(body: string) {
    const route = getHash();
    root.innerHTML = `<div class="site-shell">
      <header class="site-header"><a class="brand" href="#/home"><span class="brand-mark">✦</span><span>VQSV <small>WIKI</small></span></a><nav aria-label="Điều hướng">${nav("home", "Trang chủ")}${nav("pets", "Pet")}${nav("skills", "Kỹ năng")}${nav("items", "Vật phẩm")}${nav("world", "Thế giới")}</nav><a class="game-link" href="/">Vào game ↗</a></header>
      ${body}<footer class="site-footer"><strong>VQSV Wiki</strong><span>Dữ liệu trích từ bản game Web Native hiện tại. Hình pet là sprite gốc trong pack.</span><a href="/">Vào game ↗</a></footer>
    </div>`;
    root.dataset.section = route.section;
    root.querySelector<HTMLInputElement>("#wiki-search")?.addEventListener("input", (event) => {
      query = (event.target as HTMLInputElement).value;
      page = 1;
      renderList();
    });
  }

  function renderList() {
    const route = getHash();
    const grid = root.querySelector<HTMLElement>("#results");
    const status = root.querySelector<HTMLElement>("#result-count");
    const pager = root.querySelector<HTMLElement>("#pager");
    if (!grid || !status || !pager) return;
    const match = (name: string) => norm(name).includes(norm(query.trim()));
    if (route.section === "pets") {
      const rows = species.filter(
        (pet) =>
          pet.validForBattle &&
          match(pet.name) &&
          (element < 0 || pet.element === element) &&
          (rarity < 0 || pet.rarity === rarity) &&
          (!onlyFavorites || favorites.has(pet.speciesId)),
      );
      const pages = Math.max(1, Math.ceil(rows.length / pageSize));
      page = Math.min(page, pages);
      grid.innerHTML = rows.length
        ? rows
            .slice((page - 1) * pageSize, page * pageSize)
            .map(petCard)
            .join("")
        : '<div class="empty"><span class="empty-illustration" aria-hidden="true"><span>✦</span></span><h3>Chưa tìm thấy Pet</h3><p>Thử tên khác hoặc đổi bộ lọc nhé.</p></div>';
      status.textContent = `${count.format(rows.length)} loài Pet`;
      pager.innerHTML =
        pages > 1
          ? `<button data-page="prev" ${page === 1 ? "disabled" : ""}>← Trước</button><span>${page} / ${pages}</span><button data-page="next" ${page === pages ? "disabled" : ""}>Sau →</button>`
          : "";
    } else if (route.section === "skills") {
      const rows = skills.filter(
        (skill) => match(skill.name) && (element < 0 || skill.elementFamily === element),
      );
      const pages = Math.max(1, Math.ceil(rows.length / pageSize));
      page = Math.min(page, pages);
      grid.innerHTML =
        rows
          .slice((page - 1) * pageSize, page * pageSize)
          .map(skillCard)
          .join("") || '<p class="no-results">Không tìm thấy kỹ năng.</p>';
      status.textContent = `${count.format(rows.length)} kỹ năng`;
      pager.innerHTML =
        pages > 1
          ? `<button data-page="prev" ${page === 1 ? "disabled" : ""}>← Trước</button><span>${page} / ${pages}</span><button data-page="next" ${page === pages ? "disabled" : ""}>Sau →</button>`
          : "";
    } else if (route.section === "items") {
      const rows = items.filter(
        (item) =>
          (match(item.name) || match(item.description)) &&
          (itemKind === "all" || item.kind === itemKind),
      );
      const pages = Math.max(1, Math.ceil(rows.length / pageSize));
      page = Math.min(page, pages);
      grid.innerHTML =
        rows
          .slice((page - 1) * pageSize, page * pageSize)
          .map(itemCard)
          .join("") || '<p class="no-results">Không tìm thấy vật phẩm.</p>';
      status.textContent = `${count.format(rows.length)} vật phẩm`;
      pager.innerHTML =
        pages > 1
          ? `<button data-page="prev" ${page === 1 ? "disabled" : ""}>← Trước</button><span>${page} / ${pages}</span><button data-page="next" ${page === pages ? "disabled" : ""}>Sau →</button>`
          : "";
    }
    pager.querySelectorAll<HTMLButtonElement>("button[data-page]").forEach(
      (button) =>
        (button.onclick = () => {
          page += button.dataset.page === "next" ? 1 : -1;
          renderList();
          root.querySelector(".catalog-top")?.scrollIntoView({ behavior: "smooth" });
        }),
    );
  }

  function filters(kind: "element" | "item") {
    if (kind === "element")
      return `<div class="filter-row" id="element-filters"><button data-element="-1" class="${element === -1 ? "selected" : ""}">Tất cả</button>${elementNames.map((name, i) => `<button data-element="${i}" class="${element === i ? "selected" : ""}">${elementIcons[i]} ${name}</button>`).join("")}</div>`;
    return `<div class="filter-row" id="item-filters"><button data-kind="all" class="${itemKind === "all" ? "selected" : ""}">Tất cả</button>${["MATERIAL", "BAG", "EQUIPMENT", "SPECIAL", "BADGE"].map((kind) => `<button data-kind="${kind}" class="${itemKind === kind ? "selected" : ""}">${({ MATERIAL: "Nguyên liệu", BAG: "Túi đồ", EQUIPMENT: "Trang bị", SPECIAL: "Đặc biệt", BADGE: "Huy hiệu" } as Record<string, string>)[kind]}</button>`).join("")}</div>`;
  }

  function attachFilters() {
    root.querySelectorAll<HTMLButtonElement>("[data-element]").forEach(
      (button) =>
        (button.onclick = () => {
          element = Number(button.dataset.element);
          page = 1;
          render();
        }),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-rarity]").forEach(
      (button) =>
        (button.onclick = () => {
          rarity = Number(button.dataset.rarity);
          page = 1;
          render();
        }),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach(
      (button) =>
        (button.onclick = () => {
          itemKind = button.dataset.kind!;
          page = 1;
          render();
        }),
    );
    root.querySelector<HTMLButtonElement>("#favorite-filter")?.addEventListener("click", () => {
      onlyFavorites = !onlyFavorites;
      page = 1;
      render();
    });
  }

  function renderPetDetail(id: number) {
    const pet = byId.get(id);
    if (!pet) {
      location.hash = "#/pets";
      return;
    }
    if (selectedPetId !== id) {
      selectedPetId = id;
      petLevel = id === 280 ? 150 : 50;
      petQuality = pet.defaultQuality;
      petNature = 0;
      petColor = -1;
      physicalTrait = -1;
      divinePercent = divineSeal.isDivine(id) ? northSea.divine.sealed : 100;
    }
    const recipes = evolutionRules.filter((rule) => rule.from === id || rule.to === id);
    const pool = learnedSkills(id);
    const art = spriteUrl(pet);
    const artKey = spriteKey(pet);
    const statNames: { key: keyof PetCoreStats; label: string; short: string }[] = [
      { key: "hp", label: "Sinh lực", short: "HP" },
      { key: "attack", label: "Tấn công", short: "Công" },
      { key: "defense", label: "Phòng thủ", short: "Thủ" },
      { key: "speed", label: "Tốc độ", short: "Tốc" },
    ];
    const statSection = `<section class="detail-section stats-section" id="stats"><div class="detail-section-heading"><div><span class="eyebrow">CHỈ SỐ CHIẾN ĐẤU</span><h2>Chỉ số theo cấp và sao</h2><p>Số chuẩn của loài tính theo mã game JavaSE. Chọn thiên tính Shiny, thiên phú hoặc trạng thái Thần thú để xem chỉ số cá thể tương ứng.</p></div><span id="stat-context"></span></div>
      <div class="stat-controls"><label>Cấp <strong id="stat-level-value">${petLevel}</strong><input id="stat-level" type="range" min="${speciesDoc.minLevel}" max="${id === 280 ? 150 : 100}" value="${petLevel}" /></label><div class="quality-buttons" aria-label="Chọn mức sao">${[1, 2, 3, 4, 5].map((quality) => `<button data-quality="${quality}" aria-pressed="${quality === petQuality}">${quality} ★</button>`).join("")}</div></div>
      <div class="stat-extra"><label>Thiên tính <select id="stat-nature">${[0, 7, 8, 9].map((nature) => `<option value="${nature}" ${nature === petNature ? "selected" : ""}>${nature === 0 ? "Thường" : `Shiny ${nature - 6}`}</option>`).join("")}</select></label><label>Thiên phú cá thể <select id="stat-trait"><option value="-1">Không áp dụng</option>${rollableTraits.map((trait) => `<option value="${trait.runtimeId}" ${physicalTrait === trait.runtimeId ? "selected" : ""}>${escapeHtml(trait.name)}</option>`).join("")}</select></label>${divineSeal.isDivine(id) ? `<label>Thần thú <select id="stat-divine"><option value="30" ${divinePercent === 30 ? "selected" : ""}>Phong ấn · 30%</option><option value="120" ${divinePercent === 120 ? "selected" : ""}>Giải ấn · 120%</option></select></label>` : ""}</div>
      <div class="stat-summary">${statNames.map(({ key, label, short }) => `<article class="stat-tile"><span>${label}<small>${short}</small></span><strong data-stat="${key}"></strong><div class="stat-track"><i data-track="${key}"></i></div></article>`).join("")}</div>
      <div class="stat-table-wrap"><table class="stat-table"><caption>So sánh đủ 5 mức sao tại cấp đang chọn</caption><thead><tr><th scope="col">Sao</th>${statNames.map(({ short }) => `<th scope="col">${short}</th>`).join("")}</tr></thead><tbody id="stat-table-body"></tbody></table></div>
      <p class="stat-note" id="stat-nature-note"></p>${pet.growth.kind === "authored-flat" ? '<p class="stat-flat-note">Đây là boss có bộ chỉ số cố định trong game; đổi cấp hoặc sao không làm thay đổi bốn chỉ số gốc.</p>' : ""}<details class="stat-formula"><summary>Cách game tính các chỉ số này</summary><p>${pet.growth.kind === "authored-flat" ? "Game dùng trực tiếp bốn hằng số chỉ số của boss này." : `Mỗi loài có bốn đường tăng trưởng riêng. Game tính từng chỉ số tại cấp được chọn, áp hệ số sao ${[1, 2, 3, 4, 5].map((quality) => `${quality}★ = ${petStats.statPercent(quality)}%`).join(" · ")} và lấy phần nguyên theo từng nhánh công thức. Dạng tiến hóa có thể được nâng lên bằng chỉ số tổ tiên.`} Sau đó game mới áp thiên tính Shiny, thiên phú vĩnh viễn và phong ấn Thần thú.</p></details><p class="stat-source">Chưa tính trang bị, hiệu ứng tạm thời trong trận hoặc chỉ số HP hiện tại. Pet sở hữu thường tối đa cấp 100; boss đặc biệt theo luật game.</p></section>`;
    // Every colour the game can draw this pet in: the original and the 13 shiny themes
    // (`ShinyDesigns`), recoloured from the sprite by the same code the game uses.
    const colorSection = `<section class="detail-section" id="colors"><div class="detail-section-heading"><div><span class="eyebrow">BỘ SƯU TẬP MÀU</span><h2>Màu gốc và ${SHINY_THEMES.length} màu Shiny</h2><p>Khi trở thành Shiny (thiên tính Shiny 1, 2 hoặc 3), Pet được tặng ngẫu nhiên một trong ${SHINY_THEMES.length} màu và giữ màu đó mãi. Màu chỉ đổi ngoại hình, không đổi chỉ số; Đồ giám có trang riêng cho từng màu. Chọn một ô để xem lớn.</p></div><span>${SHINY_THEMES.length + 1} dạng</span></div>
      <div class="color-grid">${[-1, ...SHINY_THEMES.map((_, index) => index)].map((color) => `<button class="color-tile" data-color="${color}" aria-pressed="${color === petColor}"><span class="color-preview">${art ? `<img data-color-img="${color}" src="${art}" alt="${escapeHtml(pet.name)} · ${escapeHtml(colorName(color))}" />` : "✦"}</span><strong>${escapeHtml(colorName(color))}</strong><small>${colorKind(color)}</small>${color >= 0 ? `<i class="color-swatch" style="background:${swatch(color)}"></i>` : ""}</button>`).join("")}</div></section>`;
    const description =
      pet.growth.kind === "unified-record"
        ? pet.growth.record.description
        : "Hồ sơ được trích từ catalog loài Pet đang dùng trong game.";
    const activeTrait =
      traitBySpecies.get(id) ??
      (id === traitBalance.boss.speciesId ? traitBalance.boss : undefined);
    const traitSection = `<section class="detail-section" id="traits"><div class="detail-section-heading"><div><span class="eyebrow">NĂNG LỰC BẨM SINH</span><h2>Thiên phú & đặc tính</h2><p>Đặc tính riêng gắn với loài; thiên phú thể chất được xác định theo từng cá thể.</p></div></div>
      ${activeTrait ? `<article class="trait-feature"><span class="trait-sigil">✧</span><div><small>ĐẶC TÍNH RIÊNG · ${escapeHtml(activeTrait.group)}</small><h3>${escapeHtml(activeTrait.name)}</h3><p>${escapeHtml(("summary" in activeTrait ? activeTrait.summary : undefined) ?? activeTrait.description)}</p>${"summary2v2" in activeTrait && activeTrait.summary2v2 ? `<p><strong>Trong 2v2:</strong> ${escapeHtml(activeTrait.summary2v2)}</p>` : ""}<div class="trait-facts">${"kit" in activeTrait && activeTrait.kit ? "" : `<span>Mức tác động <strong>${escapeHtml(String(activeTrait.value))} ${escapeHtml(activeTrait.unit === "Power" ? "uy lực" : activeTrait.unit === "Lượt" ? "lượt" : activeTrait.unit)}</strong></span>`}<span>Gắn với loài <strong>${escapeHtml(pet.name)}</strong></span></div></div></article>` : '<p class="detail-empty">Chưa có đặc tính riêng được công bố.</p>'}
      <details class="trait-catalog"><summary><span><strong>${rollableTraits.length} thiên phú thể chất</strong><small>Chọn để xem tên, tác dụng và tính chất của từng thiên phú</small></span><b>＋</b></summary><p>Đây là nhóm tư chất ngẫu nhiên của cá thể; danh sách dưới đây không khẳng định Pet đang xem sở hữu tất cả.</p><div class="trait-grid">${rollableTraits
        .map((trait) => {
          const polarity = trait.polarity.split(".").pop();
          const label =
            polarity === "BENEFICIAL"
              ? "Có lợi"
              : polarity === "HARMFUL"
                ? "Bất lợi"
                : polarity === "MIXED"
                  ? "Hỗn hợp"
                  : "Trung tính";
          return `<article class="trait-card"><span class="trait-polarity ${polarity?.toLowerCase() ?? "neutral"}">${label}</span><h3>${escapeHtml(trait.name)}</h3><p>${escapeHtml(traitOverrides.get(trait.stableKey) ?? trait.description)}</p></article>`;
        })
        .join("")}</div></details></section>`;
    shell(
      `<main class="detail-page"><a class="back-link" href="#/pets">← Toàn bộ Pet</a>
        <div class="detail-layout"><div class="detail-visual ${elementClasses[pet.element] ?? ""}"><span class="detail-number">#${String(pet.speciesId).padStart(3, "0")}</span><div class="sprite-stage">${art ? `<img id="detail-sprite" src="${art}" alt="Sprite ${escapeHtml(pet.name)}" />` : "✦"}</div><span class="detail-art-caption" id="detail-art-caption">${colorCaption(petColor)}</span><div class="shiny-variants color-strip" aria-label="Chọn màu của Pet">${[-1, ...SHINY_THEMES.map((_, index) => index)].map((color) => `<button data-color="${color}" aria-pressed="${color === petColor}" title="${escapeHtml(colorName(color))}"><span class="variant-preview">${art ? `<img data-color-img="${color}" src="${art}" alt="" />` : "✦"}</span><span>${escapeHtml(colorName(color))}</span></button>`).join("")}</div></div>
        <div class="detail-info"><span class="eyebrow">HỒ SƠ PET</span><h1>${escapeHtml(pet.name)}</h1><div class="detail-badges">${badge(pet.element)}<span class="soft-badge">Độ hiếm ${pet.rarity} ★</span></div><p class="detail-lead">${escapeHtml(description)}</p><div class="fact-grid"><div><small>Phẩm mặc định</small><strong>${pet.defaultQuality} ★</strong></div><div><small>Công thức tiến hóa</small><strong>${recipes.length}</strong></div><div><small>Kỹ năng trong bể</small><strong>${pool.length}</strong></div><div><small>Đặc tính riêng</small><strong>${activeTrait ? escapeHtml(activeTrait.name) : "—"}</strong></div></div><button class="favorite-button ${favorites.has(id) ? "on" : ""}" id="favorite-button">${favorites.has(id) ? "♥ Đã lưu" : "♡ Lưu Pet"}</button></div></div>
        <nav class="detail-jump" aria-label="Mục trong hồ sơ"><button data-jump="colors">Màu sắc</button><button data-jump="stats">Chỉ số</button><button data-jump="traits">Thiên phú & đặc tính</button><button data-jump="evolution">Nhánh tiến hóa</button><button data-jump="learnset">Kỹ năng</button></nav>
        ${colorSection}
        ${statSection}
        ${traitSection}
        <section class="detail-section" id="evolution"><div class="detail-section-heading"><div><span class="eyebrow">HÀNH TRÌNH</span><h2>Nhánh tiến hóa</h2><p>Điều kiện và nguyên liệu lấy từ công thức game.</p></div><span>${recipes.length} công thức</span></div>${recipes.length ? `<div class="recipe-list">${recipes.map(recipeCard).join("")}</div>` : '<p class="detail-empty">Loài này chưa có công thức tiến hóa trong catalog hiện tại.</p>'}</section>
        <section class="detail-section" id="learnset"><div class="detail-section-heading"><div><span class="eyebrow">CHIẾN ĐẤU</span><h2>Kỹ năng học được</h2><p>Chọn cấp để xem những kỹ năng đã mở trong bể kỹ năng của Pet.</p></div><span id="learned-count"></span></div><label class="level-control">Cấp Pet <strong id="level-value">${petLevel}</strong><input id="wiki-level" type="range" min="1" max="${id === 280 ? 150 : 100}" value="${petLevel}" /></label>${
          pool.length
            ? `<div class="learnset-grid">${pool
                .map(([skillId, level]) => {
                  const skill = skillById.get(skillId)!;
                  return `<a class="skill-unlock" data-unlock="${level}" href="#/skills/${skillId}"><span class="unlock-level">Cấp ${level}</span><span><strong>${escapeHtml(skill.name)}</strong><small>${elementNames[skill.elementFamily] ?? "Đặc biệt"} · ${skill.powerPercent > 0 ? `${skill.powerPercent}% uy lực` : "Hiệu ứng"} · ${skill.ppMax} PP</small></span><span class="unlock-state"></span></a>`;
                })
                .join("")}</div>`
            : '<p class="detail-empty">Chưa có bể kỹ năng được công bố cho loài này.</p>'
        }</section>
      </main>`,
    );
    const statLevelInput = root.querySelector<HTMLInputElement>("#stat-level")!;
    const updateStats = () => {
      petLevel = Number(statLevelInput.value);
      const rows = [1, 2, 3, 4, 5].map((quality) => {
        const core = petStats.coreStats(id, petLevel, quality, petNature);
        const projected = traitRegistry.projectPermanentStats(physicalTrait, {
          maxHp: core.hp,
          strength: core.attack,
          defense: core.defense,
          agility: core.speed,
        });
        return {
          quality,
          stats: DivinePetSeal.scaleStats(
            {
              hp: projected.maxHp,
              attack: projected.strength,
              defense: projected.defense,
              speed: projected.agility,
            },
            divinePercent,
          ),
        };
      });
      const selected = rows.find((row) => row.quality === petQuality) ?? rows[2];
      root.querySelector<HTMLElement>("#stat-level-value")!.textContent = String(petLevel);
      root.querySelector<HTMLElement>("#stat-context")!.textContent =
        `Cấp ${petLevel} · ${petQuality} ★${petNature ? ` · Shiny ${petNature - 6}` : ""}${physicalTrait >= 0 ? " · Thiên phú" : ""}${divineSeal.isDivine(id) ? ` · ${divinePercent}%` : ""}`;
      const notes = [
        petNature === 7
          ? "Shiny 1: HP ×80%, Công ×90%, Tốc +7."
          : petNature === 8
            ? "Shiny 2: HP ×80%, Công ×130%, Tốc −2."
            : petNature === 9
              ? "Shiny 3: HP ×130%, Công ×90%, Tốc −2."
              : "Dạng thường: chỉ số tăng trưởng chuẩn của loài.",
      ];
      if (physicalTrait >= 0) {
        const trait = rollableTraits.find((row) => row.runtimeId === physicalTrait);
        notes.push(
          traitRegistry.physicalSpec(physicalTrait)?.family === "PERMANENT_STAT_PERCENT"
            ? `Thiên phú ${trait?.name ?? "đã chọn"} điều chỉnh chỉ số nền.`
            : `Thiên phú ${trait?.name ?? "đã chọn"} không đổi chỉ số nền.`,
        );
      }
      if (divineSeal.isDivine(id))
        notes.push(
          divinePercent === 30 ? "Thần thú đang bị phong ấn 30%." : "Thần thú đã giải ấn 120%.",
        );
      root.querySelector<HTMLElement>("#stat-nature-note")!.textContent = notes.join(" ");
      for (const { key } of statNames) {
        root.querySelector<HTMLElement>(`[data-stat="${key}"]`)!.textContent = count.format(
          selected.stats[key],
        );
        const maximum = Math.max(...rows.map((row) => row.stats[key]), 1);
        root.querySelector<HTMLElement>(`[data-track="${key}"]`)!.style.width =
          `${Math.max(4, Math.round((selected.stats[key] / maximum) * 100))}%`;
      }
      root.querySelector<HTMLElement>("#stat-table-body")!.innerHTML = rows
        .map(
          ({ quality, stats }) =>
            `<tr class="${quality === petQuality ? "active" : ""}"><th scope="row">${quality} ★<small>${petStats.statPercent(quality)}%${quality === pet.defaultQuality ? " · Mặc định" : ""}</small></th>${statNames.map(({ key }) => `<td>${count.format(stats[key])}</td>`).join("")}</tr>`,
        )
        .join("");
      root.querySelectorAll<HTMLButtonElement>("[data-quality]").forEach((button) => {
        button.setAttribute("aria-pressed", String(Number(button.dataset.quality) === petQuality));
      });
    };
    statLevelInput.oninput = () => {
      updateStats();
      const skillLevel = root.querySelector<HTMLInputElement>("#wiki-level")!;
      skillLevel.value = statLevelInput.value;
      skillLevel.dispatchEvent(new Event("input"));
    };
    root.querySelectorAll<HTMLButtonElement>("[data-quality]").forEach((button) => {
      button.onclick = () => {
        petQuality = Number(button.dataset.quality);
        updateStats();
      };
    });
    root.querySelector<HTMLSelectElement>("#stat-trait")!.onchange = (event) => {
      physicalTrait = Number((event.target as HTMLSelectElement).value);
      updateStats();
    };
    const divineSelect = root.querySelector<HTMLSelectElement>("#stat-divine");
    if (divineSelect)
      divineSelect.onchange = () => {
        divinePercent = Number(divineSelect.value);
        updateStats();
      };
    const colorUrls = new Map<number, string>();
    const showColor = () => {
      const main = root.querySelector<HTMLImageElement>("#detail-sprite");
      if (main) main.src = colorUrls.get(petColor) ?? art ?? "";
      root.querySelector<HTMLElement>("#detail-art-caption")!.textContent = colorCaption(petColor);
      root
        .querySelectorAll<HTMLButtonElement>("[data-color]")
        .forEach((tile) =>
          tile.setAttribute("aria-pressed", String(Number(tile.dataset.color) === petColor)),
        );
    };
    if (art && artKey) {
      colorUrls.set(-1, art);
      void pack.image(artKey).then((source) => {
        if (selectedPetId !== id) return;
        // The game recolours a shiny (nature 7..9) by its colour alone: any shiny nature gives the
        // same picture, the frame itself being the colour regions' reference.
        SHINY_THEMES.forEach((_, color) => {
          const recolored = shinyRecolor.image(source, 7, pet.spriteId, color, source);
          const url = recolored instanceof HTMLCanvasElement ? recolored.toDataURL() : art;
          colorUrls.set(color, url);
          root
            .querySelectorAll<HTMLImageElement>(`[data-color-img="${color}"]`)
            .forEach((preview) => (preview.src = url));
        });
        showColor();
      });
    }
    root.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((tile) => {
      tile.onclick = () => {
        petColor = Number(tile.dataset.color);
        showColor();
      };
    });
    root.querySelector<HTMLSelectElement>("#stat-nature")!.onchange = (event) => {
      petNature = Number((event.target as HTMLSelectElement).value);
      updateStats();
    };
    updateStats();
    root.querySelector<HTMLButtonElement>("#favorite-button")!.onclick = () => {
      if (favorites.has(id)) favorites.delete(id);
      else favorites.add(id);
      localStorage.setItem("vqsv-wiki-favorites", JSON.stringify([...favorites]));
      renderPetDetail(id);
    };
    root.querySelectorAll<HTMLButtonElement>("[data-jump]").forEach((button) => {
      button.onclick = () =>
        root.querySelector(`#${button.dataset.jump}`)?.scrollIntoView({ behavior: "smooth" });
    });
    const levelInput = root.querySelector<HTMLInputElement>("#wiki-level")!;
    const updateLevel = () => {
      petLevel = Number(levelInput.value);
      if (statLevelInput.value !== levelInput.value) {
        statLevelInput.value = levelInput.value;
        updateStats();
      }
      root.querySelector<HTMLElement>("#level-value")!.textContent = String(petLevel);
      let unlocked = 0;
      root.querySelectorAll<HTMLElement>(".skill-unlock").forEach((row) => {
        const available = Number(row.dataset.unlock) <= petLevel;
        row.classList.toggle("locked", !available);
        row.querySelector<HTMLElement>(".unlock-state")!.textContent = available
          ? "Đã mở"
          : "Chưa mở";
        if (available) unlocked++;
      });
      root.querySelector<HTMLElement>("#learned-count")!.textContent =
        `${unlocked}/${pool.length} đã mở`;
    };
    levelInput.oninput = updateLevel;
    updateLevel();
  }

  function renderSkillDetail(id: number) {
    const skill = skillById.get(id);
    if (!skill) {
      location.hash = "#/skills";
      return;
    }
    const details = skillDetailsById.get(id);
    const learners = species
      .map((pet) => ({
        pet,
        level: learnedSkills(pet.speciesId).find(([skillId]) => skillId === id)?.[1],
      }))
      .filter((row): row is { pet: PackSpeciesRow; level: number } => row.level !== undefined)
      .sort((left, right) => left.level - right.level || left.pet.speciesId - right.pet.speciesId);
    const targets: Record<string, string> = {
      single_enemy: "Một đối thủ",
      all_enemies: "Toàn bộ đối thủ",
      single_ally: "Một đồng đội",
      all_allies: "Toàn bộ đồng đội",
      self: "Bản thân",
      self_or_ally: "Bản thân hoặc đồng đội",
      self_or_one_ally: "Bản thân hoặc một đồng đội",
    };
    shell(`<main class="detail-page"><a class="back-link" href="#/skills">← Toàn bộ kỹ năng</a>
      <section class="subject-hero skill-subject ${elementClasses[skill.elementFamily] ?? ""}"><span class="subject-sigil">${elementIcons[skill.elementFamily] ?? "✦"}</span><div><span class="eyebrow">HỒ SƠ KỸ NĂNG · #${skill.skillId}</span><h1>${escapeHtml(skill.name)}</h1><div class="detail-badges">${badge(skill.elementFamily)}<span class="soft-badge">${escapeHtml(skillCategoryLabel(details?.combatCategory ?? "Chiến đấu"))}</span></div><p>${escapeHtml(details?.description ?? "Thông số kỹ năng được lấy từ dữ liệu chiến đấu của VQSV.")}</p></div></section>
      <div class="subject-facts"><div><small>Uy lực</small><strong>${skill.powerPercent > 0 ? `${skill.powerPercent}%` : "Hiệu ứng"}</strong></div><div><small>PP tối đa</small><strong>${skill.ppMax}</strong></div><div><small>Bậc kỹ năng</small><strong>${skill.learnTier}</strong></div><div><small>Mục tiêu</small><strong>${escapeHtml(targets[details?.targetPattern ?? ""] ?? "Theo kỹ năng")}</strong></div></div>
      <section class="detail-section"><div class="detail-section-heading"><div><span class="eyebrow">BỂ KỸ NĂNG</span><h2>Pet học được kỹ năng này</h2><p>Cấp mở được lấy từ bể kỹ năng đang dùng trong game.</p></div><span id="learner-count">${learners.length} loài</span></div>${learners.length ? `<label class="search-box learner-search"><span>⌕</span><input id="learner-search" type="search" placeholder="Lọc tên Pet…" aria-label="Lọc Pet học kỹ năng" /></label><div class="learner-grid">${learners.map(({ pet, level }) => `<div class="learner" data-name="${escapeHtml(norm(pet.name))}">${petMini(pet)}<span>Cấp ${level}</span></div>`).join("")}</div>` : '<p class="detail-empty">Chưa có Pet nào trong bể kỹ năng được công bố cho chiêu này.</p>'}</section></main>`);
    root.querySelector<HTMLInputElement>("#learner-search")?.addEventListener("input", (event) => {
      const needle = norm((event.target as HTMLInputElement).value.trim());
      let visible = 0;
      root.querySelectorAll<HTMLElement>(".learner").forEach((row) => {
        row.hidden = !row.dataset.name?.includes(needle);
        if (!row.hidden) visible++;
      });
      root.querySelector<HTMLElement>("#learner-count")!.textContent = `${visible} loài`;
    });
  }

  function renderItemDetail(key: string) {
    const item = itemByKey.get(key);
    if (!item) {
      location.hash = "#/items";
      return;
    }
    const usages = evolutionRules.filter((rule) =>
      rule.ingredients.some(([, ingredientKey]) => ingredientKey === key),
    );
    shell(`<main class="detail-page"><a class="back-link" href="#/items">← Toàn bộ vật phẩm</a>
      <section class="subject-hero item-subject"><span class="subject-sigil item-subject-art">${item.icon ? `<img src="${pack.url(`items.${item.icon}`)}" alt="" />` : "✧"}</span><div><span class="eyebrow">HỒ SƠ VẬT PHẨM · #${item.runtimeId}</span><h1>${escapeHtml(item.name)}</h1><div class="detail-badges"><span class="soft-badge">${escapeHtml(itemCategoryLabel(item.category))}</span><span class="soft-badge">${item.source === "cau-vong" ? "Cầu Vồng" : "Liệt Hỏa"}</span></div><p>${escapeHtml(item.description)}</p></div></section>
      <div class="subject-facts"><div><small>Loại</small><strong>${escapeHtml(itemKindLabel(item.kind))}</strong></div><div><small>Ứng dụng</small><strong>${escapeHtml(itemUsageLabel(item.usage))}</strong></div><div><small>Công thức dùng</small><strong>${usages.length}</strong></div><div><small>Mã vật phẩm</small><strong>${item.runtimeId}</strong></div></div>
      <section class="detail-section"><div class="detail-section-heading"><div><span class="eyebrow">LIÊN KẾT TIẾN HÓA</span><h2>Pet sử dụng vật phẩm này</h2><p>Mỗi tuyến hiển thị Pet trước và sau tiến hóa, cấp yêu cầu cùng nguyên liệu.</p></div><span>${usages.length} công thức</span></div>${usages.length ? `<div class="recipe-list">${usages.map(recipeCard).join("")}</div>` : '<p class="detail-empty">Vật phẩm này không nằm trong công thức tiến hóa Pet hiện tại.</p>'}</section></main>`);
  }

  function render() {
    const { section, id, key } = getHash();
    if (section === "pets" && id !== undefined) {
      renderPetDetail(id);
      return;
    }
    if (section === "skills" && id !== undefined) {
      renderSkillDetail(id);
      return;
    }
    if (section === "items" && key !== undefined) {
      renderItemDetail(key);
      return;
    }
    if (section === "home") {
      shell(
        `<main><section class="hero"><picture><source media="(max-width: 700px)" srcset="${pack.url("wiki.hero-mobile-v2.png")}" /><img src="${pack.url("wiki.hero-desktop-v2.png")}" alt="Cuốn bách khoa VQSV mở ra thế giới Pet" /></picture><div class="hero-content"><span class="eyebrow">THƯ VIỆN THẾ GIỚI VQSV</span><h1>Muôn loài Pet.<br /><em>Một đại thư.</em></h1><p>Khám phá loài Pet, kỹ năng, vật phẩm và thế giới của Vương Quốc Sủng Vật.</p><a class="primary-link" href="#/pets">Khám phá bách khoa <span>↗</span></a></div></section><section class="home-stats"><div><strong>${count.format(species.length)}</strong><span>loài Pet</span></div><div><strong>${count.format(skills.length)}</strong><span>kỹ năng</span></div><div><strong>${count.format(items.length)}</strong><span>vật phẩm</span></div><div><strong>7</strong><span>hệ nguyên tố</span></div></section><section class="home-section"><div class="home-section-title"><span class="eyebrow">BẮT ĐẦU KHÁM PHÁ</span><h2>Mở một trang mới</h2><p>Mỗi mục sử dụng dữ liệu đang phục vụ trò chơi.</p></div><div class="feature-grid"><a href="#/pets"><span>01 / BÁCH KHOA</span><b>Pet</b><p>Tìm loài, xem hệ, sprite gốc và tuyến tiến hóa.</p><i>↗</i></a><a href="#/skills"><span>02 / CHIẾN ĐẤU</span><b>Kỹ năng</b><p>Tra cứu sức mạnh, PP và hệ của kỹ năng.</p><i>↗</i></a><a href="#/items"><span>03 / HÀNH TRÌNH</span><b>Vật phẩm</b><p>Khám phá nguyên liệu, trang bị và công dụng.</p><i>↗</i></a><a href="#/world"><span>04 / THẾ GIỚI</span><b>Vùng đất</b><p>Nhìn lại bản đồ và những nơi đã đi qua.</p><i>↗</i></a></div></section><section class="home-section discovery"><div class="home-section-title"><span class="eyebrow">TỪ ĐẠI THƯ</span><h2>Những loài Pet khác nhau</h2><p>Khám phá những loài Pet từ khắp các vùng đất.</p></div><div class="pet-grid">${[
          0, 35, 80, 117, 167, 220,
        ]
          .map((n) => species[n])
          .filter(Boolean)
          .map(petCard)
          .join(
            "",
          )}</div><a class="text-link" href="#/pets">Xem toàn bộ ${species.length} loài →</a></section></main>`,
      );
    } else if (section === "pets") {
      shell(
        `<main class="catalog-page"><div class="catalog-top">${sectionHeader("ĐẠI THƯ PET", "Bách khoa Pet", "Tìm kiếm trong toàn bộ catalog Pet của VQSV. Chọn một loài để xem hồ sơ và tuyến tiến hóa.")}${search("Tìm tên Pet…")}${filters("element")}<div class="catalog-toolbar"><div class="filter-row rarity-row"><button data-rarity="-1" class="${rarity === -1 ? "selected" : ""}">Mọi độ hiếm</button>${[0, 1, 2, 3, 4, 5].map((value) => `<button data-rarity="${value}" class="${rarity === value ? "selected" : ""}">${value} ★</button>`).join("")}</div><button id="favorite-filter" class="favorite-filter ${onlyFavorites ? "selected" : ""}">♡ Pet đã lưu</button></div></div><div class="results-heading"><strong id="result-count"></strong><span>Chọn Pet để mở hồ sơ</span></div><div id="results" class="pet-grid"></div><div id="pager" class="pager"></div></main>`,
      );
      attachFilters();
      renderList();
    } else if (section === "skills") {
      shell(
        `<main class="catalog-page"><div class="catalog-top">${sectionHeader("KHO KỸ NĂNG", "Kỹ năng chiến đấu", "Tra cứu tên, hệ, sức mạnh và điểm PP từ catalog kỹ năng của game.")}${search("Tìm tên kỹ năng…")}${filters("element")}</div><div class="results-heading"><strong id="result-count"></strong><span>Dữ liệu chiến đấu VQSV</span></div><div id="results" class="row-grid"></div><div id="pager" class="pager"></div></main>`,
      );
      attachFilters();
      renderList();
    } else if (section === "items") {
      shell(
        `<main class="catalog-page"><div class="catalog-top">${sectionHeader("KHO VẬT PHẨM", "Vật phẩm & trang bị", "Tên, mô tả và phân loại lấy từ catalog vật phẩm dùng chung của game.")}${search("Tìm tên hoặc công dụng…")}${filters("item")}</div><div class="results-heading"><strong id="result-count"></strong><span>Catalog Liệt Hỏa và Cầu Vồng</span></div><div id="results" class="row-grid"></div><div id="pager" class="pager"></div></main>`,
      );
      attachFilters();
      renderList();
    } else {
      const regions = [
        ["Làng Phượng Chi", "lang-phuong-chi.png", "Khởi đầu hành trình"],
        ["Bích Thủy", "bich-thuy-trung-tam.png", "Đường nước và đảo nhỏ"],
        ["Nguyên Mộc", "nguyen-moc-trung-tam.png", "Đất xanh và bến nước"],
        ["Hắc Thạch", "hac-thach-dong-thanh.png", "Hang sâu và đá cổ"],
        ["Quảng trường Cầu Vồng", "cau-vong-quang-truong.png", "Trung tâm thành phố"],
        ["Phố Cầu Vồng", "cau-vong-pho-thanh.png", "Đường phố nhộn nhịp"],
      ];
      shell(
        `<main class="catalog-page world-page">${sectionHeader("BẢN ĐỒ THẾ GIỚI", "Các vùng đất", "Sáu bản đồ gốc từ tài nguyên VQSV, giữ nguyên nét pixel của game.")}<div class="region-grid">${regions.map(([name, file, desc]) => `<article class="region-card"><div><img src="${pack.url(`wiki.maps/${file}`)}" alt="Bản đồ ${name}" loading="lazy" /></div><span>BẢN ĐỒ VQSV</span><h2>${name}</h2><p>${desc}</p></article>`).join("")}</div></main>`,
      );
    }
  }

  window.addEventListener("hashchange", () => {
    query = "";
    page = 1;
    render();
    window.scrollTo({ top: 0 });
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "/" && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      root.querySelector<HTMLInputElement>("#wiki-search")?.focus();
    }
  });
  render();
}

start().catch((error: unknown) => {
  root.innerHTML = `<div class="wiki-error"><h1>Không mở được đại thư</h1><p>${escapeHtml(String(error))}</p><button onclick="location.reload()">Tải lại</button></div>`;
});
