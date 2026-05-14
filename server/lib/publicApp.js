import express from 'express';
import { readFileSync } from 'node:fs';
import { htmlEscape } from './htmlEscape.js';

/**
 * @param {import('./config.js').AppConfig} cfg
 * @param {import('./store.js').Store} store
 */
export function createPublicApp(cfg, store) {
  const app = express();

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.path} ${Date.now() - start}ms`);
    });
    next();
  });

  app.all(cfg.publicCallbackPath, (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    const errParam = req.query.error;
    if (errParam) {
      const desc = req.query.error_description ?? '';
      return res
        .status(400)
        .send(
          `${htmlEscape(String(errParam))}: ${htmlEscape(String(desc))}`
        );
    }
    if (code && state) {
      store.setPendingCode(String(state), String(code));
    }
    res.type('html');
    let body =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pebble Tesla</title></head><body>';
    if (code && state) {
      body +=
        '<p>Authorization received. You can return to the Pebble app on your phone.</p>';
      body += `<p style="word-break:break-all;font-size:12px">state=${htmlEscape(String(state))}</p>`;
    } else {
      body += '<p>Missing code or state in redirect.</p>';
    }
    body += '</body></html>';
    res.send(body);
  });

  if (cfg.publicKeyFile) {
    app.all(cfg.publicKeyPath, (_req, res) => {
      try {
        const b = readFileSync(cfg.publicKeyFile);
        res.type('application/x-pem-file');
        res.send(b);
      } catch {
        res.status(404).send('public key not configured');
      }
    });
  } else {
    console.warn(
      'warning: PUBLIC_KEY_FILE unset — public key route returns 404'
    );
    app.all(cfg.publicKeyPath, (_req, res) => {
      res.status(404).send('PUBLIC_KEY_FILE not set');
    });
  }

  return app;
}
