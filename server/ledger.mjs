// The owner's money and pet log: every save the game uploads carries `ledger` (EconomyLedger.ts),
// the money changes and pets gained or lost since the game loaded, each with where it came from.
// The server keeps those lines per player and checks the new save against the one before it:
// money that moved without a line, a pet that appeared without one, a pet from nowhere, a jump too
// big to be play — each becomes an alert on the admin page. Nothing here refuses a save.

/** One gain this large in a single line is worth a look whatever its source. */
export const MONEY_SPIKE = 1_000_000;
/** A gained pet this many levels above the best pet the player had before is worth a look. */
export const LEVEL_JUMP = 30;
/** Sources that need no fight, event or panel behind them (the hero just walking). */
const NOWHERE = new Set(['world', 'unknown', '']);
/** Sources where a pet or a high level may simply arrive. */
const TRUSTED_PET = /^(baseline|mail:|gift:|admin)/;

const allPets = save => [...(Array.isArray(save?.pets) ? save.pets : []),
  ...(Array.isArray(save?.meta?.campaign?.petBank) ? save.meta.campaign.petBank : [])];
const fingerprint = pet => `${pet?.speciesId}|${pet?.quality}|${pet?.nature ?? ''}`;
const money = save => Number(save?.currency?.money ?? 0) || 0;
const short = pet => ({ uid: pet?.uid, speciesId: pet?.speciesId, level: pet?.level, quality: pet?.quality, nature: pet?.nature });

/** The ledger lines a save carries, cleaned up: only well-formed ones, in seq order. */
export function ledgerEntries(save) {
  const entries = Array.isArray(save?.ledger?.entries) ? save.ledger.entries : [];
  return entries
    .filter(e => e && Number.isSafeInteger(e.seq) && e.seq > 0 && ['money', 'pet+', 'pet-'].includes(e.kind))
    .map(e => ({
      seq: e.seq,
      at: Number.isSafeInteger(e.t) ? e.t : null,
      kind: e.kind,
      amount: Number.isFinite(e.amount) ? Math.trunc(e.amount) : null,
      balance: Number.isFinite(e.balance) ? Math.trunc(e.balance) : null,
      pet: e.pet && typeof e.pet === 'object' ? short(e.pet) : null,
      source: typeof e.source === 'string' ? e.source.slice(0, 120) : '',
    }))
    .sort((a, b) => a.seq - b.seq);
}

/**
 * The new lines (seq above the previous save's own last line) and the alerts for one upload.
 * `claimed(source)` says whether a `mail:<id>` / `gift:<code>` source is one the server handed out.
 */
export function auditSave({ previous, next, claimed = () => true }) {
  const lastSeq = Number.isSafeInteger(previous?.ledger?.seq) ? previous.ledger.seq : 0;
  const alerts = [];
  const alert = (kind, text, detail = {}) => alerts.push({ kind, text, detail });
  const all = ledgerEntries(next);
  const fresh = all.filter(e => e.seq > lastSeq);
  const nextSeq = all.length ? all[all.length - 1].seq : lastSeq;

  if (previous && previous.ledger && !next.ledger)
    alert('ledger_missing', 'Save gửi lên không có nhật ký tiền/pet (bản trước có).');
  if (lastSeq > 0 && fresh.length && fresh[0].seq > lastSeq + 1)
    alert('ledger_gap', `Nhật ký bị thiếu dòng ${lastSeq + 1}–${fresh[0].seq - 1}.`);
  if (lastSeq > 0 && all.length && nextSeq < lastSeq)
    alert('ledger_rewind', `Nhật ký lùi về dòng ${nextSeq} (đã có tới ${lastSeq}): save cũ hoặc tab khác.`);

  // Money: the change between the two saves must be the sum of the lines between them.
  if (previous) {
    const moved = money(next) - money(previous);
    const logged = fresh.filter(e => e.kind === 'money').reduce((sum, e) => sum + (e.amount ?? 0), 0);
    if (moved !== logged)
      alert('money_unexplained', `Tiền đổi ${fmt(moved)} nhưng nhật ký chỉ ghi ${fmt(logged)} (chênh ${fmt(moved - logged)}).`,
        { before: money(previous), after: money(next), logged });
  }
  for (const e of fresh) {
    if (e.kind !== 'money' || (e.amount ?? 0) <= 0) continue;
    if (e.amount >= MONEY_SPIKE) alert('money_spike', `Nhận ${fmt(e.amount)} tiền một lần (nguồn: ${e.source || '?'}).`, e);
    else if (NOWHERE.has(e.source)) alert('money_nowhere', `Nhận ${fmt(e.amount)} tiền khi không ở trận, sự kiện hay cửa hàng nào.`, e);
    if (/^(mail|gift):/.test(e.source) && !claimed(e.source)) alert('source_unclaimed', `Nguồn ${e.source} không có trên máy chủ.`, e);
  }

  // Pets: every pet the new save has that the old one did not must have a pet+ line.
  const before = allPets(previous), after = allPets(next);
  const oldUids = new Set(before.map(p => p?.uid).filter(Boolean));
  const gained = new Map(fresh.filter(e => e.kind === 'pet+' && e.pet?.uid).map(e => [e.pet.uid, e]));
  const unnamed = new Map();
  for (const pet of before) if (!pet?.uid) unnamed.set(fingerprint(pet), (unnamed.get(fingerprint(pet)) ?? 0) + 1);
  const topBefore = before.reduce((top, p) => Math.max(top, Number(p?.level) || 0), 0);
  for (const pet of after) {
    if (!pet?.uid) { alert('pet_no_uid', `Pet ${pet?.speciesId} cấp ${pet?.level} không có mã định danh.`, short(pet)); continue; }
    if (oldUids.has(pet.uid)) continue;
    const line = gained.get(pet.uid);
    if (!line) { alert('pet_unexplained', `Pet ${pet.speciesId} cấp ${pet.level} xuất hiện mà nhật ký không ghi nguồn.`, short(pet)); continue; }
    if (line.source === 'baseline') {
      // A pet the old save already had (an older save, or one the admin gave): same species/quality.
      const left = unnamed.get(fingerprint(pet)) ?? 0;
      if (previous && left <= 0) alert('pet_baseline', `Pet ${pet.speciesId} cấp ${pet.level} ghi "có sẵn" nhưng bản save trước không có.`, short(pet));
      else unnamed.set(fingerprint(pet), left - 1);
      continue;
    }
    if (NOWHERE.has(line.source)) alert('pet_nowhere', `Nhận pet ${pet.speciesId} cấp ${pet.level} khi không ở trận, sự kiện hay cửa hàng nào.`, line);
    if (/^(mail|gift):/.test(line.source) && !claimed(line.source)) alert('source_unclaimed', `Nguồn ${line.source} không có trên máy chủ.`, line);
    if (!TRUSTED_PET.test(line.source) && ((Number(pet.level) || 0) > 100 || (topBefore > 0 && pet.level > topBefore + LEVEL_JUMP)))
      alert('pet_level', `Nhận pet ${pet.speciesId} cấp ${pet.level} trong khi pet mạnh nhất trước đó cấp ${topBefore} (nguồn: ${line.source}).`, line);
  }
  return { entries: fresh, alerts };
}

const fmt = value => new Intl.NumberFormat('vi-VN').format(value);
