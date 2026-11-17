// The map audit page (`/map-audit/`): every Liệt Hỏa room as the landscape game loads it — the APK
// map, its collision, the APK actors and event rects over the JAR ones, the doors, and where the
// hero can get (`RoomReach`) — with what no arrival reaches listed beside it.
import { Pack } from "../pack/Pack";
import { StoryDataRegistry, type StorySourceRegistryDocument } from "../game/story/StoryDataRegistry";
import type { RoomAsset } from "../game/story/GameAssets";
import {
  applyApkActors,
  applyApkEvents,
  type ApkActorsDocument,
  type ApkEventsDocument,
} from "../game/world/ApkActors";
import type { MapCollision } from "../game/world/MapCollision";
import { worldEventTriggers } from "../game/world/WorldEventCatalog";
import { roomArrivals, roomReach, type RoomReach } from "../game/world/RoomReach";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $("status"),
  list = $("rooms"),
  info = $("info"),
  canvas = $<HTMLCanvasElement>("map"),
  hover = $("hover"),
  filter = $<HTMLInputElement>("filter"),
  zoomSelect = $<HTMLSelectElement>("zoom");
const g = canvas.getContext("2d")!;

type Room = {
  key: string;
  scene: number;
  index: number;
  name: string;
  asset: RoomAsset;
  jar: RoomAsset;
  reach?: RoomReach;
  row?: HTMLElement;
};

async function main(): Promise<void> {
  const pack = await Pack.load();
  const [roomsDoc, lh, cv, apkActors, apkEvents] = await Promise.all([
    pack.json<{ rooms: Record<string, RoomAsset> }>("world.rooms"),
    pack.json<StorySourceRegistryDocument>("story.event-scenes"),
    pack.json<StorySourceRegistryDocument>("story.cau-vong-event-scenes"),
    pack.json<ApkActorsDocument>("world.apk-actors"),
    pack.json<ApkEventsDocument>("world.apk-events"),
  ]);
  const rooms = structuredClone(roomsDoc.rooms),
    jarRooms = structuredClone(roomsDoc.rooms),
    registry = StoryDataRegistry.combine(structuredClone(lh), structuredClone(cv)),
    jarRegistry = StoryDataRegistry.combine(structuredClone(lh), structuredClone(cv));
  applyApkActors(apkActors, rooms, registry);
  applyApkEvents(apkEvents, registry);

  const worldRoom = (scene: number, room: number) =>
    rooms[`${scene}:${room}#world`] ?? rooms[`${scene}:${room}`];
  const keys = Object.keys(rooms)
    .filter((key) => !key.endsWith("#world") && !key.startsWith("98:") && !key.startsWith("-1:"))
    .map((key) => key.split(":").map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // Every collision first: the rooms take the APK map's size and origin from it.
  const collisions = new Map<number, MapCollision>();
  const mapIds = [...new Set(keys.map(([s, r]) => worldRoom(s, r)?.mapId).filter((id) => id !== undefined))];
  let loaded = 0;
  await Promise.all(
    mapIds.map(async (id) => {
      try {
        const map = await pack.json<MapCollision>(pack.worldKey(`maps/${id}/collision.json`));
        collisions.set(id, map);
        if (map.originX !== undefined || map.originY !== undefined)
          for (const room of Object.values(rooms))
            if (room.mapId === id) {
              room.width = map.widthPixels;
              room.height = map.heightPixels;
              room.originX = map.originX ?? 0;
              room.originY = map.originY ?? 0;
            }
      } catch {
        // A map that does not ship: its rooms show without collision.
      }
      status.textContent = `Đang tải bản đồ ${++loaded}/${mapIds.length}…`;
    }),
  );
  const collision = (id: number) => collisions.get(id);
  const arrivals = roomArrivals(registry, keys, worldRoom, collision);

  const all: Room[] = keys.map(([scene, index]) => ({
    key: `${scene}:${index}`,
    scene,
    index,
    name: registry.room(scene, index)?.roomName ?? "",
    asset: worldRoom(scene, index),
    jar: jarRooms[`${scene}:${index}#world`] ?? jarRooms[`${scene}:${index}`],
  }));

  let current: Room | null = null;
  const images = new Map<number, HTMLImageElement[]>();

  const computeReach = (room: Room): RoomReach | undefined => {
    if (room.reach) return room.reach;
    const map = collision(room.asset.mapId);
    if (!map) return undefined;
    room.reach = roomReach(registry, room.scene, room.index, room.asset, map, arrivals.get(room.key) ?? []);
    return room.reach;
  };

  const paintRow = (room: Room) => {
    const badge = room.row!.querySelector(".badge")!;
    if (!room.reach) {
      badge.className = "badge wait";
      badge.textContent = "…";
      return;
    }
    const n = room.reach.findings.length;
    badge.className = n ? "badge bad" : "badge ok";
    badge.textContent = n ? String(n) : "✓";
  };

  for (const room of all) {
    const row = document.createElement("div");
    row.className = "room";
    row.innerHTML = `<span><b></b> <small></small></span><span class="badge wait">…</span>`;
    row.querySelector("b")!.textContent = room.key;
    row.querySelector("small")!.textContent = room.name;
    row.addEventListener("click", () => void show(room));
    room.row = row;
    list.append(row);
  }

  const applyFilter = () => {
    const q = filter.value.trim().toLowerCase();
    for (const room of all) {
      const bad = (room.reach?.findings.length ?? 0) > 0;
      const visible =
        !q ||
        (q === "lỗi" || q === "loi" ? bad : room.key.startsWith(q) || room.name.toLowerCase().includes(q));
      room.row!.style.display = visible ? "" : "none";
    }
  };
  filter.addEventListener("input", applyFilter);

  async function show(room: Room): Promise<void> {
    current = room;
    for (const r of all) r.row!.classList.toggle("active", r === room);
    const reach = computeReach(room);
    if (reach) paintRow(room);
    if (!images.has(room.asset.mapId)) {
      try {
        const meta = await pack.json<{ layers: number }>(pack.worldKey(`maps/${room.asset.mapId}/meta.json`));
        images.set(
          room.asset.mapId,
          await Promise.all(
            Array.from({ length: meta.layers }, (_, i) =>
              pack.image(pack.worldKey(`maps/${room.asset.mapId}/layer-${i}.png`)),
            ),
          ),
        );
      } catch {
        images.set(room.asset.mapId, []);
      }
    }
    if (current !== room) return;
    renderInfo(room);
    draw();
  }

  function renderInfo(room: Room): void {
    const reach = room.reach,
      map = collision(room.asset.mapId);
    info.innerHTML = "";
    const h = document.createElement("h2");
    h.textContent = `${room.key} ${room.name}`;
    const meta = document.createElement("div");
    meta.style.color = "var(--muted)";
    meta.textContent = map
      ? `Map ${room.asset.mapId} · ${map.widthPixels}×${map.heightPixels} px · gốc JAR (0,0) tại (${map.originX ?? 0},${map.originY ?? 0}) · ${reach?.arrivals.length ?? 0} điểm vào · ${reach?.doors.length ?? 0} cửa · ${reach?.triggers.length ?? 0} sự kiện`
      : `Map ${room.asset.mapId}: không có file va chạm`;
    const ul = document.createElement("ul");
    ul.id = "findings";
    if (!reach?.findings.length) {
      const li = document.createElement("li");
      li.className = "none";
      li.textContent = reach?.arrivals.length
        ? "✓ Không thấy chỗ kẹt: mọi cửa, ô sự kiện và NPC sự kiện đều tới được."
        : "Không có cửa nào dẫn vào phòng này (phòng mở đầu hoặc vào bằng kịch bản).";
      ul.append(li);
    } else
      for (const f of reach.findings) {
        const li = document.createElement("li");
        li.textContent = f.text;
        if (f.at) li.addEventListener("click", () => scrollToPoint(f.at!));
        ul.append(li);
      }
    const legend = document.createElement("div");
    legend.id = "legend";
    legend.innerHTML = [
      ["rgba(255,40,40,.45)", "ô chặn"],
      ["rgba(255,210,0,.5)", "chặn tới khi có huy hiệu"],
      ["rgba(60,230,120,.45)", "đi tới được"],
      ["#4aa3ff", "cửa"],
      ["#ff9a1f", "ô sự kiện (APK)"],
      ["#9aa", "vị trí JAR cũ (nét đứt)"],
      ["#ff4fd8", "NPC (APK)"],
      ["#fff", "điểm vào phòng"],
      ["#00e5ff", "làn lá sen / mây"],
      ["#ff2020", "chỗ lỗi (X)"],
    ]
      .map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`)
      .join("");
    info.append(h, meta, ul, legend);
  }

  const zoom = () => Number(zoomSelect.value) || 2;
  const toggles = ["t-col", "t-reach", "t-actors", "t-rects", "t-doors", "t-top"].map((id) => $<HTMLInputElement>(id));
  for (const t of [...toggles, zoomSelect]) t.addEventListener("change", () => draw());
  const on = (id: string) => $<HTMLInputElement>(id).checked;

  function scrollToPoint(p: { x: number; y: number }): void {
    if (!current) return;
    const z = zoom(),
      ox = current.asset.originX ?? 0,
      oy = current.asset.originY ?? 0,
      main = canvas.parentElement!.parentElement!;
    main.scrollTo({ left: (p.x + ox) * z - main.clientWidth / 2, top: (p.y + oy) * z - 100, behavior: "smooth" });
  }

  function draw(): void {
    const room = current;
    if (!room) return;
    const map = collision(room.asset.mapId),
      layers = images.get(room.asset.mapId) ?? [],
      ox = room.asset.originX ?? 0,
      oy = room.asset.originY ?? 0,
      width = map?.widthPixels ?? room.asset.width,
      height = map?.heightPixels ?? room.asset.height,
      z = zoom();
    canvas.width = width * z;
    canvas.height = height * z;
    g.imageSmoothingEnabled = false;
    g.setTransform(z, 0, 0, z, 0, 0);
    g.fillStyle = "#000";
    g.fillRect(0, 0, width, height);
    for (const i of [1, 2]) if (layers[i]) g.drawImage(layers[i], 0, 0);
    if (on("t-top") && layers[3]) g.drawImage(layers[3], 0, 0);
    // From here on, game coordinates.
    g.translate(ox, oy);
    if (map && on("t-col")) {
      const t = map.tileSize;
      map.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const c = row[x];
          if (c === "0") continue;
          g.fillStyle = c === "1" ? "rgba(255,40,40,.35)" : c === "2" ? "rgba(255,210,0,.45)" : "rgba(160,80,255,.35)";
          g.fillRect(x * t - ox, y * t - oy, t, t);
        }
      });
    }
    const reach = room.reach;
    if (reach && on("t-reach")) {
      g.fillStyle = "rgba(60,230,120,.35)";
      for (const p of reach.reached) g.fillRect(p.x - 2, p.y - 2, 4, 4);
      g.strokeStyle = "#00e5ff";
      g.lineWidth = 2 / z;
      for (const lane of reach.lanes) {
        g.beginPath();
        lane.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.stroke();
      }
    }
    if (on("t-rects")) {
      const jarRects = new Map<string, { x: number; y: number; width: number; height: number }>();
      for (const t of worldEventTriggers(jarRegistry, room.scene, room.index))
        if (t.kind === "rect") jarRects.set(`${t.group.group}`, t.rect);
      for (const t of reach?.triggers ?? worldEventTriggers(registry, room.scene, room.index)) {
        if (t.kind !== "rect") continue;
        const jar = jarRects.get(`${t.group.group}`);
        if (jar && (jar.x !== t.rect.x || jar.y !== t.rect.y || jar.width !== t.rect.width || jar.height !== t.rect.height)) {
          g.setLineDash([3 / z * 2, 3 / z * 2]);
          g.strokeStyle = "#9aa";
          g.lineWidth = 1.5 / z;
          g.strokeRect(jar.x, jar.y, jar.width, jar.height);
          g.setLineDash([]);
        }
        g.fillStyle = "rgba(255,154,31,.25)";
        g.fillRect(t.rect.x, t.rect.y, t.rect.width, t.rect.height);
        g.strokeStyle = "#ff9a1f";
        g.lineWidth = 2 / z;
        g.strokeRect(t.rect.x, t.rect.y, t.rect.width, t.rect.height);
        label(`g${t.group.group}`, t.rect.x + 2, t.rect.y + 8, "#ff9a1f");
      }
    }
    if (on("t-doors"))
      for (const door of reach?.doors ?? []) {
        g.strokeStyle = "#4aa3ff";
        g.lineWidth = 2 / z;
        g.strokeRect(door.x - 12, door.y - 12, 24, 24);
        label(`→${door.target.scene}:${door.target.room}`, door.x - 12, door.y - 14, "#4aa3ff");
      }
    if (on("t-actors")) {
      const talkers = new Set(
        (reach?.triggers ?? []).flatMap((t) => (t.kind === "actor" ? [t.actorId] : [])),
      );
      for (const actor of room.asset.actors) {
        if (actor.sourceKind === 1) continue;
        const jar = room.jar?.actors.find((a) => a.id === actor.id);
        if (jar && (jar.x !== actor.x || jar.y !== actor.y)) {
          g.strokeStyle = "rgba(170,170,170,.7)";
          g.lineWidth = 1 / z;
          g.setLineDash([2, 2]);
          g.beginPath();
          g.moveTo(jar.x, jar.y);
          g.lineTo(actor.x, actor.y);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = "#9aa";
          g.fillRect(jar.x - 2, jar.y - 2, 4, 4);
        }
        const talk = talkers.has(actor.id);
        g.fillStyle = talk ? "#ff4fd8" : "rgba(255,79,216,.5)";
        g.beginPath();
        g.arc(actor.x, actor.y, talk ? 4 : 2.5, 0, Math.PI * 2);
        g.fill();
        if (talk) label(`#${actor.id}`, actor.x + 5, actor.y - 3, "#ff4fd8");
      }
    }
    for (const a of reach?.arrivals ?? []) {
      g.fillStyle = "#fff";
      g.beginPath();
      g.moveTo(a.at.x, a.at.y - 6);
      g.lineTo(a.at.x + 5, a.at.y + 4);
      g.lineTo(a.at.x - 5, a.at.y + 4);
      g.closePath();
      g.fill();
    }
    for (const f of reach?.findings ?? []) {
      if (!f.at) continue;
      g.strokeStyle = "#ff2020";
      g.lineWidth = 3 / z;
      g.beginPath();
      g.moveTo(f.at.x - 8, f.at.y - 8);
      g.lineTo(f.at.x + 8, f.at.y + 8);
      g.moveTo(f.at.x + 8, f.at.y - 8);
      g.lineTo(f.at.x - 8, f.at.y + 8);
      g.stroke();
    }
  }

  function label(text: string, x: number, y: number, color: string): void {
    const z = zoom();
    g.save();
    g.font = `${10 / Math.min(z, 2)}px system-ui`;
    g.lineWidth = 3 / z;
    g.strokeStyle = "#000";
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
    g.restore();
  }

  canvas.addEventListener("mousemove", (event) => {
    if (!current) return;
    const z = zoom(),
      rect = canvas.getBoundingClientRect(),
      px = Math.floor((event.clientX - rect.left) / z),
      py = Math.floor((event.clientY - rect.top) / z),
      ox = current.asset.originX ?? 0,
      oy = current.asset.originY ?? 0,
      x = px - ox,
      y = py - oy,
      map = collision(current.asset.mapId);
    let terrain = "?";
    if (map) {
      const row = map.rows[Math.floor(py / map.tileSize)];
      const c = row?.[Math.floor(px / map.tileSize)];
      terrain = c === "0" ? "đi được" : c === "1" ? "chặn" : c === "2" ? "chặn tới khi có huy hiệu" : (c ?? "ngoài map");
    }
    const near = current.asset.actors.find((a) => Math.abs(a.x - x) <= 6 && Math.abs(a.y - y) <= 6);
    hover.textContent = `game (${x},${y}) · ô ${terrain}${near ? `\nNPC #${near.id} sprite ${near.sprite}` : ""}`;
    hover.style.display = "block";
    hover.style.left = `${event.clientX + 14}px`;
    hover.style.top = `${event.clientY + 14}px`;
  });
  canvas.addEventListener("mouseleave", () => (hover.style.display = "none"));

  // The whole list's counts, a room at a time so the page stays responsive.
  let done = 0;
  const step = () => {
    const room = all[done];
    if (!room) {
      const bad = all.filter((r) => r.reach?.findings.length);
      status.textContent = `${all.length} phòng · ${bad.length} phòng có chỗ nghi lỗi · ${bad.reduce((n, r) => n + r.reach!.findings.length, 0)} chỗ`;
      applyFilter();
      return;
    }
    computeReach(room);
    paintRow(room);
    status.textContent = `Đang rà ${++done}/${all.length} phòng…`;
    setTimeout(step, 0);
  };
  step();
  const first = all.find((r) => r.key === (location.hash.slice(1) || "1:0")) ?? all[0];
  if (first) void show(first);
}

main().catch((error: unknown) => {
  status.textContent = `Lỗi: ${error instanceof Error ? error.message : String(error)}`;
});
