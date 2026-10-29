import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { requireSubmitOrderRouteId } from '../../src/orders/infrastructure/http/parse-submit-order-route-id.js';

describe('requireSubmitOrderRouteId', () => {
  it.each([
    ['1', 1],
    ['0001', 1],
    ['2147483647', 2_147_483_647],
    ['0002147483647', 2_147_483_647],
    ['0000000000000000000000000001', 1],
  ])('parses %s as %d', (value, expected) => {
    expect(requireSubmitOrderRouteId(value)).toBe(expected);
  });

  it.each([
    '',
    '0',
    '000',
    '-1',
    '+1',
    '1.0',
    '1e3',
    '0x10',
    '1_000',
    ' 1',
    '1 ',
    '1\n',
    'abc',
    '１２３',
    '2147483648',
    '999999999999999999999',
  ])('rejects %j with a generic bad request', (value) => {
    expect(() => requireSubmitOrderRouteId(value)).toThrow(BadRequestException);
  });

  it.each([undefined, null, 1, {}, [], true])(
    'rejects the non-string value %j',
    (value) => {
      expect(() => requireSubmitOrderRouteId(value)).toThrow(
        BadRequestException,
      );
    },
  );
});
