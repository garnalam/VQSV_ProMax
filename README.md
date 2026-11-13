# VQSV web-native

Bản game chạy trên trình duyệt, viết bằng TypeScript + Vite + Canvas 2D. Chạy, build và test chỉ cần thư mục này: **không cần Java, `rebuild_game/` hay `modules/`**.

Đây là implementation chính của game, không phải prototype. Kiến trúc ingame, UI, world, story, battle, save và resource pack đều nằm trong repo này.

Cần Node.js 20.19+ (hoặc 22.12+), theo yêu cầu của Vite 7.

```bash
git clone <repo> && cd <repo>
npm ci             # cài đúng phiên bản trong package-lock.json
npm run dev        # chạy dev server (http://localhost:5173)
npm run build      # tsc + vite build -> dist/
npm test           # test của game, chỉ dùng public/pack
```

Một số phần chỉ chạy được khi repo nằm trong cây `VQSV-WebNative` gốc (có `../rebuild_game`, `../modules`): `npm run test:oracle`, các lệnh `export:*` / `oracle:*` ở cuối file này, và ba kiểm tra trong `src/game/story/CauVongEventScenes.test.ts` so với jar index của Java. Khi clone riêng, ba kiểm tra đó tự bỏ qua (`skipped`); phần còn lại của `npm test` không cần gì bên ngoài.

## Cấu trúc `src/`

| Thư mục | Vai trò |
|---|---|
| `app/` | `GameApp`: dựng pack, input, loop, chuyển màn |
| `core/` | Hằng số, `GameLoop`, `GameplayClock` (speed x2), `ScreenManager`, `JavaRandom` |
| `core/input/` | `InputState` (gom sự kiện DOM), `InputSnapshot` (input của một tick), `KeyCode`, `GameCommand` (bộ lệnh của gameplay) |
| `core/loop/` | `FixedStepScheduler`: nhịp tick 66 ms giống `GamePanel.run()` |
| `pack/` | Nơi duy nhất được phép tải tài nguyên (`Pack`, `boot`) |
| `data/` | Catalog gameplay đọc từ pack |
| `game/session/` | `GameplayHost`: điều phối một phiên chơi theo thứ tự lớp của Java (panel → cutscene → battle → world) |
| `game/battle`, `game/story`, `game/world` | Logic gameplay thuần |
| `rendering/` | Renderer canvas, bitmap font (`rendering/font/`) |
| `screens/` | Các màn: Boot, Title, NewGame (chỉ chuyển input cho `GameplayHost` và vẽ) |
| `persistence/` | `SaveRepository`, `SaveService` (hàng đợi ghi tuần tự); `save/` chứa schema, migration và storage |
| `dev/` | Harness so khớp với Java và trace gameplay, chỉ có trong bản dev |

## Input

```
DOM events -> InputState -> drainSnapshot() mỗi tick -> Screen.tick(InputSnapshot)
                                                      -> gameplayCommands() -> world/battle/story
```

- Chỉ khi tick chạy thì game mới nhận input. Click và chạm cũng nằm trong snapshot, không có callback nào chạy ngoài tick.
- Phím được port từ Java:
  - Xác nhận: `0`, Enter, Space; trong gameplay thêm `5` và Numpad5.
  - Di chuyển: mũi tên, WASD, numpad.
  - Quay lại: Esc, hoặc Backspace (khi không đang nhập chữ).
  - Softkey: F1/F2, mũi tên trái/phải, hoặc chạm vào ô 40×40 ở góc dưới màn hình (chỉ dùng ở màn boot/title).
- Speed x2: tick thứ hai chỉ nhận trạng thái phím đang giữ. Thao tác nhấn, click hay gõ chữ chỉ được áp dụng một lần.

## Gameplay host

Mỗi tick, `GameplayHost.step()` giao toàn bộ lệnh cho đúng một lớp, theo thứ tự `VqsvGameRuntime.tick()`:

1. `panel`: menu game / hệ thống. Mở bằng Back khi đang ở bản đồ tự do; khi panel mở thì thế giới đứng yên.
2. `cutscene`: cảnh kịch bản chiếm màn hình khi thế giới tạm dừng (mở đầu, Scene 1, trưởng làng).
3. `battle`: trận đấu trên bản đồ, kể cả hiệu ứng vào trận.
4. `world`: đi lại, sự kiện NPC, hộp thoại lưu game.

Click/chạm cũng đi theo thứ tự đó (`GameplayHost.pointer`). Host không dùng DOM nên chạy được trong test Node. Các hệ thống sau này (Story VM, panel mới, shop) cắm vào thành lớp mới trong thứ tự này.

`src/dev/gameplayTrace.test.ts` chạy 8 kịch bản chơi và so trạng thái từng tick với bản ghi `src/dev/__fixtures__/gameplay-trace.json` (ghi trước khi tách host). Khi cố ý đổi hành vi gameplay, ghi lại bằng `VQSV_RECORD_TRACE=1 npx vitest run src/dev/gameplayTrace.test.ts` và xem diff của file đó.

## So khớp với Java (trace)

`src/dev/javaTrace.test.ts` chạy cùng kịch bản với bản Java và so từng tick: event, scene/room, camera, chữ đang hiện, actor đang hiện (vị trí, hướng, trạng thái, frame). Trace Java là dữ liệu đã ghi sẵn trong `oracle/traces/<tên>.java.json`, nên `npm test` không cần Java.

- Các chỗ còn lệch được tóm tắt trong `oracle/traces/<tên>.divergence.json` (với mỗi trường: tick đầu tiên lệch, số tick lệch, giá trị hai bên). Test báo lỗi khi bản tóm tắt này thay đổi, nên sửa được một chỗ lệch hay làm lệch thêm đều hiện ra thành diff.
- Sau khi sửa: `VQSV_RECORD_DIVERGENCE=1 npx vitest run src/dev/javaTrace.test.ts`. Muốn xem trace web từng tick thì thêm `VQSV_WRITE_WEB_TRACE=1` (file `*.web.json` không commit).
- Ghi lại trace Java (cần JDK 21 và font Tahoma như ở trên, chạy từ thư mục `VQSV-Test`):

```bash
find rebuild_game/src/main/java -name '*.java' > sources.txt
javac -encoding UTF-8 -nowarn -d build/classes @sources.txt VQSV-WebNative/rebuild_game/tools/RecordGameplayTrace.java
java -Djava.awt.headless=true -Dvqsv.modules=modules -cp build/classes:rebuild_game/src/main/resources \
  vqsv.game.RecordGameplayTrace VQSV-WebNative/web-native/oracle/traces/opening.java.json opening 3000
```

### Chỗ JavaSE khác dữ liệu gốc

Một số cảnh trong bản JavaSE được viết tay và khác dữ liệu sự kiện gốc (ví dụ phần mở đầu `Scene0IntroScript`). Những chỗ khác này được ghi thành `patches` ngay trong route ở `public/pack/story/routes.json`. Mỗi patch có vị trí, nội dung gốc mong đợi (`expect`) và lý do (`why`). Nếu dữ liệu gốc thay đổi làm patch không còn khớp, quá trình biên dịch route sẽ báo lỗi chứ không âm thầm lệch.

## Buff/debuff bản web

Bản web chạy buff/debuff theo mô tả trong dữ liệu mới, không theo đúng JavaSE. Phần khác JavaSE nằm ở `public/pack/data/battle/status-web-rules.json` (viết tay, mỗi luật có `note`; chỗ mô tả chưa nói rõ được ghi là "Design decision"). `src/game/battle/StatusWebRules.ts` đọc file này.

- `loadBattleRules(data)` bật luật web: trận thật luôn dùng cách này.
- `loadBattleRules(data, { web: false })` trả về công thức Java nguyên bản. Các test golden so với Java dùng cách này.
- `src/game/battle/StatusWebRules.test.ts` kiểm từng luật: Gieo Hạt, Khôi phục, Thực Loại, Hủ Thực, Súc Lực, Gia Tốc, Hóa Đá, Ngủ, Tê Liệt, Quỷ Mị, Hỗn Loạn, Điện áp, Giam Cầm.

## Nhịp game

Mỗi tick 66 ms. Khi bị trễ dưới 1 bước, game chạy bù tối đa một tick. Khi trễ hơn thế (máy chậm, tab bị ẩn), game đồng bộ lại lịch tick chứ không chạy dồn các tick bị lỡ.

## Save

- Lưu trong IndexedDB với hai slot: `active` và `backup`.
- Schema hiện tại là v24 (`persistence/save/GameSave.ts`), không gắn với chương nào.
  - `location`: vị trí người chơi.
  - `resume.owner`: runtime sẽ tiếp tục khi load, ví dụ `scene1.bunny-capture`.
  - `progress`: tiến độ nhiệm vụ.
  - `story[<chương>]`: trạng thái riêng của từng chương.
  - Ngoài ra còn `world`, `eventStates`, `inventory`, `pets`.
- Khi lưu: kiểm tra dữ liệu, chuyển save cũ sang backup trong cùng một lần ghi, đọc lại và so sánh toàn bộ.
- Khi tải: tự migrate từ schema cũ (v23 lên v24); nếu save chính hỏng thì dùng backup.
- Đổi schema: thêm `MIGRATIONS[n]` trong `save/migrations.ts`, tăng `CURRENT_SAVE_VERSION`, thêm fixture test.

## Font

- Chữ trước đây vẽ bằng font hệ thống (Arial) nay dùng font gốc của game, `public/pack/font/font.bin`. Font được giải mã ngay lúc chạy bằng `rendering/font/SourceFont.ts`.
- Bảng chữ trong các panel (`font/panel.png`) là ảnh atlas đã bake sẵn.
- Không chỗ nào vẽ chữ bằng font của hệ điều hành, nên chữ hiển thị giống hệt nhau trên mọi máy.
- Chỗ xuống dòng, cách chia trang hộp thoại (4 dòng) và thời gian gõ chữ theo đúng JavaSE (`rendering/text/TextLayout.ts`). Bản Java đo các thứ này bằng độ rộng font Tahoma 9, nên bảng độ rộng được xuất sẵn vào `public/pack/font/text-metrics.json` bằng `rebuild_game/tools/ExportTextMetrics.java`. Khi xuất lại cần có Tahoma: trên Linux, chép `tahoma.ttf` vào `~/.fonts`. Không có Tahoma thì tool sẽ dừng, vì AWT tự đổi sang font khác và mọi độ rộng sẽ sai.

## Công cụ tùy chọn (cần source pack bên cạnh)

Các lệnh dưới đây chỉ dùng khi muốn tạo lại dữ liệu trong `public/pack`, hoặc so khớp với bản Java. Mặc định chúng đọc từ `../modules` và `../rebuild_game`; có thể đổi đường dẫn bằng biến `VQSV_SOURCE_PACK`.

```bash
npm run export:story-data | export:map-collision | export:font
npm run test:oracle          # kiểm tra trong oracle/: so pack với source Java
npm run oracle:verify-pack   # kiểm tra provenance của bản bake Java
```
