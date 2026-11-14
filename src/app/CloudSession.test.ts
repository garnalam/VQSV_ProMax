import { expect, it } from "vitest";
import { CloudSession } from "./CloudSession";
import { RemoteAccountService } from "../account/RemoteAccountService";

it("does not replace a newer login with an older asynchronous login result", async () => {
  let finishOld!: (response: Response) => void;
  const session = new CloudSession(new RemoteAccountService(async (_path, init) => {
    const { email } = JSON.parse(String(init?.body));
    if (email === "old@example.com") return new Promise(resolve => { finishOld = resolve; });
    return new Response(JSON.stringify({ user: { id: "new", email } }));
  }));
  const old = session.authenticate("login", "old@example.com", "password");
  await session.authenticate("login", "new@example.com", "password");
  finishOld(new Response(JSON.stringify({ user: { id: "old", email: "old@example.com" } })));
  await expect(old).rejects.toThrow("Phiên đăng nhập đã thay đổi.");
  expect(session.account?.id).toBe("new");
});
