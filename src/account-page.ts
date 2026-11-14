import type { Account } from "./account/AccountService";
import { RemoteAccountService } from "./account/RemoteAccountService";

const accounts = new RemoteAccountService();
const form = document.querySelector("form")!;
const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
const toggle = document.querySelector<HTMLButtonElement>("#switch")!;
const logout = document.querySelector<HTMLButtonElement>("#logout")!;
const password = form.querySelector<HTMLInputElement>("[name=password]")!;
const confirmation = document.querySelector<HTMLElement>("#confirmation")!;
const message = document.querySelector<HTMLElement>("#message")!;
const signedIn = document.querySelector<HTMLElement>("#signed-in")!;
let account: Account | null = null;
let registering = false;

function show(account: Account | null): void {
  form.hidden = account !== null;
  signedIn.hidden = account === null;
  document.querySelector<HTMLElement>("#email")!.textContent = account?.username ?? "";
}

function report(error: unknown): void {
  message.textContent = error instanceof Error ? error.message : "Không kết nối được máy chủ.";
}

toggle.addEventListener("click", () => {
  registering = !registering;
  message.textContent = "";
  confirmation.hidden = !registering;
  password.autocomplete = registering ? "new-password" : "current-password";
  submit.textContent = registering ? "Tạo tài khoản" : "Đăng nhập";
  toggle.textContent = registering ? "Về đăng nhập" : "Đăng ký";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  const values = new FormData(form);
  const email = String(values.get("email"));
  if (registering && password.value !== values.get("confirm")) {
    message.textContent = "Hai mật khẩu không khớp.";
    return;
  }
  submit.disabled = toggle.disabled = true;
  message.textContent = "";
  try {
    if (registering) await accounts.register(email, password.value);
    else await accounts.login(email, password.value);
    location.replace("/");
  } catch (error) {
    report(error);
  } finally {
    submit.disabled = toggle.disabled = false;
  }
});

logout.addEventListener("click", async () => {
  if (!account) return;
  logout.disabled = true;
  try {
    await accounts.logout(account);
    account = null;
    show(null);
  } catch (error) {
    report(error);
  } finally {
    logout.disabled = false;
  }
});

try {
  account = await accounts.current();
  show(account);
} catch (error) {
  report(error);
  show(null);
}
