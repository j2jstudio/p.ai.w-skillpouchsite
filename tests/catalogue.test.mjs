import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { ingestSiteData } from '../scripts/lib/ingest.mjs';
import {
  buildCatalogueDocumentFromSiteData,
  emitCatalogueRelease,
  serializeCanonicalJson,
  validateCatalogueDocument,
} from '../scripts/lib/catalogue-builder.mjs';
import {
  computeSha256Hex,
  DEV_FIXTURE_KEY_ID,
  DEV_FIXTURE_PUBLIC_KEY_BASE64,
  generateEd25519KeyPair,
  verifyCatalogueEnvelope,
} from '../scripts/lib/sign-catalogue.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');

test('builds full 8-dir / 16-task / 48-stage / 38-skill catalogue with parallel stage skillIds and passes V01-V10', () => {
  const siteData = ingestSiteData({ siteRoot });
  const pageManifest = JSON.parse(
    fs.readFileSync(path.join(siteRoot, 'content/page-manifest.json'), 'utf8'),
  );
  const doc = buildCatalogueDocumentFromSiteData(siteData, {
    catalogueVersion: '2026.11.0',
    generatedAt: '2026-11-02T15:00:00+08:00',
    releaseSequence: 1,
  });

  assert.equal(doc.directories.length, 8);
  assert.equal(doc.tasks.length, 16);
  assert.equal(doc.stages.length, 48);
  assert.equal(doc.skills.length, 38);

  const stageMap = new Map(doc.stages.map((st) => [st.id, st]));
  assert.equal(stageMap.get('T10.s1').skillIds.length, 3);
  assert.equal(stageMap.get('T10.s2').skillIds.length, 2);
  assert.equal(stageMap.get('T14.s1').skillIds.length, 2);
  assert.equal(stageMap.get('T01.s1').skillIds.length, 1);

  assert.equal(
    validateCatalogueDocument(doc, {
      pageManifest,
      rejectedKeys: siteData.rejectedKeys,
    }),
    true,
  );

  // Canonical JSON serialization is deterministic regardless of property insertion order
  const shuffled = {
    withdrawals: doc.withdrawals,
    tasks: doc.tasks,
    skills: doc.skills,
    stages: doc.stages,
    directories: doc.directories,
    i18nDefault: doc.i18nDefault,
    sourceReleaseSet: doc.sourceReleaseSet,
    generatedAt: doc.generatedAt,
    minimumAppVersion: doc.minimumAppVersion,
    releaseSequence: doc.releaseSequence,
    catalogueVersion: doc.catalogueVersion,
    schemaVersion: doc.schemaVersion,
    changelogSummary: doc.changelogSummary,
  };
  assert.equal(serializeCanonicalJson(doc), serializeCanonicalJson(shuffled));
});

test('enforces V01-V10 negative validation gates (broken refs, TBD pins, forbidden leaks, withdraw conflict)', () => {
  const siteData = ingestSiteData({ siteRoot });
  const baseDoc = () =>
    structuredClone(
      buildCatalogueDocumentFromSiteData(siteData, {
        generatedAt: '2026-11-02T15:00:00+08:00',
        releaseSequence: 2,
      }),
    );

  // V02 broken_ref
  {
    const doc = baseDoc();
    doc.stages[0].skillIds = ['skill:nonexistent--repo--ghost'];
    assert.throws(
      () => validateCatalogueDocument(doc),
      (err) => err.code === 'broken_ref',
    );
  }

  // V03 empty_task_or_stage
  {
    const doc = baseDoc();
    doc.stages[0].skillIds = [];
    assert.throws(
      () => validateCatalogueDocument(doc),
      (err) => err.code === 'empty_task_or_stage',
    );
  }

  // V06 pin_invalid (TBD revision)
  {
    const doc = baseDoc();
    doc.skills[0].revision = 'TBD';
    assert.throws(
      () => validateCatalogueDocument(doc),
      (err) => err.code === 'pin_invalid',
    );
  }

  // V07 sequence_invalid (not strictly greater than previous)
  {
    const doc = baseDoc();
    assert.throws(
      () => validateCatalogueDocument(doc, { previousReleaseSequence: 2 }),
      (err) => err.code === 'sequence_invalid',
    );
  }

  // V08 withdraw_conflict
  {
    const doc = baseDoc();
    doc.withdrawals.push({
      entityId: 'T01',
      entityType: 'task',
      id: 'wd:task:T01:2026.11.0',
      reasonCode: 'editorial',
      reasonPublic: 'Withdrawn in test',
      withdrawnAt: '2026-11-02T15:00:00+08:00',
    });
    assert.throws(
      () => validateCatalogueDocument(doc),
      (err) => err.code === 'withdraw_conflict',
    );
  }

  // V09 forbidden_field (G-I / popularity token)
  {
    const doc = baseDoc();
    doc.skills[0].summary.i18n['zh-Hans'] += ' 内部评分 G-I 95';
    assert.throws(
      () => validateCatalogueDocument(doc),
      (err) => err.code === 'forbidden_field',
    );
  }
});

test('emits signed release layout, verifies Ed25519 signature, blocks overwrite, and supports --bump & --ensure', () => {
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-cat-out-'));
  try {
    // 1. Emit release 1 with default dev-fixture-only key
    const r1 = emitCatalogueRelease({
      outputRoot: tmpOut,
      siteRoot,
      timestamp: '2026-11-02T15:00:00+08:00',
    });
    assert.equal(r1.skipped, false);
    assert.equal(r1.releaseSequence, 1);
    assert.equal(r1.keyId, DEV_FIXTURE_KEY_ID);

    const catBytes1 = fs.readFileSync(path.join(tmpOut, 'releases/1/catalogue.json'));
    const shaText1 = fs.readFileSync(path.join(tmpOut, 'releases/1/catalogue.json.sha256'), 'utf8');
    const sigObj1 = JSON.parse(
      fs.readFileSync(path.join(tmpOut, 'releases/1/catalogue.sig'), 'utf8'),
    );

    const verified1 = verifyCatalogueEnvelope({
      catalogueBytes: catBytes1,
      envelope: sigObj1,
      sha256Text: shaText1,
    });
    assert.equal(verified1.ok, true);
    assert.equal(verified1.releaseSequence, 1);

    // Tamper 1 byte in catalogue.json -> must reject
    const tamperedBytes = Buffer.from(catBytes1);
    tamperedBytes[tamperedBytes.length - 5] ^= 0x01;
    assert.throws(
      () =>
        verifyCatalogueEnvelope({
          catalogueBytes: tamperedBytes,
          envelope: sigObj1,
          sha256Text: shaText1,
        }),
      /sha256 mismatch/i,
    );

    // 2. --ensure skips touching existing files
    const indexMtimeBefore = fs.statSync(path.join(tmpOut, 'index.json')).mtimeMs;
    const ensured = emitCatalogueRelease({
      ensureOnly: true,
      outputRoot: tmpOut,
      siteRoot,
    });
    assert.equal(ensured.skipped, true);
    assert.equal(fs.statSync(path.join(tmpOut, 'index.json')).mtimeMs, indexMtimeBefore);

    // 3. Re-running without --bump or --force-dev refuses to overwrite immutable release 1
    assert.throws(
      () => emitCatalogueRelease({ outputRoot: tmpOut, siteRoot }),
      (err) => err.code === 'sequence_invalid',
    );

    // 4. --bump with custom production Ed25519 keypair emits release 2 while keeping release 1 intact
    const prodKey = generateEd25519KeyPair('publish-key-2026q4');
    const r2 = emitCatalogueRelease({
      bump: true,
      catalogueVersion: '2026.11.1',
      keyId: prodKey.keyId,
      outputRoot: tmpOut,
      privateKey: prodKey.privateSeedBase64,
      siteRoot,
      timestamp: '2026-11-02T16:00:00+08:00',
    });
    assert.equal(r2.releaseSequence, 2);
    assert.equal(r2.keyId, 'publish-key-2026q4');
    assert.equal(fs.existsSync(path.join(tmpOut, 'releases/1/catalogue.json')), true);

    const indexDoc2 = JSON.parse(fs.readFileSync(path.join(tmpOut, 'index.json'), 'utf8'));
    assert.equal(indexDoc2.currentReleaseSequence, 2);
    assert.equal(indexDoc2.catalogueUrl, '/catalogue/v1/releases/2/catalogue.json');

    const catBytes2 = fs.readFileSync(path.join(tmpOut, 'releases/2/catalogue.json'));
    const shaText2 = fs.readFileSync(path.join(tmpOut, 'releases/2/catalogue.json.sha256'), 'utf8');
    const sigObj2 = JSON.parse(
      fs.readFileSync(path.join(tmpOut, 'releases/2/catalogue.sig'), 'utf8'),
    );

    // Fails if verified only against dev-fixture-only key
    assert.throws(
      () =>
        verifyCatalogueEnvelope({
          catalogueBytes: catBytes2,
          envelope: sigObj2,
          sha256Text: shaText2,
          trustedPublicKeys: { [DEV_FIXTURE_KEY_ID]: DEV_FIXTURE_PUBLIC_KEY_BASE64 },
        }),
      /Untrusted or unknown keyId/i,
    );

    // Succeeds with prodKey public key
    const verified2 = verifyCatalogueEnvelope({
      catalogueBytes: catBytes2,
      envelope: sigObj2,
      sha256Text: shaText2,
      trustedPublicKeys: { [prodKey.keyId]: prodKey.publicKeyBase64 },
    });
    assert.equal(verified2.ok, true);
    assert.equal(verified2.releaseSequence, 2);
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }
});

test('vite dev server serves public/catalogue/v1 with ADR-003 Cache-Control, Content-Type, ETag 304, and OPTIONS 204', async () => {
  // Ensure public/catalogue/v1 exists
  emitCatalogueRelease({ ensureOnly: true, siteRoot });

  const server = await createServer({
    configFile: path.join(siteRoot, 'vite.config.mjs'),
    logLevel: 'error',
    server: { port: 0, strictPort: false },
  });
  await server.listen(0);
  try {
    const addr = server.httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : server.config.server.port;
    const base = `http://localhost:${port}`;

    // 1. OPTIONS preflight -> 204
    const optRes = await fetch(`${base}/catalogue/v1/index.json`, { method: 'OPTIONS' });
    assert.equal(optRes.status, 204);

    // 2. GET index.json -> 200 + ETag + short cache
    const idxRes = await fetch(`${base}/catalogue/v1/index.json`);
    assert.equal(idxRes.status, 200);
    assert.match(idxRes.headers.get('content-type') || '', /^application\/json/i);
    assert.equal(idxRes.headers.get('cache-control'), 'public, max-age=60, must-revalidate');
    const etag = idxRes.headers.get('etag');
    assert.ok(etag && etag.startsWith('"'));
    const indexJson = await idxRes.json();
    assert.ok(indexJson.currentReleaseSequence >= 1);

    // 3. Conditional GET with If-None-Match -> 304 Not Modified
    const cachedRes = await fetch(`${base}/catalogue/v1/index.json`, {
      headers: { 'If-None-Match': etag },
    });
    assert.equal(cachedRes.status, 304);

    // 4. GET immutable release artifacts (.json, .sha256, .sig)
    const [catRes, shaRes, sigRes] = await Promise.all([
      fetch(`${base}${indexJson.catalogueUrl}`),
      fetch(`${base}${indexJson.sha256Url}`),
      fetch(`${base}${indexJson.sigUrl}`),
    ]);
    assert.equal(catRes.status, 200);
    assert.equal(catRes.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(sigRes.headers.get('content-type') || '', /^application\/json/i);
    assert.match(shaRes.headers.get('content-type') || '', /^text\/plain/i);

    const catBytes = Buffer.from(await catRes.arrayBuffer());
    const shaText = await shaRes.text();
    const sigObj = await sigRes.json();
    assert.equal(shaText.trim(), `${computeSha256Hex(catBytes)}  catalogue.json`);
    const verified = verifyCatalogueEnvelope({
      catalogueBytes: catBytes,
      envelope: sigObj,
      sha256Text: shaText,
    });
    assert.equal(verified.ok, true);

    // 5. Missing release returns JSON 404 (not HTML SPA fallback)
    const missingRes = await fetch(`${base}/catalogue/v1/releases/999999/catalogue.json`);
    assert.equal(missingRes.status, 404);
    assert.match(missingRes.headers.get('content-type') || '', /^application\/json/i);
  } finally {
    await server.close();
  }
});

