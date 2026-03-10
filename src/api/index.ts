import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { swaggerSpec } from './swagger.js';
import matchRouter from './routes/match.js';
import healthRouter from './routes/health.js';
import statsRouter from './routes/stats.js';
import runnerRouter from './routes/runner.js';

const app = express();

// Middleware
app.use(cors({ origin: config.api.corsOrigins }));
app.use(express.json());

// Swagger UI
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Veridion Challenge — API Docs',
}));
app.get('/docs/spec', (_req, res) => res.json(swaggerSpec));

// API routes
app.use('/api', matchRouter);
app.use('/api', healthRouter);
app.use('/api', statsRouter);
app.use('/api', runnerRouter);

// Root redirect to docs
app.get('/', (_req, res) => res.redirect('/docs'));

// Start server
app.listen(config.api.port, () => {
  logger.info(`API server running on http://localhost:${config.api.port}`);
  logger.info(`Swagger UI: http://localhost:${config.api.port}/docs`);
  logger.info(`Health: http://localhost:${config.api.port}/api/health`);
});

export default app;
