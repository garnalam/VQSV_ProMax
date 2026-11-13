// Exports the original game's bag item tables to public/pack/story/bag-items.json.
//
// Source: modules/script/decoded/data__script__db.mid.json (`a.b.c.c`, nine short matrices) and
// data__script__chs.mid.json (`a.a.c(row)` text). The bag (`game.k` bs/br/bt/bu) reads:
//   - group 4: consumables, one row per item id: [name row, icon cell (sprite 258), description
//     row, price, flag, kind, ...params]. Kind 0 (balls) live in list L, the rest in list K;
//   - group 3: ids 0..11 are equipment (list M), ids 12.. materials (list N);
//   - group 5: special items (list O).
//
// Usage: npm run export:bag-items
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sourcePackRoot } from "./source-pack.mjs";

const root = sourcePackRoot();
const groups = JSON.parse(
  readFileSync(resolve(root, "modules/script/decoded/data__script__db.mid.json"), "utf8"),
).groups;
const chs = JSON.parse(
  readFileSync(resolve(root, "modules/script/decoded/data__script__chs.mid.json"), "utf8"),
).rows.map((row) => (Array.isArray(row) ? row.join("") : String(row)));

const table = (group) =>
  groups[group].map((row, id) => ({
    id,
    name: chs[row[0]] ?? "",
    icon: row[1],
    description: chs[row[2]] ?? "",
    columns: row,
  }));

const document = {
  schema: "vqsv-webnative-bag-items-v1",
  source:
    "Original db.mid groups 3 (equipment/materials), 4 (consumables), 5 (specials) with chs.mid names; scripts/export-bag-items.mjs",
  consumables: table(4),
  gear: table(3),
  specials: table(5),
  /** `a.a.c(634)`: the egg row's description while no egg is held. */
  texts: { 634: chs[634] ?? "" },
};
const out = resolve(process.cwd(), "public/pack/story/bag-items.json");
writeFileSync(out, `${JSON.stringify(document, null, 1)}\n`);
console.log(
  `bag items: ${document.consumables.length} consumables, ${document.gear.length} gear, ${document.specials.length} specials -> ${out}`,
);
