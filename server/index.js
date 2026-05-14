import http from 'node:http';
import { loadConfig } from './lib/config.js';
import { Store } from './lib/store.js';
import { createPublicApp } from './lib/publicApp.js';
import { createPrivateApp } from './lib/privateApp.js';

const cfg = loadConfig();

try {
  const u = new URL(cfg.fleetApiBase);
  if (!u.protocol || u.hostname === '') {
    throw new Error('invalid URL');
  }
} catch {
  console.error('invalid FLEET_API_BASE');
  process.exit(1);
}

const store = new Store({ tokenFile: cfg.tokenFile });
const publicApp = createPublicApp(cfg, store);
const privateApp = createPrivateApp(cfg, store);

const publicSrv = http.createServer(publicApp);
const privateSrv = http.createServer(privateApp);

publicSrv.listen(cfg.publicListen, () => {
  console.log(
    `public server ${cfg.publicListen} (OAuth callback + public key PEM)`
  );
});

privateSrv.listen(cfg.privateListen, () => {
  console.log(
    `private server ${cfg.privateListen} (token ingest + Fleet proxy)`
  );
});

function shutdown() {
  publicSrv.close();
  privateSrv.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
