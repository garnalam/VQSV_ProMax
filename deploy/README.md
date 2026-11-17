# Deploy VQSV ProMax lên server riêng

Server: `root@103.161.180.82`, repo ở `/root/VQSV_ProMax`. Game chạy tại
https://hoisinhvqsv.online (www và địa chỉ sslip cũ tự chuyển về đây)

- `backend` (`server/`): tài khoản, phiên đăng nhập, save, admin (`/api/*`). Dùng SQLite có sẵn
  trong Node, file `/data/game.sqlite` nằm trong volume Docker `vqsv-promax_game_data`.
- `web`: Caddy (HTTPS tự động) phục vụ bản game build từ repo này và chuyển `/api/*` sang backend.
- Trang quản trị: https://hoisinhvqsv.online/admin/ (mã ở `admin/index.html` + `src/admin/`, API ở
  `server/admin.mjs`; chỉ tài khoản admin vào được):
  - Tổng quan: số liệu, biểu đồ 14 ngày, bảng xếp hạng, sao lưu và tải file `.sqlite`.
  - Người chơi: tìm/sắp xếp; khóa, cấp/thu admin, đăng xuất mọi nơi, đặt mật khẩu mới;
    sửa save (tiền, huy hiệu, VIP/XP Thẻ Fan Cứng, hành trang, xóa pet ngân hàng, JSON thô),
    tải/nạp/khôi phục save. Sửa save dùng If-Match nên không ghi đè khi người chơi vừa lưu.
  - Giftcode: tạo/sửa/tắt/xóa mã dùng chung (tiền, huy hiệu, vật phẩm, pet), giới hạn lượt,
    thời gian mở/hết hạn, xem ai đã nhập. Người chơi nhập ở mục Giftcode trong game.
  - Gửi quà: vào hộp thư của 1 người hoặc tất cả; game nhận trong ~30 giây khi đứng tự do
    trên bản đồ; thu hồi quà chưa nhận.
  - Nhật ký mọi thao tác quản trị.

## Cập nhật bản mới

```bash
cd /root/VQSV_ProMax
git pull
sh deploy/deploy.sh
```

`deploy.sh` tạo khóa phong bì save mới (`deploy/build-keys.txt`, giữ khóa của bản trước để tab cũ
lưu được thêm một lần) rồi build và khởi động lại. Không dùng thẳng `docker compose ... up` nữa:
thiếu file khóa thì game và backend dùng khóa dev, ai đọc mã nguồn cũng biết.

Build trên server chỉ chạy `vite build` (máy 2 GB không đủ RAM cho `tsc -b`), nên hãy chạy
`npm run build` và `npm test` trên máy dev trước khi push.

## Lệnh hay dùng

```bash
docker compose -f deploy/compose.yaml ps                 # trạng thái
docker compose -f deploy/compose.yaml logs -f backend    # log backend
docker compose -f deploy/compose.yaml restart            # khởi động lại
docker compose -f deploy/compose.yaml exec backend node server/grant-admin.mjs email@cua-admin
```

## Sao lưu database

```bash
d=/var/lib/docker/volumes/vqsv-promax_game_data/_data
docker compose -f deploy/compose.yaml stop backend
mkdir -p /root/vqsv-db-backup/$(date +%F) && cp -a $d/game.sqlite* /root/vqsv-db-backup/$(date +%F)/
docker compose -f deploy/compose.yaml start backend
```

## Test backend

```bash
docker run --rm -v $PWD:/app -w /app node:24.22.1-bookworm-slim node --test server/app.test.mjs
```
