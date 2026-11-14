import { AccountError, accountMessage } from "../account/AccountService";

/** What the login panel's buttons reach in the app. */
export type LoginHandlers = {
  login(username: string, password: string): Promise<void>;
  register(username: string, password: string): Promise<void>;
  /** The first tap or key on the page: the browser lets audio start from here. */
  firstGesture(): void;
  volume: { level(): number; setLevel(level: number): void };
  muted: { get(): boolean; toggle(): void };
  speedX2: { get(): boolean; set(on: boolean): void };
  /** What players sign in with: an email on the server, a name for in-browser accounts. */
  identity?: "email" | "username";
};

type Mode = "login" | "register";

const REMEMBER_KEY = "vqsv.login.username";

const ICONS = {
  gear: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>`,
  sound: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4z"/><path class="wave" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/><path class="cross" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9.5l5 5M21 9.5l-5 5"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>`,
  user: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1z"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.5" r="1.5" fill="currentColor"/></svg>`,
};

const html = `
  <div class="login-panel" role="dialog" aria-label="Đăng nhập">
    <span class="corner tl"></span><span class="corner tr"></span>
    <span class="corner bl"></span><span class="corner br"></span>
    <div class="login-tools">
      <button type="button" class="tool" data-act="settings" aria-label="Cài đặt">${ICONS.gear}</button>
      <button type="button" class="tool" data-act="sound" aria-label="Bật/tắt âm thanh">${ICONS.sound}</button>
      <button type="button" class="tool" data-act="exit" aria-label="Thoát">${ICONS.close}</button>
    </div>
    <form class="login-form" novalidate>
      <h1 class="login-title">Tạo tài khoản</h1>
      <label class="field">${ICONS.user}<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" placeholder="Tài khoản" /></label>
      <label class="field">${ICONS.lock}<input name="password" type="password" autocomplete="current-password" maxlength="64" placeholder="Mật khẩu" /></label>
      <label class="field confirm">${ICONS.lock}<input name="confirm" type="password" autocomplete="new-password" maxlength="64" placeholder="Nhập lại mật khẩu" /></label>
      <div class="login-row">
        <label class="check"><input name="remember" type="checkbox" /><span>Ghi nhớ</span></label>
        <button type="button" class="link" data-act="forgot">Quên mật khẩu?</button>
      </div>
      <p class="login-message" role="alert"></p>
      <button type="submit" class="primary">Đăng nhập</button>
      <button type="button" class="secondary" data-act="switch">Đăng ký</button>
      <span class="login-rule"></span>
    </form>
    <div class="login-settings" hidden>
      <h2>Cài đặt</h2>
      <label class="setting">Âm lượng
        <input name="volume" type="range" min="0" max="3" step="1" />
        <output name="volumeText"></output>
      </label>
      <label class="setting check"><input name="speed" type="checkbox" /><span>Tốc độ x2</span></label>
      <button type="button" class="secondary" data-act="closeSettings">Xong</button>
    </div>
  </div>`;

/**
 * The first panel of the game: sign in, or register and then choose whether to skip the
 * prologue. It is plain HTML over the page (real fields, so the phone keyboard and the browser's
 * password manager work), and it keeps typed keys away from the game's input.
 */
export class LoginOverlay {
  readonly root: HTMLElement;
  private mode: Mode = "login";
  private busy = false;
  private gestured = false;
  private readonly form: HTMLFormElement;
  private readonly settings: HTMLElement;
  constructor(
    parent: HTMLElement,
    private readonly handlers: LoginHandlers,
  ) {
    this.root = document.createElement("div");
    this.root.id = "login";
    this.root.hidden = true;
    this.root.innerHTML = html;
    parent.append(this.root);
    this.form = this.root.querySelector("form")!;
    this.settings = this.root.querySelector(".login-settings")!;
    // Typing in the fields must not also press keys in the game behind the panel.
    for (const type of ["keydown", "keyup"])
      this.root.addEventListener(type, (event) => event.stopPropagation());
    this.root.addEventListener("pointerdown", () => this.gesture(), { capture: true });
    this.root.addEventListener("keydown", () => this.gesture(), { capture: true });
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.root.addEventListener("click", (event) => {
      const act = (event.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act) this.act(act);
    });
    const volume = this.input("volume");
    volume.addEventListener("input", () => {
      this.handlers.volume.setLevel(Number(volume.value));
      this.syncSettings();
    });
    this.input("speed").addEventListener("change", () =>
      this.handlers.speedX2.set(this.input("speed").checked),
    );
    if (handlers.identity === "email") {
      const name = this.input("username");
      Object.assign(name, { type: "email", maxLength: 128, placeholder: "Email" });
      name.setAttribute("autocomplete", "email");
      name.setAttribute("inputmode", "email");
      for (const field of ["password", "confirm"]) this.input(field).maxLength = 128;
    }
    this.setMode("login");
  }

  show(): void {
    this.root.hidden = false;
    this.busy = false;
    this.setMode("login");
    const remembered = this.remembered();
    this.input("username").value = remembered;
    this.input("remember").checked = remembered !== "";
    this.input("password").value = "";
    this.syncSettings();
    // A phone would pop its keyboard over the panel: focus only where there is a real keyboard.
    if (!window.matchMedia?.("(pointer: coarse)").matches)
      this.input(remembered ? "password" : "username").focus();
  }

  hide(): void {
    this.root.hidden = true;
    this.settings.hidden = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  private act(act: string): void {
    if (act === "switch") this.setMode(this.mode === "login" ? "register" : "login");
    else if (act === "forgot")
      this.message("Hãy liên hệ quản trị viên để lấy lại mật khẩu.", "info");
    else if (act === "settings") {
      this.syncSettings();
      this.settings.hidden = !this.settings.hidden;
    } else if (act === "closeSettings") this.settings.hidden = true;
    else if (act === "sound") {
      this.handlers.muted.toggle();
      this.syncSettings();
    } else if (act === "exit") {
      window.close();
      // Browsers only let a page close a tab the page itself opened.
      setTimeout(() => {
        if (!window.closed)
          this.message("Trình duyệt không cho trang tự đóng. Bạn có thể đóng tab này.", "info");
      }, 200);
    }
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const username = this.input("username").value.trim(),
      password = this.input("password").value;
    if (this.mode === "register" && password !== this.input("confirm").value) {
      this.message("Hai mật khẩu không khớp.", "error");
      return;
    }
    this.busy = true;
    this.form.classList.add("busy");
    this.message("", "info");
    try {
      if (this.mode === "login") await this.handlers.login(username, password);
      else await this.handlers.register(username, password);
      this.remember(username);
      this.input("password").value = "";
      this.input("confirm").value = "";
    } catch (error) {
      this.message(
        error instanceof AccountError ? accountMessage(error) : "Có lỗi, hãy thử lại.",
        "error",
      );
      if (!(error instanceof AccountError)) console.error("VQSV_LOGIN", error);
    } finally {
      this.busy = false;
      this.form.classList.remove("busy");
    }
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.root.dataset.mode = mode;
    const register = mode === "register";
    this.root.querySelector(".login-title")!.textContent = register ? "Tạo tài khoản" : "Đăng nhập";
    this.root.querySelector<HTMLButtonElement>(".primary")!.textContent = register
      ? "Đăng ký"
      : "Đăng nhập";
    this.root.querySelector<HTMLButtonElement>("[data-act=switch]")!.textContent = register
      ? "Đã có tài khoản? Đăng nhập"
      : "Đăng ký";
    this.input("password").autocomplete = register ? "new-password" : "current-password";
    this.input("confirm").value = "";
    this.message("", "info");
  }

  private syncSettings(): void {
    const level = this.handlers.volume.level(),
      muted = this.handlers.muted.get();
    this.input("volume").value = String(level);
    this.root.querySelector("output")!.textContent = muted ? "Tắt" : `${level}/3`;
    this.input("speed").checked = this.handlers.speedX2.get();
    this.root.querySelector("[data-act=sound]")!.classList.toggle("off", muted);
  }

  private message(text: string, kind: "error" | "info"): void {
    const line = this.root.querySelector<HTMLElement>(".login-message")!;
    line.textContent = text;
    line.dataset.kind = kind;
  }

  private gesture(): void {
    if (this.gestured) return;
    this.gestured = true;
    this.handlers.firstGesture();
  }

  private remembered(): string {
    try {
      return localStorage.getItem(REMEMBER_KEY) ?? "";
    } catch {
      return "";
    }
  }

  private remember(username: string): void {
    try {
      if (this.input("remember").checked) localStorage.setItem(REMEMBER_KEY, username);
      else localStorage.removeItem(REMEMBER_KEY);
    } catch {
      // Storage blocked (private mode): the name is simply not remembered.
    }
  }

  private input(name: string): HTMLInputElement {
    return this.root.querySelector<HTMLInputElement>(`[name=${name}]`)!;
  }
}
