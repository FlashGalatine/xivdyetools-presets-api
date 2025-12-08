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

// Security headers middleware
app.use('*', async (c, next) => {
  await next();
  // Prevent MIME-type sniffing attacks
  c.header('X-Content-Type-Options', 'nosniff');
  // Prevent clickjacking by denying iframe embedding
  c.header('X-Frame-Options', 'DENY');
  // Enforce HTTPS for 1 year (only in production)
  if (c.env.ENVIRONMENT === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

// CORS configuration
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const allowedOrigin = c.env.CORS_ORIGIN;
      // Additional allowed origins from environment (comma-separated)
      const additionalOrigins = c.env.ADDITIONAL_CORS_ORIGINS
        ? c.env.ADDITIONAL_CORS_ORIGINS.split(',').map((o: string) => o.trim())
        : [];

      // SECURITY: Don't allow requests without an Origin header
      // (server-to-server calls should use API keys, not CORS)
      if (!origin) {
        return null;
      }

      // Allow configured origin and additional production origins
      if (origin === allowedOrigin || additionalOrigins.includes(origin)) {
        return origin;
      }

      // SECURITY: Only allow specific localhost ports in development
      // This prevents malicious apps on other localhost ports from making requests
      const allowedDevOrigins = [
        'http://localhost:5173',   // Vite dev server
        'http://127.0.0.1:5173',   // Vite dev server (IP)
        'http://localhost:8787',   // Wrangler local dev
        'http://127.0.0.1:8787',   // Wrangler local dev (IP)
      ];
      if (allowedDevOrigins.includes(origin)) {
        return origin;
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
  // Don't expose internal errors in production
  const isDev = c.env.ENVIRONMENT === 'development';

  // Sanitize logs in production - only log error name and message, not full stack
  const logMessage = isDev ? err : { name: err.name, message: err.message };
  console.error('Unhandled error:', logMessage);

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
