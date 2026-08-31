// Security middleware & rate limiting for WorkNest Access Control

// Memory stores for sliding-window rate limiting
const stores = new Map();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

function createRateLimiter({ windowMs, maxRequests, message, name = 'default' }) {
  return function rateLimitMiddleware(req, res, next) {
    const ip = getClientIp(req);
    const key = `${name}:${ip}`;
    const now = Date.now();

    let record = stores.get(key);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      stores.set(key, record);
    } else {
      record.count += 1;
    }

    // Set rate limit headers
    const remaining = Math.max(0, maxRequests - record.count);
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        ok: false,
        error: message || 'Too many requests. Please try again later.',
        retryAfterSeconds: retryAfter,
      });
    }

    next();
  };
}

// Cleanup stale rate limit entries every 10 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of stores.entries()) {
    if (now > record.resetTime) {
      stores.delete(key);
    }
  }
}, 600000);

// Rate Limiters
export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5,           // 5 attempts per 15 min
  message: 'Too many failed login attempts from this IP. Please try again in 15 minutes.',
  name: 'login',
});

export const hardwareRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,     // 1 minute
  maxRequests: 30,         // 30 triggers / min
  message: 'Hardware rate limit exceeded. Please wait a moment before sending more requests.',
  name: 'hardware',
});

export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,     // 1 minute
  maxRequests: 120,        // 120 API calls / min
  message: 'API rate limit exceeded. Slow down requests.',
  name: 'api',
});

// Security HTTP Headers
export function securityHeaders(req, res, next) {
  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Prevent Clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Enable browser XSS filter
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Content Security Policy
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self';"
  );
  // Force HTTPS HSTS when behind reverse proxy
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}
