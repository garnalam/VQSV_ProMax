# VQSV ProMax: tài khoản và save trên VPS

Game: https://vqsv-promax.103.161.180.82.sslip.io

Backend Node.js 24.22.1 dùng SQLite; Caddy phục vụ HTTPS, game và API cùng origin. Gameplay vẫn chạy trên trình duyệt. Backend xác thực tài khoản, phân quyền và kiểm tra cấu trúc save; không xác minh rằng tiền/pet là kết quả chơi hợp lệ.

## Dựng từ source

Chạy `npm ci`, `npm run build`, `node --test server/app.test.mjs`, `npm test`.
Trên VPS, trong `/opt/vqsv-promax`, chạy `docker compose up -d --build`.

`compose.yaml` và `Caddyfile` chứa hostname triển khai. Khi đổi tên miền, thay cả hostname Caddy và PUBLIC_ORIGIN trong Compose. Backend chỉ nhận mutation từ đúng Origin này; không mở cổng database hoặc backend ra Internet.

## Chơi và lưu

Mở link game để đăng nhập hoặc đăng ký bằng email và mật khẩu tối thiểu 8 ký tự. Sau khi đăng nhập, menu gốc hiện **Chơi mới** và thêm **Chơi tiếp** nếu tài khoản đã có bản lưu hợp lệ. Dùng mục **Lưu dữ liệu** trong menu game hoặc lời nhắc lưu có sẵn.

Nếu hai tab cùng chơi, máy chủ từ chối bản ghi dùng revision cũ. Hãy quay lại màn hình đầu hoặc tải lại trang, đăng nhập và chọn **Chơi tiếp** để đọc bản đã lưu mới nhất. Đăng xuất tại `/account.html` sau khi game báo lưu xong. Phiên đăng nhập hết hạn sau 7 ngày.

## Dữ liệu và vận hành

Database nằm tại `/data/game.sqlite` trong volume `vqsv-promax_game_data`. Mật khẩu được hash scrypt, token phiên chỉ được lưu dạng hash. Save có một bản trước để khôi phục khi bản chính không dùng được. Không có dữ liệu người chơi cũ được nhập vào bản mới.

`docker compose ps` xem tình trạng dịch vụ; `docker compose logs --tail=100 backend` xem lỗi backend không chứa mật khẩu/token; `docker compose restart backend` khởi động lại API và giữ dữ liệu. Không chạy `docker compose down -v` khi muốn giữ người chơi: tùy chọn `-v` xóa volume.

API: `/api/auth/register`, `/login`, `/me`, `/logout` (các đường dẫn auth đều có tiền tố `/api/auth`); `/api/saves` và `/api/saves/:id`, `/api/saves/:id/backup`. Health: `/api/health`. Save JSON schema v33, tối đa 2 MiB; multipart upload dùng `file`, `gameVersion=web-native`, và `revision` khi cập nhật.

Không có email khôi phục mật khẩu, trang quản trị, backup theo lịch hay cơ chế chống gian lận gameplay trong bản đầu. Hostname sslip.io là địa chỉ tạm và có thể thay bằng tên miền riêng.
