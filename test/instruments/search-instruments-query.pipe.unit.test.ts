import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SearchInstrumentsQueryDto } from '../../src/instruments/infrastructure/http/search-instruments-query.dto.js';
import { SearchInstrumentsQueryPipe } from '../../src/instruments/infrastructure/http/search-instruments-query.pipe.js';

const pipe = new SearchInstrumentsQueryPipe();

describe('SearchInstrumentsQueryPipe', () => {
  it.each([
    [' pAmP ', 'pAmP'],
    ['123', '123'],
    ['x', 'x'],
    ['a'.repeat(255), 'a'.repeat(255)],
    ['😀'.repeat(255), '😀'.repeat(255)],
  ])('accepts and trims the valid query %j', async (value, expected) => {
    const result = await pipe.transform({ query: value });

    expect(result).toBeInstanceOf(SearchInstrumentsQueryDto);
    expect(result.query).toBe(expected);
  });

  it.each([
    undefined,
    null,
    'PAMP',
    [],
    {},
    { query: undefined },
    { query: '' },
    { query: '   ' },
    { query: 123 },
    { query: ['PAMP'] },
    { query: { value: 'PAMP' } },
    { query: 'PAMP', other: 'value' },
    { query: 'a'.repeat(256) },
    { query: '😀'.repeat(256) },
  ])('rejects the invalid query shape %j with a generic 400', async (value) => {
    let caught: unknown;

    try {
      await pipe.transform(value);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getStatus()).toBe(400);
    expect((caught as BadRequestException).message).toBe('Invalid request.');
  });
});
