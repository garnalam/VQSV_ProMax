import { AdminRefusal, type AdminGrant, type AdminGrantRequest } from "../account/AdminApi";
import {
  ADMIN_BUFF_LEVELS,
  ADMIN_KIND_LABELS,
  ADMIN_MAX_CURRENCY,
  ADMIN_MAX_QUANTITY,
} from "../game/admin/AdminTool";
import type { AdminView } from "../game/session/GameplayHost";

/** The game session the tool works on (`GameplayHost`). */
export type AdminToolPort = {
  adminView(): AdminView | null;
  applyAdminGrant(grant: AdminGrant): string;
};

/** The server's approval (`AdminApi`). */
export type AdminAuthorizer = { authorize(request: AdminGrantRequest): Promise<AdminGrant> };

const html = `
  <div class="admin-panel" role="dialog" aria-label="Admin Tool">
    <header class="admin-head">
      <h2>Admin Tool</h2>
      <button type="button" class="admin-close" data-act="close" aria-label="Đóng">×</button>
    </header>
    <p class="admin-message" role="status"></p>
    <section class="admin-section">
      <h3>Thêm vật phẩm vào lưng bao</h3>
      <input name="itemFilter" type="search" placeholder="Lọc theo tên..." autocomplete="off" />
      <select name="item" size="6"></select>
      <div class="admin-row">
        <label>Số lượng <input name="quantity" type="number" min="1" max="${ADMIN_MAX_QUANTITY}" value="1" /></label>
        <button type="button" data-act="addItem">Thêm</button>
      </div>
    </section>
    <section class="admin-section">
      <h3>Tiền và huy hiệu</h3>
      <div class="admin-row">
        <label>Tiền <input name="money" type="number" min="0" max="${ADMIN_MAX_CURRENCY}" /></label>
        <label>Huy hiệu <input name="badges" type="number" min="0" max="${ADMIN_MAX_CURRENCY}" /></label>
      </div>
      <div class="admin-row"><span></span><button type="button" data-act="setCurrency">Đặt</button></div>
    </section>
    <section class="admin-section">
      <h3>Buff pet +${ADMIN_BUFF_LEVELS} level</h3>
      <div class="admin-row">
        <select name="pet"></select>
        <button type="button" data-act="buffPet">Buff</button>
      </div>
    </section>
    <section class="admin-section">
      <h3>Thêm pet vào ngân hàng sủng vật</h3>
      <p class="admin-note">Thiên phú, shiny và loại shiny ngẫu nhiên. <span class="admin-bank"></span></p>
      <input name="speciesFilter" type="search" placeholder="Lọc theo tên..." autocomplete="off" />
      <select name="species" size="6"></select>
      <div class="admin-row"><span></span><button type="button" data-act="addPet">Thêm pet</button></div>
    </section>
  </div>`;

/**
 * The Admin Tool: plain HTML over the game (real fields, so typing works on a phone), opened from
 * the game menu's "Admin Tool" row. Every action asks the server first; only the grant the server
 * returns is applied to the save. Keys typed here never reach the game behind it.
 */
export class AdminToolOverlay {
  readonly root: HTMLElement;
  private port: AdminToolPort | null = null;
  private view: AdminView | null = null;
  private busy = false;

  constructor(
    parent: HTMLElement,
    private readonly server: AdminAuthorizer,
  ) {
    this.root = document.createElement("div");
    this.root.id = "admin-tool";
    this.root.hidden = true;
    this.root.innerHTML = html;
    parent.append(this.root);
    for (const type of ["keydown", "keyup"])
      this.root.addEventListener(type, (event) => {
        event.stopPropagation();
        if (type === "keydown" && (event as KeyboardEvent).key === "Escape") this.hide();
      });
    this.root.addEventListener("click", (event) => {
      if (event.target === this.root) return this.hide();
      const act = (event.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act) void this.act(act);
    });
    this.field("itemFilter").addEventListener("input", () => this.fillItems());
    this.field("speciesFilter").addEventListener("input", () => this.fillSpecies());
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(port: AdminToolPort): void {
    this.port = port;
    this.root.hidden = false;
    this.say("");
    this.refresh();
  }

  hide(): void {
    this.root.hidden = true;
    this.port = null;
  }

  private field<T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(
    name: string,
  ): T {
    return this.root.querySelector<T>(`[name="${name}"]`)!;
  }

  private say(text: string, error = false): void {
    const line = this.root.querySelector<HTMLElement>(".admin-message")!;
    line.textContent = text;
    line.classList.toggle("error", error);
  }

  /** Re-read the session: the lists, the current money and badges, the roster. */
  private refresh(): void {
    this.view = this.port?.adminView() ?? null;
    if (!this.view) {
      this.say("Chỉ dùng được khi đang ở bản đồ.", true);
      return;
    }
    this.field("money").value = String(this.view.money);
    this.field("badges").value = String(this.view.badges);
    const pet = this.field<HTMLSelectElement>("pet"),
      chosen = pet.value;
    pet.replaceChildren(
      ...this.view.pets.map((row) =>
        option(String(row.slot), `${row.slot + 1}. ${row.name} — lv${row.level}`),
      ),
    );
    if (chosen && this.view.pets.some((row) => String(row.slot) === chosen)) pet.value = chosen;
    this.root.querySelector(".admin-bank")!.textContent =
      `Ngân hàng: ${this.view.bank.used}/${this.view.bank.capacity}.`;
    this.fillItems();
    this.fillSpecies();
  }

  private fillItems(): void {
    const select = this.field<HTMLSelectElement>("item"),
      chosen = select.value,
      filter = fold(this.field("itemFilter").value),
      groups = new Map<string, HTMLOptGroupElement>();
    select.replaceChildren();
    for (const item of this.view?.items ?? []) {
      if (filter && !fold(item.name).includes(filter)) continue;
      let group = groups.get(item.kind);
      if (!group) {
        group = document.createElement("optgroup");
        group.label = ADMIN_KIND_LABELS[item.kind];
        groups.set(item.kind, group);
        select.append(group);
      }
      group.append(option(`${item.kind}:${item.id}`, `${item.name} (#${item.id})`));
    }
    if (chosen) select.value = chosen;
    if (select.selectedIndex < 0 && select.options.length) select.selectedIndex = 0;
  }

  private fillSpecies(): void {
    const select = this.field<HTMLSelectElement>("species"),
      chosen = select.value,
      filter = fold(this.field("speciesFilter").value);
    select.replaceChildren(
      ...(this.view?.species ?? [])
        .filter((row) => !filter || fold(row.name).includes(filter))
        .map((row) => option(String(row.speciesId), `${row.name} (#${row.speciesId})`)),
    );
    if (chosen) select.value = chosen;
    if (select.selectedIndex < 0 && select.options.length) select.selectedIndex = 0;
  }

  /** The request a button stands for, or a message saying what is missing. */
  private request(act: string): AdminGrantRequest | string {
    const int = (name: string) => {
      const text = this.field(name).value.trim();
      return /^\d+$/.test(text) ? Number(text) : NaN;
    };
    switch (act) {
      case "addItem": {
        const [kind, id] = this.field<HTMLSelectElement>("item").value.split(":"),
          quantity = int("quantity");
        if (!kind || id === undefined) return "Chọn một vật phẩm.";
        if (!(quantity >= 1 && quantity <= ADMIN_MAX_QUANTITY))
          return `Số lượng từ 1 đến ${ADMIN_MAX_QUANTITY}.`;
        return { action: "addItem", kind: kind as never, id: Number(id), quantity };
      }
      case "setCurrency": {
        const money = int("money"),
          badges = int("badges");
        if (!(money <= ADMIN_MAX_CURRENCY) || !(badges <= ADMIN_MAX_CURRENCY))
          return "Tiền và huy hiệu phải là số nguyên không âm.";
        return { action: "setCurrency", money, badges };
      }
      case "buffPet": {
        const slot = this.field<HTMLSelectElement>("pet").value;
        return slot === "" ? "Chưa có pet." : { action: "buffPet", slot: Number(slot) };
      }
      case "addPet": {
        const species = this.field<HTMLSelectElement>("species").value;
        if (species === "") return "Chọn một loài.";
        if (this.view && this.view.bank.used >= this.view.bank.capacity)
          return "Ngân hàng sủng vật đã đầy.";
        return { action: "addPet", speciesId: Number(species) };
      }
    }
    return "";
  }

  private async act(act: string): Promise<void> {
    if (act === "close") return this.hide();
    if (this.busy || !this.port) return;
    const request = this.request(act);
    if (typeof request === "string") {
      if (request) this.say(request, true);
      return;
    }
    this.busy = true;
    this.root.classList.add("busy");
    this.say("Đang gửi lên máy chủ...");
    try {
      const grant = await this.server.authorize(request);
      if (!this.port) return;
      this.say(this.port.applyAdminGrant(grant));
      this.refresh();
    } catch (error) {
      this.say(error instanceof AdminRefusal ? error.message : "Có lỗi, hãy thử lại.", true);
    } finally {
      this.busy = false;
      this.root.classList.remove("busy");
    }
  }
}

function option(value: string, text: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = text;
  return element;
}

/** Case- and accent-insensitive text for the filters ("long" finds "Long", "lửa" finds "Lửa"). */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}
