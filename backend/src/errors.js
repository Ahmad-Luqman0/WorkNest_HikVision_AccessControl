// Standardized Error Classes & Express Error Handling Middleware

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad Request', details = null) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access', details = null) {
    super(message, 401, 'UNAUTHORIZED', details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden action', details = null) {
    super(message, 403, 'FORBIDDEN', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details = null) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details = null) {
    super(message, 409, 'CONFLICT', details);
  }
}

// Wrapper to automatically catch async errors in Express route handlers
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Express 404 Not Found handler for API endpoints
export function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return next(new NotFoundError(`API endpoint not found: ${req.method} ${req.path}`));
  }
  next();
}

// Centralized Express Error Handling Middleware
export function errorHandler(err, req, res, next) {
  // Log unexpected internal errors
  const isOperational = err instanceof AppError;
  const statusCode = isOperational ? err.statusCode : 500;
  const code = isOperational ? err.code : 'INTERNAL_SERVER_ERROR';
  const message = err.message || 'An unexpected error occurred';

  if (!isOperational) {
    console.error(`[unhandled-error] ${req.method} ${req.path}:`, err.stack || err);
  }

  // Ensure headers haven't already been sent
  if (res.headersSent) {
    return next(err);
  }

  res.status(statusCode).json({
    ok: false,
    error: message,
    code,
    ...(err.details ? { details: err.details } : {}),
  });
}
