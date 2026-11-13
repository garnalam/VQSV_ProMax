// JavaSE parity: main quest CV4c "Cầu Vồng — Bốn Cổng", stages 7–9, and the dorm's Thiết Giáp Xà
// branch. `CauVongChapterRuntime.tick` hands these to:
//
//   3   `tickClassroom` → `CauVongAcademyExpansionRuntime` (An Kỳ Nhi's introduction, the twins and
//       Hoàng Dực Điểu, the release plan; the source route's INTRO 3:4, CONFRONTATION and
//       RELEASE_PLAN 3:5)
//   17, 19, 57, 58  `CauVongWestGateRuntime`: the guards' fight (57, `CauVongGuardEscapeRuntime`),
//       the lab's prologue (58:0, `CauVongLabPrologueCutscene`) and rescue (58:1,
//       `CauVongLabRescueRuntime`), then the bird trail's first visits (`CauVongBirdTrailCutscenes`)
//   59  `CauVongLabReturnCutscene` (59:6, ahead of the academy owners), `CauVongDormPetQuest`
//   9   `fourGateExam` (`CauVongFourGateExamStaging`: four rounds of 9:11), after the four gates' owner
//   11, 5  `CauVongDormPetQuest` (the pursuit in Rừng Gai, the rescue in the ruins)
//
// An Kỳ Nhi's campus tour (2:8) and the night after it (59:5) are `CauVongAcademySideRuntime`, so they
// live with the academy (`CauVongAcademy.ts`). `CauVongCampusInvestigationCutscenes` is room 30 (Bắc
// Hải): CV5.
//
// Bug fix against JavaSE (kept from CV4a): the bird trail's first visits of 17/19/57/58 wait for the
// release plan (3:113); Java played 17:0 the first time the chapter-3 route walked through 17.
//
// The sequences and the owners' own lines are baked by rebuild_game/tools/WebCauVongLab.java
// (`cau-vong-world/lab.json`); this file is the owners' decisions.
import type { AcademyBattle } from "./CauVongAcademy";
import type { CauVongCue, CauVongPart } from "./CauVongCutscene";
import type { FourGatesAction } from "./CauVongFourGates";
import type { ForestWorld } from "./CauVongForest";

type Line = { speaker: string; text: string; portrait: number };

export type CauVongLabDocument = {
  parts: Record<string, CauVongPart>;
  cast: Record<string, CauVongCue[]>;
  actors: {
    /** `actorId(9, 6 + round)`: the four gate teachers; 29 the examiner. */
    teachers: number[];
    examiner: number;
    dormGirl: number;
    /** `CauVongDormPetQuest.applyCast`: the two pets of 11 (29, 30) and of 5 (32, 33). */
    thorn: number[];
    ruins: number[];
    /** `CauVongBirdTrailCutscenes`' girl, bird and portal; 19's native bird prop. */
    girl: number;
    bird: number;
    portal: number;
    bird19Prop: number;
    /** `brokenProps`: 58's two apparatus. */
    labDevices: number[];
    /** `CauVongAcademyExpansionRuntime.applyCast`: 3's pets, An Kỳ Nhi, the twins, the bird. */
    expansionPets: number[];
    classGirl: number;
    twins: number[];
    classBird: number;
    /** `CauVongGuardEscapeRuntime.applyCast`: 57's guards. */
    guards: number[];
  };
  battles: Record<string, AcademyBattle>;
  text: {
    expansionWait: Line;
    expansionLost: Line;
    guardLost: Line;
    labLost: Line;
    examLost: Line[];
    dormPursuitLost: Line;
    dormLost: Line;
    dormWonNoRoom: Line;
    dormFindNoRoom: Line;
    dormRectNoRoom: Line;
    dormThanks: Line;
    dormRefused: Line;
    dormObjective: string[];
    dormSpeaker: string;
  };
  menus: { dormReturn: string[] };
  flags: Record<
    | "intro"
    | "confrontation"
    | "victory"
    | "releasePlan"
    | "northReport"
    | "angelTour"
    | "angelNight"
    | "investigationReport"
    | "labWon"
    | "labStarted"
    | "labBroken"
    | "labRetry"
    | "guardWon"
    | "guardStarted"
    | "guardRetry"
    | "prologue"
    | "returnPending"
    | "returnComplete"
    | "examFirst"
    | "examComplete"
    | "dormCry"
    | "dormAccepted"
    | "dormBefore"
    | "dormWon"
    | "dormFound"
    | "dormReturned"
    | "dormRewarded"
    | "dormSighted"
    | "dormChasePre"
    | "dormChaseWon"
    | "dormChased"
    | "dormChasePending",
    number
  >;
};

/** The owner's part and battle names carry this prefix, so the hooks find it. */
export const LAB_PREFIX = "lab:";
/** The dorm's return menu, numbered past the forest's 11/12. */
export const LAB_MENU = 21;
const CLASSROOM = 3;
const GUARDS = 57;
const LAB = 58;
const DORM = 59;
const EXAM = 9;
const THORN = 11;
const RUINS = 5;
/** `CauVongFourGateExamStaging`: STARTED, RETRY, POST (+round), the round started (140 + round). */
const EXAM_STARTED = 130;
const EXAM_RETRY = 131;
const EXAM_POST = 120;
const EXAM_ROUND = 140;
/** `CauVongDormPetQuest.grantPet` receipts (5:28000 + species). */
const RESCUED = [28022, 28033];
/** `CauVongDormPetQuest.Part`, in ordinal order. */
const DORM_PARTS = [
  "NOTICE",
  "ACCEPT",
  "FIND_PRE",
  "FIND_POST",
  "RETURN",
  "SIGHT",
  "CHASE_BEFORE",
  "CHASE_AFTER",
];

/** What the CV4c owners read and write beyond the forest's world. */
export interface LabWorld extends ForestWorld {
  /** `CauVongDormPetQuest.hasSpace(s, count)`: free party slots plus free bank slots. */
  petRoom(count: number): boolean;
  /**
   * `returnPet`'s `confirmRelease`: the lowest-level Thiết Giáp Xà (122) of the party leaves, if
   * another living pet stays.
   */
  releaseSnake(): boolean;
}

/** The CV4c owners and their state between ticks. */
export class LabOwner {
  constructor(private readonly doc: CauVongLabDocument) {}

  owns(name: string): boolean {
    return name.startsWith(LAB_PREFIX);
  }
  private start(name: string, restore?: CauVongCue[]): FourGatesAction {
    return { kind: "part", name: LAB_PREFIX + name, part: this.doc.parts[name], restore };
  }
  private say(line: Line | { speaker: string; text: string }): FourGatesAction {
    return {
      kind: "text",
      steps: [
        {
          k: "say",
          speaker: line.speaker,
          text: line.text,
          portrait: "portrait" in line ? line.portrait : -1,
        },
      ],
    };
  }
  private battle(key: string): FourGatesAction {
    return { kind: "battle", key: LAB_PREFIX + key };
  }

  // --- CauVongAcademyExpansionRuntime (3) ---

  /** `tick` on the source route (the web's only route). */
  classroom(w: LabWorld): FourGatesAction {
    const f = this.doc.flags,
      done = (event: number) => w.done(CLASSROOM, event);
    if (done(f.victory) && !done(f.releasePlan)) return this.start("RELEASE");
    // The begun introduction (114) or confrontation (115) resumes on its own.
    const resume = (done(114) && !done(f.intro)) || (done(115) && !done(f.confrontation));
    if (!done(102) || done(f.releasePlan)) return null;
    if (!done(f.intro) && !resume && !w.done(4, f.northReport)) return null;
    if (!resume && !w.requested(this.doc.actors.classGirl)) return null;
    if (!done(f.intro)) return this.start("INTRO");
    if (!w.done(DORM, f.angelNight)) return this.say(this.doc.text.expansionWait);
    if (!done(f.confrontation)) return this.start("CONFRONTATION");
    return this.birdFight(w);
  }
  /** `startBattle`: the three pets of the scene leave first. */
  private birdFight(w: LabWorld): FourGatesAction {
    for (const id of this.doc.actors.expansionPets) w.show(id, false);
    return this.battle("bird");
  }

  // --- CauVongWestGateRuntime (17, 19, 57, 58) ---

  /** The guards (57), the lab (58), then the bird trail's first visits. */
  west(w: LabWorld, room: number): FourGatesAction {
    const f = this.doc.flags;
    if (room === GUARDS) {
      const guard = this.guards(w);
      if (guard) return guard;
    }
    if (room === LAB) {
      if (!w.done(LAB, f.prologue) && !w.done(LAB, 100)) return this.start("PROLOGUE");
      const rescue = this.lab(w);
      if (rescue) return rescue;
    }
    if (
      (room === 17 || room === 19 || room === GUARDS || room === LAB) &&
      !w.done(room, 100) &&
      w.done(CLASSROOM, f.releasePlan)
    )
      return this.start(`BIRD_${room}`);
    return null;
  }
  /** `CauVongGuardEscapeRuntime.tick`. */
  private guards(w: LabWorld): FourGatesAction {
    const f = this.doc.flags;
    if (w.done(GUARDS, 101) || !w.done(GUARDS, 100)) return null;
    // The post-battle scene assumes the pre-battle cast: re-established first.
    if (w.done(GUARDS, f.guardWon))
      return this.start("GUARD_ESCAPE", this.doc.cast.GUARD_INTERCEPT);
    const near = w.at(200, 300, 80, 20);
    if (w.done(GUARDS, f.guardRetry)) {
      if (!near || !w.confirm) return null;
      w.clear(GUARDS, f.guardRetry);
    } else if (!w.done(GUARDS, f.guardStarted) && !near) return null;
    w.mark(GUARDS, f.guardStarted);
    return this.start("GUARD_INTERCEPT");
  }
  /** `CauVongLabRescueRuntime.tick`. */
  private lab(w: LabWorld): FourGatesAction {
    const f = this.doc.flags;
    if (w.done(LAB, 101) || !w.done(LAB, 100)) return null;
    if (w.done(LAB, f.labWon)) return this.start("LAB_ESCAPE");
    const near = w.at(180, 240, 40, 20);
    if (w.done(LAB, f.labRetry)) {
      if (!near || !w.confirm) return null;
      w.clear(LAB, f.labRetry);
    } else if (!w.done(LAB, f.labStarted) && !near) return null;
    w.mark(LAB, f.labStarted);
    return this.start("LAB_RESCUE");
  }

  // --- the dorm (59) ---

  /** `CauVongLabReturnCutscene.tick`, ahead of the academy owners. */
  labReturn(w: LabWorld): FourGatesAction {
    const f = this.doc.flags;
    if (!w.done(DORM, f.returnPending) || w.done(DORM, f.returnComplete)) return null;
    return this.start("LAB_RETURN");
  }

  // --- CauVongFourGateExamStaging (9, after the four gates' owner) ---

  exam(w: LabWorld): FourGatesAction {
    const f = this.doc.flags,
      done = (event: number) => w.done(EXAM, event);
    if (!w.done(26, 100) || done(f.examComplete)) return null;
    // 9:11 waits for the investigation report (4:1501); begun rounds carry on.
    let continuing = done(EXAM_STARTED) || done(EXAM_RETRY);
    for (let i = 0; i < 4; i++) continuing ||= done(f.examFirst + i) || done(EXAM_ROUND + i);
    if (!continuing && !w.done(4, f.investigationReport)) return null;
    // Old round wins predate the per-line checkpoints.
    if (!done(EXAM_STARTED))
      for (let i = 0; i < 4; i++) if (done(f.examFirst + i)) w.mark(EXAM, EXAM_POST + i);
    for (let i = 0; i < 4; i++)
      if (done(f.examFirst + i) && !done(EXAM_POST + i)) {
        return this.start(`EXAM_POST${i}`);
      }
    let next = 0;
    while (next < 4 && done(f.examFirst + next)) next++;
    if (next === 4) {
      w.mark(EXAM, f.examComplete);
      return null;
    }
    // Each teacher is approached in turn; the examiner (29) stays a shortcut.
    if (
      (!done(EXAM_ROUND + next) || done(EXAM_RETRY)) &&
      !w.requested(this.doc.actors.teachers[next]) &&
      !w.requested(this.doc.actors.examiner)
    )
      return null;
    w.clear(EXAM, EXAM_RETRY);
    w.mark(EXAM, EXAM_STARTED);
    w.mark(EXAM, EXAM_ROUND + next);
    return this.start(`EXAM_PRE${next}`);
  }

  // --- CauVongDormPetQuest (59, 11, 5) ---

  private rescueStarted(w: LabWorld): boolean {
    const f = this.doc.flags;
    return (
      w.done(RUINS, f.dormBefore) ||
      w.done(RUINS, f.dormBefore + 100) ||
      w.done(RUINS, f.dormWon) ||
      w.done(RUINS, f.dormFound) ||
      w.done(DORM, f.dormReturned) ||
      w.done(DORM, f.dormRewarded)
    );
  }
  private remaining(w: LabWorld): number {
    return RESCUED.filter((receipt) => !w.done(RUINS, receipt)).length;
  }
  private pursuit(w: LabWorld): FourGatesAction {
    w.mark(THORN, this.doc.flags.dormChasePending);
    return this.battle("pursuit");
  }
  private dormSay(text: string): FourGatesAction {
    return this.say({ speaker: this.doc.text.dormSpeaker, text });
  }
  /** `tick` in 59, 11 and 5. */
  dormPet(w: LabWorld, room: number): FourGatesAction {
    const f = this.doc.flags,
      t = this.doc.text;
    for (const name of DORM_PARTS) {
      const p = this.doc.parts[`DORM_${name}`];
      if (p.room !== room || !w.done(room, p.flag + 100) || w.done(room, p.flag)) continue;
      if (name === "FIND_POST" && !w.petRoom(this.remaining(w))) return this.say(t.dormFindNoRoom);
      return this.start(`DORM_${name}`);
    }
    if (room === THORN && w.done(DORM, f.dormAccepted) && !this.rescueStarted(w)) {
      if (w.done(THORN, f.dormChaseWon) && !w.done(THORN, f.dormChased))
        return this.start("DORM_CHASE_AFTER");
      if (w.done(THORN, f.dormChasePending)) return this.pursuit(w);
      if (!w.done(THORN, f.dormSighted) && w.at(0, 100, 140, 80)) return this.start("DORM_SIGHT");
      if (w.done(THORN, f.dormSighted) && !w.done(THORN, f.dormChased) && w.at(180, 140, 60, 60))
        return w.done(THORN, f.dormChasePre) ? this.pursuit(w) : this.start("DORM_CHASE_BEFORE");
    }
    if (room === DORM) {
      if (w.done(DORM, f.dormReturned) && !w.done(DORM, f.dormRewarded))
        return this.start("DORM_RETURN");
      if (
        !w.done(DORM, f.dormCry) &&
        !w.done(DORM, f.dormAccepted) &&
        !w.done(DORM, f.dormReturned) &&
        w.done(CLASSROOM, 102) &&
        w.at(140, 440, 120, 80)
      )
        return this.start("DORM_NOTICE");
      if (w.requested(this.doc.actors.dormGirl) && w.done(CLASSROOM, 102)) {
        if (w.done(DORM, f.dormRewarded)) return this.say(t.dormThanks);
        if (!w.done(DORM, f.dormAccepted)) return this.start("DORM_ACCEPT");
        if (w.done(RUINS, f.dormFound))
          return { kind: "menu", owner: LAB_MENU, options: this.doc.menus.dormReturn };
        return this.dormSay(this.objective(w));
      }
    } else if (
      room === RUINS &&
      w.done(DORM, f.dormAccepted) &&
      !w.done(RUINS, f.dormFound) &&
      (w.done(THORN, f.dormChased) || this.rescueStarted(w)) &&
      w.at(0, 280, 100, 40)
    ) {
      if (!w.done(RUINS, f.dormWon)) return this.start("DORM_FIND_PRE");
      return w.petRoom(this.remaining(w))
        ? this.start("DORM_FIND_POST")
        : this.say(t.dormRectNoRoom);
    }
    return null;
  }
  /** `objective(s)`. */
  private objective(w: LabWorld): string {
    const chased = w.done(THORN, this.doc.flags.dormChased) || this.rescueStarted(w);
    return this.doc.text.dormObjective[chased ? 1 : 0];
  }
  /** `returnPet`: once, after the find, the snake leaves the party. */
  private returnPet(w: LabWorld): boolean {
    const f = this.doc.flags;
    if (w.done(DORM, f.dormReturned)) return true;
    if (!w.done(RUINS, f.dormFound)) return false;
    if (!w.releaseSnake()) return false;
    w.mark(DORM, f.dormReturned);
    return true;
  }

  // --- the ends ---

  /** A part is over (its flag already written). */
  after(w: LabWorld, name: string): FourGatesAction {
    const f = this.doc.flags,
      a = this.doc.actors;
    const part = name.slice(LAB_PREFIX.length);
    if (part.startsWith("EXAM_PRE")) return this.battle(`exam${part.slice(-1)}`);
    if (part.startsWith("EXAM_POST")) {
      const round = Number(part.slice(-1));
      w.mark(EXAM, EXAM_POST + round);
      if (round === 3) w.mark(EXAM, f.examComplete);
      return null;
    }
    if (part.startsWith("BIRD_")) return { kind: "cast" };
    switch (part) {
      case "CONFRONTATION":
        return this.birdFight(w);
      case "RELEASE":
        for (const id of [a.classGirl, ...a.twins, a.classBird]) w.show(id, false);
        return null;
      case "GUARD_INTERCEPT":
        return this.battle("guard");
      case "GUARD_ESCAPE":
        w.mark(GUARDS, 101);
        return { kind: "exit", room: LAB, x: 190, y: 359, dir: 2 };
      case "LAB_RESCUE":
        w.mark(LAB, f.labBroken);
        return this.battle("lab");
      case "LAB_ESCAPE":
        w.mark(LAB, 101);
        w.mark(DORM, f.returnPending);
        return { kind: "exit", room: DORM, x: 330, y: 419, dir: 3 };
      case "DORM_FIND_PRE":
        return this.battle("dorm");
      case "DORM_FIND_POST":
      case "DORM_SIGHT":
      case "DORM_CHASE_AFTER":
        return { kind: "cast" };
      case "DORM_CHASE_BEFORE":
        return this.pursuit(w);
      default:
        return null;
    }
  }

  /** The return menu's answer. */
  answer(w: LabWorld, selection: number): FourGatesAction {
    if (selection !== 0) return null;
    return this.returnPet(w) ? this.start("DORM_RETURN") : this.say(this.doc.text.dormRefused);
  }

  /** `handleBattleResult` of each fight, keyed "lab:<battle>". */
  result(w: LabWorld, key: string, won: boolean): FourGatesAction {
    const f = this.doc.flags,
      t = this.doc.text;
    const battle = key.slice(LAB_PREFIX.length);
    if (battle.startsWith("exam")) {
      const round = Number(battle.slice(4));
      if (won) {
        w.mark(EXAM, f.examFirst + round);
        return this.start(`EXAM_POST${round}`);
      }
      w.clear(EXAM, EXAM_ROUND + round);
      w.mark(EXAM, EXAM_RETRY);
      return this.say(t.examLost[round]);
    }
    switch (battle) {
      case "bird":
        if (won) {
          w.mark(CLASSROOM, f.victory);
          return null;
        }
        return this.say(t.expansionLost);
      case "guard":
        if (won) {
          w.mark(GUARDS, f.guardWon);
          return this.start("GUARD_ESCAPE", this.doc.cast.GUARD_INTERCEPT);
        }
        w.mark(GUARDS, f.guardRetry);
        return this.say(t.guardLost);
      case "lab":
        if (won) {
          w.mark(LAB, f.labWon);
          return this.start("LAB_ESCAPE");
        }
        w.mark(LAB, f.labRetry);
        return this.say(t.labLost);
      case "pursuit":
        w.clear(THORN, f.dormChasePending);
        if (won) {
          w.mark(THORN, f.dormChaseWon);
          return this.start("DORM_CHASE_AFTER");
        }
        return this.say(t.dormPursuitLost);
      case "dorm":
        if (won) {
          w.mark(RUINS, f.dormWon);
          return w.petRoom(this.remaining(w))
            ? this.start("DORM_FIND_POST")
            : this.say(t.dormWonNoRoom);
        }
        return this.say(t.dormLost);
      default:
        return null;
    }
  }
}

/** The CV4c owners' `applyCast`s for `room`. */
export function labCast(
  doc: CauVongLabDocument,
  room: number,
  done: (room: number, event: number) => boolean,
): { cues: CauVongCue[]; visible: [number, boolean][]; state: [number, number][] } {
  const cast = {
    cues: [] as CauVongCue[],
    visible: [] as [number, boolean][],
    state: [] as [number, number][],
  };
  const f = doc.flags,
    a = doc.actors;
  if (room === CLASSROOM) {
    // `CauVongAcademyExpansionRuntime.applyCast`.
    for (const id of [...a.expansionPets, a.classBird]) cast.visible.push([id, false]);
    if (done(CLASSROOM, f.releasePlan))
      for (const id of [a.classGirl, ...a.twins]) cast.visible.push([id, false]);
  }
  if (room === 17 || room === 19 || room === GUARDS || room === LAB) {
    // `CauVongBirdTrailCutscenes.applyCast`: 19's native bird is the cutscene's own.
    cast.visible.push([a.girl, false]);
    if (room === 19) {
      cast.visible.push([a.bird19Prop, false], [a.bird, !done(19, 100)]);
      cast.visible.push([a.portal, done(19, 100)]);
      cast.state.push([a.portal, done(19, 100) ? 1 : 0]);
    } else cast.visible.push([a.bird, false]);
  }
  if (room === GUARDS) {
    // `CauVongGuardEscapeRuntime.applyCast`.
    if ((done(GUARDS, f.guardWon) || done(GUARDS, f.guardRetry)) && !done(GUARDS, 101))
      cast.cues.push(...doc.cast.GUARD_INTERCEPT);
    if (done(GUARDS, 101)) for (const id of a.guards) cast.visible.push([id, false]);
  }
  if (room === LAB) {
    // `CauVongLabRescueRuntime.applyCast`: the freed pair and the guards wait hidden.
    // `CauVongLabPrologueCutscene.applyCast`: the king (152) too.
    for (let id = 148; id <= 152; id++) cast.visible.push([id, false]);
    if (done(LAB, f.labBroken) || done(LAB, 101))
      for (const id of a.labDevices) cast.state.push([id, 2]);
    if ((done(LAB, f.labWon) || done(LAB, f.labRetry)) && !done(LAB, 101))
      cast.cues.push(...doc.cast.LAB_RESCUE);
  }
  if (room === DORM) cast.visible.push([a.girl, false]);
  // `CauVongDormPetQuest.applyCast`.
  const rescueStarted =
    done(RUINS, f.dormBefore) ||
    done(RUINS, f.dormBefore + 100) ||
    done(RUINS, f.dormWon) ||
    done(RUINS, f.dormFound) ||
    done(DORM, f.dormReturned) ||
    done(DORM, f.dormRewarded);
  if (room === THORN)
    for (const id of a.thorn)
      cast.visible.push([
        id,
        done(DORM, f.dormAccepted) && !done(THORN, f.dormChased) && !rescueStarted,
      ]);
  if (room === RUINS)
    for (const id of a.ruins)
      cast.visible.push([
        id,
        done(DORM, f.dormAccepted) &&
          !done(RUINS, f.dormFound) &&
          (done(THORN, f.dormChased) || rescueStarted),
      ]);
  return cast;
}
