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

## Events (APK records)

`node apk-events.mjs <jarEventDir> <apkEventDir> public/pack/world` writes `world/apk-events.json` (v2).
`event-decode.mjs` reads a scene_N.mid whole, as the game does (game/l.java, game/e.java, b/a.java,
b/b.java); on the JAR originals it reproduces modules/event/decoded exactly. The APK keeps every
room's group count, so the two are compared group by group:

- same record list: `rooms` edits `[group, record, shortArgs]` with the APK's world positions (op8,
  op13 with its size, op22 in the room the next op6/op76 loads, op57/58), moved into game
  coordinates, and its other changed short arguments (op6 arrival actor, op36, ...).
- rewritten by the APK (23 groups: rects dropped so the event runs on entering, as 9:1:g0 and
  7:2:g6; rects swapped for op15 gates, 10:8:g1 and 10:12:g2; a rect added, 7:2:g1; camera pans cut
  in the Lôi Kỳ Lân block rooms): `groups`, the APK's records whole, matched to the JAR's by
  opcode and text.

Screen-space records (op9/11/21/48/51) and texts keep the JAR values. Scene 0 is left alone, and
groups a story route plays by record index (5:3:g0 in the opening, 1:3:g0) keep the JAR list and
take only the positions. `GameApp` lays it over the registry with the actors (`applyApkEvents`).
The old scan matched the k-th op13 of a whole room, so where the APK moved a rect from one group to
another (7:2) it gave one group's rect to the other.

## UI layouts (APK 320x240)

`ui-apk/` holds the APK's 30 `.ui` layouts the web reads, exported with
`ExportWebUiLayoutContract` against an APK modules root (`-Dvqsv.modules=<root with ui/original>`;
put the tool's own class first on the classpath, `build/classes` has an older copy). Each keeps the
JAR layout's widget ids, laid out for 320x240. They are the reference for porting each screen to
landscape; the world HUD and the dialog box are done (corner-pinned / bottom band, full size).
