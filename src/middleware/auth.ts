/**
 * Authentication Middleware
 * Handles bot authentication and moderator verification
 */

import type { Context, Next } from 'hono';
import type { Env, AuthContext } from '../types.js';

type Variables = {
  auth: AuthContext;
};

/**
 * Extract and validate authentication from request headers
 */
export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');
  const userDiscordId = c.req.header('X-User-Discord-ID');
  const userName = c.req.header('X-User-Discord-Name');

  // Default: unauthenticated
  let auth: AuthContext = {
    isAuthenticated: false,
    isModerator: false,
  };

  // Check for Bearer token authentication
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    // Validate against BOT_API_SECRET
    if (token === c.env.BOT_API_SECRET) {
      auth = {
        isAuthenticated: true,
        isModerator: false,
        userDiscordId: userDiscordId || undefined,
        userName: userName || undefined,
      };

      // Check if user is a moderator
      if (userDiscordId && c.env.MODERATOR_IDS) {
        const moderatorIds = c.env.MODERATOR_IDS.split(',').map((id) => id.trim());
        auth.isModerator = moderatorIds.includes(userDiscordId);
      }
    }
  }

  // Set auth context for downstream handlers
  c.set('auth', auth);

  await next();
}

/**
 * Require authentication for protected routes
 * Use as middleware on specific routes
 */
export function requireAuth(
  c: Context<{ Bindings: Env; Variables: Variables }>
): Response | null {
  const auth = c.get('auth');

  if (!auth.isAuthenticated) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Valid authentication required',
      },
      401
    );
  }

  return null;
}

/**
 * Require moderator privileges
 * Use as middleware on moderation routes
 */
export function requireModerator(
  c: Context<{ Bindings: Env; Variables: Variables }>
): Response | null {
  const auth = c.get('auth');

  if (!auth.isAuthenticated) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Valid authentication required',
      },
      401
    );
  }

  if (!auth.isModerator) {
    return c.json(
      {
        error: 'Forbidden',
        message: 'Moderator privileges required',
      },
      403
    );
  }

  return null;
}

/**
 * Require user Discord ID in headers
 * For endpoints that need to know who is making the request
 */
export function requireUserContext(
  c: Context<{ Bindings: Env; Variables: Variables }>
): Response | null {
  const auth = c.get('auth');

  if (!auth.userDiscordId) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'X-User-Discord-ID header required',
      },
      400
    );
  }

  return null;
}
