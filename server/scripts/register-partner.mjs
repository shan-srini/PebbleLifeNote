#!/usr/bin/env node
/**
 * Obtain a partner client_credentials token and register this app domain with Tesla Fleet API.
 * @see https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register
 * @see https://developer.tesla.com/docs/fleet-api/authentication/partner-tokens
 */
const clientId = process.env.TESLA_CLIENT_ID;
const clientSecret = process.env.TESLA_CLIENT_SECRET;
const domain =
  process.argv[2] ?? process.env.PARTNER_DOMAIN ?? process.env.REGISTER_DOMAIN;
const fleetBase =
  process.env.FLEET_API_BASE ??
  'https://fleet-api.prd.na.vn.cloud.tesla.com';
const authUrl =
  process.env.FLEET_AUTH_URL ??
  'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token';
const scope =
  process.env.TESLA_PARTNER_SCOPE ??
  'openid vehicle_device_data vehicle_cmds vehicle_charging_cmds';

if (!clientId || !clientSecret) {
  console.error(
    'Set TESLA_CLIENT_ID and TESLA_CLIENT_SECRET (Tesla Developer portal app credentials).'
  );
  process.exit(1);
}
if (!domain) {
  console.error(
    'Pass domain as first argument or set PARTNER_DOMAIN (host only, e.g. myhost.example.com).'
  );
  process.exit(1);
}

async function fetchPartnerAccessToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    audience: fleetBase.replace(/\/+$/, ''),
    scope
  });
  const res = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('Partner token request failed:', res.status, text);
    process.exit(1);
  }
  const json = JSON.parse(text);
  if (!json.access_token) {
    console.error('No access_token in token response:', text);
    process.exit(1);
  }
  return /** @type {string} */ (json.access_token);
}

async function main() {
  const accessToken = await fetchPartnerAccessToken();
  console.log('Fetched partner access token.');

  const registerUrl = new URL('/api/1/partner_accounts', fleetBase);
  const regRes = await fetch(registerUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ domain })
  });
  const regText = await regRes.text();
  console.log('POST /api/1/partner_accounts →', regRes.status, regText);
  if (!regRes.ok) {
    process.exit(1);
  }

  const verifyUrl = new URL(
    `/api/1/partner_accounts/public_key?domain=${encodeURIComponent(domain)}`,
    fleetBase
  );
  const vRes = await fetch(verifyUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });
  const vText = await vRes.text();
  console.log('GET public_key →', vRes.status, vText);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
