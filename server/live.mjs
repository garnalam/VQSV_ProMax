import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The admin's hands in a player's game. Two kinds of command:
 * - live ones go to the running game over `/api/live` (reload, a message), and wait there until
 *   the player next plays;
 * - save ones change the player's cloud save itself, as the admin's revision, then tell the game to
 *   reload it. A game that still holds the older save cannot write over it (store.writeInTransaction
 *   answers `admin_changed`), so the admin's change always wins and nothing is merged.
 * Loading a save is the game's most travelled path, so a stuck fight, ride or cutscene is undone by
 * the reload itself: saves are only taken while the hero stands free.
 */
export const LIVE_KINDS = new Set(['reload', 'message']);

const int = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const ROOMS_FILE = fileURLToPath(new URL('../public/pack/world/rooms.json', import.meta.url));
let rooms = null;
/** The rooms the game can load (`world/rooms.json`), or null when the backend was built without it. */
function roomKeys() {
  if (rooms === null) {
    try { rooms = existsSync(ROOMS_FILE) ? new Set(Object.keys(JSON.parse(readFileSync(ROOMS_FILE, 'utf8')).rooms)) : new Set(); }
    catch { rooms = new Set(); }
  }
  return rooms;
}
function playableRoom(scene, room) {
  if (!int(scene, 1, 98) || !int(room, 0, 99)) return false;
  const known = roomKeys();
  return known.size === 0 || known.has(`${scene}:${room}`);
}

class CommandError extends Error {
  constructor(message) { super(message); this.status = 400; this.code = 'command'; }
}
const refuse = message => { throw new CommandError(message); };

function quest(save) {
  const record = save.story?.quest;
  if (!record || typeof record !== 'object') refuse('Save này chưa có sổ nhiệm vụ (chưa vào cốt truyện).');
  return record;
}
function branchMap(record) {
  const map = new Map();
  for (const entry of String(record.branch ?? '').split(',')) {
    const [task, status] = entry.split(':').map(Number);
    if (Number.isInteger(task) && task >= 0 && (status === 1 || status === 3)) map.set(task, status);
  }
  return map;
}

/**
 * Each save command: checks its input, then returns `{ describe, apply(save) }`; `apply` changes a
 * copy of the save and returns it. A bad input throws (400) before anything is written.
 */
export const SAVE_COMMANDS = {
  teleport(p) {
    const scene = p?.scene, room = p?.room;
    if (!playableRoom(scene, room)) refuse('Phòng không hợp lệ.');
    const placed = p?.x !== undefined && p?.y !== undefined && p.x !== null && p.y !== null;
    if (placed && (!int(p.x, 0, 20000) || !int(p.y, 0, 20000))) refuse('Toạ độ không hợp lệ.');
    return {
      describe: `${scene}:${room}${placed ? ` (${p.x},${p.y})` : ''}`,
      apply(save) {
        // `adminPlaced`: the game seats the hero by its own entry rule (a door when there is no
        // spot, then the nearest tile he can stand on), exactly as walking in through a door does.
        save.location = { sceneId: scene, roomIndex: room, x: placed ? p.x : -1, y: placed ? p.y : -1, direction: 0, adminPlaced: true };
        return save;
      },
    };
  },
  unstuck() {
    return {
      describe: 'đặt lại chỗ đứng an toàn',
      apply(save) { save.location = { ...save.location, adminPlaced: true }; return save; },
    };
  },
  mainTask(p) {
    if (!int(p?.progress, 0, 999)) refuse('Bước nhiệm vụ chính không hợp lệ.');
    return {
      describe: `bước ${p.progress}`,
      apply(save) {
        save.progress = { ...save.progress, mainTaskProgress: p.progress };
        if (save.world && typeof save.world === 'object') save.world.mainTaskProgress = p.progress;
        return save;
      },
    };
  },
  eventState(p) {
    if (!int(p?.scene, 0, 99) || !int(p?.room, 0, 99) || !int(p?.group, 0, 255)) refuse('Sự kiện không hợp lệ.');
    if (p.state !== 'complete' && p.state !== 'fresh') refuse('Trạng thái sự kiện không hợp lệ.');
    const key = `${p.scene}:${p.room}:${p.group}`;
    return {
      describe: `${key} → ${p.state === 'complete' ? 'xong' : 'chưa làm'}`,
      apply(save) {
        const states = { ...(save.eventStates ?? {}) };
        if (p.state === 'complete') states[key] = 3;
        else delete states[key];
        save.eventStates = states;
        return save;
      },
    };
  },
  branchTask(p) {
    if (!int(p?.task, 0, 99999) || ![-1, 1, 3].includes(p?.status)) refuse('Nhiệm vụ phụ không hợp lệ.');
    return {
      describe: `NV phụ ${p.task} → ${p.status === 3 ? 'xong' : p.status === 1 ? 'đang làm' : 'chưa nhận'}`,
      apply(save) {
        const record = quest(save), map = branchMap(record);
        if (p.status === -1) map.delete(p.task);
        else map.set(p.task, p.status);
        record.branch = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([t, s]) => `${t}:${s}`).join(',');
        return save;
      },
    };
  },
  worldFlag(p) {
    if (!int(p?.flag, 0, 1_000_000) || typeof p?.on !== 'boolean') refuse('Cờ không hợp lệ.');
    return {
      describe: `cờ ${p.flag} → ${p.on ? 'bật' : 'tắt'}`,
      apply(save) {
        if (!save.world || typeof save.world !== 'object') refuse('Save này chưa có cờ thế giới.');
        const flags = new Set(Array.isArray(save.world.sourceWorldFlags) ? save.world.sourceWorldFlags : []);
        if (p.on) flags.add(p.flag); else flags.delete(p.flag);
        save.world.sourceWorldFlags = [...flags].sort((a, b) => a - b);
        return save;
      },
    };
  },
  dismount() {
    return {
      describe: 'xuống thú cưỡi',
      apply(save) {
        const ride = save.meta?.campaign?.ride;
        if (ride && typeof ride === 'object') ride.activeIndex = -1;
        return save;
      },
    };
  },
  clearSkills() {
    return {
      describe: 'xoá hàng chờ học chiêu',
      apply(save) { save.pendingSkillLearns = []; return save; },
    };
  },
};

/** What a game says about itself in a heartbeat: small, plain fields only. */
export function presenceInfo(input) {
  const info = {};
  const where = input?.where;
  if (where && typeof where === 'object') {
    if (int(where.scene, -1, 999)) info.scene = where.scene;
    if (int(where.room, -1, 999)) info.room = where.room;
    if (Number.isFinite(where.x)) info.x = Math.round(where.x);
    if (Number.isFinite(where.y)) info.y = Math.round(where.y);
    for (const key of ['phase', 'layer', 'panel'])
      if (typeof where[key] === 'string') info[key] = where[key].slice(0, 40);
    for (const key of ['battle', 'riding', 'resting'])
      if (typeof where[key] === 'boolean') info[key] = where[key];
    if (int(where.mainTask, -1, 9999)) info.mainTask = where.mainTask;
    if (int(where.money, 0, Number.MAX_SAFE_INTEGER)) info.money = where.money;
  }
  if (int(input?.idleMs, 0, 86400_000)) info.idleMs = input.idleMs;
  if (typeof input?.hidden === 'boolean') info.hidden = input.hidden;
  return info;
}
