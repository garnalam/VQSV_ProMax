// Gifts from the server (gift codes and mailbox gifts): what an admin may put in one, and how a
// claimed gift becomes the grants the game applies (the same shapes as the Admin Tool's grants,
// see src/account/AdminApi.ts). Random parts of a pet are drawn here, never by the client.
import { randomBytes } from 'node:crypto';
import { ADMIN_BOSS_SPECIES } from './admin-grant.mjs';

const ITEM_KINDS = new Set(['BAG', 'EQUIPMENT', 'MATERIAL', 'SPECIAL']);
const SHINY_MODES = new Set(['never', 'random', 'always']);
const MAX_CURRENCY = 2147483647;
export const MAX_REWARD_ITEMS = 20;
export const MAX_REWARD_PETS = 6;
const PLAIN_NATURE = 2;
const SHINY_NATURES = [7, 8, 9];
/** Phẩm chất (the stars a pet shows): 1..5; a gift pet without stars hatches at its species default. */
export const MIN_STARS = 1;
export const MAX_STARS = 5;
/** A chosen talent (physical trait runtime id); the game checks it is rollable and else rolls. */
const MAX_TALENT_ID = 999;

function int(value, min, max) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

/**
 * `{ money, badges, items: [{ kind, id, quantity }], pets: [{ speciesId, shiny, stars?, talent? }] }` checked and
 * cleaned, or null. An empty gift is refused.
 */
export function normalizeRewards(input) {
  if (typeof input !== 'object' || input === null) return null;
  const money = int(input.money ?? 0, 0, MAX_CURRENCY);
  const badges = int(input.badges ?? 0, 0, MAX_CURRENCY);
  const rawItems = input.items ?? [];
  const rawPets = input.pets ?? [];
  if (money === null || badges === null || !Array.isArray(rawItems) || !Array.isArray(rawPets)) return null;
  if (rawItems.length > MAX_REWARD_ITEMS || rawPets.length > MAX_REWARD_PETS) return null;
  const items = [];
  for (const item of rawItems) {
    const kind = String(item?.kind ?? '');
    const id = int(item?.id, 0, 99999);
    const quantity = int(item?.quantity, 1, 9999);
    if (!ITEM_KINDS.has(kind) || id === null || quantity === null) return null;
    items.push({ kind, id, quantity });
  }
  const pets = [];
  for (const pet of rawPets) {
    const speciesId = int(pet?.speciesId, 0, 99999);
    const shiny = String(pet?.shiny ?? 'never');
    const rawStars = pet?.stars ?? 0;
    const stars = rawStars === 0 || rawStars === '' || rawStars === null ? 0 : int(rawStars, MIN_STARS, MAX_STARS);
    // No talent (absent, null or "") is a random one; 0 is a real talent (Bình hòa).
    const rawTalent = pet?.talent;
    const talent = rawTalent === undefined || rawTalent === null || rawTalent === '' ? undefined : int(rawTalent, 0, MAX_TALENT_ID);
    if (speciesId === null || ADMIN_BOSS_SPECIES.has(speciesId) || !SHINY_MODES.has(shiny) || stars === null || talent === null)
      return null;
    const clean = { speciesId, shiny };
    if (stars) clean.stars = stars;
    if (talent !== undefined) clean.talent = talent;
    pets.push(clean);
  }
  if (!money && !badges && !items.length && !pets.length) return null;
  return { money, badges, items, pets };
}

/** Each pet's random parts, drawn now: which shiny nature (if any) and the talent's entropy. */
function drawPet({ speciesId, shiny, stars, talent }) {
  const random = randomBytes(12);
  const isShiny = shiny === 'always' || (shiny === 'random' && (random[0] & 1) === 1);
  const nature = isShiny ? SHINY_NATURES[random[1] % SHINY_NATURES.length] : PLAIN_NATURE;
  const talentSeed = (random.readBigUInt64BE(4) & 0x7fffffffffffffffn).toString();
  const grant = { action: 'addPet', speciesId, nature, shiny: isShiny, talentSeed };
  if (stars) grant.quality = stars;
  if (talent !== undefined) grant.talentId = talent;
  return grant;
}

/** The grants a claimed gift hands the game, in the order it applies them. */
export function rewardGrants(rewards) {
  const grants = [];
  if (rewards.money || rewards.badges)
    grants.push({ action: 'addCurrency', money: rewards.money, badges: rewards.badges });
  for (const item of rewards.items) grants.push({ action: 'addItem', ...item });
  for (const pet of rewards.pets) grants.push(drawPet(pet));
  return grants;
}

/** The free bank slots a client reports, for gifts that carry pets. */
export function bankFree(value) {
  return int(value, 0, 100000) ?? 0;
}

export const GIFT_CODE_PATTERN = /^[A-Z0-9_-]{4,32}$/;

/** A code as the player typed it, upper-cased, or null when it cannot be a code. */
export function normalizeGiftCodeInput(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return GIFT_CODE_PATTERN.test(code) ? code : null;
}
