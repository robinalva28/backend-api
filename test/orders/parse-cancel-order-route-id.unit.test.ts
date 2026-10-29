import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  parseCancelOrderRouteId,
  requireCancelOrderRouteId,
} from '../../src/orders/infrastructure/http/parse-cancel-order-route-id.js';

describe('parseCancelOrderRouteId', () => {
  it.each([
    ['1', 1],
    ['2', 2],
    ['0001', 1],
    ['0000000002', 2],
    ['2147483647', 2_147_483_647],
    ['0002147483647', 2_147_483_647],
    ['0000000000000000000000000001', 1],
  ])('parses the route digits %s as %d', (value, expected) => {
    expect(parseCancelOrderRouteId(value)).toBe(expected);
  });

  it.each([
    '',
    '0',
    '00',
    '0000000000',
    '-1',
    '+1',
    '1.0',
    '1,0',
    '1e3',
    '1E3',
    '0x10',
    '1_000',
    ' 1',
    '1 ',
    '1\n',
    'abc',
    'NaN',
    'Infinity',
    '１２３',
    '١٢٣',
    '2147483648',
    '0002147483648',
    '9999999999',
    '10000000000',
  ])('rejects the non-ASCII or out-of-range value %j', (value) => {
    expect(parseCancelOrderRouteId(value)).toBeNull();
  });
});

describe('requireCancelOrderRouteId', () => {
  it('returns the numeric identifier for valid route digits', () => {
    expect(requireCancelOrderRouteId('0002147483647')).toBe(2_147_483_647);
  });

  it.each([undefined, null, 1, {}, [], true])(
    'rejects the non-string value %j with a generic bad request',
    (value) => {
      expect(() => requireCancelOrderRouteId(value)).toThrow(
        BadRequestException,
      );
    },
  );

  it.each(['0', '-1', '1.5', 'abc', '2147483648'])(
    'rejects the invalid route digits %j with a generic bad request',
    (value) => {
      expect(() => requireCancelOrderRouteId(value)).toThrow(
        BadRequestException,
      );
    },
  );
});
