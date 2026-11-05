import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

/** Stable machine-readable domain error. Clients switch on `code`. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = HttpStatus.UNPROCESSABLE_ENTITY,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const NotFound = (what: string) => new DomainError('NOT_FOUND', `${what} not found`, HttpStatus.NOT_FOUND);
export const Forbidden = (msg = 'Forbidden') => new DomainError('FORBIDDEN', msg, HttpStatus.FORBIDDEN);
export const Conflict = (code: string, msg: string, details?: unknown) =>
  new DomainError(code, msg, HttpStatus.CONFLICT, details);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (!res?.status) throw exception; // non-HTTP context (ws)
    let status = 500;
    let body: Record<string, unknown> = { code: 'INTERNAL', message: 'Internal server error' };

    if (exception instanceof DomainError) {
      status = exception.status;
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof ZodError) {
      status = 400;
      body = { code: 'VALIDATION_FAILED', message: 'Invalid request', details: exception.flatten() };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      body = {
        code: status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 429 ? 'RATE_LIMITED' : 'HTTP_' + status,
        message: typeof r === 'string' ? r : ((r as any).message ?? exception.message),
      };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = 409;
        body = { code: 'UNIQUE_VIOLATION', message: 'Resource already exists', details: exception.meta };
      } else if (exception.code === 'P2025') {
        status = 404;
        body = { code: 'NOT_FOUND', message: 'Resource not found' };
      } else {
        this.log.error(exception);
      }
    } else {
      this.log.error(exception);
    }
    res.status(status).json(body);
  }
}
