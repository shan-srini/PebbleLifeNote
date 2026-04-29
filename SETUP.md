# PebbleTesla setup

Concise reference aligned with [server/docker-compose.yml](server/docker-compose.yml), [server/main.go](server/main.go), and [src/pkjs/index.js](src/pkjs/index.js).

## Behavior (what the code does)

| Piece | Role |
|-------|------|
| **Watch** (`src/c/main.c`) | Sends command ints via AppMessage keys in `package.json`; never sees tokens. |
| **Phone PKJS** | PKCE OAuth (`CONFIG`); polls **`GET {tailnetBase}/v1/oauth/poll`**, posts tokens **`POST {tailnetBase}/v1/tokens`**, Fleet **`{tailnetBase}/proxy/...`** with header **`X-PebbleTesla-Secret`**. |
| **Container** ([docker-compose.yml](server/docker-compose.yml)) | Reads **`server/.env`** for **`${VAR}`** in `environment` + bind **`server/tesla-fleet-keys`** → **`/tesla-fleet-keys`**. Defaults **`TOKEN_FILE=/tesla-fleet-keys/tokens.json`**, **`PUBLIC_KEY_FILE=/tesla-fleet-keys/com.tesla.3p.public-key.pem`**. |
| **`PUBLIC_LISTEN :8080`** | OAuth callback (`PUBLIC_CALLBACK_PATH`, default `/oauth/callback`) + static PEM at Tesla’s URL path **`PUBLIC_KEY_PATH`** (default **`/.well-known/appspecific/com.tesla.3p.public-key.pem`**) from **`PUBLIC_KEY_FILE`**. |
| **`TAILNET_LISTEN :9000`** | Poll, tokens, Fleet reverse proxy under **`PROXY_PREFIX`** (default `/proxy`). Requires **`SHARED_SECRET`** on those routes when set. |

Host ports: **`PUBLIC_PORT:8080`** and **`TAILNET_PORT:9000`** (defaults in compose).

## Tesla Developer portal

- **Client ID** → PKJS `CONFIG.clientId`.
- **Redirect URI** = `{funnelBase}{redirectPath}` — defaults use **`/oauth/callback`** (`PUBLIC_CALLBACK_PATH` / `CONFIG.redirectPath`).
- **Allowed Origin** should be the HTTPS origin only (e.g. `https://example.com`), **no trailing slash**. **Allowed Redirect URI** must be the full callback URL, e.g. `https://example.com/oauth/callback` — not the site root alone.
- **“Domain is not valid”** (Tesla’s message also says the domain must be **registered with a CA**, must **not include “Tesla”**, and must **not be used with a reverse proxy**): **Tailscale Funnel is a reverse proxy**, so the portal can reject **`*.ts.net`** Funnel URLs even when HTTPS works. Funnel is not a viable **Allowed Origin / Redirect** host for Tesla’s form. Use your **own DNS name** with TLS terminated where Tesla expects (often **direct HTTPS to the Pi**: port forward + cert on the Pi, **without** Funnel for that hostname), set PKJS **`funnelBase`** to that **`https://…`** origin, and keep **`tailnetBase`** on Tailscale for phone→Pi. If you must use a VPS or nginx in front, Tesla may still flag it—try **direct-to-Pi** first or contact [Fleet API support](https://developer.tesla.com/docs/fleet-api#help-and-support).
- **Public key URL** must be **`{funnelBase}/.well-known/appspecific/com.tesla.3p.public-key.pem`** per [Tesla Fleet API](https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api). **`PUBLIC_KEY_FILE`** is only where the PEM lives on disk; it can differ from the URL path as long as the server serves the file at **`PUBLIC_KEY_PATH`**.

## EC key pair (Tesla Fleet)

```bash
openssl ecparam -name prime256v1 -genkey -noout -out private-key.pem
openssl ec -in private-key.pem -pubout -out com.tesla.3p.public-key.pem
chmod 600 private-key.pem
```

- **`com.tesla.3p.public-key.pem`** → place under **`server/tesla-fleet-keys/`** (default compose **`PUBLIC_KEY_FILE`**) so **`GET {funnelBase}/.well-known/appspecific/com.tesla.3p.public-key.pem`** returns it.
- **`private-key.pem`** → keep under **`server/tesla-fleet-keys/`** (gitignored); never expose over HTTP; used later for command signing (proxy today forwards Bearer only — see [server/README.md](server/README.md)).

**Populate keys:** PEMs and **`tokens.json`** live on the host under **`server/tesla-fleet-keys/`**; the container sees **`/tesla-fleet-keys/`**.

## Run the server (Docker already installed)

From repo **`server/`**:

1. Create **`server/.env`** (gitignored) — at minimum **`SHARED_SECRET=`** (same string PKJS uses). Optional: **`FLEET_API_BASE`**, **`PUBLIC_KEY_PATH`**, **`PUBLIC_KEY_FILE`**, **`TOKEN_FILE`** (see compose).
2. Add **`com.tesla.3p.public-key.pem`** (and optionally private material for signing) under **`server/tesla-fleet-keys/`**.
3. **`docker compose up -d --build`**

Logs: **`docker compose logs -f`**.

### Cloudflare Tunnel (custom domain → public listener)

Use this instead of Tailscale Funnel for PKJS **`funnelBase`** when Tesla requires your own domain.

1. Install **`cloudflared`** on the same machine that runs Docker and **`cloudflared tunnel login`** once.
2. Ensure **`docker compose`** is up so **`127.0.0.1:8080`** reaches the public listener (or set **`TARGET`** / **`PUBLIC_PORT`** to match).
3. From **`server/`**: **`./scripts/setup-cloudflare-tunnel.sh tesla.example.com`**
4. Run **`cloudflared tunnel --config ./cloudflared/config.yml run`** (or install a systemd service using the same command).

Set **`funnelBase`** to **`https://tesla.example.com`** (no trailing slash). **`tailnetBase`** stays on Tailscale (**`:9000`**).

## Tailscale + Funnel

- Join tailnet: **`tailscale up`** (phone must be on same tailnet for **`tailnetBase`**).
- PKJS **`tailnetBase`**: **`http://<pi-hostname>:<TAILNET_PORT>`** (default port **9000**).
- Expose **only** public listener for Tesla: **`sudo tailscale funnel --bg 8080`** (proxies to localhost **8080**, not 9000). Use the printed HTTPS origin as PKJS **`funnelBase`** (no trailing slash).

Verify PEM (must match Tesla’s path):

```bash
curl -fsS "https://<funnel-host>/.well-known/appspecific/com.tesla.3p.public-key.pem" | head -n 1
```

## PebbleKit JS

Edit **`CONFIG`** at top of [src/pkjs/index.js](src/pkjs/index.js):

| Field | Must match |
|-------|------------|
| `clientId` | Tesla app |
| `funnelBase` | Funnel HTTPS origin (port **8080** path space) |
| `tailnetBase` | `http://…:<TAILNET_PORT>` on tailnet |
| `sharedSecret` | `SHARED_SECRET` in `.env` |
| `redirectPath` | Tesla redirect + `PUBLIC_CALLBACK_PATH` (default **`/oauth/callback`**) |

Then **`pebble build`** and install **`build/PebbleTesla.pbw`**.

## Watch

**Up** / **Select** refresh; **Down** opens menu; **Tesla login** runs OAuth (browser hits Funnel → Pi stores code → PKJS polls tailnet).

## Caveats

Bearer-only Fleet proxy may not be enough for some **`POST …/command`** flows — extend server or add Tesla signing. Rotate **`SHARED_SECRET`** like a password.
