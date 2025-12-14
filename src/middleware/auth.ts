/**
 * Authentication Middleware
 * Handles bot authentication (BOT_API_SECRET) and web authentication (JWT)
 */

import type { Context, Next } from 'hono';
import type { Env, AuthContext } from '../types.js';

type Variables = {
  auth: AuthContext;
};

// ============================================
// HMAC REQUEST SIGNING (Bot Auth Security)
// ============================================

/**
 * Verify HMAC signature for bot requests
 * This prevents header spoofing attacks by cryptographically
 * binding the user headers to the request
 *
 * Signature format: HMAC-SHA256(timestamp:userDiscordId:userName)
 */
async function verifyBotRequestSignature(
  signature: string | undefined,
  timestamp: string | undefined,
  userDiscordId: string | undefined,
  userName: string | undefined,
  signingSecret: string
): Promise<boolean> {
  if (!signature || !timestamp) return false;

  // Reject requests older than 5 minutes to prevent replay attacks
  const requestTime = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(requestTime) || Math.abs(now - requestTime) > 300) {
    return false;
  }

  // Recreate the signed message
  const message = `${timestamp}:${userDiscordId || ''}:${userName || ''}`;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(signingSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Decode hex signature
    const signatureBytes = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    return await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(message));
  } catch {
    return false;
  }
}

// ============================================
// JWT VERIFICATION (Web Auth)
// ============================================

interface JWTPayload {
  sub: string; // Discord user ID
  iat: number;
  exp: number;
  iss: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

/**
 * Base64URL decode to string
 */
function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4;
  if (padding) {
    base64 += '='.repeat(4 - padding);
  }
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Verify JWT signature, algorithm, and expiration
 * SECURITY: Validates algorithm to prevent JWT algorithm confusion attacks
 */
async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;

    // SECURITY: Validate JWT algorithm before signature verification
    // This prevents algorithm confusion attacks (e.g., "alg": "none")
    try {
      const header = JSON.parse(base64UrlDecode(encodedHeader));
      if (header.alg !== 'HS256') {
        console.warn('JWT verification failed: Invalid algorithm', { alg: header.alg });
        return null;
      }
    } catch {
      console.warn('JWT verification failed: Could not parse header');
      return null;
    }

    // Verify signature using HMAC-SHA256
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Decode signature from base64url
    let sigBase64 = signature.replace(/-/g, '+').replace(/_/g, '/');
    const sigPadding = sigBase64.length % 4;
    if (sigPadding) {
      sigBase64 += '='.repeat(4 - sigPadding);
    }
    const sigBytes = Uint8Array.from(atob(sigBase64), (c) => c.charCodeAt(0));

    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      encoder.encode(signatureInput)
    );

    if (!isValid) return null;

    // Decode and validate payload
    const payload: JWTPayload = JSON.parse(base64UrlDecode(encodedPayload));

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if a user ID is in the moderator list
 * Handles various formats: comma-separated, space-separated, newline-separated
 */
function checkModerator(userDiscordId: string | undefined, moderatorIds: string): boolean {
  if (!userDiscordId || !moderatorIds) return false;
  // Split on any combination of whitespace and/or commas for maximum flexibility
  // This handles: "123,456", "123, 456", "123 456", "123\n456", etc.
  const ids = moderatorIds
    .split(/[\s,]+/)
    .filter(Boolean); // Remove empty strings from split
  return ids.includes(userDiscordId);
}

// ============================================
// MIDDLEWARE
// ============================================

/**
 * Extract and validate authentication from request headers
 * Supports two authentication methods:
 * 1. Bot Auth: Bearer token = BOT_API_SECRET with X-User-Discord-ID header
 * 2. Web Auth: Bearer token = JWT from OAuth worker
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
    authSource: 'none',
  };

  // Check for Bearer token authentication
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    // Method 1: Bot authentication (BOT_API_SECRET)
    if (token === c.env.BOT_API_SECRET) {
      // SECURITY: Always require HMAC signature for bot authentication
      // This prevents header spoofing attacks where an attacker with the API secret
      // could set arbitrary X-User-Discord-ID headers to impersonate users
      if (!c.env.BOT_SIGNING_SECRET) {
        // CRITICAL: BOT_SIGNING_SECRET not configured - reject bot auth entirely
        // This prevents falling back to trusting user-supplied headers
        console.error('Bot auth: BOT_SIGNING_SECRET not configured - rejecting authentication');
        // Don't authenticate - let the request proceed as unauthenticated
        // The route handler will return 401 if auth is required
      } else {
        const signature = c.req.header('X-Request-Signature');
        const timestamp = c.req.header('X-Request-Timestamp');

        const isValidSignature = await verifyBotRequestSignature(
          signature,
          timestamp,
          userDiscordId,
          userName,
          c.env.BOT_SIGNING_SECRET
        );

        if (!isValidSignature) {
          // Log failed signature attempts (but don't reveal details)
          console.warn('Bot auth: Invalid or missing request signature', {
            hasSignature: !!signature,
            hasTimestamp: !!timestamp,
            path: c.req.path,
          });
          // Don't authenticate - let the request proceed as unauthenticated
          // The route handler will return 401 if auth is required
        } else {
          auth = {
            isAuthenticated: true,
            isModerator: checkModerator(userDiscordId, c.env.MODERATOR_IDS),
            userDiscordId: userDiscordId || undefined,
            userName: userName || undefined,
            authSource: 'bot',
          };
        }
      }
    }
    // Method 2: Web authentication (JWT)
    else if (c.env.JWT_SECRET) {
      const jwtPayload = await verifyJWT(token, c.env.JWT_SECRET);

      if (jwtPayload) {
        // Use display name if available, fallback to username
        const displayName = jwtPayload.global_name || jwtPayload.username;

        auth = {
          isAuthenticated: true,
          isModerator: checkModerator(jwtPayload.sub, c.env.MODERATOR_IDS),
          userDiscordId: jwtPayload.sub,
          userName: displayName,
          authSource: 'web',
        };
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
 * Require user Discord ID in auth context
 * For endpoints that need to know who is making the request
 * Works for both bot auth (from header) and web auth (from JWT)
 */
export function requireUserContext(
  c: Context<{ Bindings: Env; Variables: Variables }>
): Response | null {
  const auth = c.get('auth');

  if (!auth.userDiscordId) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'User context required (login or provide X-User-Discord-ID header)',
      },
      400
    );
  }

  return null;
}
