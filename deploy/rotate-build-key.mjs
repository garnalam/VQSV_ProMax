// Run on the server before every `docker compose ... up -d --build`: puts a new random save
// envelope build key first in deploy/build-keys.txt and keeps the one before it, so a tab still
// running the previous build can save once more before it is asked to reload.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), 'build-keys.txt');
const old = existsSync(file) ? readFileSync(file, 'utf8').split(/\s+/).filter(line => /^[0-9a-f]{64}$/.test(line)) : [];
writeFileSync(file, [randomBytes(32).toString('hex'), ...old.slice(0, 1)].join('\n') + '\n', { mode: 0o600 });
console.log('build key rotated; keys kept:', Math.min(old.length, 1) + 1);
