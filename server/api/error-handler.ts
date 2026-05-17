import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}

const HTTP_STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

/** Maps custom error codes to HTTP status codes */
const CODE_TO_STATUS: Record<string, number> = {
  QUEUE_FULL: 429,
  NOT_FOUND: 404,
  FST_ERR_VALIDATION: 400,
  PARALLELISM_EXCEEDED: 503, // Phase 37 Plan 37-04 (Pitfall 9)
};

function resolveStatusCode(error: FastifyError & { statusCode?: number }): number {
  if (error.code && CODE_TO_STATUS[error.code] !== undefined) {
    return CODE_TO_STATUS[error.code];
  }
  return error.statusCode ?? 500;
}

function resolveErrorCode(error: FastifyError & { validation?: unknown[] }): string {
  if (error.validation || error.code === 'FST_ERR_VALIDATION') {
    return 'VALIDATION_ERROR';
  }
  if (error.code && error.code !== 'FST_ERR_VALIDATION') {
    return error.code;
  }
  return 'INTERNAL_ERROR';
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const status = resolveStatusCode(error);
  const code = resolveErrorCode(error);
  const title = HTTP_STATUS_TITLES[status] ?? 'Unknown Error';

  const problem: ProblemDetail = {
    type: `https://device-farm.local/errors/${code}`,
    title,
    status,
    detail: error.message,
    instance: request.url,
  };

  if (status >= 500) {
    request.log?.error?.({ err: error }, problem.detail);
  } else {
    request.log?.warn?.({ err: error }, problem.detail);
  }

  // Phase 37 Plan 37-04 — preserve Retry-After for over-cap parallel-deploy
  // jobs (Pitfall 9). createHttpError attaches a numeric `retryAfterSeconds`
  // field; we copy it into the response header before send. The header value
  // is a constant integer (not user input) — no XSS surface.
  const retryAfter = (error as Error & { retryAfterSeconds?: number }).retryAfterSeconds;
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
    reply.header('Retry-After', String(Math.max(0, Math.trunc(retryAfter))));
  }

  reply
    .code(status)
    .header('content-type', 'application/problem+json')
    .send(problem);
}

export function createHttpError(
  statusCode: number,
  message: string,
  code?: string,
  options?: { retryAfterSeconds?: number },
): Error & { statusCode: number; code?: string; retryAfterSeconds?: number } {
  const error = new Error(message) as Error & {
    statusCode: number;
    code?: string;
    retryAfterSeconds?: number;
  };
  error.statusCode = statusCode;
  if (code) {
    error.code = code;
  }
  if (options?.retryAfterSeconds !== undefined) {
    error.retryAfterSeconds = options.retryAfterSeconds;
  }
  return error;
}
