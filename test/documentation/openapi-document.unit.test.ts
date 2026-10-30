import { describe, expect, it } from 'vitest';
import { OPENAPI_DOCUMENT } from '../../src/documentation/openapi.document.js';
import { isPositiveSubmitOrderDecimal } from '../../src/orders/infrastructure/http/submit-order-decimal.js';

const document = OPENAPI_DOCUMENT as unknown as Record<string, any>;

function resolvePointer(ref: string): any {
  expect(ref.startsWith('#/')).toBe(true);

  return ref
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<any>((current, part) => {
      expect(current).toHaveProperty(part);
      return current[part];
    }, document);
}

function resolveSchema(schema: any): any {
  return schema?.$ref === undefined ? schema : resolvePointer(schema.$ref);
}

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRefs(item, refs);
    }
    return refs;
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string') {
        refs.push(item);
      } else {
        collectRefs(item, refs);
      }
    }
  }

  return refs;
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys);
    }
    return keys;
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      keys.push(key);
      collectKeys(item, keys);
    }
  }

  return keys;
}

function matches(value: unknown, inputSchema: any): boolean {
  const schema = resolveSchema(inputSchema);

  if (value === null) {
    return schema.nullable === true;
  }

  if (schema.oneOf !== undefined) {
    return (
      (schema.oneOf as unknown[]).filter((option) => matches(value, option))
        .length === 1
    );
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    return false;
  }

  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        return false;
      }

      const record = value as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as Record<string, any>;
      const required = (schema.required ?? []) as string[];

      if (!required.every((key) => Object.hasOwn(record, key))) {
        return false;
      }

      if (
        schema.additionalProperties === false &&
        Object.keys(record).some((key) => !Object.hasOwn(properties, key))
      ) {
        return false;
      }

      return Object.entries(record).every(([key, item]) => {
        const property = properties[key];
        return property === undefined || matches(item, property);
      });
    }
    case 'array': {
      return (
        Array.isArray(value) &&
        value.every((item) => matches(item, schema.items))
      );
    }
    case 'string': {
      if (typeof value !== 'string') {
        return false;
      }

      if (
        schema.minLength !== undefined &&
        [...value].length < schema.minLength
      ) {
        return false;
      }

      if (
        schema.maxLength !== undefined &&
        [...value].length > schema.maxLength
      ) {
        return false;
      }

      return (
        schema.pattern === undefined ||
        new RegExp(schema.pattern as string).test(value)
      );
    }
    case 'integer': {
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        (schema.minimum === undefined || value >= schema.minimum) &&
        (schema.maximum === undefined || value <= schema.maximum)
      );
    }
    case 'number': {
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (schema.minimum === undefined || value >= schema.minimum) &&
        (schema.maximum === undefined || value <= schema.maximum)
      );
    }
    default:
      return true;
  }
}

function examplesAt(container: any): unknown[] {
  const media = container.content?.['application/json'];
  const examples = media?.examples;

  if (examples !== undefined) {
    return Object.values(examples)
      .map((example: any) => example.value)
      .filter((value: any) => value !== undefined);
  }

  return media?.example === undefined ? [] : [media.example];
}

describe('OpenAPI 3.0.3 document', () => {
  it('declares the required metadata and exactly the four public operations', () => {
    expect(document.openapi).toBe('3.0.3');
    expect(document.info.title).toBe('backend API');
    expect(document.info.version).toBe('0.0.0');
    expect(Object.keys(document.paths).sort()).toEqual([
      '/instruments',
      '/users/{userId}/orders',
      '/users/{userId}/orders/{orderId}/cancel',
      '/users/{userId}/portfolio',
    ]);

    const operations = Object.values(document.paths).flatMap((path: any) =>
      Object.values(path).map((operation: any) => operation),
    );

    expect(operations).toHaveLength(4);
    expect(
      operations.map((operation: any) => operation.operationId).sort(),
    ).toEqual(['cancelOrder', 'getPortfolio', 'searchInstruments', 'submitOrder']);
    expect(operations.every((operation: any) => operation.tags.length > 0)).toBe(
      true,
    );
  });

  it('resolves every local $ref and uses no remote hosts or CDN assets', () => {
    const refs = collectRefs(document);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(() => resolvePointer(ref)).not.toThrow();
    }

    const serialized = JSON.stringify(document);
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it('documents the search query, response shape, and status codes', () => {
    const operation = document.paths['/instruments'].get;
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '400',
      '500',
    ]);

    const query = resolvePointer(operation.parameters[0].$ref);
    expect(query).toMatchObject({
      name: 'query',
      in: 'query',
      required: true,
    });
    expect(query.schema).toEqual({ type: 'string' });
    expect(query.schema.minLength).toBeUndefined();
    expect(query.schema.maxLength).toBeUndefined();
    expect(query.description).toContain('255');
    expect(query.description).toContain('Unicode');
    expect(query.description).toContain('trim');
    expect(matches(' '.repeat(256) + 'PAMP', query.schema)).toBe(true);

    const success = resolvePointer(operation.responses['200'].$ref);
    expect(success.content['application/json'].schema).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/Instrument' },
    });
    expect(success.content['application/json'].examples.withoutMatches.value).toEqual(
      [],
    );
  });

  it('documents portfolio amounts, nullable percentages and ordered positions', () => {
    const operation = document.paths['/users/{userId}/portfolio'].get;
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '400',
      '404',
      '500',
    ]);

    const portfolio = resolveSchema(
      resolvePointer(operation.responses['200'].$ref).content[
        'application/json'
      ].schema,
    );
    expect(portfolio.required).toEqual([
      'totalValue',
      'availableCash',
      'positions',
    ]);
    expect(portfolio.additionalProperties).toBe(false);
    expect(portfolio.properties.totalValue.pattern).toBe(
      '^-?[0-9]+\\.[0-9]{2}$',
    );
    expect(portfolio.properties.availableCash.pattern).toBe(
      '^-?[0-9]+\\.[0-9]{2}$',
    );

    const position = resolveSchema(portfolio.properties.positions.items);
    expect(position.additionalProperties).toBe(false);
    expect(position.properties.quantity.type).toBe('integer');
    expect(position.properties.totalReturnPercent.nullable).toBe(true);
    expect(position.properties.dailyReturnPercent.nullable).toBe(true);
    expect(position.properties.positionValue.pattern).toBe(
      '^-?[0-9]+\\.[0-9]{2}$',
    );
  });

  it('documents four mutually exclusive submit combinations', () => {
    const operation = document.paths['/users/{userId}/orders'].post;
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '201',
      '400',
      '404',
      '409',
      '500',
    ]);

    const parameters = operation.parameters.map((parameter: any) =>
      resolvePointer(parameter.$ref),
    );
    expect(parameters.map((parameter: any) => parameter.name).sort()).toEqual([
      'Idempotency-Key',
      'userId',
    ]);
    expect(
      parameters.find((parameter: any) => parameter.name === 'Idempotency-Key')
        ?.required,
    ).toBe(true);

    const request = resolveSchema(
      operation.requestBody.content['application/json'].schema,
    );
    expect(request.oneOf).toHaveLength(4);

    const combinations = request.oneOf.map((option: any) =>
      resolveSchema(option),
    );
    const expected = [
      { type: 'LIMIT', mode: 'size', price: true },
      { type: 'LIMIT', mode: 'amount', price: true },
      { type: 'MARKET', mode: 'size', price: false },
      { type: 'MARKET', mode: 'amount', price: false },
    ] as const;

    expect(
      combinations.map((combination: any) => ({
        type: combination.properties.type.enum[0],
        mode: Object.hasOwn(combination.properties, 'size')
          ? 'size'
          : 'amount',
        price: Object.hasOwn(combination.properties, 'price'),
      })),
    ).toEqual(expected);

    for (const combination of combinations) {
      expect(combination.additionalProperties).toBe(false);
      expect(combination.required).toContain('instrumentId');
      expect(combination.required).toContain('side');
      expect(combination.required).toContain('type');
      expect(Object.hasOwn(combination.properties, 'currency')).toBe(false);
    }

    const limitBySize = combinations[0];
    const limitByAmount = combinations[1];
    const marketBySize = combinations[2];
    const marketByAmount = combinations[3];

    expect(limitBySize.required).toContain('size');
    expect(limitBySize.required).toContain('price');
    expect(limitByAmount.required).toContain('amount');
    expect(limitByAmount.required).toContain('price');
    expect(marketBySize.required).toContain('size');
    expect(marketBySize.required).not.toContain('price');
    expect(marketByAmount.required).toContain('amount');
    expect(marketByAmount.required).not.toContain('price');
  });

  it('keeps creation and replay status sets distinct', () => {
    const operation = document.paths['/users/{userId}/orders'].post;
    const created = resolveSchema(
      resolvePointer(operation.responses['201'].$ref).content[
        'application/json'
      ].schema,
    );
    const replayed = resolveSchema(
      resolvePointer(operation.responses['200'].$ref).content[
        'application/json'
      ].schema,
    );

    expect(
      resolveSchema(created.properties.order.properties.status).enum,
    ).toEqual(['NEW', 'FILLED', 'REJECTED']);
    expect(
      resolveSchema(replayed.properties.order.properties.status).enum,
    ).toEqual(['NEW', 'FILLED', 'REJECTED', 'CANCELLED']);
  });

  it('documents cancellation without a body or idempotency header', () => {
    const operation =
      document.paths['/users/{userId}/orders/{orderId}/cancel'].post;
    expect(operation.requestBody).toBeUndefined();
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '400',
      '404',
      '409',
      '500',
    ]);

    const parameters = operation.parameters.map((parameter: any) =>
      resolvePointer(parameter.$ref),
    );
    expect(parameters.map((parameter: any) => parameter.name).sort()).toEqual([
      'orderId',
      'userId',
    ]);
    expect(
      parameters.some((parameter: any) => parameter.name === 'Idempotency-Key'),
    ).toBe(false);

    const success = resolvePointer(operation.responses['200'].$ref);
    expect(
      success.content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/CancelOrderResponse');
  });

  it('validates every example against its schema', () => {
    const requestOperation = document.paths['/users/{userId}/orders'].post;
    const requestSchema =
      requestOperation.requestBody.content['application/json'].schema;

    for (const value of examplesAt(requestOperation.requestBody)) {
      expect(matches(value, requestSchema)).toBe(true);
    }

    for (const response of Object.values(document.components.responses)) {
      const schema = (response as any).content['application/json'].schema;

      for (const value of examplesAt(response)) {
        expect(matches(value, schema)).toBe(true);
      }
    }
  });

  it('rejects invalid combinations and decimal values through the documented patterns', () => {
    const requestOperation = document.paths['/users/{userId}/orders'].post;
    const requestSchema =
      requestOperation.requestBody.content['application/json'].schema;

    const invalidBodies = [
      { instrumentId: 47, side: 'BUY', type: 'LIMIT', size: 3 },
      { instrumentId: 47, side: 'BUY', type: 'LIMIT', amount: '10.00' },
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        size: 3,
        price: '10.00',
      },
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'LIMIT',
        size: 3,
        amount: '10.00',
        price: '10.00',
      },
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'LIMIT',
        size: 3,
        price: '10.00',
        currency: 'ARS',
      },
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        size: 3,
        unknown: true,
      },
    ];

    for (const body of invalidBodies) {
      expect(matches(body, requestSchema)).toBe(false);
    }

    const amountPattern = new RegExp(
      resolvePointer('#/components/schemas/OrderAmount').pattern,
    );
    const pricePattern = new RegExp(
      resolvePointer('#/components/schemas/LimitPrice').pattern,
    );

    const validDecimals = ['1', '10', '10.0', '10.00', '00010.00', '0.01'];
    const invalidDecimals = [
      '',
      '0',
      '0.00',
      '10.000',
      '10.001',
      '1e2',
      '+1',
      ' 1',
      '1 ',
      '1,00',
      '-1',
      '1_000',
      '0x1',
    ];

    for (const valid of validDecimals) {
      expect(amountPattern.test(valid)).toBe(true);
      expect(pricePattern.test(valid)).toBe(true);
    }

    for (const invalid of invalidDecimals) {
      expect(amountPattern.test(invalid)).toBe(false);
      expect(pricePattern.test(invalid)).toBe(false);
    }

    expect(pricePattern.test('.01')).toBe(false);
    expect(pricePattern.test('000000001.00')).toBe(true);
    expect(pricePattern.test('99999999.99')).toBe(true);
    expect(pricePattern.test('000000000.01')).toBe(true);
    expect(pricePattern.test('12345678.90')).toBe(true);
    expect(pricePattern.test('012345678.90')).toBe(true);
    expect(pricePattern.test('123456789.90')).toBe(false);
    expect(pricePattern.test('000123456789.90')).toBe(false);
    expect(pricePattern.test('100000000')).toBe(false);
    expect(amountPattern.test('123456789.90')).toBe(true);
    expect(amountPattern.test('000123456789.90')).toBe(true);

    const priceCases = [
      ...validDecimals,
      ...invalidDecimals,
      '.01',
      '000000001.00',
      '99999999.99',
      '000000000.01',
      '0000000000.01',
      '000000001',
      '100000000',
      '123456789.90',
      '000123456789.90',
      '1.0',
      '1.00',
      '1.',
      '99.999',
    ];

    for (const value of priceCases) {
      expect(pricePattern.test(value)).toBe(
        isPositiveSubmitOrderDecimal(value, { maxIntegerDigits: 8 }),
      );
    }
  });

  it('does not expose internal order fields or unsupported response codes', () => {
    const keys = collectKeys(document);
    for (const forbidden of [
      'replayed',
      'idempotencyKey',
      'idempotency_metadata',
      'idempotencyMetadata',
      'metadata',
      'sql',
      'currency',
    ]) {
      expect(keys).not.toContain(forbidden);
    }

    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item as any)) {
        expect(['get', 'post']).toContain(method);
        for (const code of ['401', '403', '408', '503', '504']) {
          expect((operation as any).responses[code]).toBeUndefined();
        }
        expect(path).toMatch(/^\//);
      }
    }
  });
});
