import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

/**
 * @param {import('./config.js').AppConfig} cfg
 * @param {import('./store.js').Store} store
 */
export function createPrivateApp(cfg, store) {
  const app = express();

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.path} ${Date.now() - start}ms`);
    });
    next();
  });

  function requireSecret(req, res, next) {
    if (!cfg.sharedSecret) {
      console.warn(
        'warning: SHARED_SECRET empty — private server routes are not authenticated'
      );
      return next();
    }
    if (req.get('X-PebbleTesla-Secret') !== cfg.sharedSecret) {
      return res.status(401).send('unauthorized');
    }
    next();
  }

  app.all('/v1/oauth/poll', requireSecret, (req, res) => {
    if (req.method !== 'GET') {
      return res.status(405).send('method');
    }
    const state = req.query.state;
    if (!state || typeof state !== 'string') {
      return res.status(400).send('missing state');
    }
    const code = store.takePendingCode(state);
    if (code === undefined) {
      return res.status(404).send('pending');
    }
    res.json({ code });
  });

  app.all(
    '/v1/tokens',
    requireSecret,
    (req, res, next) => {
      if (req.method !== 'POST') {
        return res.status(405).send('method');
      }
      next();
    },
    express.json({ limit: 1 << 20 }),
    (req, res) => {
      try {
        const b = req.body;
        store.setTokens({
          access_token: b.access_token,
          refresh_token: b.refresh_token,
          expires_at: b.expires_at
        });
        res.sendStatus(204);
      } catch (e) {
        res.status(500).send(e instanceof Error ? e.message : String(e));
      }
    }
  );

  const proxy = createProxyMiddleware({
    target: cfg.fleetApiBase,
    changeOrigin: true,
    on: {
      proxyReq(proxyReq) {
        const tok = store.getAccessToken();
        if (tok) proxyReq.setHeader('Authorization', `Bearer ${tok}`);
      },
      error(err, _req, res) {
        console.error('proxy error:', err);
        if ('writableEnded' in res && res.writableEnded) return;
        if (typeof res.writeHead === 'function') {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end(err instanceof Error ? err.message : String(err));
        }
      }
    }
  });

  app.use(cfg.proxyPrefix, requireSecret, proxy);

  app.use((err, _req, res, next) => {
    if (err instanceof SyntaxError || err?.type === 'entity.parse.failed') {
      return res.status(400).send(err.message);
    }
    next(err);
  });

  return app;
}
