import { Store } from './store.mjs';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Cách dùng: node server/grant-admin.mjs email-cua-admin');
  process.exit(2);
}
const store = new Store(process.env.DB_PATH || '/data/game.sqlite');
try {
  if (store.grantAdmin(email)) console.log('Đã cấp quyền quản trị.');
  else {
    console.error('Chưa có tài khoản này hoặc tài khoản đang bị khóa.');
    process.exitCode = 1;
  }
} finally {
  store.close();
}
