# PebbleTesla server (Raspberry Pi)

Node.js (Express) service with two HTTP surfaces:

1. **Public server** — expose only via your HTTPS edge (e.g. Tailscale Funnel): OAuth `redirect_uri` and the static **Tesla public key** PEM. Do not expose token or proxy routes on this host.
2. **Private server** — token ingest, OAuth code poll, and Fleet **reverse proxy** (Bearer from stored tokens + optional path to add command signing later). Reachable only on your private network (e.g. VPN / LAN), not the public internet.

## Build (local)

```bash
cd server
npm install
npm start
```

## Keys and partner registration

Generate a **P-256** key pair (public key must match [Tesla’s hosted path](https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api)):

```bash
cd server
npm run create-keys
# or: KEYS_DIR=/path/to/dir npm run create-keys
```

After the public PEM is reachable at `https://<your-domain>/.well-known/appspecific/com.tesla.3p.public-key.pem`, register the domain with Tesla (partner client credentials from the Developer portal):

```bash
cd server
export TESLA_CLIENT_ID=...
export TESLA_CLIENT_SECRET=...
export FLEET_API_BASE=https://fleet-api.prd.na.vn.cloud.tesla.com   # your region
# optional: FLEET_AUTH_URL, TESLA_PARTNER_SCOPE
npm run register-partner -- mysubdomain.example.com
# or: PARTNER_DOMAIN=mysubdomain.example.com npm run register-partner
```

The script calls `POST /api/1/partner_accounts` then `GET /api/1/partner_accounts/public_key` to verify. See [Partner Endpoints — register](https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register) and [Partner Tokens](https://developer.tesla.com/docs/fleet-api/authentication/partner-tokens).

## Docker

Build and run with [Dockerfile](Dockerfile) and [docker-compose.yml](docker-compose.yml):

```bash
cd server
# cp .env.sample .env   # then edit .env (gitignored)
# Create server/.env with SHARED_SECRET, FLEET_API_BASE, etc. (Compose loads it for ${VAR} in docker-compose.yml)
docker compose up -d --build
```

- Maps **8080** (public server: OAuth callback + public key) and **9000** (private server: API + Fleet proxy). Override host ports with `PUBLIC_PORT` and `PRIVATE_PORT` in `.env` or the shell.
- **Secrets on disk:** bind-mount **`./tesla-fleet-keys`** → **`/tesla-fleet-keys`** in the container. Defaults: **`com.tesla.3p.public-key.pem`** (same basename [Tesla documents](https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api) for the public key URL) and **`tokens.json`** (override with `PUBLIC_KEY_FILE` / `TOKEN_FILE` in `.env`).

Ensure `ca-certificates` are present (included in the image) so outbound HTTPS to Tesla works.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PUBLIC_LISTEN` | `:8080` | Bind address for the **public** server (OAuth callback + public key) |
| `PRIVATE_LISTEN` | `:9000` | Bind address for the **private** server (token ingest, poll, Fleet proxy) |
| `PUBLIC_CALLBACK_PATH` | `/oauth/redirect` | Must match PKJS `CONFIG.redirectPath` and Tesla Developer **Allowed Redirect URI(s)** path |
| `PUBLIC_KEY_PATH` | `/.well-known/appspecific/com.tesla.3p.public-key.pem` | HTTP path (must match [Tesla’s required URL](https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api)) |
| `PUBLIC_KEY_FILE` | (empty in code; compose defaults `/tesla-fleet-keys/com.tesla.3p.public-key.pem`) | Filesystem path to PEM bytes served at `PUBLIC_KEY_PATH` |
| `FLEET_API_BASE` | `https://fleet-api.prd.na.vn.cloud.tesla.com` | Set EU/NA host per your Tesla app region |
| `PROXY_PREFIX` | `/proxy` | PKJS calls `privateBase + /proxy + /api/1/...` |
| `SHARED_SECRET` | (empty) | `X-PebbleTesla-Secret` for **all** private-server routes; set in production |
| `TOKEN_FILE` | `tokens.json` | Where OAuth tokens are stored (mode 0600); compose defaults `/tesla-fleet-keys/tokens.json` |

## Public HTTPS edge (e.g. Funnel)

- Public base: `https://<your-public-host>` (HTTPS).
- Register in Tesla Developer portal: `redirect_uri` = `https://<public-host><PUBLIC_CALLBACK_PATH>`.
- Public key URL: `https://<public-host><PUBLIC_KEY_PATH>` (must match what you register with Tesla).

## Private server (phone → Pi on your network)

- Set `PRIVATE_LISTEN` and point PKJS `CONFIG.privateBase` at the Pi (e.g. `http://raspberrypi:9000` or `http://100.x.x.x:9000` on a VPN).
- All requests to `/v1/*` and `/proxy/*` should send `X-PebbleTesla-Secret: <SHARED_SECRET>` when set.

## OAuth flow (with Pebble phone app)

1. PKJS opens Tesla authorize with `redirect_uri` = public HTTPS callback URL.
2. Browser hits the public server → `GET <PUBLIC_CALLBACK_PATH>?code=...&state=...` → server stores `code` by `state`.
3. PKJS polls `GET <privateBase>/v1/oauth/poll?state=...` with shared secret.
4. PKJS exchanges `code` at Tesla token endpoint, then `POST <privateBase>/v1/tokens` to the Pi.
5. PKJS uses `GET/POST <privateBase>/proxy/...` for Fleet; Pi adds `Authorization: Bearer` from `tokens.json`.

## Command signing

This server **forwards** JSON command bodies to Fleet with the stored access token. Some Tesla Fleet command flows require **additional** request signing with your app private key; that is not implemented in this process yet. If Tesla returns errors on `POST .../command`, extend the proxy or use Tesla’s official command-signing tools and keep the private key only on this host.

## Files

- Run from a working directory writable for `TOKEN_FILE` (or set `TOKEN_FILE` to an absolute path on a mounted volume).
- Keep private keys and `tokens.json` off git (see `server/.gitignore`).
