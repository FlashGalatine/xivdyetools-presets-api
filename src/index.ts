/**
 * XIV Dye Tools Community Presets API
 * Cloudflare Worker Entry Point
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env, AuthContext } from './types.js';

// Import route handlers
import { presetsRouter } from './handlers/presets.js';
import { votesRouter } from './handlers/votes.js';
import { categoriesRouter } from './handlers/categories.js';
import { moderationRouter } from './handlers/moderation.js';

// Import middleware
import { authMiddleware } from './middleware/auth.js';

// Extend Hono context with our custom variables
type Variables = {
  auth: AuthContext;
};

// Create Hono app with typed bindings
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================
// GLOBAL MIDDLEWARE
// ============================================

// Request logging
app.use('*', logger());

// CORS configuration
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const allowedOrigin = c.env.CORS_ORIGIN;
      // Allow configured origin, localhost for dev, and no origin (direct API calls)
      if (
        !origin ||
        origin === allowedOrigin ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:')
      ) {
        return origin || '*';
      }
      return null;
    },
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-User-Discord-ID', 'X-User-Discord-Name'],
    exposeHeaders: ['X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400,
  })
);

// Authentication middleware (sets auth context)
app.use('*', authMiddleware);

// ============================================
// HEALTH CHECK
// ============================================

app.get('/', (c) => {
  return c.json({
    name: 'XIV Dye Tools Community Presets API',
    version: c.env.API_VERSION,
    status: 'healthy',
    environment: c.env.ENVIRONMENT,
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// API ROUTES
// ============================================

// Mount route handlers under /api/v1
app.route('/api/v1/presets', presetsRouter);
app.route('/api/v1/votes', votesRouter);
app.route('/api/v1/categories', categoriesRouter);
app.route('/api/v1/moderation', moderationRouter);

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: 'Not Found',
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
    404
  );
});

// Global error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);

  // Don't expose internal errors in production
  const isDev = c.env.ENVIRONMENT === 'development';

  return c.json(
    {
      error: 'Internal Server Error',
      message: isDev ? err.message : 'An unexpected error occurred',
      ...(isDev && { stack: err.stack }),
    },
    500
  );
});

// Export for Cloudflare Workers
export default app;
