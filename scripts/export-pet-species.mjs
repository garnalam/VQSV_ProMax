// Exports the original species table (db.mid group 0, `a.b.c.c[0]`) to
// public/pack/story/pet-species.json for the pet screen (`petstate.ui`, game.k f/a).
//
// Columns the screen reads: 0 name row, 1 element (365 + element is its chs.mid name), 2 the
// evolution kind of a form (1/2 evolves, 3 is a mutation), 4 the star cap, 17 the sprite, 19 the
// form it evolves into (-1: none), 22 = 2 marks a divine beast (cannot be released).
//
// Usage: npm run export:pet-species
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

const species = groups[0].map((row, id) => ({
  id,
  name: chs[row[0]] ?? "",
  element: row[1],
  elementName: chs[365 + row[1]] ?? "",
  columns: row,
}));
const document = {
  schema: "vqsv-webnative-pet-species-v1",
  source: "Original db.mid group 0 (species) with chs.mid names; scripts/export-pet-species.mjs",
  species,
};
const out = resolve(process.cwd(), "public/pack/story/pet-species.json");
writeFileSync(out, `${JSON.stringify(document, null, 1)}\n`);
console.log(`pet species: ${species.length} -> ${out}`);
