import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { sha256 } from './crypto';
import { Conflict, DomainError } from './errors';
import { PrismaService } from './prisma.service';

/**
 * Idempotent execution: the first call with (scope,key) runs `fn` and stores its result;
 * replays with the same payload return the stored result; a different payload is rejected.
 * Failed executions release the key so the client can retry.
 */
@Injectable()
export class IdempotencyService {
  constructor(private prisma: PrismaService) {}

  async run<T>(scope: string, key: string | undefined, payload: unknown, fn: () => Promise<T>): Promise<T & { replayed?: boolean }> {
    if (!key) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400);
    if (key.length > 100) throw new DomainError('IDEMPOTENCY_KEY_INVALID', 'Idempotency key too long', 400);
    const requestHash = sha256(JSON.stringify(payload ?? null));
    let rowId: string;
    try {
      rowId = (await this.prisma.idempotencyKey.create({ data: { scope, key, requestHash } })).id;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const existing = await this.prisma.idempotencyKey.findUniqueOrThrow({ where: { scope_key: { scope, key } } });
      if (existing.requestHash !== requestHash) throw Conflict('IDEMPOTENCY_MISMATCH', 'Idempotency key reused with a different request');
      if (existing.responseBody == null) throw Conflict('IDEMPOTENCY_IN_PROGRESS', 'Request with this key is still processing');
      return { ...(existing.responseBody as any), replayed: true };
    }
    try {
      const result = await fn();
      await this.prisma.idempotencyKey.update({
        where: { id: rowId },
        data: { responseCode: 200, responseBody: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue },
      });
      return result as T & { replayed?: boolean };
    } catch (e) {
      await this.prisma.idempotencyKey.delete({ where: { id: rowId } }).catch(() => undefined);
      throw e;
    }
  }
}

@Global()
@Module({ providers: [IdempotencyService], exports: [IdempotencyService] })
export class IdempotencyModule {}
