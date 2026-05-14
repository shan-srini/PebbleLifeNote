import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';

/**
 * @typedef {{ access_token: string, refresh_token?: string, expires_at: number }} TokenBundle
 */

export class Store {
  /** @type {TokenBundle} */
  #tokens = { access_token: '', refresh_token: '', expires_at: 0 };
  /** @type {Map<string, string>} */
  #pending = new Map();
  #tokenFile;

  /**
   * @param {{ tokenFile: string }} opts
   */
  constructor(opts) {
    this.#tokenFile = opts.tokenFile;
    this.loadTokensFromDisk();
  }

  loadTokensFromDisk() {
    try {
      const b = readFileSync(this.#tokenFile, 'utf8');
      if (!b) return;
      const parsed = JSON.parse(b);
      this.#tokens = {
        access_token: parsed.access_token ?? '',
        refresh_token: parsed.refresh_token ?? '',
        expires_at: Number(parsed.expires_at) || 0
      };
    } catch {
      // missing or invalid file — keep defaults
    }
  }

  getAccessToken() {
    return this.#tokens.access_token;
  }

  /**
   * @param {string} state
   * @param {string} code
   */
  setPendingCode(state, code) {
    this.#pending.set(state, code);
  }

  /**
   * @param {string} state
   * @returns {string | undefined}
   */
  takePendingCode(state) {
    const code = this.#pending.get(state);
    if (code !== undefined) this.#pending.delete(state);
    return code;
  }

  /**
   * @param {TokenBundle} bundle
   */
  setTokens(bundle) {
    this.#tokens = {
      access_token: bundle.access_token ?? '',
      refresh_token: bundle.refresh_token ?? '',
      expires_at: Number(bundle.expires_at) || 0
    };
    this.#persistTokensToDisk();
  }

  #persistTokensToDisk() {
    const data = JSON.stringify(this.#tokens, null, 2);
    const tmp = `${this.#tokenFile}.tmp`;
    writeFileSync(tmp, data, { mode: 0o600 });
    renameSync(tmp, this.#tokenFile);
  }
}
