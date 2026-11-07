import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitCatalogueRelease } from './lib/catalogue-builder.mjs';
import { generateEd25519KeyPair } from './lib/sign-catalogue.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');

function parseCliArgs(argv) {
  const opts = {
    bump: false,
    ensureOnly: false,
    forceDev: false,
    keygen: false,
    testOnly: false,
  };
  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
    if (arg === '--ensure') {
      opts.ensureOnly = true;
    } else if (arg === '--bump') {
      opts.bump = true;
    } else if (arg === '--force-dev') {
      opts.forceDev = true;
    } else if (arg === '--test-only') {
      opts.testOnly = true;
    } else if (arg === '--keygen') {
      opts.keygen = true;
    } else if (arg === '--seq' && argv[idx + 1]) {
      opts.releaseSequence = Number.parseInt(argv[idx + 1], 10);
      idx += 1;
    } else if (arg === '--version' && argv[idx + 1]) {
      opts.catalogueVersion = argv[idx + 1];
      idx += 1;
    } else if (arg === '--out' && argv[idx + 1]) {
      opts.outputRoot = path.resolve(argv[idx + 1]);
      idx += 1;
    } else if (arg === '--key-id' && argv[idx + 1]) {
      opts.keyId = argv[idx + 1];
      idx += 1;
    }
  }
  return opts;
}

const cli = parseCliArgs(process.argv.slice(2));

if (cli.keygen) {
  const generated = generateEd25519KeyPair(cli.keyId || 'publish-key-2026q4');
  console.log(JSON.stringify(generated, null, 2));
  process.exit(0);
}

const result = emitCatalogueRelease({
  ...cli,
  siteRoot,
});

if (!result.skipped) {
  console.log(
    `[catalogue] Built release #${result.releaseSequence} (${result.catalogueVersion}) -> ${path.relative(siteRoot, result.releaseDir)} ` +
      `[${result.counts.directories} dirs, ${result.counts.tasks} tasks, ${result.counts.stages} stages, ${result.counts.skills} skills, ` +
      `${(result.byteLength / 1024).toFixed(1)} KiB, keyId=${result.keyId}]`,
  );
}

