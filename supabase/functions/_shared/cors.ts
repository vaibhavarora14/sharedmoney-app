import { resolveAllowHeaders } from './cors-headers.ts';
import { ALLOWED_ORIGIN } from './env.ts';

const IS_PROD = Deno.env.get('NODE_ENV') === 'production';

/**
 * CORS headers utility for Supabase Edge Functions.
 * 
 * Strategy:
 * - Production: Strict matching against ALLOWED_ORIGIN. Wildcards are forbidden.
 * - Development: Seamless mirroring of the request origin or fallback to localhost.
 */
export function getCorsHeaders(req?: Request): Record<string, string> {
  const allowedOrigins = ALLOWED_ORIGIN 
    ? ALLOWED_ORIGIN.split(',').map(o => o.trim()).filter(o => o.length > 0)
    : [];
  
  const requestOrigin = req?.headers.get('Origin');
  let originToAllow: string;

  if (IS_PROD) {
    // --- STRICTION PRODUCTION MODE ---
    if (allowedOrigins.length === 0) {
      throw new Error('CORS Error: ALLOWED_ORIGIN must be set in production.');
    }
    
    if (allowedOrigins.includes('*')) {
      throw new Error('CORS Error: Wildcard origin (*) is forbidden in production for security.');
    }

    if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
      originToAllow = requestOrigin;
    } else {
      // Fallback to the primary production origin for mobile/server requests without 'Origin' header
      originToAllow = allowedOrigins[0];
    }
  } else {
    // --- SEAMLESS DEVELOPMENT MODE ---
    // Mirror the request origin if present (allows any local dev port to work instantly)
    // Otherwise fallback to the first configured origin or standard Expo dev port
    originToAllow = requestOrigin || allowedOrigins[0] || 'http://localhost:8081';
  }
  
  const requestedHeaders = req?.headers.get('Access-Control-Request-Headers');

  return {
    'Access-Control-Allow-Origin': originToAllow,
    'Access-Control-Allow-Headers': resolveAllowHeaders(requestedHeaders),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Length, X-JSON',
  };
}
