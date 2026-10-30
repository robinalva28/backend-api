import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { SearchInstrumentsService } from '../../src/instruments/application/search-instruments.service.js';
import type { InstrumentSearchRepository } from '../../src/instruments/application/ports/out/instrument-search.repository.js';
import { InstrumentsController } from '../../src/instruments/infrastructure/http/instruments.controller.js';
import { SearchInstrumentsQueryPipe } from '../../src/instruments/infrastructure/http/search-instruments-query.pipe.js';
import {
  INSTRUMENT_SEARCH_REPOSITORY,
  SEARCH_INSTRUMENTS_USE_CASE,
} from '../../src/instruments/instruments.tokens.js';
import { configureHttpApplication } from '../../src/bootstrap/configure-http.js';

const INVALID_MESSAGE = 'Invalid request.';
const UNAVAILABLE_MESSAGE = 'Instrument search could not be completed.';

let app: INestApplication;
const searchByText = vi.fn<InstrumentSearchRepository['searchByText']>();

beforeAll(async () => {
  const moduleFixture = await Test.createTestingModule({
    controllers: [InstrumentsController],
    providers: [
      SearchInstrumentsQueryPipe,
      {
        provide: INSTRUMENT_SEARCH_REPOSITORY,
        useValue: { searchByText },
      },
      {
        provide: SEARCH_INSTRUMENTS_USE_CASE,
        inject: [INSTRUMENT_SEARCH_REPOSITORY],
        useFactory: (
          repository: InstrumentSearchRepository,
        ): SearchInstrumentsService =>
          new SearchInstrumentsService(repository),
      },
    ],
  }).compile();

  app = moduleFixture.createNestApplication();
  configureHttpApplication(app);
  await app.init();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  searchByText.mockReset();
  searchByText.mockResolvedValue([]);
});

describe('GET /instruments validation', () => {
  const invalidPaths = [
    '/instruments',
    '/instruments?query=',
    '/instruments?query=%20%20',
    '/instruments?query=PAMP&query=DYCA',
    '/instruments?query%5Ba%5D=PAMP',
    '/instruments?query%5B%5D=PAMP',
    '/instruments?query=PAMP&query%5Ba%5D=DYCA',
    '/instruments?query=PAMP&other=value',
    `/instruments?query=${'a'.repeat(256)}`,
    `/instruments?query=${encodeURIComponent('😀'.repeat(256))}`,
  ];

  it.each(invalidPaths)(
    'returns a generic 400 without reaching the repository for %s',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path).expect(400);

      expect(response.body).toEqual({ message: INVALID_MESSAGE });
      expect(Object.keys(response.body)).toEqual(['message']);
      expect(searchByText).not.toHaveBeenCalled();
    },
  );

  it('accepts text after trimming the exterior spaces', async () => {
    await request(app.getHttpServer())
      .get('/instruments?query=%20PAMP%20')
      .expect(200);

    expect(searchByText).toHaveBeenCalledTimes(1);
    expect(searchByText).toHaveBeenCalledWith('PAMP');
  });

  it('accepts a raw value longer than 255 characters when trim leaves PAMP', async () => {
    await request(app.getHttpServer())
      .get('/instruments')
      .query({ query: ' '.repeat(256) + 'PAMP' })
      .expect(200);

    expect(searchByText).toHaveBeenCalledTimes(1);
    expect(searchByText).toHaveBeenCalledWith('PAMP');
  });

  it('accepts numeric text as a valid query', async () => {
    await request(app.getHttpServer())
      .get('/instruments?query=123')
      .expect(200);

    expect(searchByText).toHaveBeenCalledWith('123');
  });

  it('counts Unicode code points, not UTF-16 code units', async () => {
    const astral = '😀'.repeat(255);

    await request(app.getHttpServer())
      .get('/instruments')
      .query({ query: astral })
      .expect(200);

    expect(searchByText).toHaveBeenCalledWith(astral);
  });

  it('returns a generic 500 instead of an empty successful result on failure', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    searchByText.mockRejectedValueOnce(
      new Error('sensitive SQL detail from the driver'),
    );

    const response = await request(app.getHttpServer())
      .get('/instruments?query=PAMP')
      .expect(500);

    expect(response.body).toEqual({ message: UNAVAILABLE_MESSAGE });
    expect(JSON.stringify(response.body)).not.toContain('sensitive SQL');
    expect(searchByText).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalled();

    const logged = log.mock.calls.map((call) => String(call[0])).join(' ');
    expect(logged).toContain('operation=instrument-search');
    expect(logged).not.toContain('sensitive SQL detail');
    expect(logged).not.toContain('\n');
  });
});
