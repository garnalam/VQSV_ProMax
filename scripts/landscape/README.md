# Landscape maps (APK Liệt Hỏa)

Bakes the APK's 320x240 landscape maps into `public/pack/world/maps/<id>/`. The game keeps
the old JAR coordinates. Each map carries `originX/originY`, the APK pixel where the JAR map's
(0, 0) now lies. `GameAssets.prepareMap` sizes the rooms from it at load, and `MapCollision`
reads terrain through it, so the widened edges can be walked on.

1. Unpack the APK. Build an APK modules root: a copy of `modules/{map,mod,img}` with the
   APK's `assets/data` originals laid over it.
2. `PixelShift <oldModulesRoot> <apkModulesRoot> <ids...>` finds the whole-tile shift between
   each old map and the APK one (`id oldWxH newWxH dx dy match`).
3. `node terrain-at.mjs <oldMapDir> <apkMapDir> pixel.txt out.json` checks collision agreement.
4. `selected.txt` lists the accepted maps as `id:dx:dy` (pixel match >= 0.8).
5. `ExportApkMaps <apkModulesRoot> public/pack/world/maps $(cat selected.txt)` writes the
   layer PNGs and `meta.json`.
6. `node apk-collision.mjs <apkMapDir> public/pack/world $(cat selected.txt)` writes `collision.json`.

The Java tools compile and run against `rebuild_game/build/classes`, e.g.
`javac -cp ../../../rebuild_game/build/classes -d out *.java` and then
`java -cp "../../../rebuild_game/build/classes;out" ExportApkMaps ...`.

The last 20 maps (23, 30, 36, 44, 45, 46, 47, 50, 61, 69, 70, 83-89, 95-97) were matched by eye;
their shift is the terrain/actor best fit. Map 91 is 4,0 (redrawn; path centre and actors agree). Cầu Vồng (201+) is not touched.

## Actors (APK positions)

`node apk-actors.mjs <jarEventDir> <apkEventDir> public/pack/world` writes `world/apk-actors.json`:
each room actor's APK spot, in game coordinates, matched to its JAR record by LCS on (kind, sprite,
state). `GameApp` lays it over the rooms and the story registry at boot (landscape only; the tests
and traces keep the JAR spots). Doors and arrivals follow, because both read the moved actors.
The actors only the APK has are added too (`added`, 131): props and wandering villagers it shows
from the start. Hidden ones and new gated obstacles (cuttable trees, breakable rocks) are left out,
since no APK event here would show or clear them.

## Event positions

`node apk-events.mjs <jarDecodedEventDir> <jarEventDir> <apkEventDir> public/pack/world` writes
`world/apk-events.json`: the APK values of the records that hold world positions (op13 trigger
rectangles, op8 places, op22 arrivals in the room the next op6/op76 loads, op57/58 block tiles), in
game coordinates. `GameApp` lays them over the story registry with the actors. The screen-space
records (op9/11/21) stay. A room whose count of an opcode changed in the APK keeps the JAR values
for that opcode (13 records).

## UI layouts (APK 320x240)

`ui-apk/` holds the APK's 30 `.ui` layouts the web reads, exported with
`ExportWebUiLayoutContract` against an APK modules root (`-Dvqsv.modules=<root with ui/original>`;
put the tool's own class first on the classpath, `build/classes` has an older copy). Each keeps the
JAR layout's widget ids, laid out for 320x240. They are the reference for porting each screen to
landscape; the world HUD and the dialog box are done (corner-pinned / bottom band, full size).
