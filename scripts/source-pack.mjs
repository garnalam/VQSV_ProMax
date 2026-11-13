// Location of the decoded source pack (`modules/`, `rebuild_game/`) used by the optional
// exporters. It is only needed to regenerate files under public/pack; dev, build and test run
// from the committed pack alone.
//
// Default: the directory that contains web-native (VQSV-WebNative). Override with
// VQSV_SOURCE_PACK=/path/to/VQSV-WebNative.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function sourcePackRoot() {
  const root = resolve(process.env.VQSV_SOURCE_PACK ?? resolve(process.cwd(), ".."));
  if (!existsSync(resolve(root, "modules")))
    throw new Error(
      `source pack not found at ${root} (expected a modules/ folder). ` +
        "Set VQSV_SOURCE_PACK to the VQSV-WebNative directory.",
    );
  return root;
}
