import { Body, HttpStatus, Param, PipeTransform, Query } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import { ErrorCode } from '@app/shared';
import { AppError } from './errors';

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

const uuid = z.uuid();

/** Validates a UUID route parameter (accepts UUIDv7). */
export class UuidPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    const parsed = uuid.safeParse(value);
    if (!parsed.success)
      throw new AppError(ErrorCode.NOT_FOUND, 'Resource not found', HttpStatus.NOT_FOUND);
    return parsed.data;
  }
}

export const UuidParam = (name = 'id') => Param(name, new UuidPipe());
