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
- **Public key URL** must be **`{funnelBase}/.well-known/appspecific/com.tesla.3p.public-key.pem`** per [Tesla Fleet API](https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api) (defaults align with that). Register that exact HTTPS URL in the developer portal. **`PUBLIC_KEY_FILE`** is only where the PEM lives on disk; it can differ from the URL path as long as the server serves the file at **`PUBLIC_KEY_PATH`**.

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
