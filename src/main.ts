import "./style.css";
import { GameApp } from "./app/GameApp";
import { mountPageShell } from "./app/PageShell";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("Missing game canvas");
// The sheet in index.html reports the code download; from here the canvas loader reports the files.
document.getElementById("boot")?.remove();

const app = new GameApp(canvas);
mountPageShell({
  app: document.getElementById("app")!,
  stage: document.getElementById("stage")!,
  canvas,
  padLeft: document.getElementById("pad-left")!,
  padRight: document.getElementById("pad-right")!,
  input: app.input,
  textEntryActive: () => app.textEntryActive(),
});
window.addEventListener("vqsv-render-error", ((event: CustomEvent<string>) => {
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#000";
    context.fillRect(0, 0, 240, 320);
    context.fillStyle = "#fff";
    context.font = "9px monospace";
    context.fillText("RENDER FAILED", 8, 20);
    context.fillText(event.detail.slice(0, 38), 8, 38);
  }
}) as EventListener);
try {
  await app.start();
} catch (error) {
  console.error("VQSV_BOOT_FAILED", error);
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#000";
    context.fillRect(0, 0, 240, 320);
    context.fillStyle = "#fff";
    context.font = "10px monospace";
    context.fillText("BOOT FAILED", 8, 20);
    context.fillText(String(error), 8, 38);
  }
}
