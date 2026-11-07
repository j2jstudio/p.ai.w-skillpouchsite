import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedRoot = path.resolve(__dirname, '.generated');
const publicRoot = path.resolve(__dirname, 'public');

function collectHtmlEntries(dir, baseDir = dir, acc = {}) {
  if (!fs.existsSync(dir)) {
    return acc;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectHtmlEntries(fullPath, baseDir, acc);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      const rel = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      const key = rel.replace(/\.html$/, '').replace(/\//g, '__');
      acc[key] = fullPath;
    }
  }
  return acc;
}

/**
 * Serves `/catalogue/v1/**` from `public/` during `vite` / `vite preview` with exact ADR-003
 * response headers (`Cache-Control`, `Content-Type` for `.sig` & `.sha256`, strong `ETag`,
 * `If-None-Match` -> `304 Not Modified`, and `OPTIONS` -> `204`).
 */
function catalogueFacadePlugin() {
  const handleCatalogueRequest = (req, res, next) => {
    const rawUrl = req.url || '';
    const pathname = rawUrl.split('?')[0];
    if (!pathname.startsWith('/catalogue/v1/')) {
      next();
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'If-None-Match, Accept, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'ETag, Cache-Control, Content-Length');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end('{"error":"method_not_allowed"}\n');
      return;
    }

    const relPath = pathname.replace(/^\/+/, '');
    const resolvedFile = path.resolve(publicRoot, relPath);
    if (!resolvedFile.startsWith(`${publicRoot}${path.sep}`) || !fs.existsSync(resolvedFile) || !fs.statSync(resolvedFile).isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end('{"error":"not_found"}\n');
      return;
    }

    const bytes = fs.readFileSync(resolvedFile);
    const sha256Prefix = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32);
    const etag = `"${sha256Prefix}"`;

    const isIndex = pathname === '/catalogue/v1/index.json';
    res.setHeader(
      'Cache-Control',
      isIndex ? 'public, max-age=60, must-revalidate' : 'public, max-age=31536000, immutable',
    );
    res.setHeader('ETag', etag);

    if (pathname.endsWith('.sha256')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }

    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch) {
      const candidates = String(ifNoneMatch)
        .split(',')
        .map((token) => token.trim().replace(/^W\//, ''));
      if (candidates.includes(etag) || candidates.includes('*')) {
        res.statusCode = 304;
        res.end();
        return;
      }
    }

    res.statusCode = 200;
    res.setHeader('Content-Length', String(bytes.length));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(bytes);
  };

  return {
    name: 'skillpouch-catalogue-facade',
    configureServer(server) {
      server.middlewares.use(handleCatalogueRequest);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleCatalogueRequest);
    },
  };
}

export default defineConfig(() => {
  const input = collectHtmlEntries(generatedRoot);
  return {
    root: generatedRoot,
    publicDir: publicRoot,
    plugins: [catalogueFacadePlugin()],
    resolve: {
      alias: [
        {
          find: /^@src\//,
          replacement: `${path.resolve(__dirname, 'src')}/`,
        },
        {
          find: /^\/src\//,
          replacement: `${path.resolve(__dirname, 'src')}/`,
        },
      ],
    },
    server: {
      port: 5173,
      strictPort: true,
      fs: {
        allow: [__dirname],
      },
    },
    appType: 'mpa',
    optimizeDeps: {
      noDiscovery: true,
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
      rollupOptions: {
        input,
      },
    },
  };
});
