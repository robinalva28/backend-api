import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { INVALID_SUBMIT_ORDER_REQUEST_MESSAGE } from './http-messages.js';

const HEADER_NAME = 'idempotency-key';
const UUID_LENGTH = 36;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the single `Idempotency-Key` header from the raw header list. Node
 * may join repeated headers with a comma in `headers`, so duplicates are
 * detected deterministically before any join and rejected. The accepted
 * value is a hexadecimal 8-4-4-4-12 UUID of any version or variant, including
 * the nil UUID, normalized to lowercase before reaching the use case.
 */
export function requireSubmitOrderIdempotencyKey(
  request: Pick<Request, 'rawHeaders'>,
): string {
  const values = readHeaderValues(request.rawHeaders, HEADER_NAME);

  if (values.length !== 1) {
    throw invalidRequest();
  }

  const value = values[0];

  if (
    value === undefined ||
    value.length !== UUID_LENGTH ||
    !UUID_PATTERN.test(value)
  ) {
    throw invalidRequest();
  }

  return value.toLowerCase();
}

function readHeaderValues(
  rawHeaders: readonly string[],
  name: string,
): string[] {
  const values: string[] = [];

  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const headerName = rawHeaders[index];
    const headerValue = rawHeaders[index + 1];

    if (
      headerName !== undefined &&
      headerValue !== undefined &&
      headerName.toLowerCase() === name
    ) {
      values.push(headerValue);
    }
  }

  return values;
}

function invalidRequest(): BadRequestException {
  return new BadRequestException(INVALID_SUBMIT_ORDER_REQUEST_MESSAGE);
}
