import crypto from 'node:crypto';

/**
 * RFC 8032 §7.1 Test Vector 1 (publicly documented IETF standard test vector).
 * Strictly for local development (`#if DEBUG` in SkillPouchApp) and unit tests.
 * Production builds of SkillPouchApp compile out `DEV_FIXTURE_KEY_ID` completely.
 */
export const DEV_FIXTURE_KEY_ID = 'dev-fixture-only';
export const DEV_FIXTURE_SEED_HEX =
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
export const DEV_FIXTURE_PUBLIC_KEY_HEX =
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
export const DEV_FIXTURE_PUBLIC_KEY_BASE64 =
  '11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=';

export const TEST_ONLY_SIGNATURE_PLACEHOLDER = 'TEST_ONLY_NOT_A_REAL_SIGNATURE';

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Compute SHA-256 lowercase hex digest of exact UTF-8/raw Buffer bytes.
 */
export function computeSha256Hex(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Format `.sha256` sidecar content per ADR-002 §B.1 (`{hex}  catalogue.json\n`).
 */
export function formatSha256Sidecar(sha256Hex, fileName = 'catalogue.json') {
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) {
    throw new Error(`[sign] Invalid sha256 hex digest: ${sha256Hex}`);
  }
  return `${sha256Hex}  ${fileName}\n`;
}

/**
 * Parse a 32-byte Ed25519 seed (hex / base64) or PKCS#8 PEM into a Node KeyObject.
 */
export function createEd25519PrivateKey(rawKeyMaterial) {
  if (!rawKeyMaterial || typeof rawKeyMaterial !== 'string') {
    throw new Error('[sign] Missing Ed25519 private key material');
  }
  const trimmed = rawKeyMaterial.trim();

  if (trimmed.startsWith('-----BEGIN ')) {
    const keyObj = crypto.createPrivateKey(trimmed);
    if (keyObj.asymmetricKeyType !== 'ed25519') {
      throw new Error(`[sign] Expected ed25519 PEM key, got ${keyObj.asymmetricKeyType}`);
    }
    return keyObj;
  }

  let seedBytes;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    seedBytes = Buffer.from(trimmed, 'hex');
  } else {
    seedBytes = Buffer.from(trimmed, 'base64');
  }

  if (seedBytes.length !== 32) {
    throw new Error(
      `[sign] Ed25519 raw seed must decode to 32 bytes (got ${seedBytes.length} bytes)`,
    );
  }

  const pkcs8Der = Buffer.concat([ED25519_PKCS8_PREFIX, seedBytes]);
  return crypto.createPrivateKey({
    key: pkcs8Der,
    format: 'der',
    type: 'pkcs8',
  });
}

/**
 * Parse a 32-byte raw Ed25519 public key (hex or base64) or SPKI PEM into a Node KeyObject.
 */
export function createEd25519PublicKey(rawPublicKey) {
  if (!rawPublicKey || typeof rawPublicKey !== 'string') {
    throw new Error('[sign] Missing Ed25519 public key material');
  }
  const trimmed = rawPublicKey.trim();

  if (trimmed.startsWith('-----BEGIN ')) {
    const pubObj = crypto.createPublicKey(trimmed);
    if (pubObj.asymmetricKeyType !== 'ed25519') {
      throw new Error(`[sign] Expected ed25519 public key, got ${pubObj.asymmetricKeyType}`);
    }
    return pubObj;
  }

  const rawBytes = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (rawBytes.length !== 32) {
    throw new Error(
      `[sign] Ed25519 raw public key must decode to 32 bytes (got ${rawBytes.length} bytes)`,
    );
  }

  const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, rawBytes]);
  return crypto.createPublicKey({
    key: spkiDer,
    format: 'der',
    type: 'spki',
  });
}

/**
 * Export raw 32-byte public key from an Ed25519 PrivateKey or PublicKey KeyObject.
 */
export function exportRawEd25519PublicKey(keyObject) {
  const pubObj =
    keyObject.type === 'private' ? crypto.createPublicKey(keyObject) : keyObject;
  const spkiDer = pubObj.export({ format: 'der', type: 'spki' });
  const rawBytes = spkiDer.subarray(spkiDer.length - 32);
  return {
    hex: rawBytes.toString('hex'),
    base64: rawBytes.toString('base64'),
  };
}

/**
 * Generate a fresh offline Ed25519 signing keypair (32-byte seed + 32-byte raw public key).
 * Never persisted into the repository automatically.
 */
export function generateEd25519KeyPair(keyId = 'publish-key-2026q4') {
  const seedBytes = crypto.randomBytes(32);
  const privKey = createEd25519PrivateKey(seedBytes.toString('hex'));
  const pub = exportRawEd25519PublicKey(privKey);
  return {
    keyId,
    privateSeedBase64: seedBytes.toString('base64'),
    privateSeedHex: seedBytes.toString('hex'),
    publicKeyBase64: pub.base64,
    publicKeyHex: pub.hex,
  };
}

/**
 * Sign `catalogue.json` exact bytes and produce a detached `PublishEnvelope` (`catalogue.sig`).
 *
 * Per ADR-002 §B.2:
 * - Signs the 64-byte lowercase ASCII hex SHA-256 digest of `catalogue.json`.
 * - Priority:
 *   1. `options.testOnly === true` -> emits `TEST_ONLY_NOT_A_REAL_SIGNATURE` placeholder
 *   2. `options.privateKey` or `process.env.CATALOGUE_SIGNING_PRIVATE_KEY` -> signs with prod key
 *   3. `options.allowDevFixture !== false` -> signs with non-production `dev-fixture-only` RFC 8032 vector
 */
export function signCatalogueBytes(catalogueBytes, metadata, options = {}) {
  const { releaseSequence, catalogueVersion, signedAt, rollbackOf } = metadata;
  if (!Number.isInteger(releaseSequence) || releaseSequence < 1) {
    throw new Error(`[sign] Invalid releaseSequence: ${releaseSequence}`);
  }
  if (!catalogueVersion || typeof catalogueVersion !== 'string') {
    throw new Error('[sign] Missing catalogueVersion');
  }
  const timestamp = signedAt || new Date().toISOString();
  const sha256 = computeSha256Hex(catalogueBytes);

  if (options.testOnly) {
    const envelope = {
      alg: 'Ed25519',
      catalogueVersion,
      keyId: options.keyId || 'test-only-placeholder',
      releaseSequence,
      sha256,
      signature: TEST_ONLY_SIGNATURE_PLACEHOLDER,
      signedAt: timestamp,
    };
    if (rollbackOf !== undefined) {
      envelope.rollbackOf = rollbackOf;
    }
    return envelope;
  }

  const envPrivateKey =
    options.privateKey ?? process.env.CATALOGUE_SIGNING_PRIVATE_KEY ?? '';
  let keyId;
  let privateKeyObj;

  if (envPrivateKey.trim()) {
    keyId =
      options.keyId ||
      process.env.CATALOGUE_SIGNING_KEY_ID ||
      'publish-key-2026q4';
    if (keyId === DEV_FIXTURE_KEY_ID) {
      throw new Error(
        `[sign] External signing key must not use reserved "${DEV_FIXTURE_KEY_ID}" keyId`,
      );
    }
    privateKeyObj = createEd25519PrivateKey(envPrivateKey);
  } else if (options.allowDevFixture !== false) {
    keyId = DEV_FIXTURE_KEY_ID;
    privateKeyObj = createEd25519PrivateKey(DEV_FIXTURE_SEED_HEX);
  } else {
    throw new Error(
      '[sign] CATALOGUE_SIGNING_PRIVATE_KEY is required when dev fixture signing is disabled',
    );
  }

  const payloadBytes = Buffer.from(sha256, 'ascii');
  const signatureBase64 = crypto
    .sign(null, payloadBytes, privateKeyObj)
    .toString('base64');

  const envelope = {
    alg: 'Ed25519',
    catalogueVersion,
    keyId,
    releaseSequence,
    sha256,
    signature: signatureBase64,
    signedAt: timestamp,
  };
  if (rollbackOf !== undefined) {
    envelope.rollbackOf = rollbackOf;
  }
  return envelope;
}

/**
 * Verify `catalogue.json` bytes against `.sha256` sidecar and detached `PublishEnvelope` (`catalogue.sig`).
 */
export function verifyCatalogueEnvelope({
  catalogueBytes,
  sha256Text,
  envelope,
  trustedPublicKeys = { [DEV_FIXTURE_KEY_ID]: DEV_FIXTURE_PUBLIC_KEY_BASE64 },
}) {
  const actualSha256 = computeSha256Hex(catalogueBytes);

  if (sha256Text !== undefined) {
    const match = String(sha256Text)
      .trim()
      .match(/^([0-9a-f]{64})\s+catalogue\.json$/);
    if (!match) {
      throw new Error('[verify] Malformed catalogue.json.sha256 sidecar format');
    }
    if (match[1] !== actualSha256) {
      throw new Error(
        `[verify] Sidecar sha256 mismatch: expected ${match[1]}, got ${actualSha256}`,
      );
    }
  }

  if (!envelope || typeof envelope !== 'object') {
    throw new Error('[verify] Missing PublishEnvelope object');
  }
  if (envelope.alg !== 'Ed25519') {
    throw new Error(`[verify] Unsupported signature algorithm: ${envelope.alg}`);
  }
  if (envelope.sha256 !== actualSha256) {
    throw new Error(
      `[verify] Envelope sha256 mismatch: envelope=${envelope.sha256}, actual=${actualSha256}`,
    );
  }

  const parsedDoc = JSON.parse(
    Buffer.isBuffer(catalogueBytes)
      ? catalogueBytes.toString('utf8')
      : String(catalogueBytes),
  );
  if (parsedDoc.releaseSequence !== envelope.releaseSequence) {
    throw new Error(
      `[verify] releaseSequence mismatch: doc=${parsedDoc.releaseSequence}, envelope=${envelope.releaseSequence}`,
    );
  }
  if (parsedDoc.catalogueVersion !== envelope.catalogueVersion) {
    throw new Error(
      `[verify] catalogueVersion mismatch: doc=${parsedDoc.catalogueVersion}, envelope=${envelope.catalogueVersion}`,
    );
  }

  const rawPubKey = trustedPublicKeys[envelope.keyId];
  if (!rawPubKey) {
    throw new Error(`[verify] Untrusted or unknown keyId: "${envelope.keyId}"`);
  }

  const publicKeyObj = createEd25519PublicKey(rawPubKey);
  const sigBytes = Buffer.from(envelope.signature, 'base64');
  if (sigBytes.length !== 64) {
    throw new Error(`[verify] Invalid Ed25519 signature byte length: ${sigBytes.length}`);
  }
  const ok = crypto.verify(
    null,
    Buffer.from(actualSha256, 'ascii'),
    publicKeyObj,
    sigBytes,
  );
  if (!ok) {
    throw new Error('[verify] Ed25519 signature verification failed');
  }

  return {
    ok: true,
    sha256: actualSha256,
    keyId: envelope.keyId,
    releaseSequence: parsedDoc.releaseSequence,
    catalogueVersion: parsedDoc.catalogueVersion,
  };
}
