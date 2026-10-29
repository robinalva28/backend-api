import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { requireSubmitOrderIdempotencyKey } from '../../src/orders/infrastructure/http/submit-order-idempotency-key.js';

const KEY = '123e4567-e89b-12d3-a456-426614174000';

function requestWithRawHeaders(
  headers: readonly string[],
): Pick<Request, 'rawHeaders'> {
  return { rawHeaders: [...headers] };
}

describe('requireSubmitOrderIdempotencyKey', () => {
  it.each([
    ['lowercase', KEY],
    ['uppercase', KEY.toUpperCase()],
    ['mixed case', '123E4567-e89b-12D3-a456-426614174000'],
    ['nil UUID', '00000000-0000-0000-0000-000000000000'],
    ['arbitrary version and variant', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
  ])('accepts the %s UUID and normalizes it to lowercase', (_label, value) => {
    expect(
      requireSubmitOrderIdempotencyKey(
        requestWithRawHeaders(['Idempotency-Key', value]),
      ),
    ).toBe(value.toLowerCase());
  });

  it('recognizes the header name without case sensitivity', () => {
    expect(
      requireSubmitOrderIdempotencyKey(
        requestWithRawHeaders([
          'Accept',
          'application/json',
          'idempotency-KEY',
          KEY,
        ]),
      ),
    ).toBe(KEY);
  });

  it.each([
    ['absent', []],
    ['empty', ['Idempotency-Key', '']],
    ['urn prefix', ['Idempotency-Key', `urn:uuid:${KEY}`]],
    ['braces', ['Idempotency-Key', `{${KEY}}`]],
    ['compact form', ['Idempotency-Key', KEY.replaceAll('-', '')]],
    ['comma-separated', ['Idempotency-Key', `${KEY},${KEY}`]],
    ['internal space', ['Idempotency-Key', KEY.replace('-', ' ')]],
    ['trailing space', ['Idempotency-Key', `${KEY} `]],
    ['leading space', ['Idempotency-Key', ` ${KEY}`]],
    ['malformed', ['Idempotency-Key', 'not-a-uuid']],
    ['non-hexadecimal', ['Idempotency-Key', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz']],
    ['too short', ['Idempotency-Key', '123e4567-e89b-12d3-a456-42661417400']],
    ['too long', ['Idempotency-Key', `${KEY}0`]],
  ])('rejects a %s value with a generic bad request', (_label, headers) => {
    expect(() =>
      requireSubmitOrderIdempotencyKey(
        requestWithRawHeaders(headers as readonly string[]),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects repeated headers even when both values are valid', () => {
    expect(() =>
      requireSubmitOrderIdempotencyKey(
        requestWithRawHeaders([
          'Idempotency-Key',
          KEY,
          'idempotency-key',
          KEY,
        ]),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects repeated headers when the first one is the only valid value', () => {
    expect(() =>
      requireSubmitOrderIdempotencyKey(
        requestWithRawHeaders([
          'Idempotency-Key',
          KEY,
          'Idempotency-Key',
          'not-a-uuid',
        ]),
      ),
    ).toThrow(BadRequestException);
  });
});
