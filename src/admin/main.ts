import "./admin.css";
import type { AdminItemKind } from "../account/AdminApi";
import { defaultFetch } from "../account/RemoteAccountService";
import type { GameSave, SavedPet } from "../persistence/save/GameSave";
import { loadAdminCatalog, type AdminCatalog } from "./catalog";
import {
  emptyRewards,
  rewardEditor,
  rewardSummary,
  type Rewards,
} from "./rewards";
import { dateTime, el, money, node, number, playTime, type Child } from "./dom";

// ---------------------------------------------------------------- types from the server
type Account = { id: string; email: string; role: string };
type UserRow = {
  id: string;
  email: string;
  createdAt: number;
  role: string;
  lockedAt: number | null;
  revision: number | null;
  updatedAt: number | null;
  hasPrevious: number;
  money: number | null;
  badges: number | null;
  mainTask: number | null;
  playTime: number | null;
  sceneId: number | null;
  partySize: number | null;
  bankSize: number | null;
  topLevel: number | null;
  sessions?: number;
  unclaimedMail?: number;
};
type AuditEntry = {
  action: string;
  at: number;
  revision: number | null;
  detail: string | null;
  admin: string | null;
  target: string | null;
};
type Stats = {
  activity: Record<string, number>;
  signups: { day: string; count: number }[];
  saves: { day: string; count: number }[];
  leaders: Record<"level" | "money" | "task" | "play", UserRow[]>;
};
type Overview = {
  summary: { accounts: number; saves: number; locked: number };
  disk: { total: number; free: number };
  backupAt: number | null;
  audit: AuditEntry[];
  stats: Stats;
  openAlerts?: number;
};
type GiftCode = {
  code: string;
  description: string;
  rewards: Rewards;
  maxUses: number | null;
  startsAt: number | null;
  expiresAt: number | null;
  active: boolean;
  createdAt: number;
  uses: number;
};
type SentMail = {
  batch: string;
  title: string;
  body: string;
  rewards: Rewards;
  createdAt: number;
  recipients: number;
  claimed: number;
  email: string | null;
};

const ACTIONS: Record<string, string> = {
  lock: "Khóa",
  unlock: "Mở khóa",
  restore: "Khôi phục save",
  backup: "Sao lưu database",
  download: "Tải file database",
  upload: "Nạp file save",
  edit: "Sửa save",
  grant_admin: "Cấp quyền admin",
  revoke_admin: "Thu quyền admin",
  logout: "Đăng xuất mọi nơi",
  password: "Đặt mật khẩu mới",
  giftcode_create: "Tạo giftcode",
  giftcode_edit: "Sửa giftcode",
  giftcode_delete: "Xóa giftcode",
  mail: "Gửi quà",
  mail_recall: "Thu hồi quà",
  "live:reload": "Buộc tải lại game",
  "live:reload-all": "Buộc mọi người tải lại",
  "live:message": "Nhắn trong game",
  "live:cancel": "Huỷ lệnh",
  "live:teleport": "Dịch chuyển",
  "live:unstuck": "Đặt lại chỗ đứng",
  "live:mainTask": "Đổi bước nhiệm vụ chính",
  "live:eventState": "Đổi sự kiện",
  "live:branchTask": "Đổi nhiệm vụ phụ",
  "live:worldFlag": "Đổi cờ cốt truyện",
  "live:dismount": "Cho xuống thú cưỡi",
  "live:clearSkills": "Xoá hàng chờ học chiêu",
};
const gib = (bytes: number) => number.format(bytes / 1024 ** 3) + " GiB";

// ---------------------------------------------------------------- state
let account: Account | null = null;
let catalog: AdminCatalog | null = null;
let catalogLoading: Promise<AdminCatalog> | null = null;
let tab = "overview";
let refreshId = 0;
const players = { search: "", page: 0, sort: "recent", open: null as string | null };
let mailTarget: { id: string; email: string } | "all" = "all";
const app = node("app");

// ---------------------------------------------------------------- api
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<{ body: any; response: Response }> {
  const headers = new Headers(options.headers);
  if (account) headers.set("x-vqsv-account", account.id);
  let body = options.body;
  if (options.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.json);
  }
  const response = await defaultFetch(path, { ...options, body, headers });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || (response.status === 409 && json.code === "account_changed"))
      showLogin();
    throw new ApiError(json.error || "Không kết nối được API máy chủ.", response.status);
  }
  return { body: json, response };
}
const api = async (path: string, options: RequestInit & { json?: unknown } = {}) =>
  (await request(path, options)).body;

// ---------------------------------------------------------------- shell
function message(text: string, error = false): void {
  const box = node("message");
  box.hidden = !text;
  box.classList.toggle("error", error);
  box.textContent = text;
  if (text && !error)
    setTimeout(() => {
      if (box.textContent === text) box.hidden = true;
    }, 6000);
}

/** A button whose async work disables it and reports failures in the message box. */
function button(label: string, action: () => unknown, className = ""): HTMLButtonElement {
  const control = el("button", { className }, label);
  control.onclick = async () => {
    control.disabled = true;
    message("");
    try {
      await action();
    } catch (error) {
      message(error instanceof Error ? error.message : String(error), true);
    } finally {
      control.disabled = false;
    }
  };
  return control;
}

function showLogin(): void {
  account = null;
  refreshId++;
  app.replaceChildren();
  app.hidden = true;
  node("tabs").hidden = true;
  node("logout").hidden = true;
  node("identity").textContent = "";
  node("sign-in").hidden = false;
}

async function enter(user: Account | undefined): Promise<void> {
  if (user?.role !== "admin") {
    showLogin();
    message("Tài khoản này chưa có quyền quản trị.", true);
    return;
  }
  account = user;
  node("identity").textContent = user.email;
  node("sign-in").hidden = true;
  node("tabs").hidden = false;
  node("logout").hidden = false;
  app.hidden = false;
  ensureCatalog();
  void refreshAlertCount();
  setInterval(() => void refreshAlertCount(), 60_000);
  await show(tab);
}

/** The game's item and species names, loaded once in the background. */
function ensureCatalog(): Promise<AdminCatalog> {
  catalogLoading ??= loadAdminCatalog().then((loaded) => {
    catalog = loaded;
    fillDatalists(loaded);
    return loaded;
  });
  catalogLoading.catch(() => message("Không tải được danh sách vật phẩm/pet của game.", true));
  return catalogLoading;
}

function fillDatalists(loaded: AdminCatalog): void {
  node("item-list").replaceChildren(
    ...loaded.items.map((item) => el("option", { value: loaded.itemLabel(item.kind, item.id) })),
  );
  node("species-list").replaceChildren(
    ...loaded.species.map((row) => el("option", { value: loaded.speciesLabel(row.speciesId) })),
  );
  node("room-list").replaceChildren(...loaded.rooms.map((room) => el("option", { value: room.label })));
  node("branch-list").replaceChildren(
    ...loaded.branchTasks.map((task) => el("option", { value: String(task.id), label: `${task.name} #${task.id}` })),
  );
}

const itemName = (kind: AdminItemKind, id: number) =>
  catalog?.itemName(kind, id) ?? `${kind} #${id}`;
const speciesName = (id: number) => catalog?.speciesName(id) ?? `Pet #${id}`;
const summary = (rewards: Rewards) => rewardSummary(rewards, itemName, speciesName);

async function show(name: string): Promise<void> {
  tab = name;
  for (const control of node("tabs").querySelectorAll("button"))
    control.classList.toggle("active", control.dataset.tab === name);
  const id = ++refreshId;
  app.replaceChildren(el("p", { className: "loading" }, "Đang tải…"));
  try {
    const view =
      name === "overview"
        ? await overviewView()
        : name === "players"
          ? players.open
            ? await playerView(players.open)
            : await playersView()
          : name === "codes"
            ? await codesView()
            : name === "mail"
              ? await mailView()
              : name === "alerts"
                ? await alertsView()
                : name === "online"
                  ? await onlineView()
                  : await auditView();
    if (id === refreshId) app.replaceChildren(view);
  } catch (error) {
    if (id === refreshId)
      app.replaceChildren(
        el("p", { className: "card" }, error instanceof Error ? error.message : String(error)),
      );
  }
}
const reload = () => show(tab);

// ---------------------------------------------------------------- overview
function bars(rows: { day: string; count: number }[]): HTMLElement {
  const days: { day: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(Date.now() + 7 * 3600_000 - i * 86400_000).toISOString().slice(0, 10);
    days.push({ day, count: rows.find((row) => row.day === day)?.count ?? 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.count));
  return el(
    "div",
    {},
    el(
      "div",
      { className: "bars" },
      ...days.map((d) =>
        el(
          "div",
          { style: `height:${Math.max(2, (d.count / max) * 100)}%`, title: `${d.day}: ${d.count}` },
          el("span", {}, d.count ? String(d.count) : ""),
        ),
      ),
    ),
    el("div", { className: "bar-labels" }, ...days.map((d) => el("span", {}, d.day.slice(8)))),
  );
}

function leaderList(title: string, rows: UserRow[], value: (row: UserRow) => string): HTMLElement {
  return el(
    "div",
    { className: "card leaders" },
    el("h3", {}, title),
    rows.length
      ? el(
          "ol",
          {},
          ...rows.map((row) => {
            const item = el("li", {}, el("a", { href: "#" }, row.email), el("b", {}, value(row)));
            item.querySelector("a")!.onclick = (event) => {
              event.preventDefault();
              openPlayer(row.id);
            };
            return item;
          }),
        )
      : el("p", {}, "Chưa có dữ liệu."),
  );
}

async function overviewView(): Promise<HTMLElement> {
  const data: Overview = await api("/admin/overview");
  const a = data.stats.activity;
  const metric = (label: string, value: Child, note?: string) =>
    el("div", { className: "card" }, el("dt", {}, label), el("dd", {}, value), note ? el("small", {}, note) : "");
  return el(
    "div",
    { className: "stack" },
    el("div", { className: "heading" }, el("h1", {}, "Tổng quan"), button("Làm mới", reload)),
    el(
      "dl",
      { className: "metrics" },
      metric("Tài khoản", number.format(data.summary.accounts), `${data.summary.locked} đã khóa · +${a.new7d} trong 7 ngày`),
      metric("Save đang lưu", number.format(data.summary.saves)),
      metric("Chơi trong 24 giờ", number.format(a.active24h), `${a.active7d} trong 7 ngày`),
      metric("Phiên đăng nhập còn hạn", number.format(a.signedIn)),
      metric("Giftcode đang mở", number.format(a.activeCodes), `${a.redemptions} lượt đã nhập`),
      metric("Quà chưa nhận", number.format(a.unclaimedMail)),
      metric("Ổ đĩa còn trống", gib(data.disk.free), "Tổng " + gib(data.disk.total)),
      metric("Cảnh báo tiền/pet chưa xem", number.format(data.openAlerts ?? 0), "Xem ở tab Cảnh báo"),
    ),
    el(
      "div",
      { className: "grid2" },
      el("div", { className: "card" }, el("h3", {}, "Đăng ký mới (14 ngày)"), bars(data.stats.signups)),
      el("div", { className: "card" }, el("h3", {}, "Người chơi có lưu game (14 ngày)"), bars(data.stats.saves)),
    ),
    el("h2", {}, "Bảng xếp hạng"),
    el(
      "div",
      { className: "grid4" },
      leaderList("Cấp pet cao nhất", data.stats.leaders.level, (r) => "Lv " + (r.topLevel ?? "—")),
      leaderList("Nhiều tiền nhất", data.stats.leaders.money, (r) => money(r.money)),
      leaderList("Nhiệm vụ chính xa nhất", data.stats.leaders.task, (r) => "NV " + (r.mainTask ?? 0)),
      leaderList("Chơi lâu nhất", data.stats.leaders.play, (r) => playTime(r.playTime)),
    ),
    el(
      "div",
      { className: "card heading" },
      el(
        "div",
        {},
        el("h2", {}, "Sao lưu database"),
        el("p", {}, data.backupAt ? "Gần nhất " + dateTime(data.backupAt) : "Chưa có bản sao lưu."),
      ),
      el(
        "div",
        { className: "links" },
        button("Sao lưu ngay", async () => {
          await api("/admin/backup", { method: "POST" });
          message("Đã sao lưu database trên server.");
          await reload();
        }),
        data.backupAt
          ? el("a", { className: "action", href: "/api/admin/backup/download", download: "" }, "Tải file .sqlite")
          : "",
      ),
    ),
    el("div", { className: "card" }, el("h3", {}, "Thao tác gần đây"), auditList(data.audit)),
  );
}

// ---------------------------------------------------------------- audit
function auditList(entries: AuditEntry[]): HTMLElement {
  if (!entries.length) return el("p", {}, "Chưa có thao tác.");
  return el(
    "ul",
    { className: "audit" },
    ...entries.map((entry) =>
      el(
        "li",
        {},
        [
          dateTime(entry.at),
          entry.admin,
          ACTIONS[entry.action] ?? entry.action,
          entry.target,
          entry.detail,
          entry.revision ? "v" + entry.revision : null,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    ),
  );
}

async function auditView(): Promise<HTMLElement> {
  const { audit } = await api("/admin/audit");
  return el(
    "div",
    { className: "stack" },
    el("div", { className: "heading" }, el("h1", {}, "Nhật ký quản trị"), button("Làm mới", reload)),
    el("div", { className: "card" }, auditList(audit)),
  );
}

// ---------------------------------------------------------------- players
function statusBadges(user: UserRow): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (user.role === "admin") out.push(el("span", { className: "badge admin" }, "Admin"));
  if (user.lockedAt) out.push(el("span", { className: "badge locked" }, "Đã khóa"));
  return out;
}

function openPlayer(id: string): void {
  players.open = id;
  void show("players");
}

async function playersView(): Promise<HTMLElement> {
  const query = new URLSearchParams({
    q: players.search,
    page: String(players.page),
    sort: players.sort,
  });
  const { users, hasMore }: { users: UserRow[]; hasMore: boolean } = await api("/admin/users?" + query);
  const search = el("input", { type: "search", placeholder: "Tìm theo email", value: players.search });
  const sort = el(
    "select",
    {},
    ...Object.entries({
      recent: "Lưu game gần nhất",
      new: "Đăng ký mới nhất",
      level: "Cấp pet cao nhất",
      money: "Nhiều tiền nhất",
      task: "Nhiệm vụ xa nhất",
      play: "Chơi lâu nhất",
    }).map(([value, label]) => el("option", { value, selected: value === players.sort }, label)),
  );
  const form = el("form", { className: "row" }, search, sort, el("button", { type: "submit" }, "Tìm"));
  form.onsubmit = (event) => {
    event.preventDefault();
    players.search = search.value.trim();
    players.sort = sort.value;
    players.page = 0;
    void reload();
  };
  sort.onchange = () => form.requestSubmit();
  const rows = users.map((user) => {
    const row = el(
      "tr",
      { className: "clickable" },
      el("td", {}, user.email, ...statusBadges(user), el("small", {}, "Tạo " + dateTime(user.createdAt))),
      el("td", { className: "num" }, user.mainTask ?? "—"),
      el("td", { className: "num" }, user.topLevel ?? "—", el("small", {}, `${user.partySize ?? 0} đội · ${user.bankSize ?? 0} ngân hàng`)),
      el("td", { className: "num" }, money(user.money), el("small", {}, `${user.badges ?? 0} huy hiệu`)),
      el("td", { className: "num" }, playTime(user.playTime)),
      el("td", {}, user.revision ? dateTime(user.updatedAt) : "Chưa có save", user.revision ? el("small", {}, "v" + user.revision) : ""),
    );
    row.onclick = () => openPlayer(user.id);
    return row;
  });
  const prev = button("Trang trước", () => {
    players.page--;
    return reload();
  });
  prev.disabled = players.page === 0;
  const next = button("Trang sau", () => {
    players.page++;
    return reload();
  });
  next.disabled = !hasMore;
  return el(
    "div",
    { className: "stack" },
    el("div", { className: "heading" }, el("h1", {}, "Người chơi"), form),
    el(
      "div",
      { className: "card table-scroll" },
      el(
        "table",
        {},
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            ...["Email", "Nhiệm vụ", "Cấp pet cao nhất", "Tiền", "Thời gian chơi", "Lưu gần nhất"].map((h) => el("th", {}, h)),
          ),
        ),
        el("tbody", {}, ...(rows.length ? rows : [el("tr", {}, el("td", { colSpan: 6 }, "Không tìm thấy tài khoản."))])),
      ),
      el("div", { className: "pager" }, prev, el("span", {}, "Trang " + (players.page + 1)), next),
    ),
  );
}

function downloadJson(value: unknown, name: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = el("a", { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const picker = el("input", { type: "file", accept: ".json,application/json" });
    picker.onchange = () => resolve(picker.files?.[0] ?? null);
    picker.addEventListener("cancel", () => resolve(null));
    picker.click();
  });
}

async function playerView(id: string): Promise<HTMLElement> {
  const [{ user }] = (await Promise.all([
    api(`/admin/users/${id}`),
    ensureCatalog().catch(() => null),
  ])) as [{ user: UserRow }, unknown];
  const path = `/admin/users/${id}`;
  const self = user.id === account?.id;
  const back = button("← Danh sách", () => {
    players.open = null;
    return reload();
  });
  const password = el("input", { type: "text", placeholder: "Mật khẩu mới (8–128 ký tự)", autocomplete: "off" });
  const actions = el(
    "div",
    { className: "actions" },
    !self && user.role !== "admin"
      ? button(user.lockedAt ? "Mở khóa" : "Khóa tài khoản", async () => {
          const locked = !user.lockedAt;
          if (locked && !confirm(`Khóa ${user.email} và đăng xuất mọi phiên của tài khoản này?`)) return;
          await api(path + "/lock", { method: "POST", json: { locked } });
          message(locked ? "Đã khóa tài khoản." : "Đã mở khóa tài khoản.");
          await reload();
        }, user.lockedAt ? "" : "danger")
      : "",
    !self && !user.lockedAt
      ? button(user.role === "admin" ? "Thu quyền admin" : "Cấp quyền admin", async () => {
          const role = user.role === "admin" ? "player" : "admin";
          if (!confirm(`${role === "admin" ? "Cấp" : "Thu"} quyền quản trị của ${user.email}?`)) return;
          await api(path + "/role", { method: "POST", json: { role } });
          message("Đã đổi quyền.");
          await reload();
        })
      : "",
    button("Đăng xuất mọi nơi", async () => {
      if (!confirm(`Đăng xuất ${user.email} khỏi mọi thiết bị?`)) return;
      const { sessions } = await api(path + "/logout", { method: "POST" });
      message(`Đã kết thúc ${sessions} phiên.`);
      await reload();
    }),
    button("Gửi quà", () => {
      mailTarget = { id: user.id, email: user.email };
      return show("mail");
    }, "primary"),
  );
  const passwordRow = self
    ? ""
    : el(
        "div",
        { className: "row" },
        password,
        button("Đặt mật khẩu mới", async () => {
          if (password.value.length < 8) throw new Error("Mật khẩu mới cần ít nhất 8 ký tự.");
          if (!confirm(`Đặt mật khẩu mới cho ${user.email}? Mọi phiên đang đăng nhập sẽ bị đăng xuất.`)) return;
          await api(path + "/password", { method: "POST", json: { password: password.value } });
          password.value = "";
          message("Đã đặt mật khẩu mới. Hãy gửi mật khẩu này cho người chơi.");
        }),
      );
  const info = el(
    "div",
    { className: "card stack" },
    el("div", { className: "heading" }, el("div", {}, el("h1", {}, user.email, ...statusBadges(user)),
      el("p", {}, `Tạo ${dateTime(user.createdAt)} · ${user.sessions ?? 0} phiên còn hạn · ${user.unclaimedMail ?? 0} quà chưa nhận`)), back),
    actions,
    passwordRow,
  );
  return el("div", { className: "stack" }, info, await liveSection(user), await ledgerSection(user.id), await saveSection(user));
}

// ---------------------------------------------------------------- live channel (server/live.mjs)
type Presence = { seenAt: number; sinceAt: number; info: PresenceInfo };
type PresenceInfo = {
  scene?: number; room?: number; x?: number; y?: number; phase?: string; layer?: string; panel?: string;
  battle?: boolean; riding?: boolean; resting?: boolean; mainTask?: number; money?: number; idleMs?: number; hidden?: boolean;
};
type OnlineRow = Presence & { userId: string; email: string; role: string };
type LiveCommandRow = {
  id: number; kind: string; payload: Record<string, unknown> | null; createdAt: number; status: string;
  deliveredAt: number | null; doneAt: number | null; result: string | null; admin: string | null;
};
const ONLINE_MS = 45_000;
const COMMAND_NAMES: Record<string, string> = {
  reload: "Tải lại game", message: "Tin nhắn", teleport: "Dịch chuyển", unstuck: "Đặt lại chỗ đứng",
  mainTask: "Bước nhiệm vụ chính", eventState: "Sự kiện", branchTask: "Nhiệm vụ phụ", worldFlag: "Cờ cốt truyện",
  dismount: "Xuống thú cưỡi", clearSkills: "Xoá hàng chờ học chiêu",
};
const COMMAND_STATUS: Record<string, string> = {
  pending: "Chờ game nhận", delivered: "Game đã nhận", done: "Xong", failed: "Lỗi", cancelled: "Đã huỷ",
};
const PHASE_NAMES: Record<string, string> = {
  freeworld: "đi tự do", returnWorld: "đi tự do", event: "đang xem sự kiện", battle: "trong trận",
  battleEntry: "vào trận", savePrompt: "hỏi lưu game", saving: "đang lưu",
};
const roomLabel = (scene?: number, room?: number) =>
  scene === undefined || room === undefined ? "—" : catalog?.roomLabel(scene, room) ?? `Phòng ${scene}:${room}`;
function seconds(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} giây` : s < 3600 ? `${Math.floor(s / 60)} phút` : `${Math.floor(s / 3600)} giờ ${Math.floor((s % 3600) / 60)} phút`;
}
/** What the player is doing, in a few words. */
function doingText(info: PresenceInfo): string {
  if (info.layer === "menu") return "ở màn hình đăng nhập / tải game";
  if (info.layer === "story" || info.layer === "cutscene") return "đang xem đoạn phim cốt truyện";
  const parts = [PHASE_NAMES[info.phase ?? ""] ?? info.phase ?? ""];
  if (info.battle) parts.push("trong trận");
  if (info.panel) parts.push(`mở bảng ${PANEL_NAMES[info.panel] ?? info.panel}`);
  if (info.riding) parts.push("đang cưỡi");
  if (info.hidden) parts.push("tab đang ẩn");
  return parts.filter(Boolean).join(" · ");
}
function presenceLine(presence: Presence | null, now: number): HTMLElement {
  if (!presence) return el("p", {}, "Chưa từng mở game bản có kênh quản trị.");
  const online = now - presence.seenAt < ONLINE_MS, info = presence.info;
  return el(
    "p",
    {},
    el("span", { className: online ? "badge admin" : "badge" }, online ? "Đang chơi" : "Offline"),
    " ",
    online
      ? `${roomLabel(info.scene, info.room)} (${info.x ?? "?"},${info.y ?? "?"}) · ${doingText(info)} · chơi ${seconds(now - presence.sinceAt)} · thao tác cuối ${seconds(info.idleMs ?? 0)} trước`
      : `Lần cuối ${dateTime(presence.seenAt)} ở ${roomLabel(info.scene, info.room)}`,
  );
}
function commandText(row: LiveCommandRow): string {
  const p = row.payload ?? {};
  switch (row.kind) {
    case "message": return `“${String(p.text ?? "")}”`;
    case "reload": return p.reason ? `sau khi đổi save (${COMMAND_NAMES[String(p.reason)] ?? p.reason})` : "";
    default: return "";
  }
}

async function onlineView(): Promise<HTMLElement> {
  const [{ online }] = (await Promise.all([api("/admin/online"), ensureCatalog().catch(() => null)])) as [{ online: OnlineRow[] }, unknown];
  const now = Date.now();
  const rows = online.map((row) => {
    const tr = el(
      "tr",
      { className: "clickable" },
      el("td", {}, row.email, row.role === "admin" ? el("span", { className: "badge admin" }, "Admin") : ""),
      el("td", {}, roomLabel(row.info.scene, row.info.room), el("small", {}, `(${row.info.x ?? "?"},${row.info.y ?? "?"})`)),
      el("td", {}, doingText(row.info)),
      el("td", { className: "num" }, row.info.mainTask ?? "—"),
      el("td", { className: "num" }, seconds(now - row.sinceAt)),
      el("td", { className: "num" }, seconds(row.info.idleMs ?? 0)),
    );
    tr.onclick = () => openPlayer(row.userId);
    return tr;
  });
  return el(
    "div",
    { className: "stack" },
    el(
      "div",
      { className: "heading" },
      el("h1", {}, `Đang chơi (${online.length})`),
      el(
        "div",
        { className: "links" },
        button("Làm mới", reload),
        button("Buộc tất cả tải lại game", async () => {
          if (!confirm(`Bắt ${online.length} người đang chơi tải lại game? Ai đang đứng tự do sẽ được lưu trước; ai đang trong trận/sự kiện sẽ quay về lần lưu gần nhất.`)) return;
          const { players: count } = await api("/admin/online/reload", { method: "POST" });
          message(`Đã gửi lệnh tải lại cho ${count} người (trong 15 giây tới).`);
        }, "danger"),
      ),
    ),
    el("p", {}, "Game báo về mỗi 15 giây; người không báo trong 45 giây được coi là đã thoát. Bấm một dòng để mở người chơi."),
    el(
      "div",
      { className: "card table-scroll" },
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, ...["Email", "Đang ở", "Đang làm", "NV chính", "Đã chơi", "Thao tác cuối"].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...(rows.length ? rows : [el("tr", {}, el("td", { colSpan: 6 }, "Không có ai đang chơi."))])),
      ),
    ),
  );
}

/** The player page's "Can thiệp trực tiếp": where they are, and the admin's commands. */
async function liveSection(user: UserRow): Promise<HTMLElement> {
  const path = `/admin/users/${user.id}`;
  const [live, save] = (await Promise.all([
    api(path + "/live"),
    user.revision ? api(path + "/save").catch(() => null) : null,
  ])) as [{ presence: Presence | null; commands: LiveCommandRow[]; now: number }, GameSave | null];
  const online = !!live.presence && live.now - live.presence.seenAt < ONLINE_MS;
  const send = async (kind: string, payload: unknown, ask?: string) => {
    if (ask && !confirm(ask)) return;
    const body = await api(path + "/command", { method: "POST", json: { kind, payload } });
    message(
      body.save
        ? `Đã sửa save (${COMMAND_NAMES[kind]}${body.describe ? ": " + body.describe : ""}). ${online ? "Game của người chơi sẽ tự tải lại trong 15 giây." : "Người chơi sẽ thấy khi vào game."}`
        : `Đã gửi lệnh ${COMMAND_NAMES[kind]}. ${online ? "Game sẽ nhận trong 15 giây." : "Lệnh chờ tới khi người chơi vào game."}`,
    );
    await reload();
  };
  const field = (props: Record<string, unknown>) => el("input", props);
  const section = el("div", { className: "card stack" });
  section.append(
    el("div", { className: "heading" }, el("h2", {}, "Can thiệp trực tiếp"), button("Làm mới", reload)),
    presenceLine(live.presence, live.now),
  );

  // ---- reload and a message
  const text = field({ type: "text", placeholder: "Tin nhắn hiện trong game (tối đa 300 ký tự)", maxLength: 300 });
  section.append(
    el(
      "div",
      { className: "actions" },
      button("Buộc tải lại game", () => send("reload", null, `Bắt game của ${user.email} tải lại? Nếu họ đang đứng tự do, game lưu trước khi tải lại.`)),
    ),
    el(
      "div",
      { className: "row" },
      text,
      button("Gửi tin nhắn", () => {
        if (!text.value.trim()) throw new Error("Hãy nhập nội dung tin nhắn.");
        return send("message", { text: text.value.trim() });
      }),
    ),
  );
  if (!save) {
    section.append(el("p", {}, "Chưa có save bản web nên chưa sửa được vị trí / nhiệm vụ."));
  } else {
    const warn = online
      ? " Người chơi đang online: game sẽ tải lại và quay về lần lưu gần nhất (mất phần chưa lưu)."
      : "";
    const loc = save.location;
    // ---- stuck on the map
    const roomInput = field({ type: "text", placeholder: "Chọn phòng…", list: "room-list", style: "min-width:18rem" });
    const x = field({ type: "number", placeholder: "x (bỏ trống)", min: 0, style: "width:7rem" });
    const y = field({ type: "number", placeholder: "y (bỏ trống)", min: 0, style: "width:7rem" });
    section.append(
      el("h3", {}, "Kẹt trên bản đồ"),
      el("p", {}, `Save đang ở: ${roomLabel(loc.sceneId, loc.roomIndex)} ${loc.x < 0 ? "(sẽ đứng ở cửa phòng)" : `(${loc.x},${loc.y})`}${loc.adminPlaced ? " · admin vừa đặt, chờ người chơi vào game" : ""}.`),
      el(
        "div",
        { className: "actions" },
        button("Đặt lại chỗ đứng an toàn (kẹt tường)", () =>
          send("unstuck", {}, `Đưa ${user.email} ra ô đứng được gần nhất trong phòng hiện tại?${warn}`)),
      ),
      el(
        "div",
        { className: "row" },
        roomInput,
        x,
        y,
        button("Dịch chuyển", () => {
          const match = /(\d+):(\d+)\s*$/.exec(roomInput.value.trim());
          if (!match) throw new Error("Hãy chọn phòng trong danh sách.");
          const scene = Number(match[1]), room = Number(match[2]);
          if (!catalog?.rooms.some((r) => r.scene === scene && r.room === room)) throw new Error("Phòng không có trong game.");
          const payload: Record<string, number> = { scene, room };
          if (x.value !== "" && y.value !== "") Object.assign(payload, { x: Number(x.value), y: Number(y.value) });
          return send("teleport", payload, `Dịch chuyển ${user.email} tới ${roomLabel(scene, room)}?${warn}`);
        }),
      ),
      el("small", {}, "Bỏ trống x/y: nhân vật đứng ở một cửa của phòng, rồi game tự dời sang ô đứng được gần nhất."),
    );

    // ---- stuck in the story
    const progress = save.progress?.mainTaskProgress ?? save.world?.mainTaskProgress ?? 0;
    const taskSelect = el(
      "select",
      {},
      ...(catalog?.mainTasks ?? []).map((t) => el("option", { value: String(t.index), selected: t.index === progress }, `${t.index + 1}. ${t.name}`)),
    );
    if (!catalog?.mainTasks.some((t) => t.index === progress))
      taskSelect.append(el("option", { value: String(progress), selected: true }, `Bước ${progress}`));
    const quest = (save.story?.quest ?? {}) as { branch?: string; node?: string };
    const branches = String(quest.branch ?? "")
      .split(",")
      .map((entry) => entry.split(":").map(Number))
      .filter(([task, status]) => Number.isInteger(task) && (status === 1 || status === 3));
    const branchRow = (task: number, status: number) =>
      el(
        "tr",
        {},
        el("td", {}, catalog?.branchName(task) ?? `#${task}`, el("small", {}, `#${task}`)),
        el("td", {}, status === 3 ? "Xong" : "Đang làm"),
        el(
          "td",
          { className: "links" },
          status !== 3 ? button("Đánh dấu xong", () => send("branchTask", { task, status: 3 }, `Đánh dấu xong nhiệm vụ phụ #${task}?${warn}`)) : "",
          status === 3 ? button("Mở lại (đang làm)", () => send("branchTask", { task, status: 1 }, `Mở lại nhiệm vụ phụ #${task}?${warn}`)) : "",
          button("Xoá khỏi sổ", () => send("branchTask", { task, status: -1 }, `Xoá nhiệm vụ phụ #${task} khỏi sổ (như chưa nhận)?${warn}`), "danger"),
        ),
      );
    const branchAdd = field({ type: "number", placeholder: "Mã NV phụ", min: 0, style: "width:8rem", list: "branch-list" });
    const ev = { scene: field({ type: "number", placeholder: "scene", min: 0, style: "width:6rem" }), room: field({ type: "number", placeholder: "room", min: 0, style: "width:6rem" }), group: field({ type: "number", placeholder: "group", min: 0, style: "width:6rem" }) };
    const evState = () => {
      const [scene, room, group] = [ev.scene, ev.room, ev.group].map((input) => Number(input.value));
      if ([ev.scene, ev.room, ev.group].some((input) => input.value === "")) throw new Error("Nhập đủ scene, room, group.");
      return { scene, room, group, key: `${scene}:${room}:${group}` };
    };
    const states = (save.eventStates ?? {}) as Record<string, number>;
    const evNow = el("small", {});
    const showEv = () => {
      try { const { key } = evState(); evNow.textContent = `Hiện tại: ${states[key] === 3 ? "đã xong" : states[key] !== undefined ? `trạng thái ${states[key]}` : "chưa làm"}`; }
      catch { evNow.textContent = ""; }
    };
    for (const input of Object.values(ev)) input.oninput = showEv;
    const flags = new Set<number>(save.world?.sourceWorldFlags ?? []);
    const flagInput = field({ type: "number", placeholder: "Mã cờ", min: 0, style: "width:8rem" });
    section.append(
      el("h3", {}, "Kẹt nhiệm vụ / cốt truyện"),
      el("div", { className: "row" }, el("span", {}, "Nhiệm vụ chính:"), taskSelect,
        button("Đặt bước này", () => send("mainTask", { progress: Number(taskSelect.value) }, `Đặt nhiệm vụ chính của ${user.email} về bước ${Number(taskSelect.value) + 1}?${warn}`))),
      el("small", {}, `Bước hiện tại trong save: ${progress + 1}${quest.node ? ` · nút cốt truyện “${quest.node}”` : ""}.`),
      el("h4", {}, "Nhiệm vụ phụ trong sổ"),
      branches.length
        ? el("div", { className: "table-scroll" }, el("table", {}, el("tbody", {}, ...branches.map(([t, s]) => branchRow(t, s)))))
        : el("p", {}, "Sổ nhiệm vụ phụ trống."),
      el("div", { className: "row" }, branchAdd,
        button("Thêm: đang làm", () => send("branchTask", { task: Number(branchAdd.value), status: 1 }, `Giao nhiệm vụ phụ #${branchAdd.value}?${warn}`)),
        button("Thêm: đã xong", () => send("branchTask", { task: Number(branchAdd.value), status: 3 }, `Đánh dấu xong nhiệm vụ phụ #${branchAdd.value}?${warn}`))),
      el("h4", {}, "Sự kiện (nhóm sự kiện trên bản đồ)"),
      el("div", { className: "row" }, ev.scene, ev.room, ev.group,
        button("Đánh dấu đã xong", () => { const e = evState(); return send("eventState", { scene: e.scene, room: e.room, group: e.group, state: "complete" }, `Đánh dấu sự kiện ${e.key} đã xong?${warn}`); }),
        button("Đặt lại chưa làm", () => { const e = evState(); return send("eventState", { scene: e.scene, room: e.room, group: e.group, state: "fresh" }, `Đặt lại sự kiện ${e.key} như chưa làm?${warn}`); }),
        evNow),
      el("small", {}, `Đã xong ${Object.values(states).filter((v) => v === 3).length} sự kiện. Mã sự kiện xem trong JSON save (eventStates) hoặc nhật ký tiền/pet ("Sự kiện s:r:g").`),
      el("h4", {}, "Cờ cốt truyện (vật phẩm ẩn op20)"),
      el("p", {}, flags.size ? `Đang bật: ${[...flags].sort((a, b) => a - b).join(", ")}` : "Chưa bật cờ nào."),
      el("div", { className: "row" }, flagInput,
        button("Bật", () => send("worldFlag", { flag: Number(flagInput.value), on: true }, `Bật cờ ${flagInput.value}?${warn}`)),
        button("Tắt", () => send("worldFlag", { flag: Number(flagInput.value), on: false }, `Tắt cờ ${flagInput.value}?${warn}`))),
    );

    // ---- stuck in a state
    const riding = (save.meta?.campaign?.ride?.activeIndex ?? -1) >= 0;
    section.append(
      el("h3", {}, "Kẹt trạng thái"),
      el("p", {}, `Thú cưỡi: ${riding ? "đang cưỡi" : "không cưỡi"} · hàng chờ học chiêu: ${save.pendingSkillLearns?.length ?? 0}.`),
      el(
        "div",
        { className: "actions" },
        button("Thoát trận / sự kiện bị treo", () =>
          send("reload", null, `Game lưu chỉ khi nhân vật đứng tự do, nên tải lại sẽ đưa ${user.email} ra khỏi trận/sự kiện bị treo, về lần lưu gần nhất. Tiếp tục?`)),
        button("Xuống thú cưỡi", () => send("dismount", {}, `Cho ${user.email} xuống thú cưỡi?${warn}`)),
        button("Xoá hàng chờ học chiêu", () => send("clearSkills", {}, `Xoá ${save.pendingSkillLearns?.length ?? 0} chiêu đang chờ học của ${user.email}?${warn}`)),
      ),
    );
  }

  // ---- history
  const history = live.commands.map((row) =>
    el(
      "tr",
      {},
      el("td", {}, dateTime(row.createdAt), el("small", {}, row.admin ?? "")),
      el("td", {}, COMMAND_NAMES[row.kind] ?? row.kind, el("small", {}, commandText(row))),
      el("td", {}, COMMAND_STATUS[row.status] ?? row.status, row.result ? el("small", {}, row.result) : ""),
      el(
        "td",
        {},
        row.status === "pending" || row.status === "delivered"
          ? button("Huỷ", async () => {
              await api(`/admin/commands/${row.id}`, { method: "DELETE" });
              message("Đã huỷ lệnh.");
              await reload();
            })
          : "",
      ),
    ),
  );
  section.append(
    el("h3", {}, "Lệnh đã gửi"),
    history.length
      ? el("div", { className: "table-scroll" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Lúc", "Lệnh", "Trạng thái", ""].map((h) => el("th", {}, h)))), el("tbody", {}, ...history)))
      : el("p", {}, "Chưa gửi lệnh nào."),
  );
  return section;
}

// ---------------------------------------------------------------- money and pet log (server/ledger.mjs)
type LedgerAlert = { id: number; userId: string; email: string; kind: string; text: string; createdAt: number; seenAt: number | null };
type LedgerLine = {
  seq: number; at: number | null; kind: "money" | "pet+" | "pet-"; amount: number | null; balance: number | null;
  pet: { speciesId: number; level: number; quality: number } | null; source: string; createdAt: number;
};

const PANEL_NAMES: Record<string, string> = {
  worldShop: "cửa hàng", cauVongShop: "cửa hàng Cầu Vồng", portableShop: "cửa hàng mang theo", petBank: "ngân hàng pet",
  bag: "túi đồ", giftCode: "giftcode", battlePass: "Thẻ Fan Cứng", wardrobe: "tủ đồ", campaign: "chiến dịch",
  cauVongIncubator: "lò ấp Cầu Vồng", gamemenu: "menu", gamesystem: "hệ thống",
};
/** A ledger source in words (EconomyLedger / WorldRuntime.ledgerContext). */
function sourceLabel(source: string): string {
  const [kind, ...rest] = source.split(":"), tail = rest.join(":");
  if (source === "baseline") return "Có sẵn trong save cũ";
  if (source === "story") return "Cốt truyện";
  if (source === "world" || !source) return "⚠ Đang đi tự do (không rõ nguồn)";
  if (kind === "battle") return tail === "wild" ? "Trận đấu" : tail === "2v2" ? "Trận 2v2 (gym)" : `Trận ${tail}`;
  if (kind === "event") return `Sự kiện ${tail}`;
  if (kind === "panel") return `Bảng ${PANEL_NAMES[tail] ?? tail}`;
  if (kind === "mail") return `Thư quà #${tail}`;
  if (kind === "gift") return `Giftcode ${tail}`;
  if (kind === "phase") return `Màn hình ${tail}`;
  return source;
}

async function refreshAlertCount(): Promise<void> {
  try {
    const { open } = await api("/admin/alerts");
    const badge = node("alert-count");
    badge.textContent = String(open);
    badge.hidden = !open;
  } catch {
    // The count waits for the next minute.
  }
}

function alertTable(alerts: LedgerAlert[], withPlayer: boolean, after: () => unknown): HTMLElement {
  if (!alerts.length) return el("p", {}, "Không có cảnh báo.");
  return el(
    "table",
    {},
    el("thead", {}, el("tr", {}, el("th", {}, "Lúc"), withPlayer ? el("th", {}, "Người chơi") : "", el("th", {}, "Cảnh báo"), el("th", {}, ""))),
    el(
      "tbody",
      {},
      ...alerts.map((a) =>
        el(
          "tr",
          { className: a.seenAt ? "muted" : "" },
          el("td", {}, dateTime(a.createdAt)),
          withPlayer ? el("td", {}, button(a.email, () => openPlayer(a.userId), "link")) : "",
          el("td", {}, a.text),
          el("td", {}, a.seenAt ? "Đã xem" : button("Đã xem", async () => {
            await api("/admin/alerts/seen", { method: "POST", json: { ids: [a.id] } });
            await refreshAlertCount();
            await after();
          })),
        ),
      ),
    ),
  );
}

let alertsShowAll = false;
async function alertsView(): Promise<HTMLElement> {
  const { alerts } = (await api(`/admin/alerts${alertsShowAll ? "?all=1" : ""}`)) as { alerts: LedgerAlert[] };
  void refreshAlertCount();
  const open = alerts.filter((a) => !a.seenAt);
  return el(
    "div",
    { className: "stack" },
    el(
      "div",
      { className: "heading" },
      el("h1", {}, "Cảnh báo tiền / pet"),
      el(
        "div",
        { className: "actions" },
        button(alertsShowAll ? "Chỉ chưa xem" : "Xem cả đã xem", () => {
          alertsShowAll = !alertsShowAll;
          return reload();
        }),
        open.length
          ? button(`Đánh dấu ${open.length} đã xem`, async () => {
              await api("/admin/alerts/seen", { method: "POST", json: { ids: open.map((a) => a.id) } });
              await refreshAlertCount();
              await reload();
            })
          : "",
        button("Làm mới", reload),
      ),
    ),
    el("p", { className: "muted" }, "Mỗi lần game lưu, máy chủ so save mới với save trước và với nhật ký nguồn tiền/pet. Cảnh báo không chặn người chơi; mở người chơi để xem nhật ký và khôi phục save trước nếu cần."),
    el("div", { className: "card" }, alertTable(alerts, true, reload)),
  );
}

async function ledgerSection(id: string): Promise<HTMLElement> {
  const { log, alerts } = (await api(`/admin/users/${id}/ledger`)) as { log: LedgerLine[]; alerts: LedgerAlert[] };
  const what = (line: LedgerLine) =>
    line.kind === "money"
      ? `${(line.amount ?? 0) >= 0 ? "+" : ""}${money(line.amount)} tiền`
      : `${line.kind === "pet+" ? "Nhận" : "Mất"} ${line.pet ? `${speciesName(line.pet.speciesId)} Lv ${line.pet.level}` : "pet"}`;
  return el(
    "details",
    { className: "card", open: alerts.some((a) => !a.seenAt) },
    el("summary", {}, el("strong", {}, `Nhật ký tiền / pet (${log.length} dòng gần nhất, ${alerts.filter((a) => !a.seenAt).length} cảnh báo chưa xem)`)),
    el("h3", {}, "Cảnh báo"),
    alertTable(alerts, false, reload),
    el("h3", {}, "Nhật ký"),
    log.length
      ? el(
          "table",
          {},
          el("thead", {}, el("tr", {}, el("th", {}, "Lúc"), el("th", {}, "Thay đổi"), el("th", {}, "Số dư"), el("th", {}, "Nguồn"))),
          el(
            "tbody",
            {},
            ...log.map((line) =>
              el(
                "tr",
                {},
                el("td", {}, dateTime(line.at ?? line.createdAt)),
                el("td", {}, what(line)),
                el("td", {}, line.kind === "money" ? money(line.balance) : ""),
                el("td", {}, sourceLabel(line.source)),
              ),
            ),
          ),
        )
      : el("p", {}, "Chưa có dòng nào (người chơi chưa lưu game từ khi có nhật ký)."),
  );
}

// ---------------------------------------------------------------- save editor
type InventoryRow = { kind: AdminItemKind; id: number; quantity: number };

function inventoryRows(save: GameSave): InventoryRow[] {
  const inv = save.inventory;
  const rows: InventoryRow[] = [];
  for (const [id, quantity] of Object.entries(inv.items ?? {})) rows.push({ kind: "BAG", id: Number(id), quantity });
  for (const id of new Set(inv.equipment ?? [])) rows.push({ kind: "EQUIPMENT", id, quantity: 1 });
  for (const [id, quantity] of Object.entries(inv.materials ?? {})) rows.push({ kind: "MATERIAL", id: Number(id), quantity });
  const specials = new Map<number, number>();
  for (const id of inv.specials ?? []) specials.set(id, (specials.get(id) ?? 0) + 1);
  for (const [id, quantity] of specials) rows.push({ kind: "SPECIAL", id, quantity });
  return rows;
}

/** Writes the edited rows back; a list whose rows did not change keeps its order. */
function writeInventory(save: GameSave, rows: InventoryRow[]): void {
  const inv = save.inventory;
  const of = (kind: AdminItemKind) => rows.filter((row) => row.kind === kind && row.quantity > 0);
  inv.items = Object.fromEntries(of("BAG").map((r) => [String(r.id), Math.min(99, r.quantity)]));
  inv.materials = Object.fromEntries(of("MATERIAL").map((r) => [String(r.id), r.quantity]));
  const equipment = of("EQUIPMENT").map((r) => r.id);
  inv.equipment = [...(inv.equipment ?? []).filter((id) => equipment.includes(id)), ...equipment.filter((id) => !(inv.equipment ?? []).includes(id))];
  const wanted = new Map(of("SPECIAL").map((r) => [r.id, Math.min(99, r.quantity)]));
  const specials: number[] = [];
  const seen = new Map<number, number>();
  for (const id of inv.specials ?? []) {
    const count = seen.get(id) ?? 0;
    if (count < (wanted.get(id) ?? 0)) {
      specials.push(id);
      seen.set(id, count + 1);
    }
  }
  for (const [id, quantity] of wanted) for (let i = seen.get(id) ?? 0; i < quantity; i++) specials.push(id);
  inv.specials = specials;
}

function numberField(label: string, value: number, onChange: (value: number) => void, max = 2147483647): HTMLElement {
  const input = el("input", { type: "number", min: "0", max: String(max), value: String(value) });
  input.onchange = () => onChange(Math.max(0, Math.min(max, Math.trunc(Number(input.value) || 0))));
  return el("label", { className: "field" }, label, input);
}

async function saveSection(user: UserRow): Promise<HTMLElement> {
  const path = `/admin/users/${user.id}`;
  const section = el("div", { className: "card stack" });
  const toolbar = el(
    "div",
    { className: "actions" },
    user.revision ? button("Tải save (.json)", async () => downloadJson(await api(path + "/save"), `vqsv-${user.email}-v${user.revision}.json`)) : "",
    user.hasPrevious ? button("Tải bản trước", async () => downloadJson(await api(path + "/save/backup"), `vqsv-${user.email}-truoc.json`)) : "",
    user.hasPrevious
      ? button("Khôi phục bản trước", async () => {
          if (!confirm(`Khôi phục bản save trước của ${user.email}? Bản hiện tại sẽ thành bản trước.`)) return;
          await api(path + "/save/restore", { method: "POST", json: { revision: user.revision } });
          message("Đã khôi phục bản save trước.");
          await reload();
        })
      : "",
    button("Nạp file save…", async () => {
      const file = await pickFile();
      if (!file) return;
      if (!confirm(`Thay save của ${user.email} bằng ${file.name}?${user.revision ? " Save hiện tại sẽ thành bản trước." : ""}`)) return;
      await api(path + "/save", { method: "PUT", body: await file.text(), headers: { "content-type": "application/json" } });
      message("Đã nạp save. Nếu người chơi đang online, game của họ tự tải lại trong 15 giây.");
      await reload();
    }),
  );
  section.append(el("div", { className: "heading" }, el("h2", {}, "Save của người chơi"), toolbar));
  if (!user.revision) {
    section.append(el("p", {}, "Tài khoản này chưa có save trên server."));
    return section;
  }
  const { body, response } = await request(path + "/save");
  const revision = Number((response.headers.get("etag") ?? "").replace(/"/g, ""));
  const draft = body as GameSave;
  section.append(
    el(
      "p",
      { className: "warn" },
      "Nếu người chơi đang online, sau khi bạn lưu, game của họ tự tải lại trong 15 giây và chơi tiếp từ bản bạn sửa (mất phần chơi chưa lưu); game cũ không ghi đè được bản của bạn. Muốn tặng đồ khi họ đang online, nên dùng Gửi quà.",
    ),
  );
  const sub = el("div", { className: "subtabs" });
  const body2 = el("div");
  const views: Record<string, () => HTMLElement> = {
    "Cơ bản": () => basicEditor(draft),
    "Hành trang": () => inventoryEditor(draft),
    "Pet": () => petEditor(draft),
    "JSON": () => jsonEditor(draft),
  };
  let current = "Cơ bản";
  let leave: (() => void) | null = null;
  const open = (name: string) => {
    leave?.();
    leave = null;
    current = name;
    for (const control of sub.children) control.classList.toggle("active", control.textContent === name);
    const view = views[name]();
    leave = (view as HTMLElement & { leave?: () => void }).leave ?? null;
    body2.replaceChildren(view);
  };
  for (const name of Object.keys(views)) {
    const control = el("button", {}, name);
    control.onclick = () => {
      try {
        open(name);
      } catch (error) {
        message(error instanceof Error ? error.message : String(error), true);
      }
    };
    sub.append(control);
  }
  open(current);
  section.append(
    sub,
    body2,
    el(
      "div",
      { className: "row" },
      button("Lưu thay đổi vào server", async () => {
        leave?.();
        if (!confirm(`Ghi save đã sửa cho ${user.email}? Bản hiện tại sẽ thành bản trước (khôi phục được).`)) return;
        await api(path + "/save", { method: "PUT", json: draft, headers: { "if-match": `"${revision}"` } });
        message("Đã lưu save đã sửa.");
        await reload();
      }, "primary"),
      button("Bỏ thay đổi", reload),
    ),
  );
  return section;
}

function basicEditor(save: GameSave): HTMLElement {
  save.currency ??= { money: 0, badges: 0 };
  const currency = save.currency;
  const pass = save.meta?.battlePass;
  const vip = el("input", { type: "checkbox", checked: !!pass?.vipUnlocked });
  vip.onchange = () => {
    if (pass) pass.vipUnlocked = vip.checked;
  };
  const collected = (save.collection ?? []).filter((v) => v === 2).length;
  return el(
    "div",
    { className: "stack" },
    el(
      "div",
      { className: "grid4" },
      numberField("Tiền", currency.money, (v) => (currency.money = v)),
      numberField("Huy hiệu (tiền huy hiệu)", currency.badges, (v) => (currency.badges = v)),
      numberField("Bước xua đuổi pet (repel)", Math.max(0, save.repelSteps), (v) => (save.repelSteps = v || -1), 100000),
      pass ? numberField("XP Thẻ Fan Cứng", pass.xp, (v) => (pass.xp = v), 10_000_000) : el("span"),
    ),
    pass ? el("label", { className: "row" }, vip, "Đã mở VIP Thẻ Fan Cứng") : "",
    el(
      "dl",
      { className: "metrics" },
      ...(
        [
          ["Nhiệm vụ chính", String(save.progress?.mainTaskProgress ?? 0)],
          ["Vị trí", `Cảnh ${save.location.sceneId} · phòng ${save.location.roomIndex} (${save.location.x}, ${save.location.y})`],
          ["Thời gian chơi", playTime(save.playTimeMillis ?? 0)],
          ["Đồ giám đã thu", String(collected)],
          ["Giftcode đã dùng (gói sẵn)", String(save.meta?.redeemedGiftCodes.length ?? 0)],
          ["Lưu lúc", dateTime(Date.parse(save.savedAt))],
        ] as const
      ).map(([label, value]) => el("div", { className: "card" }, el("dt", {}, label), el("dd", { style: "font-size:15px" }, value))),
    ),
  );
}

function inventoryEditor(save: GameSave): HTMLElement & { leave?: () => void } {
  const rows = inventoryRows(save);
  const table = el("tbody");
  const filter = el("input", { type: "search", placeholder: "Lọc theo tên" });
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    table.replaceChildren(
      ...rows
        .filter((row) => !q || itemName(row.kind, row.id).toLowerCase().includes(q))
        .map((row) => {
          const quantity = el("input", { type: "number", min: "0", max: row.kind === "EQUIPMENT" ? "1" : row.kind === "MATERIAL" ? "2147483647" : "99", value: String(row.quantity), style: "width:90px" });
          quantity.onchange = () => (row.quantity = Math.max(0, Math.trunc(Number(quantity.value) || 0)));
          const remove = el("button", { className: "danger" }, "Xóa");
          remove.onclick = () => {
            rows.splice(rows.indexOf(row), 1);
            render();
          };
          return el(
            "tr",
            {},
            el("td", {}, itemName(row.kind, row.id), el("small", {}, `${catalog?.kindLabel(row.kind) ?? row.kind} #${row.id}`)),
            el("td", {}, quantity),
            el("td", {}, remove),
          );
        }),
    );
  };
  filter.oninput = render;
  const pick = el("input", { list: "item-list", placeholder: "Gõ tên vật phẩm để thêm…", style: "flex:1;min-width:220px" });
  const amount = el("input", { type: "number", min: "1", value: "1", style: "width:90px" });
  const add = el("button", {}, "Thêm");
  add.onclick = () => {
    const choice = catalog?.parseItem(pick.value);
    if (!choice) return message("Chọn một vật phẩm trong danh sách gợi ý.", true);
    const quantity = Math.max(1, Math.trunc(Number(amount.value) || 1));
    const existing = rows.find((row) => row.kind === choice.kind && row.id === choice.id);
    if (existing) existing.quantity = choice.kind === "EQUIPMENT" ? 1 : existing.quantity + quantity;
    else rows.unshift({ kind: choice.kind, id: choice.id, quantity: choice.kind === "EQUIPMENT" ? 1 : quantity });
    pick.value = "";
    render();
  };
  render();
  const view = el(
    "div",
    { className: "stack" },
    el("div", { className: "row" }, pick, amount, add, filter),
    el("p", { className: "muted" }, "Vật phẩm thường và đặc biệt tối đa 99 mỗi loại, trang sức mỗi món 1 cái. Số lượng 0 = xóa."),
    el(
      "div",
      { className: "table-scroll" },
      el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Vật phẩm"), el("th", {}, "Số lượng"), el("th", {}, ""))), table),
    ),
  ) as HTMLElement & { leave?: () => void };
  view.leave = () => writeInventory(save, rows);
  return view;
}

function petLine(pet: SavedPet, actions: Child): HTMLElement {
  const shiny = (pet.nature ?? 0) >= 7;
  return el(
    "tr",
    {},
    el("td", {}, speciesName(pet.speciesId), shiny ? el("span", { className: "badge shiny" }, "Shiny " + pet.nature) : "", el("small", {}, "#" + pet.speciesId)),
    el("td", { className: "num" }, "Lv " + pet.level),
    el("td", { className: "num" }, String(pet.quality)),
    el("td", { className: "num" }, `${pet.currentHp ?? "?"}/${pet.maxHp ?? "?"}`),
    el("td", {}, actions),
  );
}

function petEditor(save: GameSave): HTMLElement {
  const bank = save.meta?.campaign.petBank ?? [];
  const view = el("div", { className: "stack" });
  const head = () =>
    el("thead", {}, el("tr", {}, ...["Pet", "Cấp", "Phẩm chất", "HP", ""].map((h) => el("th", {}, h))));
  const render = () => {
    const party = save.pets.map((pet) => petLine(pet, ""));
    const banked = bank.map((pet, index) => {
      const remove = el("button", { className: "danger" }, "Xóa khỏi ngân hàng");
      remove.onclick = () => {
        if (!confirm(`Xóa ${speciesName(pet.speciesId)} (Lv ${pet.level}) khỏi ngân hàng sủng vật?`)) return;
        bank.splice(index, 1);
        bank.forEach((p, slot) => (p.slot = slot));
        render();
      };
      return petLine(pet, remove);
    });
    view.replaceChildren(
      el("h3", {}, `Đội hình (${save.pets.length})`),
      el("div", { className: "table-scroll" }, el("table", {}, head(), el("tbody", {}, ...party))),
      el("h3", {}, `Ngân hàng sủng vật (${bank.length})`),
      bank.length
        ? el("div", { className: "table-scroll" }, el("table", {}, head(), el("tbody", {}, ...banked)))
        : el("p", {}, "Trống."),
      el("p", { className: "muted" }, "Muốn tặng pet: dùng Gửi quà (pet được tạo đúng cách trong game, có thiên phú và shiny ngẫu nhiên). Sửa cấp/kỹ năng pet trong tab JSON nếu thật cần."),
    );
  };
  render();
  return view;
}

function jsonEditor(save: GameSave): HTMLElement & { leave?: () => void } {
  const area = el("textarea", { rows: 28, spellcheck: false });
  area.value = JSON.stringify(save, null, 1);
  const view = el(
    "div",
    { className: "stack" },
    el("p", { className: "warn" }, "Sửa trực tiếp dữ liệu save. Server chỉ nhận nếu đúng cấu trúc save của game; sai cấu trúc sẽ bị từ chối khi lưu."),
    area,
  ) as HTMLElement & { leave?: () => void };
  view.leave = () => {
    let parsed: GameSave;
    try {
      parsed = JSON.parse(area.value);
    } catch {
      throw new Error("JSON không hợp lệ: hãy sửa lỗi cú pháp trước.");
    }
    for (const key of Object.keys(save)) delete (save as Record<string, unknown>)[key];
    Object.assign(save, parsed);
  };
  return view;
}

// ---------------------------------------------------------------- gift codes
const toLocalInput = (time: number | null) =>
  time ? new Date(time - new Date(time).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
const fromLocalInput = (value: string) => (value ? new Date(value).getTime() : null);

function codeForm(existing: GiftCode | null, done: () => void): HTMLElement {
  const code = el("input", { placeholder: "VD: TET2027", value: existing?.code ?? "", readOnly: !!existing, style: "text-transform:uppercase" });
  const description = el("input", { placeholder: "Mô tả (người chơi thấy dòng này)", value: existing?.description ?? "" });
  const maxUses = el("input", { type: "number", min: "1", placeholder: "Không giới hạn", value: existing?.maxUses ? String(existing.maxUses) : "" });
  const startsAt = el("input", { type: "datetime-local", value: toLocalInput(existing?.startsAt ?? null) });
  const expiresAt = el("input", { type: "datetime-local", value: toLocalInput(existing?.expiresAt ?? null) });
  const active = el("input", { type: "checkbox", checked: existing?.active ?? true });
  const rewards = rewardEditor(existing?.rewards ?? emptyRewards(), () => catalog);
  const random = el("button", { type: "button" }, "Mã ngẫu nhiên");
  random.onclick = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    code.value = "VQSV" + [...bytes].map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  };
  return el(
    "div",
    { className: "card stack" },
    el("h2", {}, existing ? `Sửa giftcode ${existing.code}` : "Tạo giftcode mới"),
    el(
      "div",
      { className: "grid2" },
      el("label", { className: "field" }, "Mã", el("div", { className: "row" }, code, existing ? "" : random)),
      el("label", { className: "field" }, "Mô tả quà", description),
      el("label", { className: "field" }, "Tổng số lượt dùng (mỗi tài khoản chỉ 1 lần)", maxUses),
      el("label", { className: "row" }, active, "Đang mở cho người chơi nhập"),
      el("label", { className: "field" }, "Bắt đầu từ (để trống = ngay)", startsAt),
      el("label", { className: "field" }, "Hết hạn lúc (để trống = không hết hạn)", expiresAt),
    ),
    el("h3", {}, "Phần quà"),
    rewards.element,
    el(
      "div",
      { className: "row" },
      button(existing ? "Lưu giftcode" : "Tạo giftcode", async () => {
        await api("/admin/giftcodes", {
          method: "POST",
          json: {
            code: code.value.trim().toUpperCase(),
            description: description.value,
            maxUses: maxUses.value ? Number(maxUses.value) : null,
            startsAt: fromLocalInput(startsAt.value),
            expiresAt: fromLocalInput(expiresAt.value),
            active: active.checked,
            rewards: rewards.value(),
          },
        });
        message(existing ? "Đã lưu giftcode." : `Đã tạo giftcode ${code.value.trim().toUpperCase()}.`);
        done();
      }, "primary"),
      existing ? button("Hủy", done) : "",
    ),
  );
}

async function codesView(): Promise<HTMLElement> {
  const [{ codes }] = await Promise.all([api("/admin/giftcodes") as Promise<{ codes: GiftCode[] }>, ensureCatalog().catch(() => null)]);
  const formSlot = el("div");
  formSlot.append(codeForm(null, () => void reload()));
  const now = Date.now();
  const state = (c: GiftCode) =>
    !c.active ? "Đang tắt"
      : c.startsAt && now < c.startsAt ? "Chưa bắt đầu"
        : c.expiresAt && now > c.expiresAt ? "Hết hạn"
          : c.maxUses !== null && c.uses >= c.maxUses ? "Hết lượt"
            : "Đang mở";
  const rows = codes.map((c) => {
    const who = el("div");
    return el(
      "tr",
      {},
      el("td", {}, el("b", {}, c.code), el("small", {}, c.description)),
      el("td", {}, summary(c.rewards)),
      el("td", { className: "num" }, `${c.uses}${c.maxUses !== null ? " / " + c.maxUses : ""}`),
      el("td", {}, state(c), el("small", {}, [c.startsAt ? "từ " + dateTime(c.startsAt) : "", c.expiresAt ? "đến " + dateTime(c.expiresAt) : ""].filter(Boolean).join(" "))),
      el(
        "td",
        {},
        el(
          "div",
          { className: "actions" },
          button("Sửa", () => {
            formSlot.replaceChildren(codeForm(c, () => void reload()));
            formSlot.scrollIntoView({ behavior: "smooth" });
          }),
          button(c.active ? "Tắt" : "Bật", async () => {
            await api("/admin/giftcodes", { method: "POST", json: { ...c, active: !c.active } });
            await reload();
          }),
          button("Ai đã nhập", async () => {
            const { redemptions } = await api(`/admin/giftcodes/${c.code}/redemptions`);
            who.replaceChildren(
              redemptions.length
                ? el("ul", { className: "audit" }, ...redemptions.map((r: { email: string; at: number }) => el("li", {}, `${dateTime(r.at)} · ${r.email}`)))
                : el("small", {}, "Chưa ai nhập."),
            );
          }),
          button("Xóa", async () => {
            if (!confirm(`Xóa giftcode ${c.code}? Lịch sử ai đã nhập cũng bị xóa, và mã này có thể được tạo lại.`)) return;
            await api(`/admin/giftcodes/${c.code}`, { method: "DELETE" });
            message("Đã xóa giftcode.");
            await reload();
          }, "danger"),
        ),
        who,
      ),
    );
  });
  return el(
    "div",
    { className: "stack" },
    el("div", { className: "heading" }, el("h1", {}, "Giftcode"), button("Làm mới", reload)),
    el("p", {}, "Người chơi nhập mã trong game ở mục Giftcode như mã có sẵn. Mã tạo ở đây dùng chung cho mọi người, mỗi tài khoản nhập được một lần."),
    el(
      "div",
      { className: "card table-scroll" },
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, ...["Mã", "Quà", "Đã dùng", "Trạng thái", ""].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...(rows.length ? rows : [el("tr", {}, el("td", { colSpan: 5 }, "Chưa có giftcode nào."))])),
      ),
    ),
    formSlot,
  );
}

// ---------------------------------------------------------------- mail
async function mailView(): Promise<HTMLElement> {
  const [{ mail }] = await Promise.all([api("/admin/mail") as Promise<{ mail: SentMail[] }>, ensureCatalog().catch(() => null)]);
  const everyone = el("input", { type: "radio", name: "target", checked: mailTarget === "all" });
  const one = el("input", { type: "radio", name: "target", checked: mailTarget !== "all" });
  const email = el("input", { type: "search", placeholder: "Email người nhận", value: mailTarget === "all" ? "" : mailTarget.email });
  const found = el("small", {}, mailTarget === "all" ? "" : "Người nhận: " + mailTarget.email);
  let target: { id: string; email: string } | null = mailTarget === "all" ? null : mailTarget;
  email.onchange = async () => {
    one.checked = true;
    target = null;
    found.textContent = "Đang tìm…";
    const { users }: { users: UserRow[] } = await api("/admin/users?" + new URLSearchParams({ q: email.value.trim().toLowerCase() }));
    const exact = users.find((u) => u.email === email.value.trim().toLowerCase()) ?? (users.length === 1 ? users[0] : undefined);
    if (exact) {
      target = { id: exact.id, email: exact.email };
      found.textContent = "Người nhận: " + exact.email;
    } else found.textContent = users.length ? `Có ${users.length} tài khoản khớp, hãy gõ đủ email.` : "Không tìm thấy tài khoản.";
  };
  const title = el("input", { placeholder: "Tiêu đề (VD: Quà đền bù bảo trì)", maxLength: 80 });
  const text = el("input", { placeholder: "Lời nhắn (không bắt buộc)", maxLength: 300 });
  const rewards = rewardEditor(emptyRewards(), () => catalog);
  const sent = mail.map((m) =>
    el(
      "tr",
      {},
      el("td", {}, dateTime(m.createdAt)),
      el("td", {}, el("b", {}, m.title), el("small", {}, m.body)),
      el("td", {}, m.email ?? `Tất cả (${m.recipients})`),
      el("td", {}, summary(m.rewards)),
      el("td", { className: "num" }, `${m.claimed}/${m.recipients}`),
      el(
        "td",
        {},
        m.claimed < m.recipients
          ? button("Thu hồi", async () => {
              if (!confirm(`Thu hồi "${m.title}" khỏi ${m.recipients - m.claimed} người chưa nhận?`)) return;
              const { recalled } = await api(`/admin/mail/${m.batch}`, { method: "DELETE" });
              message(`Đã thu hồi ${recalled} phần quà.`);
              await reload();
            }, "danger")
          : "",
      ),
    ),
  );
  return el(
    "div",
    { className: "stack" },
    el("h1", {}, "Gửi quà"),
    el(
      "div",
      { className: "card stack" },
      el("p", {}, "Quà vào hộp thư trên server. Người chơi đang online nhận trong khoảng 30 giây khi đứng tự do trên bản đồ; người offline nhận lần vào game sau. Quà có pet chờ đến khi ngân hàng sủng vật đủ chỗ."),
      el(
        "div",
        { className: "row" },
        el("label", { className: "row" }, everyone, "Tất cả người chơi (trừ tài khoản bị khóa)"),
        el("label", { className: "row" }, one, "Một người:"),
        email,
        found,
      ),
      el("div", { className: "grid2" }, el("label", { className: "field" }, "Tiêu đề", title), el("label", { className: "field" }, "Lời nhắn", text)),
      el("h3", {}, "Phần quà"),
      rewards.element,
      button("Gửi quà", async () => {
        const toAll = everyone.checked;
        if (!toAll && !target) throw new Error("Chọn người nhận (gõ email rồi nhấn Enter).");
        const value = rewards.value();
        if (!confirm(`Gửi "${title.value}" (${summary(value)}) cho ${toAll ? "TẤT CẢ người chơi" : target!.email}?`)) return;
        const { recipients } = await api("/admin/mail", {
          method: "POST",
          json: { target: toAll ? "all" : target!.id, title: title.value, body: text.value, rewards: value },
        });
        mailTarget = "all";
        message(`Đã gửi quà cho ${recipients} người.`);
        await reload();
      }, "primary"),
    ),
    el(
      "div",
      { className: "card table-scroll" },
      el("h2", {}, "Đã gửi"),
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, ...["Lúc", "Thư", "Người nhận", "Quà", "Đã nhận", ""].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...(sent.length ? sent : [el("tr", {}, el("td", { colSpan: 6 }, "Chưa gửi quà nào."))])),
      ),
    ),
  );
}

// ---------------------------------------------------------------- boot
for (const control of node("tabs").querySelectorAll("button"))
  control.addEventListener("click", () => {
    if (control.dataset.tab === "players" && tab === "players") players.open = null;
    void show(control.dataset.tab!);
  });

node<HTMLFormElement>("login").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const submit = form.querySelector("button")!;
  submit.disabled = true;
  message("");
  try {
    const { user } = await api("/auth/login", {
      method: "POST",
      json: { email: data.get("email"), password: data.get("password") },
    });
    await enter(user);
  } catch (error) {
    message(error instanceof Error ? error.message : String(error), true);
  } finally {
    (form.elements.namedItem("password") as HTMLInputElement).value = "";
    submit.disabled = false;
  }
};
node("logout").onclick = async () => {
  await api("/auth/logout", { method: "POST" }).catch(() => undefined);
  showLogin();
};

api("/auth/me")
  .then(({ user }) => enter(user))
  .catch(() => showLogin());
