import { createApplication } from './app.mjs';

const origin = process.env.PUBLIC_ORIGIN;
if (!origin || new URL(origin).origin !== origin || !origin.startsWith('https://'))
  throw new Error('PUBLIC_ORIGIN must be a canonical HTTPS origin');
const app = createApplication({
  databasePath: process.env.DB_PATH || '/data/game.sqlite', origin,
  trustedProxy: true, secureCookies: true,
});
app.server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('VQSV save backend listening'));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => void app.close().then(() => process.exit(0)));
