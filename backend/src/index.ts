import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import providerRoutes from './routes/providers.js';
import codexProxyRoutes from './routes/codexProxy.js';
import claudeProxyRoutes from './routes/claudeProxy.js';
import { logger } from './services/logger.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3120', 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = [
  path.resolve(__dirname, '../../frontend/dist'),
  path.resolve(process.cwd(), 'frontend/dist'),
].find((dir) => fs.existsSync(path.join(dir, 'index.html')));

// Middleware
app.use(cors());

// 全量请求日志 —— 放在 body parser 之前，确保即使 body 解析失败也能记录
app.use((req, _res, next) => {
  const start = Date.now();
  _res.on('finish', () => {
    logger.info('http', `${req.method} ${req.path} → ${_res.statusCode} (${Date.now() - start}ms)`, {
      host: req.headers.host,
      ua: (req.headers['user-agent'] || '').slice(0, 60),
    });
  });
  next();
});

// Body parser — 提高限制到 50MB，Claude Code 请求含大量 system prompt + tools
app.use(express.json({ limit: '50mb' }));

// API Routes
app.use('/api', providerRoutes);
app.use('/proxy', codexProxyRoutes);
app.use('/proxy', claudeProxyRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// CLI process identity check: used before killing a port to avoid stopping unrelated services.
app.get('/info', (_req, res) => {
  res.type('text/plain').send('cv-switch-web');
});

// Production: serve built frontend + SPA fallback
if (frontendDist) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/proxy')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  const env = process.env.NODE_ENV || 'development';
  logger.info('server', `CC Switch Web 启动`, {
    port: PORT,
    env,
    node: process.version,
    logDir: logger.logDir,
  });
});
