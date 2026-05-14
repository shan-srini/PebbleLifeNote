function getenv(key, def) {
  const v = process.env[key];
  return v !== undefined && v !== '' ? v : def;
}

/**
 * @typedef {{
 *   publicListen: string,
 *   privateListen: string,
 *   publicCallbackPath: string,
 *   publicKeyPath: string,
 *   publicKeyFile: string,
 *   fleetApiBase: string,
 *   proxyPrefix: string,
 *   sharedSecret: string,
 *   tokenFile: string
 * }} AppConfig
 */

/** @returns {AppConfig} */
export function loadConfig() {
  return {
    publicListen: getenv('PUBLIC_LISTEN', ':8080'),
    privateListen: getenv('PRIVATE_LISTEN', ':9000'),
    publicCallbackPath: getenv('PUBLIC_CALLBACK_PATH', '/oauth/redirect'),
    publicKeyPath: getenv(
      'PUBLIC_KEY_PATH',
      '/.well-known/appspecific/com.tesla.3p.public-key.pem'
    ),
    publicKeyFile: getenv('PUBLIC_KEY_FILE', ''),
    fleetApiBase: getenv(
      'FLEET_API_BASE',
      'https://fleet-api.prd.na.vn.cloud.tesla.com'
    ),
    proxyPrefix: getenv('PROXY_PREFIX', '/proxy'),
    sharedSecret: process.env.SHARED_SECRET ?? '',
    tokenFile: getenv('TOKEN_FILE', 'tokens.json')
  };
}
