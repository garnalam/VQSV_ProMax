import type { Account } from "../account/AccountService";
import type { RemoteAccountService } from "../account/RemoteAccountService";
import type { SaveRepository } from "../persistence/SaveRepository";
export class CloudSession {
  account: Account | null = null;
  saves: SaveRepository | null = null;
  private generation = 0;
  constructor(private readonly service: RemoteAccountService) {}
  async authenticate(mode: "login" | "register", email: string, password: string): Promise<void> {
    const generation = ++this.generation;
    const account = await this.service[mode](email, password);
    if (generation !== this.generation) throw new Error("Phiên đăng nhập đã thay đổi.");
    this.bind(account);
  }
  async restore(): Promise<boolean> {
    const generation = ++this.generation;
    const account = await this.service.current();
    if (generation !== this.generation) return false;
    this.bind(account);
    return account !== null;
  }
  async logout(): Promise<void> {
    ++this.generation;
    if (this.account) await this.service.logout(this.account);
    this.bind(null);
  }
  private bind(account: Account | null): void {
    this.account = account;
    this.saves = account ? this.service.saves(account) : null;
  }
}
