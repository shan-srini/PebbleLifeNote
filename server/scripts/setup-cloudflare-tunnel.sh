#!/usr/bin/env bash
# Point a Cloudflare Tunnel hostname at the PebbleTesla *public* listener (OAuth + Tesla PEM).
# Prerequisites: domain DNS on Cloudflare, cloudflared installed, "docker compose up" publishing 8080.
#
#   cloudflared tunnel login    # once, opens browser
#   ./scripts/setup-cloudflare-tunnel.sh tesla.example.com
#   cloudflared tunnel --config ./cloudflared/config.yml run
#
# Environment (optional):
#   TUNNEL_NAME   default: pebbletesla
#   TARGET        default: http://127.0.0.1:8080  (match PUBLIC_PORT / compose)
#   CONFIG_DIR    default: server/cloudflared

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOSTNAME="${1:-${HOSTNAME:-}}"
TUNNEL_NAME="${TUNNEL_NAME:-pebbletesla}"
TARGET="${TARGET:-http://127.0.0.1:${PUBLIC_PORT:-8080}}"
CONFIG_DIR="${CONFIG_DIR:-$ROOT/cloudflared}"

usage() {
	cat <<'EOF'
Usage: ./scripts/setup-cloudflare-tunnel.sh <hostname>
   or: HOSTNAME=tesla.example.com ./scripts/setup-cloudflare-tunnel.sh

Requires: cloudflared, python3, "cloudflared tunnel login" already done.
Optional env: TUNNEL_NAME (default pebbletesla), TARGET (default http://127.0.0.1:8080), CONFIG_DIR
EOF
	exit 1
}

[[ -n "${HOSTNAME}" ]] || usage

if ! command -v cloudflared >/dev/null 2>&1; then
	echo "Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
	exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
	echo "python3 is required to parse tunnel list output."
	exit 1
fi

mkdir -p "${CONFIG_DIR}"

if ! cloudflared tunnel list >/dev/null 2>&1; then
	echo "cloudflared is not logged in or tunnel list failed."
	echo "Run once: cloudflared tunnel login"
	exit 1
fi

set +e
python3 - "$TUNNEL_NAME" <<'PY'
import json, subprocess, sys
name = sys.argv[1]
p = subprocess.run(
    ["cloudflared", "tunnel", "list", "--output", "json"],
    capture_output=True,
    text=True,
)
if p.returncode != 0:
    sys.stderr.write(p.stderr or "cloudflared tunnel list failed\n")
    sys.exit(2)
data = json.loads(p.stdout or "[]")
if not isinstance(data, list):
    data = data.get("tunnels") or data.get("result") or []
for t in data:
    if t.get("name") == name:
        sys.exit(0)
sys.exit(1)
PY
tunnel_list_ec=$?
set -e
case "${tunnel_list_ec}" in
	0) ;;
	1)
		echo "Creating tunnel '${TUNNEL_NAME}'..."
		cloudflared tunnel create "${TUNNEL_NAME}"
		;;
	*)
		exit 1
		;;
esac

UUID="$(python3 - "$TUNNEL_NAME" <<'PY'
import json, subprocess, sys
name = sys.argv[1]
p = subprocess.run(
    ["cloudflared", "tunnel", "list", "--output", "json"],
    capture_output=True,
    text=True,
)
p.check_returncode()
data = json.loads(p.stdout or "[]")
if not isinstance(data, list):
    data = data.get("tunnels") or data.get("result") or []
for t in data:
    if t.get("name") == name:
        tid = t.get("id")
        if tid:
            print(tid)
            sys.exit(0)
print("Could not find tunnel id for name:", name, file=sys.stderr)
sys.exit(1)
PY
)"

CREDS="${HOME}/.cloudflared/${UUID}.json"
if [[ ! -f "${CREDS}" ]]; then
	echo "Expected credentials at ${CREDS} — check cloudflared tunnel create output."
	exit 1
fi

echo "Routing DNS: ${HOSTNAME} -> tunnel ${TUNNEL_NAME} (${UUID})"
if ! cloudflared tunnel route dns "${TUNNEL_NAME}" "${HOSTNAME}"; then
	echo ""
	echo "tunnel route dns failed (zone not in this account, or name already routed)."
	echo "In Cloudflare DNS, add a CNAME for ${HOSTNAME} targeting your tunnel if the dashboard prompts you,"
	echo "or fix permissions and re-run this script."
fi

CONF="${CONFIG_DIR}/config.yml"
cat >"${CONF}" <<EOF
tunnel: ${UUID}
credentials-file: ${CREDS}

ingress:
  - hostname: ${HOSTNAME}
    service: ${TARGET}
  - service: http_status:404
EOF

echo ""
echo "Wrote ${CONF}"
echo ""
echo "PebbleTesla must be listening on ${TARGET} (same host as cloudflared)."
echo "Start the tunnel:"
echo "  cloudflared tunnel --config ${CONF} run"
echo ""
echo "Then set PKJS funnelBase to: https://${HOSTNAME}"
echo "(no trailing slash — matches trimSlash() in src/pkjs/index.js)"
echo ""
echo "Optional systemd (run as root, adjust paths/user):"
echo "  ExecStart=/usr/local/bin/cloudflared tunnel --config ${CONF} run"
