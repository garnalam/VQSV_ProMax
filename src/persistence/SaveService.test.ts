import { describe, expect, it, vi } from "vitest";
import type { GameSave } from "./save/GameSave";
import type { SaveRepository } from "./SaveRepository";
import { SaveService } from "./SaveService";

const snapshot = (n: number) => ({ savedAt: String(n) }) as unknown as GameSave;

function repository(write: (save: GameSave) => Promise<void>): SaveRepository {
  return { save: write } as unknown as SaveRepository;
}

describe("SaveService", () => {
  it("exposes an autosave failure even without a caller callback", async () => {
    const error = new Error("Phiên đăng nhập đã hết.");
    const service = new SaveService(repository(async () => { throw error; }));
    service.save(snapshot(1));
    await service.flush();
    expect(service.lastError).toBe(error);
    expect(service.pending).toBe(0);
    expect(service.lastSavedAt).toBeNull();
  });
  it("writes in request order, one at a time", async () => {
    const order: string[] = [];
    let running = 0;
    const service = new SaveService(
      repository(async (save) => {
        running++;
        expect(running).toBe(1);
        await new Promise((r) => setTimeout(r, save.savedAt === "1" ? 5 : 0));
        order.push(save.savedAt);
        running--;
      }),
    );
    for (const n of [1, 2, 3]) service.save(snapshot(n));
    expect(service.pending).toBe(3);
    await service.flush();
    expect(order).toEqual(["1", "2", "3"]);
    expect(service.pending).toBe(0);
  });

  it("reports each outcome, and a failure does not stop later writes", async () => {
    const service = new SaveService(
      repository(async (save) => {
        if (save.savedAt === "1") throw new Error("disk full");
      }),
    );
    const outcomes: string[] = [];
    service.save(snapshot(1), {
      onSuccess: () => outcomes.push("1 ok"),
      onFailure: () => outcomes.push("1 failed"),
    });
    service.save(snapshot(2), { onSuccess: () => outcomes.push("2 ok") });
    await service.flush();
    expect(outcomes).toEqual(["1 failed", "2 ok"]);
  });

  it("a throwing callback does not block the queue", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const written: string[] = [];
    const service = new SaveService(repository(async (save) => void written.push(save.savedAt)));
    service.save(snapshot(1), {
      onSuccess: () => {
        throw new Error("callback bug");
      },
    });
    service.save(snapshot(2));
    await service.flush();
    expect(written).toEqual(["1", "2"]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
