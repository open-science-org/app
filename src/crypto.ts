// Hashing, canonical JSON and Ethereum-style keys (OIP-10 section 1, OIP-13 section 1, OIP-16 section 6).
import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

// JSON Canonicalization Scheme (RFC 8785) for the values the ledger uses:
// strings, safe integers, booleans, null, arrays and objects. Amounts are decimal strings, never floats.
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`non-integer number in canonical JSON: ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
  }
  throw new Error(`unsupported value in canonical JSON: ${typeof value}`);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `sha256:<hex>` of the canonical form, as used for version IDs and block hashes. */
export function hashOf(value: unknown): string {
  return 'sha256:' + sha256Hex(canonicalize(value));
}

export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return 'sha256:' + sha256Hex('');
  let level = leaves.map((l) => sha256Hex(l));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256Hex(level[i] + (level[i + 1] ?? level[i])));
    level = next;
  }
  return 'sha256:' + level[0];
}

function keccak(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}

export function addressOfPublicKey(pub: Uint8Array): string {
  const uncompressed = secp256k1.Point.fromBytes(pub).toBytes(false);
  return '0x' + bytesToHex(keccak(uncompressed.slice(1)).slice(-20));
}

export function addressOf(privateKeyHex: string): string {
  return addressOfPublicKey(secp256k1.getPublicKey(hexToBytes(privateKeyHex)));
}

/** Deterministic development key. Never use for anything real. */
export function devKey(name: string): string {
  return sha256Hex('oso-dev-key:' + name);
}

/** Signs keccak256 of a message string; returns a 65-byte recoverable signature as hex. */
export function signMessage(privateKeyHex: string, message: string): string {
  const sig = secp256k1.sign(keccak(utf8ToBytes(message)), hexToBytes(privateKeyHex), { prehash: false, format: 'recovered' });
  return bytesToHex(sig);
}

/** Returns the address that signed `message`, or null if the signature is malformed. */
export function recoverSigner(message: string, signatureHex: string): string | null {
  try {
    const pub = secp256k1.recoverPublicKey(hexToBytes(signatureHex), keccak(utf8ToBytes(message)), { prehash: false });
    return addressOfPublicKey(pub);
  } catch {
    return null;
  }
}
