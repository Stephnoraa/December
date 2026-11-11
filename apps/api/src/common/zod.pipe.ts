import { Body, PipeTransform, Query } from '@nestjs/common';
import type { ZodType } from 'zod';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}

/** @Body() validated with a shared zod schema. */
export const ZBody = <T>(schema: ZodType<T>) => Body(new ZodPipe(schema));
/** @Query() validated with a zod schema. */
export const ZQuery = <T>(schema: ZodType<T>) => Query(new ZodPipe(schema));
