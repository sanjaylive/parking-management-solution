import { PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';

export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}

