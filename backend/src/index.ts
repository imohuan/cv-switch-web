import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import providerRoutes from './routes/providers.js';
import codexProxyRoutes from './routes/codexProxy.js';
import claudeProxyRoutes from './routes/claudeProxy.js';
import { logger } from './services/logger.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3120', 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Middleware
app.use(cors());
app.use(express.json());

// 全量请求日志中间件 —— 任何请求都记录
app.use((req, _res, next) => {
  logger.info('http', `>>> ${req.method} ${req.path}`, {
    host: req.headers.host,
    'user-agent': (req.headers['user-agent'] || '').slice(0, 80),
  });
  // 记录响应完成
  const start = Date.now();
  _res.on('finish', () => {
    logger.info('http', `<<< ${req.method} ${req.path} ${_res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// API Routes
app.use('/api', providerRoutes);
app.use('/proxy', codexProxyRoutes);
app.use('/proxy', claudeProxyRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Production: serve built frontend + SPA fallback
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (req, res, next) => {
  // Don't intercept API/proxy routes
  if (req.path.startsWith('/api') || req.path.startsWith('/proxy')) return next();
  const indexPath = path.join(frontendDist, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(404).json({ error: 'Not found (frontend may not be built yet)' });
    }
  });
});

app.listen(PORT, () => {
  const env = process.env.NODE_ENV || 'development';
  logger.info('server', `CC Switch Web 启动`, {
    port: PORT,
    env,
    node: process.version,
    logDir: logger.logDir,
  });
});
