#!/usr/bin/env node
/**
 * Generate EC P-256 (prime256v1 / secp256r1) key pair for Tesla Fleet command signing.
 * Public PEM is served at /.well-known/appspecific/com.tesla.3p.public-key.pem
 * @see https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const keysDir =
  process.env.KEYS_DIR ?? join(__dirname, '..', 'tesla-fleet-keys');

mkdirSync(keysDir, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

const pubPath = join(keysDir, 'com.tesla.3p.public-key.pem');
const privPath = join(keysDir, 'com.tesla.3p.private-key.pem');

writeFileSync(pubPath, publicKey, { mode: 0o644 });
writeFileSync(privPath, privateKey, { mode: 0o600 });

console.log(`Wrote public key:  ${pubPath}`);
console.log(`Wrote private key: ${privPath}`);
console.log(
  'Host only the public PEM over HTTPS; keep the private key on the server (not in git).'
);
