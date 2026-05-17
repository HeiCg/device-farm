import { describe, it, expect, vi } from 'vitest';
import { errorHandler, createHttpError } from '../error-handler.js';

function mockRequest(url = '/api/jobs') {
  return { url } as any;
}

function mockReply() {
  const reply: any = {
    statusCode: 200,
    _headers: {} as Record<string, string>,
    _body: null as any,
    code(statusCode: number) {
      reply.statusCode = statusCode;
      return reply;
    },
    header(name: string, value: string) {
      reply._headers[name] = value;
      return reply;
    },
    send(body: any) {
      reply._body = body;
      return reply;
    },
  };
  return reply;
}

describe('errorHandler', () => {
  it('produces correct RFC 7807 ProblemDetail shape for 500 error', () => {
    const error: any = new Error('Internal failure');
    error.statusCode = 500;
    const request = mockRequest('/api/jobs');
    const reply = mockReply();

    errorHandler(error, request, reply);

    expect(reply._body).toMatchObject({
      type: 'https://device-farm.local/errors/INTERNAL_ERROR',
      title: 'Internal Server Error',
      status: 500,
      detail: 'Internal failure',
      instance: '/api/jobs',
    });
  });

  it('produces correct status and type for 404 error', () => {
    const error: any = new Error('Job not found');
    error.statusCode = 404;
    error.code = 'NOT_FOUND';
    const request = mockRequest('/api/jobs/123');
    const reply = mockReply();

    errorHandler(error, request, reply);

    expect(reply._body.status).toBe(404);
    expect(reply._body.type).toBe('https://device-farm.local/errors/NOT_FOUND');
    expect(reply._body.title).toBe('Not Found');
  });

  it('maps QUEUE_FULL code to 429', () => {
    const error: any = new Error('Queue is full');
    error.code = 'QUEUE_FULL';
    const request = mockRequest();
    const reply = mockReply();

    errorHandler(error, request, reply);

    expect(reply._body.status).toBe(429);
    expect(reply._body.type).toBe('https://device-farm.local/errors/QUEUE_FULL');
  });

  it('sets content-type to application/problem+json', () => {
    const error: any = new Error('fail');
    error.statusCode = 400;
    const request = mockRequest();
    const reply = mockReply();

    errorHandler(error, request, reply);

    expect(reply._headers['content-type']).toBe('application/problem+json');
  });

  it('instance field matches request URL', () => {
    const error: any = new Error('fail');
    error.statusCode = 400;
    const request = mockRequest('/api/jobs?status=running');
    const reply = mockReply();

    errorHandler(error, request, reply);

    expect(reply._body.instance).toBe('/api/jobs?status=running');
  });

  it('handles Fastify validation errors as 400', () => {
    const error: any = new Error('body/platform must be string');
    error.code = 'FST_ERR_VALIDATION';
    error.statusCode = 400;
    error.validation = [{ message: 'must be string', keyword: 'type' }];
    const request = mockRequest();
    const reply = mockReply();

    errorHandler(error, request, reply);

    expect(reply._body.status).toBe(400);
    expect(reply._body.type).toBe('https://device-farm.local/errors/VALIDATION_ERROR');
  });

  it('defaults to 500 when no statusCode on error', () => {
    const error: any = new Error('unexpected');
    const request = mockRequest();
    const reply = mockReply();

    errorHandler(error, request, reply);

    expect(reply._body.status).toBe(500);
  });
});

describe('createHttpError', () => {
  it('creates error with statusCode and code properties', () => {
    const error = createHttpError(404, 'Not found', 'NOT_FOUND');

    expect(error).toBeInstanceOf(Error);
    expect((error as any).statusCode).toBe(404);
    expect((error as any).code).toBe('NOT_FOUND');
    expect(error.message).toBe('Not found');
  });

  it('works without code parameter', () => {
    const error = createHttpError(500, 'Server error');

    expect(error).toBeInstanceOf(Error);
    expect((error as any).statusCode).toBe(500);
    expect(error.message).toBe('Server error');
  });
});
