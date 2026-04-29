# PebbleTesla server (Raspberry Pi)

Go service with two HTTP surfaces:

1. **Public (Tailscale Funnel)** — only map these paths in Funnel: OAuth `redirect_uri` and the static **Tesla public key** PEM. Do not expose token or proxy routes.
2. **Tailnet** — token ingest, OAuth code poll, and Fleet **reverse proxy** (Bearer from stored tokens + optional path to add command signing later).

## Build (local)

```bash
cd server
go build -o pebbletesla-server .
```

## Docker

Build and run with [Dockerfile](Dockerfile) and [docker-compose.yml](docker-compose.yml):

```bash
cd server
# optional: create .env with SHARED_SECRET, FLEET_API_BASE, etc.
docker compose up -d --build
```

- Maps **8080** (public: OAuth callback + public key) and **9000** (tailnet API + Fleet proxy). Override host ports with `PUBLIC_PORT` and `TAILNET_PORT` in `.env` or the shell.
- Persists **`tokens.json`** in the named volume `pebbletesla-data` mounted at `/data`.
- Place your Tesla **public key PEM** at `/data/public_key.pem` inside the volume (or set `PUBLIC_KEY_FILE` to another path). Example with a bind mount instead of the named volume:

```yaml
volumes:
  - ./data:/data
```

Ensure `ca-certificates` are present (included in the image) so outbound HTTPS to Tesla works.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PUBLIC_LISTEN` | `:8080` | Address for Funnel (callback + public key) |
| `TAILNET_LISTEN` | `:9000` | Address for phone on tailnet (bind to `100.x` or all interfaces + ACLs) |
| `PUBLIC_CALLBACK_PATH` | `/oauth/callback` | Must match PKJS `CONFIG.redirectPath` and Tesla Developer `redirect_uri` path |
| `PUBLIC_KEY_PATH` | `/tesla/public_key.pem` | URL path for your registered public key |
| `PUBLIC_KEY_FILE` | (empty) | Filesystem path to PEM to serve at `PUBLIC_KEY_PATH` |
| `FLEET_API_BASE` | `https://fleet-api.prd.na.vn.cloud.tesla.com` | Set EU/NA host per your Tesla app region |
| `PROXY_PREFIX` | `/proxy` | PKJS calls `tailnet + /proxy + /api/1/...` |
| `SHARED_SECRET` | (empty) | `X-PebbleTesla-Secret` for **all** tailnet routes; set in production |
| `TOKEN_FILE` | `tokens.json` | Where OAuth tokens are stored (mode 0600) |

## Funnel

- Public base: `https://<your-funnel-host>` (HTTPS).
- Register in Tesla Developer portal: `redirect_uri` = `https://<funnel-host><PUBLIC_CALLBACK_PATH>`.
- Public key URL: `https://<funnel-host><PUBLIC_KEY_PATH>` (must match what you register with Tesla).

## Tailnet (phone → Pi)

- Set `TAILNET_LISTEN` and use Pi MagicDNS or `100.x` in PKJS `CONFIG.tailnetBase` (e.g. `http://raspberrypi:9000`).
- All requests to `/v1/*` and `/proxy/*` should send `X-PebbleTesla-Secret: <SHARED_SECRET>` when set.

## OAuth flow (with Pebble phone app)

1. PKJS opens Tesla authorize with `redirect_uri` = Funnel callback URL.
2. Browser hits Funnel → `GET <PUBLIC_CALLBACK_PATH>?code=...&state=...` → server stores `code` by `state`.
3. PKJS polls `GET http://<tailnet>/v1/oauth/poll?state=...` with shared secret.
4. PKJS exchanges `code` at Tesla token endpoint, then `POST /v1/tokens` to Pi.
5. PKJS uses `GET/POST http://<tailnet>/proxy/...` for Fleet; Pi adds `Authorization: Bearer` from `tokens.json`.

## Command signing

This server **forwards** JSON command bodies to Fleet with the stored access token. Some Tesla Fleet command flows require **additional** request signing with your app private key; that is not implemented in this binary yet. If Tesla returns errors on `POST .../command`, extend the proxy or use Tesla’s official command-signing tools and keep the private key only on this host.

## Files

- Run from a working directory writable for `TOKEN_FILE`.
- Keep private keys and `tokens.json` off git (see `server/.gitignore`).
