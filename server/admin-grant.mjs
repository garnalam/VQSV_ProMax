// The Admin Tool's server rules, shared by the Cloudflare Pages Function (functions/api/[[path]].js)
// and the web-native dev server (VQSV-WebNative/web-native/vite.config.ts), so both answer
// /api/admin/* the same way. Plain JavaScript with no imports: it runs in Workers and in Node.

/** Tàn Nguyệt Long Ma (278) and Kim Diễm Long Vương (280): the Admin Tool never hands these out. */
export const ADMIN_BOSS_SPECIES = new Set([278, 280]);
const ADMIN_ITEM_KINDS = new Set(["BAG", "EQUIPMENT", "MATERIAL", "SPECIAL"]);
const ADMIN_MAX_QUANTITY = 9999;
const ADMIN_MAX_CURRENCY = 2147483647;
const ADMIN_BUFF_LEVELS = 15;
/** Nature 2 is the ordinary hatch; 7, 8 and 9 are the three shiny natures. */
const ADMIN_PLAIN_NATURE = 2;
const ADMIN_SHINY_NATURES = [7, 8, 9];

/**
 * One /api/admin/* call for an account whose role the caller read from the database. A normal
 * account is refused whatever its client shows. A grant is validated and returned in normalized
 * form; the client applies only what the server handed back. The random parts of a new pet (shiny
 * or not, which shiny, the talent's entropy) are drawn here.
 *
 * `rest` is the path after /api/admin; `body` the parsed JSON body (POST only).
 * Returns `{ status, body }`.
 */
export function adminRoute(role, rest, method, body) {
  if (role !== "admin") return { status: 403, body: { error: "Tài khoản không có quyền quản trị." } };
  if (rest.length === 1 && rest[0] === "status" && method === "GET") return { status: 200, body: { admin: true } };
  if (rest.length === 1 && rest[0] === "grant" && method === "POST") {
    const grant = normalizeAdminGrant(body);
    if (!grant) return { status: 400, body: { error: "Thao tác admin không hợp lệ." } };
    return { status: 200, body: { ok: true, grant } };
  }
  return { status: 404, body: { error: "Không tìm thấy API admin." } };
}

function adminInt(value, min, max) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

export function normalizeAdminGrant(body) {
  switch (body?.action) {
    case "addItem": {
      const kind = String(body.kind || "");
      const id = adminInt(body.id, 0, 99999);
      const quantity = adminInt(body.quantity, 1, ADMIN_MAX_QUANTITY);
      if (!ADMIN_ITEM_KINDS.has(kind) || id === null || quantity === null) return null;
      return { action: "addItem", kind, id, quantity };
    }
    case "setCurrency": {
      const money = adminInt(body.money, 0, ADMIN_MAX_CURRENCY);
      const badges = adminInt(body.badges, 0, ADMIN_MAX_CURRENCY);
      if (money === null || badges === null) return null;
      return { action: "setCurrency", money, badges };
    }
    case "buffPet": {
      const slot = adminInt(body.slot, 0, 5);
      if (slot === null) return null;
      return { action: "buffPet", slot, levels: ADMIN_BUFF_LEVELS };
    }
    case "addPet": {
      const speciesId = adminInt(body.speciesId, 0, 99999);
      // Optional stars (phẩm chất 1..5); without them the pet hatches at its species default.
      const quality = body.quality === undefined || body.quality === null || body.quality === 0 ? 0 : adminInt(body.quality, 1, 5);
      // Optional talent (physical trait runtime id); absent = rolled from talentSeed.
      const talentId = body.talentId === undefined || body.talentId === null || body.talentId === "" ? undefined : adminInt(body.talentId, 0, 999);
      if (speciesId === null || ADMIN_BOSS_SPECIES.has(speciesId) || quality === null || talentId === null) return null;
      const random = crypto.getRandomValues(new Uint32Array(4));
      const shiny = (random[0] & 1) === 1;
      const nature = shiny ? ADMIN_SHINY_NATURES[random[1] % ADMIN_SHINY_NATURES.length] : ADMIN_PLAIN_NATURE;
      // 63 random bits as a decimal string: the client's talent roll takes a 64-bit entropy.
      const talentSeed = ((BigInt(random[2] & 0x7fffffff) << 32n) | BigInt(random[3])).toString();
      const grant = { action: "addPet", speciesId, nature, shiny, talentSeed };
      if (quality) grant.quality = quality;
      if (talentId !== undefined) grant.talentId = talentId;
      return grant;
    }
    default:
      return null;
  }
}
