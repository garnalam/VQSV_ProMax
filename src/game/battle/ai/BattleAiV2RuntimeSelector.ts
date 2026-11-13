import type { BattleAiEncounterCatalog } from "./BattleAiEncounterCatalog";
import type { BattleAiEncounterSpec } from "./BattleAiObservation";

/**
 * `BattleAiV2RuntimeSelector.Mode` — the staged activation modes, fail-closed.
 *
 * `shadowEnabled` is whether the utility pass runs at all; `gameplayCommitEnabled` is whether its
 * proposal may replace the source-v1 answer. A committing mode still has to pass `canCommit`, so the
 * pilot catalog's commissioning and the B1 activation review — not this enum — decide which battles
 * actually run on v2.
 */
export type BattleAiV2ModeName =
  | "SOURCE_V1"
  | "SHADOW_V2"
  | "LEADER_BOSS_CANARY_V2"
  | "ELIGIBLE_ENCOUNTERS_V2"
  | "ALL_ENCOUNTERS_V2";

export type BattleAiV2RuntimeMode = {
  readonly name: BattleAiV2ModeName;
  readonly shadowEnabled: boolean;
  readonly gameplayCommitEnabled: boolean;
  canCommit(encounter: BattleAiEncounterSpec | null, catalog: BattleAiEncounterCatalog): boolean;
};

function mode(
  name: BattleAiV2ModeName,
  shadowEnabled: boolean,
  gameplayCommit: boolean,
): BattleAiV2RuntimeMode {
  return {
    name,
    shadowEnabled,
    gameplayCommitEnabled: gameplayCommit,
    canCommit(encounter: BattleAiEncounterSpec | null, catalog: BattleAiEncounterCatalog) {
      if (!gameplayCommit || encounter === null) return false;
      if (encounter.battleFormat === "SIMULTANEOUS_2V2") {
        return name === "ALL_ENCOUNTERS_V2" && catalog.isCommissioned(encounter.encounterKey);
      }
      if (name === "LEADER_BOSS_CANARY_V2") {
        return catalog.activationReview(encounter.encounterKey) !== null;
      }
      return (
        (name === "ELIGIBLE_ENCOUNTERS_V2" || name === "ALL_ENCOUNTERS_V2") &&
        catalog.isCommissioned(encounter.encounterKey)
      );
    },
  };
}

/** The five modes in Java's enum order, keyed by the name `mode.name()` prints. */
export const RUNTIME_MODES: Record<BattleAiV2ModeName, BattleAiV2RuntimeMode> = {
  SOURCE_V1: mode("SOURCE_V1", false, false),
  SHADOW_V2: mode("SHADOW_V2", true, false),
  LEADER_BOSS_CANARY_V2: mode("LEADER_BOSS_CANARY_V2", true, true),
  ELIGIBLE_ENCOUNTERS_V2: mode("ELIGIBLE_ENCOUNTERS_V2", true, true),
  ALL_ENCOUNTERS_V2: mode("ALL_ENCOUNTERS_V2", true, true),
};

/**
 * `BattleAiV2RuntimeSelector.parse`: the dashed wire value, case-insensitively; unset means the
 * widest mode.
 *
 * Java reads a system property and then an environment variable, neither of which the browser has,
 * so the caller supplies the configured string. Both Java answers are kept: an empty value selects
 * `ALL_ENCOUNTERS_V2` and an unrecognised one throws instead of quietly falling back to source-v1.
 */
export function parseRuntimeMode(configured: string | null | undefined): BattleAiV2RuntimeMode {
  const value = (configured ?? "").trim().toLowerCase();
  if (value === "" || value === "all-encounters-v2") return RUNTIME_MODES.ALL_ENCOUNTERS_V2;
  const name = WIRE_VALUES[value];
  if (name === undefined) {
    throw new Error(
      `Unsupported Battle AI v2 mode: ${configured}. Expected source-v1, shadow-v2, ` +
        "leader-boss-canary-v2 or eligible-encounters-v2 or all-encounters-v2.",
    );
  }
  return RUNTIME_MODES[name];
}

const WIRE_VALUES: Record<string, BattleAiV2ModeName> = {
  "source-v1": "SOURCE_V1",
  "shadow-v2": "SHADOW_V2",
  "leader-boss-canary-v2": "LEADER_BOSS_CANARY_V2",
  "eligible-encounters-v2": "ELIGIBLE_ENCOUNTERS_V2",
  "all-encounters-v2": "ALL_ENCOUNTERS_V2",
};

/** `AI-V2-C all encounter activation` for the widest mode, the canary label for the two narrower ones. */
export function runtimeModeTraceLabel(mode: BattleAiV2RuntimeMode): string {
  if (mode.name === "ALL_ENCOUNTERS_V2") return "AI-V2-C all encounter activation";
  return mode.name === "ELIGIBLE_ENCOUNTERS_V2"
    ? "AI-V2-B4 eligible encounter activation"
    : "AI-V2-B2 Leader/Boss canary";
}

/** Whether this mode writes the `ai-v2-live:` rationale prefix into the committed decision. */
export function runtimeModeIsLive(mode: BattleAiV2RuntimeMode): boolean {
  return mode.name === "ELIGIBLE_ENCOUNTERS_V2" || mode.name === "ALL_ENCOUNTERS_V2";
}
