# PebbleTesla setup

## 1. Tesla Developer / Fleet

- Create a Fleet API application and note **Client ID**.
- Set **redirect URI** to your Funnel HTTPS URL including path, e.g. `https://<funnel-host>/oauth/callback` (must match `CONFIG.redirectPath` in `src/pkjs/index.js` and `PUBLIC_CALLBACK_PATH` on the Pi).
- Register the **public key** URL served by the Pi (see [server/README.md](server/README.md)) per Tesla’s Fleet registration steps. The URL must match where you actually host the PEM (see §2).

## 2. Fleet API key pair (ECDSA)

Tesla expects a **PEM-encoded EC key on the P-256 curve (`prime256v1`)** for partner registration and vehicle virtual-key / command signing. Official guidance: [Fleet API — Developer Guide](https://developer.tesla.com/docs/fleet-api/virtual-keys/developer-guide) and [What is Fleet API?](https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api).

### 2.1 Generate private and public PEM files

On a **trusted machine** (your laptop or the Pi), with **OpenSSL**:

```bash
mkdir -p ~/tesla-fleet-keys && cd ~/tesla-fleet-keys
openssl ecparam -name prime256v1 -genkey -noout -out private-key.pem
openssl ec -in private-key.pem -pubout -out public-key.pem
chmod 600 private-key.pem
chmod 644 public-key.pem
```

- **`private-key.pem`**: keep **secret**; use for command signing and any flows that need the app private key. **Never** commit it, **never** put it on a public URL, and back it up somewhere safe (password manager, encrypted backup).
- **`public-key.pem`**: safe to publish; this is what Tesla fetches over HTTPS for registration.

### 2.2 Where Tesla expects the public key (recommended URL)

Tesla’s docs register the key at a fixed **well-known** path on **your** HTTPS origin (the same host you use with Funnel):

```text
https://<your-funnel-host>/.well-known/appspecific/com.tesla.3p.public-key.pem
```

For PebbleTesla’s Docker defaults (`PUBLIC_KEY_PATH` / `PUBLIC_KEY_FILE`), you can either:

**Option A — match Tesla’s path (recommended for registration):**

Copy the public PEM into your mounted `/data` directory under the filename Tesla expects, and set env vars so the Go server serves it at that URL path (example filenames):

```bash
cp public-key.pem /srv/pebbletesla/data/com.tesla.3p.public-key.pem
```

In `server/.env` (or `environment` in compose):

```bash
PUBLIC_KEY_PATH=/.well-known/appspecific/com.tesla.3p.public-key.pem
PUBLIC_KEY_FILE=/data/com.tesla.3p.public-key.pem
```

**Option B — PebbleTesla defaults (`/tesla/public_key.pem`):**

Copy as:

```bash
cp public-key.pem /srv/pebbletesla/data/public_key.pem
```

Then register **`https://<funnel-host>/tesla/public_key.pem`** in the Tesla Developer portal so it matches [server/README.md](server/README.md) defaults. If Tesla’s registration UI or API requires the well-known path, use option A.

### 2.3 After the public URL works

- Use the public key URL and your **Client ID** / domain in Tesla’s **partner / register** flow as documented for your region.
- Store **`private-key.pem`** on the Pi (or only where you will add signing later), e.g. `chmod 600` under `/srv/pebbletesla/` **outside** the public web root, and keep it out of git (see [server/.gitignore](server/.gitignore) and `*.pem` in the repo root `.gitignore`).

## 3. Raspberry Pi: Docker, build, and run the server

These steps assume a **64-bit Raspberry Pi OS** (or another ARM64 Linux) on your Pi, with **Docker Engine** and **Docker Compose** (`docker compose`, v2 plugin) **already installed**, and your user able to run `docker` (e.g. in the `docker` group or via `sudo`). The app is started with [server/docker-compose.yml](server/docker-compose.yml). For generating keys in §2 you still need **`openssl`** on whatever machine you use.

### 3.1 Get the project and build the image on the Pi

On your dev machine, copy the repo to the Pi (for example with `rsync` or `git clone`). Then on the Pi:

```bash
cd /path/to/PebbleTesla/server
```

Create `server/.env` (do not commit it) with at least:

```bash
SHARED_SECRET=your-long-random-secret
FLEET_API_BASE=https://fleet-api.prd.na.vn.cloud.tesla.com
```

Use the **EU** Fleet host if your Tesla app is registered in Europe (see Tesla Fleet docs).

Place the **public key** file from §2 on the Pi where the container can read it (example using defaults + bind mount):

```bash
sudo mkdir -p /srv/pebbletesla/data
sudo cp /path/from/section-2/public-key.pem /srv/pebbletesla/data/public_key.pem
sudo chown -R "$USER:$USER" /srv/pebbletesla/data
```

If you use Tesla’s well-known filename instead, copy to `com.tesla.3p.public-key.pem` and set `PUBLIC_KEY_FILE` / `PUBLIC_KEY_PATH` as in §2.2.

Use a small override so `/data` in the container is that directory. Create `server/docker-compose.override.yml` next to `docker-compose.yml`:

```yaml
services:
  pebbletesla:
    volumes:
      - /srv/pebbletesla/data:/data
```

Docker Compose merges `docker-compose.yml` and `docker-compose.override.yml` automatically.

Build and start:

```bash
cd /path/to/PebbleTesla/server
docker compose up -d --build
```

Confirm the process is listening:

```bash
curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/oauth/callback
curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:9000/v1/oauth/poll
```

(Expect non-500 responses; exact codes depend on query/body.) Check logs with `docker compose logs -f`.

### 3.2 PKJS endpoints from the phone

- **`tailnetBase`**: URL your **phone** uses on Tailscale to reach the Pi’s **9000** port, e.g. `http://raspberrypi:9000` or `http://<MagicDNS-name>:9000` (same tailnet as the Pi).
- **`funnelBase`**: Public **HTTPS** base you expose with Funnel (next section), must match Tesla **redirect URI** and must reach **8080** on the Pi (OAuth callback + public key only).

## 4. Tailscale and Funnel on the Pi

### 4.1 Install Tailscale and join your tailnet

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Complete browser login if prompted. In the [Tailscale admin console](https://login.tailscale.com/admin/machines), enable **MagicDNS** if you want hostnames like `raspberrypi.your-tailnet.ts.net`.

Ensure your **phone** is on the same tailnet so PKJS can call `tailnetBase` on port **9000**. Restrict who can reach the Pi with [Tailscale ACLs](https://tailscale.com/kb/1018/acls) if you like.

### 4.2 Enable Funnel for your tailnet

Funnel must be allowed for your domain. In the admin console, check **DNS → Tailscale domain** / **HTTPS**, and under **Funnel** (or **App connectors** / policy), enable Funnel per [Tailscale Funnel documentation](https://tailscale.com/kb/1223/funnel). Exact labels move between releases; if Funnel is disabled, CLI commands below will error until an admin enables it.

### 4.3 Publish only the public HTTP listener (port 8080)

The Go server’s **8080** listener serves the OAuth **redirect** and the **public key** path. Point Funnel at that port, **not** at 9000 (tailnet-only API).

On the Pi, after Docker is up and listening on `127.0.0.1:8080`:

```bash
sudo tailscale funnel --bg 8080
```

That exposes your node’s HTTPS Funnel URL and reverse-proxies to **`http://127.0.0.1:8080`** (see [Tailscale Funnel examples](https://tailscale.com/docs/reference/examples/funnel)). If your CLI prefers an explicit target, use `sudo tailscale funnel --bg http://127.0.0.1:8080` per `tailscale funnel --help`.

Use **`tailscale serve`** only for tailnet-only exposure; **Funnel** is what makes the URL reachable from the public internet for Tesla’s redirect.

Note the **HTTPS base URL** printed by the command (e.g. `https://<machine>.<tailnet>.ts.net`). Set PKJS **`funnelBase`** to that origin **without a trailing slash**, and keep **`redirectPath`** (`/oauth/callback`) aligned with Tesla and `PUBLIC_CALLBACK_PATH`.

Verify the public key is reachable over the internet (replace with your real path from §2):

```bash
curl -fsS "https://<funnel-host>/.well-known/appspecific/com.tesla.3p.public-key.pem" | head
# or, if using PebbleTesla defaults:
curl -fsS "https://<funnel-host>/tesla/public_key.pem" | head
```

Register in the Tesla Developer portal:

- **Redirect URI** = `https://<funnel-host>/oauth/callback` (path must match).
- **Public key URL** = the HTTPS URL where your PEM is actually served (must match §2 and `PUBLIC_KEY_PATH`).

### 4.4 Firewall on the Pi

- **Do not** publicly expose **9000**; only the phone (Tailscale) should use it.
- UFW example: allow SSH and Tailscale; **do not** `allow 9000` from the internet. Docker publishes **8080** and **9000** to all interfaces by default; binding **9000** to `127.0.0.1` only would require extra Docker/iptables setup—relying on **Tailscale ACLs** and **not port-forwarding 9000** on your router is the usual approach.

## 5. PebbleKit JS (`src/pkjs/index.js`)

Edit the `CONFIG` object at the top of the file:

| Field | Example | Purpose |
|-------|---------|---------|
| `clientId` | Tesla app client ID | OAuth |
| `funnelBase` | `https://<your-funnel-host>` | Tesla **redirect_uri** + public key; HTTPS only |
| `tailnetBase` | `http://raspberrypi:9000` | Pi **tailnet** API (tokens + `/proxy`); use MagicDNS name |
| `sharedSecret` | Same as Pi `SHARED_SECRET` | `X-PebbleTesla-Secret` header |
| `redirectPath` | `/oauth/callback` | Path on `funnelBase`; must match Tesla and Pi |

Rebuild the watchapp after changes (`pebble build`).

## 6. Watch

Install `build/PebbleTesla.pbw` with the Rebble phone app. Use **Up** (and **Select**) to refresh, **Down** to open the **actions menu**, and run **Tesla login** once so OAuth completes in the phone browser (Funnel callback + tailnet poll must work).

## 7. Limitations

- Fleet **vehicle commands** may require extra signing beyond Bearer forwarding; see [server/README.md](server/README.md). If Tesla rejects `POST .../command`, extend the Go proxy or use Tesla’s official signing tooling.
- `CONFIG` is embedded in PKJS; treat the shared secret like a password when distributing binaries.
- **Tailscale CLI** flags for Funnel change between releases; run `tailscale funnel --help` and `tailscale serve --help` on the Pi and follow [Tailscale’s current Funnel docs](https://tailscale.com/kb/1223/funnel) if a command fails.
