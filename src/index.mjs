import { createHmac, randomBytes } from "node:crypto";

export const DEFAULT_FERATERRA_API_URL = "https://testnet.feraterra.app";
export const REMOTE_FERATERRA_MCP_URL = "https://mcp.feraterra.app/mcp";
export const DEFAULT_FERATERRA_TERMS_URL = "https://feraterra.app/terms";
export const PRICE_TICKS_PER_USD = 100;
export const LOTS_PER_BASE_UNIT = 10_000;
export const MICRO_USD_PER_DOLLAR = 1_000_000;
export const MIN_FERATERRA_TIMEOUT_MS = 250;
export const MAX_FERATERRA_TIMEOUT_MS = 120_000;
const DEFAULT_FERATERRA_TIMEOUT_MS = 10_000;

const MASK64 = 0xffff_ffff_ffff_ffffn;
const SECP_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP_GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const SECP_GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const SECP_HALF_N = SECP_N >> 1n;
const SECP_SQRT_EXP = (SECP_P + 1n) >> 2n;

const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const KECCAK_RHO = [
  1n, 3n, 6n, 10n, 15n, 21n, 28n, 36n, 45n, 55n, 2n, 14n,
  27n, 41n, 56n, 8n, 25n, 43n, 62n, 18n, 39n, 61n, 20n, 44n,
];

const KECCAK_PI = [
  10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4,
  15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
];

const TEXT_ENCODER = new TextEncoder();

function formatFixedScale(rawUnits, decimals) {
  const n = BigInt(typeof rawUnits === "bigint" ? rawUnits : Math.trunc(Number(rawUnits) || 0));
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

function parseFixedScale(value, scaleInt, fieldName) {
  const num = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(num)) {
    throw new TypeError(`Invalid numeric ${fieldName}: ${String(value)}`);
  }
  return Math.round(num * scaleInt);
}

export function ticksToUsd(ticks) {
  return formatFixedScale(ticks, 2);
}

export function usdToTicks(usd) {
  return parseFixedScale(usd, PRICE_TICKS_PER_USD, "usd");
}

export function lotsToBase(lots) {
  return formatFixedScale(lots, 4);
}

export function baseToLots(base) {
  return parseFixedScale(base, LOTS_PER_BASE_UNIT, "base");
}

export function microToUsd(micro) {
  return formatFixedScale(micro, 6);
}

export function usdToMicro(usd) {
  return parseFixedScale(usd, MICRO_USD_PER_DOLLAR, "usd");
}

function rotl64(x, s) {
  return ((x << s) | (x >> (64n - s))) & MASK64;
}

function readU64LE(buf, offset) {
  let out = 0n;
  for (let i = 0; i < 8; i += 1) {
    out |= BigInt(buf[offset + i]) << BigInt(i * 8);
  }
  return out;
}

function writeU64LE(word, out, offset) {
  for (let i = 0; i < 8; i += 1) {
    out[offset + i] = Number((word >> BigInt(i * 8)) & 0xffn);
  }
}

function writeU64BE(word, out, offset) {
  const w = BigInt(word) & MASK64;
  for (let i = 0; i < 8; i += 1) {
    out[offset + 7 - i] = Number((w >> BigInt(i * 8)) & 0xffn);
  }
}

function keccakF1600(st) {
  const bc = new Array(5).fill(0n);
  for (let rnd = 0; rnd < 24; rnd += 1) {
    for (let x = 0; x < 5; x += 1) {
      bc[x] = st[x] ^ st[x + 5] ^ st[x + 10] ^ st[x + 15] ^ st[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      const t = bc[(x + 4) % 5] ^ rotl64(bc[(x + 1) % 5], 1n);
      for (let y = 0; y < 25; y += 5) {
        st[y + x] = (st[y + x] ^ t) & MASK64;
      }
    }
    let t = st[1];
    for (let i = 0; i < 24; i += 1) {
      const j = KECCAK_PI[i];
      const next = st[j];
      st[j] = rotl64(t, KECCAK_RHO[i]);
      t = next;
    }
    for (let y = 0; y < 25; y += 5) {
      const r0 = st[y];
      const r1 = st[y + 1];
      const r2 = st[y + 2];
      const r3 = st[y + 3];
      const r4 = st[y + 4];
      st[y] = (r0 ^ ((~r1 & MASK64) & r2)) & MASK64;
      st[y + 1] = (r1 ^ ((~r2 & MASK64) & r3)) & MASK64;
      st[y + 2] = (r2 ^ ((~r3 & MASK64) & r4)) & MASK64;
      st[y + 3] = (r3 ^ ((~r4 & MASK64) & r0)) & MASK64;
      st[y + 4] = (r4 ^ ((~r0 & MASK64) & r1)) & MASK64;
    }
    st[0] = (st[0] ^ KECCAK_RC[rnd]) & MASK64;
  }
}

export function keccak256(input) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const rate = 136;
  const st = new Array(25).fill(0n);
  let offset = 0;
  while (offset + rate <= data.length) {
    for (let i = 0; i < 17; i += 1) {
      st[i] ^= readU64LE(data, offset + i * 8);
    }
    keccakF1600(st);
    offset += rate;
  }
  const tail = new Uint8Array(rate);
  const rem = data.length - offset;
  if (rem > 0) {
    tail.set(data.subarray(offset), 0);
  }
  tail[rem] ^= 0x01;
  tail[rate - 1] ^= 0x80;
  for (let i = 0; i < 17; i += 1) {
    st[i] ^= readU64LE(tail, i * 8);
  }
  keccakF1600(st);
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i += 1) {
    writeU64LE(st[i], out, i * 8);
  }
  return out;
}

function bytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hexStr) {
  const clean = String(hexStr || "").trim().replace(/^0x/i, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new ValueError(`Invalid hex string: ${String(hexStr)}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

class ValueError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValueError";
  }
}

function bytesToBigIntBE(bytes) {
  let out = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    out = (out << 8n) | BigInt(bytes[i]);
  }
  return out;
}

function bigIntToBytes32BE(val) {
  const out = new Uint8Array(32);
  let cur = val;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(cur & 0xffn);
    cur >>= 8n;
  }
  return out;
}

function mod(a, m) {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modInv(a, m) {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = mod(a, m);
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r !== 1n) {
    throw new ValueError("Element is not invertible");
  }
  return t < 0n ? t + m : t;
}

function modPow(base, exp, modulus) {
  let result = 1n;
  let b = mod(base, modulus);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % modulus;
    }
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

function secpPointAdd(p1, p2) {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  let lam;
  if (x1 === x2) {
    if ((y1 + y2) % SECP_P === 0n) {
      return null;
    }
    lam = (3n * x1 * x1 * modInv(2n * y1, SECP_P)) % SECP_P;
  } else {
    lam = (mod(y2 - y1, SECP_P) * modInv(mod(x2 - x1, SECP_P), SECP_P)) % SECP_P;
  }
  const x3 = mod(lam * lam - x1 - x2, SECP_P);
  const y3 = mod(lam * (x1 - x3) - y1, SECP_P);
  return [x3, y3];
}

function secpScalarMul(kScalar, point) {
  let k = mod(kScalar, SECP_N);
  if (k === 0n) return null;
  let acc = null;
  let addend = point;
  while (k > 0n) {
    if (k & 1n) {
      acc = secpPointAdd(acc, addend);
    }
    addend = secpPointAdd(addend, addend);
    k >>= 1n;
  }
  return acc;
}

function formatEip55Address(addr20) {
  const low = bytesToHex(addr20);
  const hashHex = bytesToHex(keccak256(TEXT_ENCODER.encode(low)));
  let out = "0x";
  for (let i = 0; i < 40; i += 1) {
    const ch = low[i];
    const nibble = Number.parseInt(hashHex[i], 16);
    out += ch >= "a" && ch <= "f" && nibble >= 8 ? ch.toUpperCase() : ch;
  }
  return out;
}

export function computeLedgerTipDigest({
  walSeq,
  ledgerChainHash,
  stateRoot,
  chainId = 0,
  clearinghouseAddress = "",
}) {
  const chBytes = hexToBytes(ledgerChainHash);
  const srBytes = hexToBytes(stateRoot);
  if (chBytes.length !== 32 || srBytes.length !== 32) {
    throw new ValueError("ledgerChainHash and stateRoot must each be 32 bytes");
  }
  const clhRaw = String(clearinghouseAddress || "").trim();
  let clhBytes;
  if (clhRaw) {
    clhBytes = hexToBytes(clhRaw);
    if (clhBytes.length !== 20) {
      throw new ValueError("clearinghouseAddress must be 20 bytes when specified");
    }
  } else {
    clhBytes = new Uint8Array(20);
  }
  const prefix = TEXT_ENCODER.encode("ARENA_LEDGER_TIP_V2_1");
  const payload = new Uint8Array(prefix.length + 8 + 20 + 8 + 32 + 32);
  let pos = 0;
  payload.set(prefix, pos);
  pos += prefix.length;
  writeU64BE(BigInt(chainId), payload, pos);
  pos += 8;
  payload.set(clhBytes, pos);
  pos += 20;
  writeU64BE(BigInt(walSeq), payload, pos);
  pos += 8;
  payload.set(chBytes, pos);
  pos += 32;
  payload.set(srBytes, pos);
  return keccak256(payload);
}

export function recoverLedgerTipSigner(digestBytes, signatureHex) {
  if (!(digestBytes instanceof Uint8Array) || digestBytes.length !== 32) {
    throw new ValueError("Expected 32-byte digestBytes");
  }
  const sig = hexToBytes(signatureHex);
  if (sig.length !== 65) {
    throw new ValueError("Expected 65-byte secp256k1 signature");
  }
  const r = bytesToBigIntBE(sig.subarray(0, 32));
  const s = bytesToBigIntBE(sig.subarray(32, 64));
  const vRaw = sig[64];
  const recid = vRaw === 27 || vRaw === 28 ? vRaw - 27 : vRaw;
  if ((recid !== 0 && recid !== 1) || r < 1n || r >= SECP_N || s < 1n || s > SECP_HALF_N || r >= SECP_P) {
    throw new ValueError("Invalid or malleable secp256k1 signature parameters");
  }
  const ySq = mod(modPow(r, 3n, SECP_P) + 7n, SECP_P);
  let y = modPow(ySq, SECP_SQRT_EXP, SECP_P);
  if ((y * y) % SECP_P !== ySq) {
    throw new ValueError("Signature r does not lie on secp256k1");
  }
  if (Number(y & 1n) !== recid) {
    y = SECP_P - y;
  }
  const rInv = modInv(r, SECP_N);
  const e = bytesToBigIntBE(digestBytes) % SECP_N;
  const u1 = mod((SECP_N - e) * rInv, SECP_N);
  const u2 = (s * rInv) % SECP_N;
  const q = secpPointAdd(secpScalarMul(u1, [SECP_GX, SECP_GY]), secpScalarMul(u2, [r, y]));
  if (q === null) {
    throw new ValueError("Recovered point at infinity");
  }
  const pub64 = new Uint8Array(64);
  pub64.set(bigIntToBytes32BE(q[0]), 0);
  pub64.set(bigIntToBytes32BE(q[1]), 32);
  return formatEip55Address(keccak256(pub64).subarray(12));
}

export function verifyLedgerTip(tip, options = {}) {
  const pinnedRaw = String(options.expectedOperatorAddress || "").trim();
  const allowSelfAsserted = options.allowSelfAssertedSigner !== false;
  try {
    const tipDomain = String(tip.tip_domain || "").trim();
    if (tipDomain && tipDomain !== "ARENA_LEDGER_TIP_V2_1") {
      return {
        valid: false,
        digest_verified: false,
        signature_verified: false,
        pinned_operator_checked: Boolean(pinnedRaw),
        computed_digest: null,
        recovered_operator_address: null,
        reason: `unsupported_tip_domain:${tipDomain}`,
      };
    }
    const walSeq = BigInt(tip.wal_seq ?? -1);
    if (walSeq < 0n) {
      throw new ValueError("wal_seq must be >= 0");
    }
    const chainId = Number(tip.chain_id ?? 0);
    if (options.expectedChainId !== undefined && chainId !== Number(options.expectedChainId)) {
      return {
        valid: false,
        digest_verified: false,
        signature_verified: false,
        pinned_operator_checked: Boolean(pinnedRaw),
        computed_digest: null,
        recovered_operator_address: null,
        reason: "chain_id_mismatch",
      };
    }
    const clearinghouseAddress = String(tip.clearinghouse_address || "").trim();
    if (options.expectedClearinghouseAddress) {
      const expCh = bytesToHex(hexToBytes(options.expectedClearinghouseAddress));
      const gotCh = clearinghouseAddress ? bytesToHex(hexToBytes(clearinghouseAddress)) : "";
      if (!gotCh || expCh !== gotCh) {
        return {
          valid: false,
          digest_verified: false,
          signature_verified: false,
          pinned_operator_checked: Boolean(pinnedRaw),
          computed_digest: null,
          recovered_operator_address: null,
          reason: "clearinghouse_address_mismatch",
        };
      }
    }

    const digestBytes = computeLedgerTipDigest({
      walSeq,
      ledgerChainHash: String(tip.ledger_chain_hash || ""),
      stateRoot: String(tip.state_root || ""),
      chainId,
      clearinghouseAddress,
    });
    const computedDigestHex = `0x${bytesToHex(digestBytes)}`;
    let digestVerified = true;
    if (tip.tip_digest !== undefined && tip.tip_digest !== null && String(tip.tip_digest).trim() !== "") {
      const providedDigestHex = `0x${bytesToHex(hexToBytes(String(tip.tip_digest)))}`;
      digestVerified = providedDigestHex === computedDigestHex;
    }
    if (!digestVerified) {
      return {
        valid: false,
        digest_verified: false,
        signature_verified: false,
        pinned_operator_checked: Boolean(pinnedRaw),
        computed_digest: computedDigestHex,
        recovered_operator_address: null,
        reason: "tip_digest_mismatch",
      };
    }

    let expectedLower = "";
    if (pinnedRaw) {
      const expBytes = hexToBytes(pinnedRaw);
      if (expBytes.length !== 20 || expBytes.every((b) => b === 0)) {
        return {
          valid: false,
          digest_verified: true,
          signature_verified: false,
          pinned_operator_checked: true,
          computed_digest: computedDigestHex,
          recovered_operator_address: null,
          reason: "invalid_expected_operator_address",
        };
      }
      expectedLower = `0x${bytesToHex(expBytes)}`;
      if (tip.operator_eth_address) {
        const payloadLower = `0x${bytesToHex(hexToBytes(String(tip.operator_eth_address)))}`;
        if (payloadLower !== expectedLower) {
          return {
            valid: false,
            digest_verified: true,
            signature_verified: false,
            pinned_operator_checked: true,
            computed_digest: computedDigestHex,
            recovered_operator_address: null,
            reason: "operator_address_mismatch",
          };
        }
      }
    } else if (allowSelfAsserted) {
      const payloadBytes = hexToBytes(String(tip.operator_eth_address || ""));
      if (payloadBytes.length !== 20 || payloadBytes.every((b) => b === 0)) {
        return {
          valid: false,
          digest_verified: true,
          signature_verified: false,
          pinned_operator_checked: false,
          computed_digest: computedDigestHex,
          recovered_operator_address: null,
          reason: "missing_operator_eth_address",
        };
      }
      expectedLower = `0x${bytesToHex(payloadBytes)}`;
    } else {
      return {
        valid: false,
        digest_verified: true,
        signature_verified: false,
        pinned_operator_checked: false,
        computed_digest: computedDigestHex,
        recovered_operator_address: null,
        reason: "self_asserted_signer_disallowed",
      };
    }

    const recovered = recoverLedgerTipSigner(digestBytes, String(tip.operator_signature || ""));
    const sigOk = recovered.toLowerCase() === expectedLower;
    return {
      valid: sigOk,
      digest_verified: true,
      signature_verified: sigOk,
      pinned_operator_checked: Boolean(pinnedRaw),
      computed_digest: computedDigestHex,
      recovered_operator_address: recovered,
      ...(sigOk ? {} : { reason: "ecrecover_signer_mismatch" }),
    };
  } catch (err) {
    return {
      valid: false,
      digest_verified: false,
      signature_verified: false,
      pinned_operator_checked: Boolean(pinnedRaw),
      computed_digest: null,
      recovered_operator_address: null,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

function canonicalMarketKind(rawKind) {
  const k = String(rawKind || "").trim().toLowerCase();
  if (k === "perp" || k === "linear_perp" || k === "linear_perpetual") {
    return "perp";
  }
  if (k === "formula_perp" || k === "formula_perpetual") {
    return "formula_perp";
  }
  return k;
}

function unifiedSymbolForMarket(market) {
  if (typeof market.unified_symbol === "string" && market.unified_symbol.trim()) {
    return market.unified_symbol.trim();
  }
  const rawSym = String(market.symbol || "").trim().toUpperCase();
  const spotMatch = /^([A-Z0-9]+)-([A-Z0-9]+)-SPOT$/.exec(rawSym);
  if (spotMatch) {
    return `${spotMatch[1]}/${spotMatch[2]}`;
  }
  const perpMatch = /^([A-Z0-9]+)-([A-Z0-9]+)-(?:PERP|PRP)$/.exec(rawSym);
  if (perpMatch) {
    return `${perpMatch[1]}/${perpMatch[2]}:${perpMatch[2]}`;
  }
  const kind = canonicalMarketKind(market.kind);
  if (kind === "perp" || kind === "formula_perp") {
    return rawSym.includes(":") ? rawSym : `${rawSym}:USD`;
  }
  return rawSym;
}

function readRuntimeSetting(runtime, key) {
  const viaGetter = runtime?.getSetting?.(key);
  if (typeof viaGetter === "string" && viaGetter.trim()) {
    return viaGetter.trim();
  }
  const viaSecret = runtime?.character?.settings?.secrets?.[key];
  if (typeof viaSecret === "string" && viaSecret.trim()) {
    return viaSecret.trim();
  }
  const viaEnv = process.env[key];
  if (typeof viaEnv === "string" && viaEnv.trim()) {
    return viaEnv.trim();
  }
  return "";
}

function extractMessageText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (typeof message.content?.text === "string") return message.content.text;
  return "";
}

function isLoopbackHostname(hostname) {
  const h = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1" || h === "0:0:0:0:0:0:0:1") {
    return true;
  }
  return /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(h);
}

function normalizeAndValidateBaseUrl(rawUrl) {
  const candidate = String(rawUrl ?? "").trim();
  if (!candidate) {
    throw new ValueError("FeraTerra baseUrl must be a non-empty URL");
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ValueError(`Invalid FeraTerra baseUrl: ${String(rawUrl)}`);
  }
  if (parsed.username || parsed.password) {
    throw new ValueError("FeraTerra baseUrl must not contain userinfo credentials");
  }
  if (parsed.search || parsed.hash || candidate.includes("?") || candidate.includes("#")) {
    throw new ValueError("FeraTerra baseUrl must not contain query parameters or hash fragments");
  }
  if (parsed.protocol === "https:") {
    // Allowed
  } else if (parsed.protocol === "http:") {
    if (!isLoopbackHostname(parsed.hostname)) {
      throw new ValueError(
        "Insecure http: FeraTerra baseUrl is only permitted for loopback hosts (127.0.0.1, [::1], localhost)"
      );
    }
  } else {
    throw new ValueError(`Unsupported FeraTerra baseUrl protocol: ${parsed.protocol}`);
  }
  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${cleanPath}`;
}

function clampTimeoutMs(rawTimeout) {
  if (rawTimeout === undefined || rawTimeout === null || rawTimeout === "") {
    return DEFAULT_FERATERRA_TIMEOUT_MS;
  }
  const num = Number(rawTimeout);
  if (!Number.isFinite(num)) {
    return DEFAULT_FERATERRA_TIMEOUT_MS;
  }
  return Math.min(MAX_FERATERRA_TIMEOUT_MS, Math.max(MIN_FERATERRA_TIMEOUT_MS, Math.trunc(num)));
}

export class FeraTerraClient {
  constructor(options = {}) {
    const hasExplicitBaseUrl = options.baseUrl !== undefined && options.baseUrl !== null;
    const defaultEnvUrl = process.env.FERATERRA_API_URL || DEFAULT_FERATERRA_API_URL;
    const rawUrl = hasExplicitBaseUrl ? options.baseUrl : defaultEnvUrl;
    this.baseUrl = normalizeAndValidateBaseUrl(rawUrl);

    let sameOriginAsEnv = true;
    if (hasExplicitBaseUrl) {
      try {
        sameOriginAsEnv =
          new URL(this.baseUrl).origin === new URL(normalizeAndValidateBaseUrl(defaultEnvUrl)).origin;
      } catch {
        sameOriginAsEnv = false;
      }
    }

    this._apiKey = String(
      options.apiKey !== undefined
        ? options.apiKey
        : sameOriginAsEnv
          ? process.env.FERATERRA_API_KEY ?? ""
          : ""
    ).trim();
    this._apiSecret = String(
      options.apiSecret !== undefined
        ? options.apiSecret
        : sameOriginAsEnv
          ? process.env.FERATERRA_API_SECRET ?? ""
          : ""
    ).trim();
    const rawAid =
      options.accountId !== undefined
        ? options.accountId
        : sameOriginAsEnv
          ? process.env.FERATERRA_ACCOUNT_ID ?? 0
          : 0;
    this.accountId = Number.isFinite(Number(rawAid)) && Number(rawAid) > 0 ? Math.trunc(Number(rawAid)) : 0;
    this.expectedOperatorAddress = String(
      options.expectedOperatorAddress ?? process.env.FERATERRA_EXPECTED_OPERATOR ?? ""
    ).trim();
    this.timeoutMs = clampTimeoutMs(options.timeoutMs);
    this._fetch = options.fetch ?? globalThis.fetch;
    if (typeof this._fetch !== "function") {
      throw new TypeError("Native fetch is required or pass options.fetch");
    }
  }

  static fromRuntime(runtime, overrides = {}) {
    const runtimeBaseRaw = readRuntimeSetting(runtime, "FERATERRA_API_URL") || DEFAULT_FERATERRA_API_URL;
    const hasOverrideUrl = overrides.baseUrl !== undefined && overrides.baseUrl !== null;
    const baseUrl = normalizeAndValidateBaseUrl(hasOverrideUrl ? overrides.baseUrl : runtimeBaseRaw);

    let sameOriginAsRuntime = true;
    if (hasOverrideUrl) {
      try {
        sameOriginAsRuntime =
          new URL(baseUrl).origin === new URL(normalizeAndValidateBaseUrl(runtimeBaseRaw)).origin;
      } catch {
        sameOriginAsRuntime = false;
      }
    }

    const apiKey =
      overrides.apiKey !== undefined
        ? overrides.apiKey
        : sameOriginAsRuntime
          ? readRuntimeSetting(runtime, "FERATERRA_API_KEY")
          : "";
    const apiSecret =
      overrides.apiSecret !== undefined
        ? overrides.apiSecret
        : sameOriginAsRuntime
          ? readRuntimeSetting(runtime, "FERATERRA_API_SECRET")
          : "";
    const aidStr = sameOriginAsRuntime ? readRuntimeSetting(runtime, "FERATERRA_ACCOUNT_ID") : "";
    const accountId = overrides.accountId ?? (aidStr ? Number.parseInt(aidStr, 10) : 0);
    const expectedOperatorAddress =
      overrides.expectedOperatorAddress ?? readRuntimeSetting(runtime, "FERATERRA_EXPECTED_OPERATOR");
    return new FeraTerraClient({
      ...overrides,
      baseUrl,
      apiKey,
      apiSecret,
      accountId,
      expectedOperatorAddress,
    });
  }

  _buildHeaders(method, pathAndQuery, bodyStr = "", { skipAuth = false } = {}) {
    const headers = {
      Accept: "application/json",
    };
    if (bodyStr) {
      headers["Content-Type"] = "application/json";
    }
    if (!skipAuth && this._apiKey && this._apiSecret) {
      const tsMs = String(Date.now());
      const nonce = randomBytes(12).toString("hex");
      const canonical = `${tsMs}\n${method}\n${pathAndQuery}\n${bodyStr}`;
      const sig = createHmac("sha256", this._apiSecret).update(canonical).digest("hex");
      headers["X-Arena-API-Key"] = this._apiKey;
      headers["X-Arena-Timestamp"] = tsMs;
      headers["X-Arena-Nonce"] = nonce;
      headers["X-Arena-Signature"] = sig;
    }
    return headers;
  }

  async _requestJson(method, path, { query, body, skipAuth = false } = {}) {
    let pathAndQuery = path;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && String(v) !== "") {
          qs.set(k, String(v));
        }
      }
      const qsStr = qs.toString();
      if (qsStr) {
        pathAndQuery += `?${qsStr}`;
      }
    }
    const bodyStr = body !== undefined ? JSON.stringify(body) : "";
    const url = `${this.baseUrl}${pathAndQuery}`;
    const init = {
      method,
      headers: this._buildHeaders(method, pathAndQuery, bodyStr, { skipAuth }),
      redirect: "error",
    };
    if (bodyStr) {
      init.body = bodyStr;
    }
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      init.signal = AbortSignal.timeout(this.timeoutMs);
    }
    const resp = await this._fetch(url, init);
    const rawText = await resp.text();
    let parsed;
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new Error(`${method} ${pathAndQuery} returned non-JSON response (HTTP ${resp.status})`);
    }
    if (!resp.ok || (parsed && typeof parsed === "object" && parsed.ok === false)) {
      const detail = parsed?.error || parsed?.message || `HTTP ${resp.status}`;
      throw new Error(`${method} ${pathAndQuery} failed: ${String(detail)}`);
    }
    return parsed;
  }

  async _resolveMarket({ marketId, symbol } = {}) {
    const listed = await this.listMarkets({ activeOnly: false });
    const markets = listed.markets;
    if (marketId !== undefined && Number(marketId) > 0) {
      const targetId = Math.trunc(Number(marketId));
      const byId = markets.find((m) => Number(m.market_id) === targetId);
      if (byId) return byId;
      return {
        market_id: targetId,
        symbol: `MARKET-${targetId}`,
        unified_symbol: `MARKET-${targetId}`,
        kind: "perp",
        trading_status: "live",
        mark_price_ticks: 0,
        best_bid_ticks: 0,
        best_ask_ticks: 0,
        mark_price_usd: "0.00",
        best_bid_usd: "0.00",
        best_ask_usd: "0.00",
      };
    }
    const raw = String(symbol || "BTC-USD-PERP").trim().toUpperCase();
    if (/^\d+$/.test(raw)) {
      const numId = Number.parseInt(raw, 10);
      const byId = markets.find((m) => Number(m.market_id) === numId);
      if (byId) return byId;
    }
    const exact = markets.find(
      (m) => m.symbol.toUpperCase() === raw || m.unified_symbol.toUpperCase() === raw
    );
    if (exact) return exact;

    const baseMatch = markets.find(
      (m) =>
        m.symbol.toUpperCase().startsWith(`${raw}-`) ||
        m.unified_symbol.toUpperCase().startsWith(`${raw}/`)
    );
    if (baseMatch) return baseMatch;
    throw new Error(`Unknown FeraTerra market: ${String(symbol || marketId)}`);
  }

  async listMarkets(params = {}) {
    const resp = await this._requestJson("GET", "/markets");
    const kindFilter = canonicalMarketKind(params.kind || "");
    const symbolFilter = String(params.symbol || "").trim().toUpperCase();
    const activeOnly = params.activeOnly !== false;
    const rawMarkets = Array.isArray(resp.markets) ? resp.markets : [];
    const markets = [];
    for (const m of rawMarkets) {
      if (kindFilter && canonicalMarketKind(m.kind) !== kindFilter) {
        continue;
      }
      if (activeOnly && String(m.trading_status || "live").toLowerCase() === "halted") {
        continue;
      }
      const unified = unifiedSymbolForMarket(m);
      if (
        symbolFilter &&
        String(m.symbol || "").toUpperCase() !== symbolFilter &&
        unified.toUpperCase() !== symbolFilter
      ) {
        continue;
      }
      const markTicks = Number(m.mark_price_ticks ?? 0);
      const bidTicks = Number(m.best_bid_ticks ?? 0);
      const askTicks = Number(m.best_ask_ticks ?? 0);
      markets.push({
        ...m,
        market_id: Number(m.market_id),
        symbol: String(m.symbol || ""),
        unified_symbol: unified,
        kind: String(m.kind || ""),
        trading_status: String(m.trading_status || "live"),
        mark_price_ticks: markTicks,
        best_bid_ticks: bidTicks,
        best_ask_ticks: askTicks,
        mark_price_usd: ticksToUsd(markTicks),
        best_bid_usd: ticksToUsd(bidTicks),
        best_ask_usd: ticksToUsd(askTicks),
      });
    }
    return {
      ok: true,
      wal_seq: Number(resp.wal_seq ?? 0),
      count: markets.length,
      markets,
    };
  }

  async getOrderbook(params = {}) {
    const depth = Math.max(1, Math.min(200, Math.trunc(Number(params.depth ?? 20) || 20)));
    let marketId = params.marketId !== undefined && Number(params.marketId) > 0
      ? Math.trunc(Number(params.marketId))
      : 0;
    let symbol = String(params.symbol || "").trim();
    let unifiedSymbol = symbol;
    if (marketId <= 0) {
      const mkt = await this._resolveMarket({ symbol: symbol || "BTC-USD-PERP" });
      marketId = mkt.market_id;
      symbol = mkt.symbol;
      unifiedSymbol = mkt.unified_symbol;
    }
    const book = await this._requestJson("GET", "/book", {
      query: { market_id: marketId, depth },
    });
    const resolvedSymbol = String(book.symbol || symbol || `MARKET-${marketId}`);
    const resolvedUnified = unifiedSymbolForMarket({
      symbol: resolvedSymbol,
      unified_symbol: book.unified_symbol || unifiedSymbol,
      kind: book.kind,
    });
    const normalizeSide = (levels) =>
      (Array.isArray(levels) ? levels : []).map((lvl) => {
        if (Array.isArray(lvl)) {
          const pxTicks = Number(lvl[0] ?? 0);
          const qtyLots = Number(lvl[1] ?? 0);
          const count = Number(lvl[2] ?? 1);
          return {
            price_ticks: pxTicks,
            price_usd: ticksToUsd(pxTicks),
            qty_lots: qtyLots,
            qty_base: lotsToBase(qtyLots),
            order_count: count,
          };
        }
        const pxTicks = Number(lvl?.price_ticks ?? 0);
        const qtyLots = Number(lvl?.qty_lots ?? 0);
        const count = Number(lvl?.order_count ?? 1);
        return {
          price_ticks: pxTicks,
          price_usd: ticksToUsd(pxTicks),
          qty_lots: qtyLots,
          qty_base: lotsToBase(qtyLots),
          order_count: count,
        };
      });

    const formattedBids = normalizeSide(book.bids);
    const formattedAsks = normalizeSide(book.asks);
    const bestBidTicks = formattedBids.length > 0 ? formattedBids[0].price_ticks : null;
    const bestAskTicks = formattedAsks.length > 0 ? formattedAsks[0].price_ticks : null;
    const spreadUsd =
      bestBidTicks !== null && bestAskTicks !== null && bestAskTicks >= bestBidTicks
        ? ticksToUsd(bestAskTicks - bestBidTicks)
        : null;

    return {
      ...book,
      ok: true,
      wal_seq: Number(book.wal_seq ?? 0),
      market_id: Number(book.market_id ?? marketId),
      symbol: resolvedSymbol,
      unified_symbol: resolvedUnified,
      depth,
      best_bid_usd: bestBidTicks !== null ? ticksToUsd(bestBidTicks) : null,
      best_ask_usd: bestAskTicks !== null ? ticksToUsd(bestAskTicks) : null,
      spread_usd: spreadUsd,
      bids: Array.isArray(book.bids) ? book.bids : [],
      asks: Array.isArray(book.asks) ? book.asks : [],
      formatted_bids: formattedBids,
      formatted_asks: formattedAsks,
    };
  }

  async getLeaderboard(params = {}) {
    const limit = Math.max(1, Math.min(100, Math.trunc(Number(params.limit ?? 25) || 25)));
    const sort = String(params.sort || "equity").trim().toLowerCase() || "equity";
    const resp = await this._requestJson("GET", "/leaderboard", {
      query: { limit, sort },
    });
    const entries = Array.isArray(resp.entries) ? resp.entries : [];
    return {
      ...resp,
      ok: true,
      wal_seq: Number(resp.wal_seq ?? 0),
      sort_by: String(resp.sort_by || sort),
      entries,
    };
  }

  async getTerms(params = {}) {
    const format = params.format ? String(params.format).trim().toLowerCase() : undefined;
    const resp = await this._requestJson("GET", "/terms", {
      query: format ? { format } : undefined,
      skipAuth: true,
    });
    const sections = Array.isArray(resp.sections) ? resp.sections : [];
    return {
      ...resp,
      ok: true,
      protocol: String(resp.protocol || "FeraTerra"),
      title: String(resp.title || "FeraTerra Protocol Terms of Use"),
      version: String(resp.version || "1.0"),
      terms_url: String(resp.terms_url || DEFAULT_FERATERRA_TERMS_URL),
      headless_protocol: resp.headless_protocol !== false,
      non_custodial: resp.non_custodial !== false,
      benchmark_only: resp.benchmark_only !== false,
      monetary_prizes: Boolean(resp.monetary_prizes ?? false),
      chain_id: Number(resp.chain_id ?? 0),
      clearinghouse_address: String(resp.clearinghouse_address || ""),
      sections,
    };
  }

  async previewOrder(params = {}) {
    const rawAid = params.accountId !== undefined ? Number(params.accountId) : this.accountId;
    const accountId = Number.isFinite(rawAid) ? Math.trunc(rawAid) : NaN;
    if (!Number.isFinite(accountId) || accountId < 0) {
      throw new ValueError("accountId must be >= 0 for previewOrder (0 = anonymous zero-key preview)");
    }
    const isMarket = String(params.orderType || "limit").trim().toLowerCase() === "market";
    const isMarkPeg = Boolean(params.markPeg) && !isMarket;
    let mkt;
    if (
      params.marketId !== undefined &&
      Number(params.marketId) > 0 &&
      (params.priceTicks !== undefined || params.price !== undefined || isMarket || isMarkPeg)
    ) {
      const mid = Math.trunc(Number(params.marketId));
      mkt = {
        market_id: mid,
        symbol: String(params.symbol || `MARKET-${mid}`),
        unified_symbol: unifiedSymbolForMarket({ symbol: params.symbol || `MARKET-${mid}` }),
        mark_price_ticks: 0,
        best_bid_ticks: 0,
        best_ask_ticks: 0,
      };
    } else {
      mkt = await this._resolveMarket({
        marketId: params.marketId,
        symbol: params.symbol || "BTC-USD-PERP",
      });
    }

    const sideRaw = String(params.side || "buy").trim().toLowerCase();
    let side;
    if (sideRaw === "buy" || sideRaw === "bid") {
      side = "bid";
    } else if (sideRaw === "sell" || sideRaw === "ask") {
      side = "ask";
    } else {
      throw new ValueError(`Unsupported order side: ${String(params.side)}`);
    }

    const qtyLots =
      params.qtyLots !== undefined
        ? Math.trunc(Number(params.qtyLots))
        : baseToLots(params.amount ?? 0.01);
    if (!Number.isFinite(qtyLots) || qtyLots <= 0) {
      throw new ValueError("Order quantity must be > 0");
    }

    let priceTicks;
    if (params.priceTicks !== undefined) {
      priceTicks = Math.trunc(Number(params.priceTicks));
    } else if (params.price !== undefined && params.price !== null) {
      priceTicks = usdToTicks(params.price);
    } else if (isMarket || isMarkPeg) {
      priceTicks = 0;
    } else {
      priceTicks = Number(mkt.mark_price_ticks || mkt.best_ask_ticks || mkt.best_bid_ticks || 0);
    }
    if (!Number.isFinite(priceTicks) || priceTicks < 0) {
      throw new ValueError("Order preview priceTicks must be a finite integer >= 0");
    }
    if (!isMarket && !isMarkPeg && priceTicks <= 0) {
      throw new ValueError("Limit order preview requires a positive price or priceTicks");
    }

    let tif = String(params.tif || (isMarket ? "ioc" : "gtc")).trim().toLowerCase();
    if (params.postOnly && tif === "gtc") {
      tif = "post_only";
    }
    const stp = String(params.stp || "cancel_resting").trim().toLowerCase();
    const payload = {
      account_id: accountId,
      market_id: mkt.market_id,
      side,
      tif,
      stp,
      price_ticks: priceTicks,
      qty_lots: qtyLots,
      reduce_only: Boolean(params.reduceOnly),
      is_market: isMarket,
    };
    if (params.postOnlySlide) {
      payload.post_only_slide = true;
    }
    if (params.markPeg) {
      payload.mark_peg = true;
    }
    if (params.pegOffsetTicks !== undefined && Number(params.pegOffsetTicks) !== 0) {
      payload.peg_offset_ticks = Math.trunc(Number(params.pegOffsetTicks));
    }
    if (params.priorityFeePpm !== undefined && Number(params.priorityFeePpm) > 0) {
      payload.priority_fee_ppm = Math.trunc(Number(params.priorityFeePpm));
    }

    const resp = await this._requestJson("POST", "/order/preview", {
      body: payload,
      skipAuth: accountId === 0,
    });
    const effPxTicks = Number(resp.effective_price_ticks ?? priceTicks);
    const estFilledLots = Number(resp.estimated_filled_lots ?? 0);
    const estRestingLots = Number(resp.estimated_resting_lots ?? 0);
    const estAvgPxTicks = Number(resp.estimated_avg_price_ticks ?? 0);
    const estSlippageBps = Number(resp.estimated_slippage_bps ?? 0);
    const estFeeMicro = Number(resp.estimated_fee_micro ?? 0);
    const preImrMicro = Number(resp.pre_imr_micro ?? 0);
    const postImrMicro = Number(resp.post_imr_micro ?? 0);
    const reqImrMicro = Number(resp.required_imr_micro ?? postImrMicro);
    const postFreeMicro = Number(resp.post_free_margin_micro ?? 0);
    const outAccountId = Number(resp.account_id ?? accountId);
    const anonymous = Boolean(resp.anonymous ?? (outAccountId === 0));

    return {
      ...resp,
      ok: true,
      anonymous,
      account_id: outAccountId,
      would_accept: Boolean(resp.would_accept),
      status: String(resp.status || (resp.would_accept ? "Ok" : "Rejected")),
      market_id: mkt.market_id,
      symbol: mkt.symbol,
      unified_symbol: mkt.unified_symbol,
      side,
      qty_lots: qtyLots,
      qty_base: lotsToBase(qtyLots),
      effective_price_ticks: effPxTicks,
      effective_price_usd: ticksToUsd(effPxTicks),
      estimated_filled_lots: estFilledLots,
      estimated_filled_base: lotsToBase(estFilledLots),
      estimated_resting_lots: estRestingLots,
      estimated_resting_base: lotsToBase(estRestingLots),
      estimated_avg_price_ticks: estAvgPxTicks,
      estimated_avg_price_usd: ticksToUsd(estAvgPxTicks),
      estimated_slippage_bps: estSlippageBps,
      estimated_fee_micro: estFeeMicro,
      estimated_fee_usd: microToUsd(estFeeMicro),
      required_imr_micro: reqImrMicro,
      required_imr_usd: microToUsd(reqImrMicro),
      pre_imr_micro: preImrMicro,
      pre_imr_usd: microToUsd(preImrMicro),
      post_imr_micro: postImrMicro,
      post_imr_usd: microToUsd(postImrMicro),
      post_free_margin_micro: postFreeMicro,
      post_free_margin_usd: microToUsd(postFreeMicro),
      wal_seq: Number(resp.wal_seq ?? 0),
    };
  }

  async verifySolvency(params = {}) {
    const includeHealth = params.includeHealth !== false;
    const [tip, health] = await Promise.all([
      this._requestJson("GET", "/ledger/tip"),
      includeHealth ? this._requestJson("GET", "/health") : Promise.resolve(null),
    ]);

    const expectedOp = String(
      params.expectedOperatorAddress ?? this.expectedOperatorAddress ?? ""
    ).trim();

    const verification = verifyLedgerTip(tip, {
      expectedOperatorAddress: expectedOp,
      expectedChainId: params.expectedChainId,
      expectedClearinghouseAddress: params.expectedClearinghouseAddress,
      allowSelfAssertedSigner: !expectedOp,
    });

    const conservationOk =
      health === null
        ? true
        : health.ok !== false &&
          health.conservation_ok !== false &&
          health.double_entry_ok !== false;

    const solvent = Boolean(verification.signature_verified && verification.digest_verified && conservationOk);

    return {
      ok: true,
      solvent,
      signature_verified: verification.signature_verified,
      digest_verified: verification.digest_verified,
      conservation_ok: conservationOk,
      pinned_operator_checked: verification.pinned_operator_checked,
      recovered_operator_address: verification.recovered_operator_address,
      operator_eth_address: tip.operator_eth_address ? String(tip.operator_eth_address) : null,
      wal_seq: Number(tip.wal_seq ?? 0),
      state_root: String(tip.state_root || ""),
      ledger_chain_hash: String(tip.ledger_chain_hash || ""),
      tip_digest: tip.tip_digest ? String(tip.tip_digest) : verification.computed_digest,
      chain_id: Number(tip.chain_id ?? 0),
      clearinghouse_address: String(tip.clearinghouse_address || ""),
      health,
      tip,
    };
  }
}

const SYMBOL_MODIFIER_STOPWORDS = new Set([
  "POST-ONLY",
  "POST-ONLY-SLIDE",
  "MARK-PEG",
  "REDUCE-ONLY",
  "MIDPOINT-PEG",
  "PRIMARY-PEG",
  "TRAILING-PEG",
  "DARK-MIDPOINT",
  "ZERO-KEY",
  "DRY-RUN",
  "PRE-TRADE",
  "NON-CUSTODIAL",
  "CROSS-MARGIN",
  "TIME-IN-FORCE",
  "KEEP-PRIORITY",
  "BENCHMARK-ONLY",
  "ON-CHAIN",
  "REAL-TIME",
  "STOP-LOSS",
  "TAKE-PROFIT",
]);

export function parseSymbolFromText(text) {
  const pairRegex =
    /\b([A-Z0-9]{2,10}(?:-[A-Z0-9]{2,10}){1,2}|[A-Z0-9]{2,10}\/[A-Z0-9]{2,10}(?::[A-Z0-9]{2,10})?)\b/gi;
  let match = pairRegex.exec(text);
  while (match !== null) {
    const candidate = match[1].toUpperCase();
    if (!SYMBOL_MODIFIER_STOPWORDS.has(candidate)) {
      return candidate;
    }
    match = pairRegex.exec(text);
  }
  const ticker = /\b(BTC|ETH|SOL|XAU|EUR)\b/i.exec(text);
  if (ticker) {
    return `${ticker[1].toUpperCase()}-USD-PERP`;
  }
  return undefined;
}

export const feraterraListMarketsAction = {
  name: "FERATERRA_LIST_MARKETS",
  similes: [
    "LIST_FERATERRA_MARKETS",
    "GET_FERATERRA_MARKETS",
    "SHOW_PERP_MARKETS",
    "FERATERRA_MARKETS",
  ],
  description:
    "List live FeraTerra CLOB markets (perpetuals, spot, basis spreads, and bounded claims) with mark prices and best bid/ask quotes.",
  examples: [
    [
      {
        name: "user",
        content: { text: "List the active perpetual markets on FeraTerra." },
      },
      {
        name: "agent",
        content: {
          text: "Active FeraTerra markets (WAL #42): BTC-USD-PERP mark $70000.00 (bid $69995.00 / ask $70005.00).",
          action: "FERATERRA_LIST_MARKETS",
        },
      },
    ],
  ],
  async validate() {
    return true;
  },
  async handler(runtime, message, _state, options = {}, callback) {
    try {
      const msgText = extractMessageText(message);
      let kind = options.kind;
      if (!kind && msgText) {
        if (/\bspot\b/i.test(msgText)) kind = "spot";
        else if (/\b(?:perp|perpetual|perpetuals)\b/i.test(msgText)) kind = "perp";
      }
      const client = FeraTerraClient.fromRuntime(runtime, options);
      const data = await client.listMarkets({
        kind,
        symbol: options.symbol,
        activeOnly: options.activeOnly ?? !/\binclude\s+halted\b/i.test(msgText),
      });
      const lines = data.markets.slice(0, 15).map(
        (m) =>
          `- ${m.symbol} (${m.unified_symbol}): mark $${m.mark_price_usd} | bid $${m.best_bid_usd} / ask $${m.best_ask_usd}`
      );
      const text =
        data.count > 0
          ? `FeraTerra markets (${data.count} listed, WAL #${data.wal_seq}):\n${lines.join("\n")}`
          : `No matching FeraTerra markets found (WAL #${data.wal_seq}).`;
      const response = {
        text,
        action: "FERATERRA_LIST_MARKETS",
        data,
      };
      if (callback) await callback(response);
      return {
        success: true,
        text,
        data,
        values: { count: data.count, wal_seq: data.wal_seq },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const text = `Failed to list FeraTerra markets: ${errorMsg}`;
      if (callback) await callback({ text, action: "FERATERRA_LIST_MARKETS" });
      return { success: false, text, error: errorMsg };
    }
  },
};

export const feraterraGetOrderbookAction = {
  name: "FERATERRA_GET_ORDERBOOK",
  similes: [
    "GET_FERATERRA_BOOK",
    "SHOW_FERATERRA_ORDERBOOK",
    "FERATERRA_DEPTH",
    "CHECK_CLOB_SPREAD",
  ],
  description:
    "Fetch live L2/L3 CLOB order book depth, top-of-book bid/ask USD prices, and spread for a FeraTerra market.",
  examples: [
    [
      {
        name: "user",
        content: { text: "Show me the BTC-USD-PERP orderbook depth 5 on FeraTerra." },
      },
      {
        name: "agent",
        content: {
          text: "BTC-USD-PERP orderbook (WAL #42): best bid $69995.00, best ask $70005.00, spread $10.00.",
          action: "FERATERRA_GET_ORDERBOOK",
        },
      },
    ],
  ],
  async validate() {
    return true;
  },
  async handler(runtime, message, _state, options = {}, callback) {
    try {
      const msgText = extractMessageText(message);
      const depthMatch = /\b(?:depth|top)\s+(\d{1,3})\b/i.exec(msgText);
      const depth = options.depth ?? (depthMatch ? Number.parseInt(depthMatch[1], 10) : 20);
      const marketIdMatch = /\bmarket(?:_id|\s+id)?\s*[=:#]?\s*(\d+)\b/i.exec(msgText);
      const marketId = options.marketId ?? (marketIdMatch ? Number.parseInt(marketIdMatch[1], 10) : undefined);
      const symbol = options.symbol ?? (marketId ? undefined : parseSymbolFromText(msgText) ?? "BTC-USD-PERP");

      const client = FeraTerraClient.fromRuntime(runtime, options);
      const data = await client.getOrderbook({ marketId, symbol, depth });
      const text =
        `${data.symbol} (${data.unified_symbol}) orderbook (WAL #${data.wal_seq}): ` +
        `best bid ${data.best_bid_usd ? `$${data.best_bid_usd}` : "N/A"}, ` +
        `best ask ${data.best_ask_usd ? `$${data.best_ask_usd}` : "N/A"}, ` +
        `spread ${data.spread_usd ? `$${data.spread_usd}` : "N/A"} ` +
        `(${data.formatted_bids.length} bid levels, ${data.formatted_asks.length} ask levels).`;
      if (callback) await callback({ text, action: "FERATERRA_GET_ORDERBOOK", data });
      return {
        success: true,
        text,
        data,
        values: {
          market_id: data.market_id,
          symbol: data.symbol,
          best_bid_usd: data.best_bid_usd,
          best_ask_usd: data.best_ask_usd,
          spread_usd: data.spread_usd,
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const text = `Failed to fetch FeraTerra orderbook: ${errorMsg}`;
      if (callback) await callback({ text, action: "FERATERRA_GET_ORDERBOOK" });
      return { success: false, text, error: errorMsg };
    }
  },
};

export const feraterraGetLeaderboardAction = {
  name: "FERATERRA_GET_LEADERBOARD",
  similes: [
    "SHOW_FERATERRA_LEADERBOARD",
    "GET_TOP_TRADERS",
    "FERATERRA_RANKINGS",
    "FERATERRA_STANDINGS",
  ],
  description:
    "Retrieve the ranked FeraTerra trader leaderboard sorted by equity, pnl, streak, volume, or roi.",
  examples: [
    [
      {
        name: "user",
        content: { text: "Show the top 10 traders on the FeraTerra leaderboard by pnl." },
      },
      {
        name: "agent",
        content: {
          text: "FeraTerra leaderboard (sorted by pnl, 10 entries): #1 Account 77 ($12500.00).",
          action: "FERATERRA_GET_LEADERBOARD",
        },
      },
    ],
  ],
  async validate() {
    return true;
  },
  async handler(runtime, message, _state, options = {}, callback) {
    try {
      const msgText = extractMessageText(message);
      const limitMatch = /\b(?:top|limit)\s+(\d{1,3})\b/i.exec(msgText);
      const sortMatch = /\b(equity|pnl|streak|volume|roi)\b/i.exec(msgText);
      const limit = options.limit ?? (limitMatch ? Number.parseInt(limitMatch[1], 10) : 25);
      const sort = options.sort ?? (sortMatch ? sortMatch[1].toLowerCase() : "equity");

      const client = FeraTerraClient.fromRuntime(runtime, options);
      const data = await client.getLeaderboard({ limit, sort });
      const topSummary = data.entries
        .slice(0, 10)
        .map(
          (e) =>
            `#${e.rank} Account ${e.account_id}${e.equity_usd !== undefined ? ` ($${e.equity_usd})` : ""}`
        )
        .join(", ");
      const text =
        data.entries.length > 0
          ? `FeraTerra leaderboard (sorted by ${data.sort_by}, WAL #${data.wal_seq}): ${topSummary}`
          : `FeraTerra leaderboard is currently empty (WAL #${data.wal_seq}).`;
      if (callback) await callback({ text, action: "FERATERRA_GET_LEADERBOARD", data });
      return {
        success: true,
        text,
        data,
        values: {
          sort_by: data.sort_by,
          entry_count: data.entries.length,
          wal_seq: data.wal_seq,
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const text = `Failed to fetch FeraTerra leaderboard: ${errorMsg}`;
      if (callback) await callback({ text, action: "FERATERRA_GET_LEADERBOARD" });
      return { success: false, text, error: errorMsg };
    }
  },
};

export const feraterraGetTermsAction = {
  name: "FERATERRA_GET_TERMS",
  similes: [
    "GET_FERATERRA_TERMS",
    "SHOW_PROTOCOL_TERMS",
    "FERATERRA_TERMS_OF_USE",
    "CHECK_FERATERRA_TERMS",
  ],
  description:
    "Fetch machine-readable FeraTerra protocol terms via headless GET /terms (non-custodial scope, benchmark-only leaderboard, zero monetary prizes, and EIP-191 onboarding terms URL).",
  examples: [
    [
      {
        name: "user",
        content: { text: "Fetch the FeraTerra protocol terms and onboarding policy." },
      },
      {
        name: "agent",
        content: {
          text: "FeraTerra Protocol Terms of Use v1.0 (https://feraterra.app/terms): headless_protocol=true, non_custodial=true, benchmark_only=true, monetary_prizes=false.",
          action: "FERATERRA_GET_TERMS",
        },
      },
    ],
  ],
  async validate() {
    return true;
  },
  async handler(runtime, _message, _state, options = {}, callback) {
    try {
      const client = FeraTerraClient.fromRuntime(runtime, options);
      const data = await client.getTerms({ format: options.format });
      const text =
        `${data.title} v${data.version} (${data.terms_url}): ` +
        `headless_protocol=${data.headless_protocol}, non_custodial=${data.non_custodial}, ` +
        `benchmark_only=${data.benchmark_only}, monetary_prizes=${data.monetary_prizes}` +
        (data.chain_id > 0 ? `, chain_id=${data.chain_id}` : "") +
        `.`;
      if (callback) await callback({ text, action: "FERATERRA_GET_TERMS", data });
      return {
        success: true,
        text,
        data,
        values: {
          terms_url: data.terms_url,
          version: data.version,
          headless_protocol: data.headless_protocol,
          non_custodial: data.non_custodial,
          benchmark_only: data.benchmark_only,
          monetary_prizes: data.monetary_prizes,
          chain_id: data.chain_id,
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const text = `Failed to fetch FeraTerra protocol terms: ${errorMsg}`;
      if (callback) await callback({ text, action: "FERATERRA_GET_TERMS" });
      return { success: false, text, error: errorMsg };
    }
  },
};

export const feraterraPreviewOrderAction = {
  name: "FERATERRA_PREVIEW_ORDER",
  similes: [
    "SIMULATE_FERATERRA_ORDER",
    "DRY_RUN_FERATERRA_ORDER",
    "CHECK_ORDER_MARGIN",
    "PREVIEW_PERP_TRADE",
  ],
  description:
    "Execute a stateless, zero-mutation pre-trade simulation on FeraTerra via POST /order/preview (defaults to anonymous zero-key account_id=0 when unauthenticated, or simulates portfolio margin for account_id >= 1).",
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Preview buying 0.1 BTC-USD-PERP at $70000 post-only on FeraTerra.",
        },
      },
      {
        name: "agent",
        content: {
          text: "FeraTerra order preview ACCEPTED (Ok, anonymous account_id=0): bid 0.1000 BTC-USD-PERP @ $70000.00 | required IMR $35.00.",
          action: "FERATERRA_PREVIEW_ORDER",
        },
      },
    ],
  ],
  async validate() {
    return true;
  },
  async handler(runtime, message, _state, options = {}, callback) {
    try {
      const msgText = extractMessageText(message);
      const side =
        options.side ?? (/\b(?:sell|ask|short)\b/i.test(msgText) ? "sell" : "buy");
      const orderType =
        options.orderType ?? (/\bmarket\s+order\b/i.test(msgText) ? "market" : "limit");
      const acctMatch = /\baccount(?:_id)?\s*[=:#]?\s*(\d+)\b/i.exec(msgText);
      const amtMatch = /\b(?:buy|buying|sell|selling|bid|ask)\s+(\d+(?:\.\d+)?)\b/i.exec(msgText);
      const pxMatch = /\b(?:at|@)\s*\$?(\d+(?:\.\d+)?)\b/i.exec(msgText);

      const client = FeraTerraClient.fromRuntime(runtime, options);
      const data = await client.previewOrder({
        accountId: options.accountId ?? (acctMatch ? Number.parseInt(acctMatch[1], 10) : undefined),
        marketId: options.marketId,
        symbol: options.symbol ?? parseSymbolFromText(msgText) ?? "BTC-USD-PERP",
        side,
        orderType,
        amount: options.amount ?? (amtMatch ? Number.parseFloat(amtMatch[1]) : 0.01),
        qtyLots: options.qtyLots,
        price: options.price ?? (pxMatch ? Number.parseFloat(pxMatch[1]) : undefined),
        priceTicks: options.priceTicks,
        tif: options.tif,
        reduceOnly: options.reduceOnly ?? /\breduce[-\s]?only\b/i.test(msgText),
        postOnly: options.postOnly ?? /\bpost[-\s]?only\b/i.test(msgText),
        postOnlySlide: options.postOnlySlide,
        markPeg: options.markPeg ?? /\bmark[-\s]?peg\b/i.test(msgText),
        pegOffsetTicks: options.pegOffsetTicks,
        stp: options.stp,
        priorityFeePpm: options.priorityFeePpm,
      });

      const verdict = data.would_accept ? "ACCEPTED" : "REJECTED";
      const marginSuffix = data.anonymous
        ? `required IMR $${data.required_imr_usd} (anonymous zero-key account_id=0)`
        : `post-IMR $${data.post_imr_usd}, free margin $${data.post_free_margin_usd}`;
      const text =
        `FeraTerra order preview ${verdict} (${data.status}): ${data.side} ${data.qty_base} ${data.symbol} ` +
        `@ $${data.effective_price_usd} | est. filled ${data.estimated_filled_base}, resting ${data.estimated_resting_base}, ` +
        `fee $${data.estimated_fee_usd}, ${marginSuffix}.`;
      if (callback) await callback({ text, action: "FERATERRA_PREVIEW_ORDER", data });
      return {
        success: true,
        text,
        data,
        values: {
          anonymous: data.anonymous,
          account_id: data.account_id,
          would_accept: data.would_accept,
          status: data.status,
          required_imr_usd: data.required_imr_usd,
          post_imr_usd: data.post_imr_usd,
          post_free_margin_usd: data.post_free_margin_usd,
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const text = `Failed to preview FeraTerra order: ${errorMsg}`;
      if (callback) await callback({ text, action: "FERATERRA_PREVIEW_ORDER" });
      return { success: false, text, error: errorMsg };
    }
  },
};

export const feraterraVerifySolvencyAction = {
  name: "FERATERRA_VERIFY_SOLVENCY",
  similes: [
    "VERIFY_FERATERRA_LEDGER_TIP",
    "AUDIT_FERATERRA_SOLVENCY",
    "CHECK_FERATERRA_STATE_ROOT",
    "FERATERRA_PROOF_OF_SOLVENCY",
  ],
  description:
    "Cryptographically verify FeraTerra solvency invariants and the Keccak-256 + secp256k1 operator-signed WAL ledger tip.",
  examples: [
    [
      {
        name: "user",
        content: { text: "Verify FeraTerra exchange solvency and operator ledger tip signature." },
      },
      {
        name: "agent",
        content: {
          text: "FeraTerra solvency VERIFIED at WAL #42 (signer 0x..., state_root 0x...).",
          action: "FERATERRA_VERIFY_SOLVENCY",
        },
      },
    ],
  ],
  async validate() {
    return true;
  },
  async handler(runtime, message, _state, options = {}, callback) {
    try {
      const msgText = extractMessageText(message);
      const addrMatch = /\b(0x[0-9a-fA-F]{40})\b/.exec(msgText);
      const client = FeraTerraClient.fromRuntime(runtime, options);
      const data = await client.verifySolvency({
        expectedOperatorAddress:
          options.expectedOperatorAddress ?? (addrMatch ? addrMatch[1] : undefined),
        expectedChainId: options.expectedChainId,
        expectedClearinghouseAddress: options.expectedClearinghouseAddress,
        includeHealth: options.includeHealth,
      });

      const statusLabel = data.solvent ? "VERIFIED" : "FAILED";
      const text =
        `FeraTerra solvency ${statusLabel} at WAL #${data.wal_seq}: ` +
        `signature_verified=${data.signature_verified}, conservation_ok=${data.conservation_ok}, ` +
        `signer=${data.recovered_operator_address ?? "invalid"}, state_root=${data.state_root}.`;
      if (callback) await callback({ text, action: "FERATERRA_VERIFY_SOLVENCY", data });
      return {
        success: data.solvent,
        text,
        data,
        values: {
          solvent: data.solvent,
          signature_verified: data.signature_verified,
          conservation_ok: data.conservation_ok,
          wal_seq: data.wal_seq,
        },
        ...(data.solvent ? {} : { error: "solvency_verification_failed" }),
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const text = `Failed to verify FeraTerra solvency: ${errorMsg}`;
      if (callback) await callback({ text, action: "FERATERRA_VERIFY_SOLVENCY" });
      return { success: false, text, error: errorMsg };
    }
  },
};

export const feraterraMarketSummaryProvider = {
  name: "FERATERRA_MARKET_SUMMARY",
  description:
    "Provides a real-time FeraTerra CLOB market summary (active symbols, USD mark prices, best bid/ask quotes, and WAL sequence).",
  dynamic: true,
  async get(runtime, _message, _state) {
    let baseUrl = DEFAULT_FERATERRA_API_URL;
    try {
      const client = FeraTerraClient.fromRuntime(runtime);
      baseUrl = client.baseUrl;
      const data = await client.listMarkets({ activeOnly: true });
      const rows = data.markets
        .slice(0, 12)
        .map(
          (m) =>
            `${m.symbol} (${m.unified_symbol}): mark $${m.mark_price_usd}, bid $${m.best_bid_usd}, ask $${m.best_ask_usd}`
        );
      const text =
        data.count > 0
          ? `[FeraTerra Live Markets | ${client.baseUrl} | WAL #${data.wal_seq}]\n${rows.join("\n")}`
          : `[FeraTerra Live Markets | ${client.baseUrl} | WAL #${data.wal_seq}] No active markets.`;
      return {
        text,
        data,
        values: {
          base_url: client.baseUrl,
          wal_seq: data.wal_seq,
          market_count: data.count,
        },
        toString() {
          return text;
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const emptyData = {
        ok: false,
        wal_seq: 0,
        count: 0,
        markets: [],
      };
      const text = `[FeraTerra Live Markets | ${baseUrl}] Market summary unavailable: ${errorMsg}`;
      return {
        text,
        data: emptyData,
        values: {
          base_url: baseUrl,
          wal_seq: 0,
          market_count: 0,
          error: errorMsg,
        },
        toString() {
          return text;
        },
      };
    }
  },
};

export const feraterraPlugin = {
  name: "@feraterra/plugin-elizaos",
  description:
    "Zero-dependency ElizaOS plugin for FeraTerra — sovereign CLOB perpetuals, spot, basis spreads, zero-key stateless order preview, headless protocol terms, leaderboard, and cryptographic solvency verification.",
  actions: [
    feraterraListMarketsAction,
    feraterraGetOrderbookAction,
    feraterraGetLeaderboardAction,
    feraterraGetTermsAction,
    feraterraPreviewOrderAction,
    feraterraVerifySolvencyAction,
  ],
  providers: [feraterraMarketSummaryProvider],
};

export default feraterraPlugin;
