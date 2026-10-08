import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PORT = parseInt(process.env.PORT || '8080', 10);

// Health check endpoint for Cloud Run and load balancers
app.get('/healthz', (_req, res) => {
  res.status(200).send('OK');
});

// Serve static assets for both /idle-distribution and root requests
if (existsSync(DIST_DIR)) {
  app.use('/idle-distribution', express.static(DIST_DIR));
  app.use(express.static(DIST_DIR));
}

// Single-page application fallback for client-side routing
if (existsSync(DIST_DIR)) {
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[idle-distribution] production server listening on port ${PORT}`);
});
