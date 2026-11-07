import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestSiteData, writePageManifest } from './lib/ingest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');

try {
  const data = ingestSiteData({ siteRoot });
  const manifestPath = path.join(siteRoot, 'content/page-manifest.json');
  writePageManifest(manifestPath, data.manifest);

  console.log(
    `[ingest] OK: directories=${data.directories.length} tasks=${data.tasks.length} stages=${data.stages.length} skills=${data.skills.length} pages=${data.manifest.pages.length} bilingualComplete=${data.bilingualComplete}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
