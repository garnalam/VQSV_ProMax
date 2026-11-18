/**
 * Mô tả đặc tính game và wiki hiển thị (`balance/pet-design-traits.json`: `summary`, `summary2v2`) phải
 * dựng từ đúng số đang chạy trong trận: mẫu `text`/`text2v2` của kịch bản + `params` sau `tuning.json`.
 * Sau khi đổi số: `TRAIT_TEXT_WRITE=1 npx vitest run src/game/battle/traitkit/TraitText.test.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { TRAIT_SCRIPTS } from "./scripts";
import { renderTraitText } from "./TraitKit";

const FILE = resolve(import.meta.dirname, "../../../../public/pack/balance/pet-design-traits.json");

type Row = {
  speciesId: number;
  name?: string;
  summary?: string;
  summary2v2?: string;
  kit?: boolean;
};

it("mô tả đặc tính trong pack khớp số của kịch bản sau tuning", () => {
  const raw = readFileSync(FILE, "utf8");
  const doc = JSON.parse(raw) as { traits: Row[] };
  const wrong: number[] = [];
  for (const row of doc.traits) {
    const script = TRAIT_SCRIPTS.get(row.speciesId);
    if (!script) continue;
    const summary = renderTraitText(row.speciesId, script)?.trim();
    // `text2v2` trống = "Như 1v1" (truyền undefined sẽ rơi về mặc định `text`).
    const two = script.text2v2
      ? renderTraitText(row.speciesId, script, script.text2v2)?.trim()
      : undefined;
    const want: Row = { ...row, name: script.name, summary, kit: true };
    if (two) want.summary2v2 = two;
    else delete want.summary2v2;
    if (JSON.stringify(want) !== JSON.stringify(row)) {
      wrong.push(row.speciesId);
      Object.assign(row, want);
      if (!two) delete row.summary2v2;
    }
  }
  if (process.env.TRAIT_TEXT_WRITE && wrong.length > 0)
    writeFileSync(FILE, JSON.stringify(doc, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  else expect(wrong).toEqual([]);
  expect(doc.traits.filter((r) => TRAIT_SCRIPTS.has(r.speciesId)).length).toBe(280);
});
