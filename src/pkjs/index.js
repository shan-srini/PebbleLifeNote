/**
 * PebbleTesla — PebbleKit JS (phone). Configure CONFIG below.
 * OAuth (PKCE) on phone; tokens synced to Pi tailnet; Fleet via Pi proxy.
 */

var CONFIG = {
  clientId: '',
  funnelBase: '',
  tailnetBase: '',
  sharedSecret: '',
  redirectPath: '/oauth/callback',
  publicKeyUrlPath: '/tesla/public_key.pem',
  fleetScopes: 'openid offline_access user_data vehicle_device_data vehicle_cmds vehicle_charging_cmds',
  authAuthorizeURL: 'https://auth.tesla.com/oauth2/v3/authorize',
  authTokenURL: 'https://auth.tesla.com/oauth2/v3/token'
};

var STORAGE = {
  verifier: 'pt_verifier',
  state: 'pt_state',
  access: 'pt_access',
  refresh: 'pt_refresh',
  expires: 'pt_expires',
  vehicleId: 'pt_vid'
};

var CMD = {
  REFRESH: 1,
  SIGN_IN: 12,
  LOCK: 2,
  UNLOCK: 3,
  CLIMATE_ON: 4,
  CLIMATE_OFF: 5,
  TRUNK: 6,
  FRUNK: 7,
  CHARGE_OPEN: 8,
  CHARGE_CLOSE: 9,
  SENTRY_ON: 10,
  SENTRY_OFF: 11
};

var AUTH = { OK: 0, NEED: 1 };
var ERR = { NONE: 0, NET: 1, AUTH: 2, TESLA: 3, CONFIG: 4 };

function lsGet(k) {
  try {
    return localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}

function lsSet(k, v) {
  try {
    if (v === null || v === undefined) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch (e) {}
}

function configureRequired() {
  return !!(CONFIG.clientId && CONFIG.funnelBase && CONFIG.tailnetBase);
}

function redirectUri() {
  return trimSlash(CONFIG.funnelBase) + CONFIG.redirectPath;
}

function trimSlash(u) {
  return u.replace(/\/+$/, '');
}

function proxy(path) {
  return trimSlash(CONFIG.tailnetBase) + '/proxy' + path;
}

function xhr(method, url, headers, body, cb) {
  var req = new XMLHttpRequest();
  req.open(method, url, true);
  if (headers) {
    for (var h in headers) {
      if (headers.hasOwnProperty(h)) req.setRequestHeader(h, headers[h]);
    }
  }
  req.onload = function () {
    cb(null, req.status, req.responseText);
  };
  req.onerror = function () {
    cb(new Error('network'), 0, '');
  };
  req.send(body || null);
}

function base64urlEncode(buf) {
  var bytes = new Uint8Array(buf);
  var binary = '';
  for (var i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  var b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomVerifier() {
  var a = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(a);
  } else {
    for (var i = 0; i < 32; i++) a[i] = (Math.random() * 256) | 0;
  }
  return base64urlEncode(a);
}

function sha256Challenge(verifier, cb) {
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (buf) {
      cb(null, base64urlEncode(buf));
    }).catch(function (e) {
      cb(e);
    });
    return;
  }
  cb(new Error('Web Crypto unavailable for PKCE'));
}

function postTokensToPi(tokens, cb) {
  var url = trimSlash(CONFIG.tailnetBase) + '/v1/tokens';
  var body = JSON.stringify({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || '',
    expires_at: tokens.expires_at || 0
  });
  xhr('POST', url, {
    'Content-Type': 'application/json',
    'X-PebbleTesla-Secret': CONFIG.sharedSecret
  }, body, function (err) {
    if (err) console.log('token sync to Pi failed: ' + err);
    if (cb) cb(err);
  });
}

function parseTokenResponse(text) {
  try {
    var j = JSON.parse(text);
    var now = Math.floor(Date.now() / 1000);
    var exp = j.expires_in ? now + parseInt(j.expires_in, 10) : 0;
    return {
      access_token: j.access_token,
      refresh_token: j.refresh_token || lsGet(STORAGE.refresh),
      expires_at: exp
    };
  } catch (e) {
    return null;
  }
}

function exchangeCode(code, verifier, cb) {
  var body =
    'grant_type=authorization_code&client_id=' + encodeURIComponent(CONFIG.clientId) +
    '&code=' + encodeURIComponent(code) +
    '&redirect_uri=' + encodeURIComponent(redirectUri()) +
    '&code_verifier=' + encodeURIComponent(verifier);
  xhr('POST', CONFIG.authTokenURL, { 'Content-Type': 'application/x-www-form-urlencoded' }, body, function (err, status, text) {
    if (err || status < 200 || status >= 300) {
      cb(err || new Error('token ' + status));
      return;
    }
    var tok = parseTokenResponse(text);
    if (!tok || !tok.access_token) {
      cb(new Error('bad token json'));
      return;
    }
    lsSet(STORAGE.access, tok.access_token);
    lsSet(STORAGE.refresh, tok.refresh_token || '');
    lsSet(STORAGE.expires, String(tok.expires_at));
    postTokensToPi(tok, function (syncErr) {
      cb(syncErr || null);
    });
  });
}

function refreshAccess(cb) {
  var rt = lsGet(STORAGE.refresh);
  if (!rt) {
    cb(new Error('no refresh'));
    return;
  }
  var body =
    'grant_type=refresh_token&client_id=' + encodeURIComponent(CONFIG.clientId) +
    '&refresh_token=' + encodeURIComponent(rt);
  xhr('POST', CONFIG.authTokenURL, { 'Content-Type': 'application/x-www-form-urlencoded' }, body, function (err, status, text) {
    if (err || status < 200 || status >= 300) {
      cb(err || new Error('refresh ' + status));
      return;
    }
    var tok = parseTokenResponse(text);
    if (!tok || !tok.access_token) {
      cb(new Error('bad refresh'));
      return;
    }
    lsSet(STORAGE.access, tok.access_token);
    if (tok.refresh_token) lsSet(STORAGE.refresh, tok.refresh_token);
    lsSet(STORAGE.expires, String(tok.expires_at));
    postTokensToPi(tok, function (syncErr) {
      cb(syncErr || null);
    });
  });
}

function refreshIfNeeded(cb) {
  var exp = parseInt(lsGet(STORAGE.expires) || '0', 10);
  var now = Math.floor(Date.now() / 1000);
  if (exp > now + 120) {
    cb(null);
    return;
  }
  if (!lsGet(STORAGE.refresh)) {
    cb(null);
    return;
  }
  refreshAccess(cb);
}

function pushStoredTokensToPi(cb) {
  if (!lsGet(STORAGE.access)) {
    if (cb) cb(null);
    return;
  }
  postTokensToPi(
    {
      access_token: lsGet(STORAGE.access),
      refresh_token: lsGet(STORAGE.refresh) || '',
      expires_at: parseInt(lsGet(STORAGE.expires) || '0', 10)
    },
    cb || function () {}
  );
}

function pollForCode(state, verifier, attempts, cb) {
  if (attempts <= 0) {
    cb(new Error('oauth timeout'));
    return;
  }
  var url = trimSlash(CONFIG.tailnetBase) + '/v1/oauth/poll?state=' + encodeURIComponent(state);
  xhr('GET', url, { 'X-PebbleTesla-Secret': CONFIG.sharedSecret }, null, function (err, status, text) {
    if (!err && status === 200) {
      try {
        var j = JSON.parse(text);
        if (j.code) {
          exchangeCode(j.code, verifier, cb);
          return;
        }
      } catch (e) {}
    }
    setTimeout(function () {
      pollForCode(state, verifier, attempts - 1, cb);
    }, 1500);
  });
}

function startOAuthFlow() {
  if (!configureRequired()) {
    sendToWatch({ auth_state: AUTH.NEED, err_code: ERR.CONFIG });
    return;
  }
  var verifier = randomVerifier();
  var state = randomVerifier();
  lsSet(STORAGE.verifier, verifier);
  lsSet(STORAGE.state, state);
  sha256Challenge(verifier, function (err, challenge) {
    if (err) {
      console.log(err);
      sendToWatch({ auth_state: AUTH.NEED, err_code: ERR.AUTH });
      return;
    }
    var url =
      CONFIG.authAuthorizeURL +
      '?client_id=' + encodeURIComponent(CONFIG.clientId) +
      '&redirect_uri=' + encodeURIComponent(redirectUri()) +
      '&response_type=code' +
      '&scope=' + encodeURIComponent(CONFIG.fleetScopes) +
      '&state=' + encodeURIComponent(state) +
      '&code_challenge=' + encodeURIComponent(challenge) +
      '&code_challenge_method=S256';
    if (typeof Pebble !== 'undefined' && Pebble.openURL) {
      Pebble.openURL(url);
    }
    pollForCode(state, verifier, 80, function (e) {
      if (e) {
        sendToWatch({ auth_state: AUTH.NEED, err_code: ERR.AUTH });
        return;
      }
      sendToWatch({ auth_state: AUTH.OK, err_code: ERR.NONE });
    });
  });
}

function ensureVehicleId(cb) {
  var vid = lsGet(STORAGE.vehicleId);
  if (vid) {
    cb(null, vid);
    return;
  }
  xhr('GET', proxy('/api/1/vehicles'), { 'X-PebbleTesla-Secret': CONFIG.sharedSecret }, null, function (err, status, text) {
    if (err || status < 200 || status >= 300) {
      cb(err || new Error('vehicles ' + status));
      return;
    }
    try {
      var j = JSON.parse(text);
      var list = j.response || j;
      if (!list || !list.length) {
        cb(new Error('no vehicles'));
        return;
      }
      vid = list[0].id_s || list[0].id;
      if (!vid) {
        cb(new Error('no id'));
        return;
      }
      lsSet(STORAGE.vehicleId, vid);
      cb(null, vid);
    } catch (e) {
      cb(e);
    }
  });
}

function getVehicleData(cb) {
  refreshIfNeeded(function (re) {
    if (re) {
      cb(re);
      return;
    }
    pushStoredTokensToPi(function () {
      runVehicleData(cb);
    });
  });
}

function runVehicleData(cb) {
  ensureVehicleId(function (e, vid) {
    if (e) {
      cb(e);
      return;
    }
    var path = '/api/1/vehicles/' + encodeURIComponent(vid) + '/vehicle_data';
    xhr('GET', proxy(path), { 'X-PebbleTesla-Secret': CONFIG.sharedSecret }, null, function (err, status, text) {
      if (err) {
        cb(err);
        return;
      }
      if (status === 401 || status === 403) {
        cb(new Error('auth'));
        return;
      }
      if (status < 200 || status >= 300) {
        cb(new Error('api ' + status));
        return;
      }
      try {
        var j = JSON.parse(text);
        var resp = j.response || j;
        var charge = resp.charge_state || {};
        var vs = resp.vehicle_state || {};
        var cs = resp.climate_state || {};
        var bat = typeof charge.battery_level === 'number' ? charge.battery_level : -1;
        sendToWatch({
          battery: Math.max(0, Math.min(100, bat)),
          locked: vs.locked ? 1 : 0,
          climate_on: cs.is_preconditioning ? 1 : 0,
          sentry_on: vs.sentry_mode ? 1 : 0,
          auth_state: AUTH.OK,
          err_code: ERR.NONE
        });
        cb(null);
      } catch (ex) {
        cb(ex);
      }
    });
  });
}

function fleetCommand(body, cb) {
  refreshIfNeeded(function (re) {
    if (re) {
      cb(re);
      return;
    }
    pushStoredTokensToPi(function () {
      ensureVehicleId(function (e, vid) {
        if (e) {
          cb(e);
          return;
        }
        var path = '/api/1/vehicles/' + encodeURIComponent(vid) + '/command';
        xhr(
          'POST',
          proxy(path),
          {
            'Content-Type': 'application/json',
            'X-PebbleTesla-Secret': CONFIG.sharedSecret
          },
          JSON.stringify(body),
          function (err, status, text) {
            if (err) {
              cb(err);
              return;
            }
            if (status < 200 || status >= 300) {
              cb(new Error(text || 'cmd'));
              return;
            }
            cb(null);
          }
        );
      });
    });
  });
}

function handleVehicleCommand(cmd) {
  switch (cmd) {
    case CMD.LOCK:
      return fleetCommand({ command: 'door_lock' }, afterCommand);
    case CMD.UNLOCK:
      return fleetCommand({ command: 'door_unlock' }, afterCommand);
    case CMD.CLIMATE_ON:
      return fleetCommand({ command: 'auto_conditioning_start' }, afterCommand);
    case CMD.CLIMATE_OFF:
      return fleetCommand({ command: 'auto_conditioning_stop' }, afterCommand);
    case CMD.TRUNK:
      return fleetCommand({ command: 'actuate_trunk', which_trunk: 'rear' }, afterCommand);
    case CMD.FRUNK:
      return fleetCommand({ command: 'actuate_trunk', which_trunk: 'front' }, afterCommand);
    case CMD.CHARGE_OPEN:
      return fleetCommand({ command: 'charge_port_door_open' }, afterCommand);
    case CMD.CHARGE_CLOSE:
      return fleetCommand({ command: 'charge_port_door_close' }, afterCommand);
    case CMD.SENTRY_ON:
      return fleetCommand({ command: 'set_sentry_mode', on: true }, afterCommand);
    case CMD.SENTRY_OFF:
      return fleetCommand({ command: 'set_sentry_mode', on: false }, afterCommand);
    default:
      return;
  }
}

function afterCommand(err) {
  if (err) {
    sendToWatch({ err_code: ERR.TESLA, auth_state: AUTH.OK });
    return;
  }
  getVehicleData(function () {});
}

function sendToWatch(msg) {
  if (typeof Pebble === 'undefined') return;
  try {
    Pebble.sendAppMessage(msg, function () {}, function (e) {
      console.log('sendAppMessage failed: ' + e);
    });
  } catch (ex) {
    console.log(ex);
  }
}

function handleCmd(cmd) {
  if (!configureRequired()) {
    sendToWatch({ auth_state: AUTH.NEED, err_code: ERR.CONFIG });
    return;
  }
  if (cmd === CMD.SIGN_IN) {
    startOAuthFlow();
    return;
  }
  if (!lsGet(STORAGE.access)) {
    sendToWatch({ auth_state: AUTH.NEED, err_code: ERR.AUTH });
    return;
  }
  if (cmd === CMD.REFRESH) {
    getVehicleData(function (err) {
      if (err) {
        var ec = err.message === 'auth' ? ERR.AUTH : ERR.NET;
        sendToWatch({ err_code: ec, auth_state: AUTH.NEED });
        return;
      }
    });
    return;
  }
  handleVehicleCommand(cmd);
}

Pebble.addEventListener('ready', function () {
  if (!configureRequired()) {
    sendToWatch({ auth_state: AUTH.NEED, err_code: ERR.CONFIG });
    return;
  }
  pushStoredTokensToPi();
  if (!lsGet(STORAGE.access)) {
    sendToWatch({ auth_state: AUTH.NEED, err_code: ERR.AUTH });
  }
});

Pebble.addEventListener('appmessage', function (e) {
  var cmd = e.payload.cmd;
  if (typeof cmd === 'number') {
    handleCmd(cmd);
  }
});
