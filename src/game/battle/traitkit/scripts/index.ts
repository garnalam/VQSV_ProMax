import { setTraitTuning, type TraitScript } from "../TraitKit";
import tuning from "../tuning.json";
import { PART_1 } from "./part1";
import { PART_2 } from "./part2";
import { PART_3 } from "./part3";
import { PART_4 } from "./part4";
import { PART_5 } from "./part5";
import { PART_6 } from "./part6";
import { PART_7 } from "./part7";
import { PART_8 } from "./part8";

// Bảng cân bằng (mô phỏng trận 5–7 lượt): ghi đè tham số theo loài.
setTraitTuning(tuning as Record<number, Record<string, number>>);

/** Mọi kịch bản đặc tính, theo id loài (0..279). */
export const TRAIT_SCRIPTS: ReadonlyMap<number, TraitScript> = new Map(
  [PART_1, PART_2, PART_3, PART_4, PART_5, PART_6, PART_7, PART_8].flatMap((part) =>
    Object.entries(part).map(([id, script]) => [Number(id), script] as const),
  ),
);
