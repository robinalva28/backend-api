import {
  BadRequestException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { SearchInstrumentsError } from '../../src/instruments/application/errors/search-instruments.error.js';
import { InstrumentsExceptionFilter } from '../../src/instruments/infrastructure/http/instruments-exception.filter.js';

function createHost(): {
  host: ArgumentsHost;
  response: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
} {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };

  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => response as unknown as Response,
      }),
    } as unknown as ArgumentsHost,
    response,
  };
}

describe('InstrumentsExceptionFilter', () => {
  it('returns the generic 400 without logging validation details', () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { host, response } = createHost();
    const filter = new InstrumentsExceptionFilter();

    filter.catch(new BadRequestException('sensitive validation detail'), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ message: 'Invalid request.' });
    expect(log).not.toHaveBeenCalled();
  });

  it('returns the generic 500 and logs only sanitized diagnostics', () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { host, response } = createHost();
    const filter = new InstrumentsExceptionFilter();
    const cause = Object.assign(
      new Error(
        'postgres://alice:secret@db.internal/backend_api password=hunter2\nnext line',
      ),
      { code: 'ECONNREFUSED' },
    );

    filter.catch(new SearchInstrumentsError(cause), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      message: 'Instrument search could not be completed.',
    });
    expect(log).toHaveBeenCalledTimes(1);

    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain('operation=instrument-search');
    expect(logged).toContain('SearchInstrumentsError');
    expect(logged).toContain('ECONNREFUSED');
    expect(logged).toContain('connection refused');
    expect(logged).not.toContain('alice');
    expect(logged).not.toContain('secret');
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('\n');
  });

  it('sanitizes non-error exceptions as generic 500 failures', () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { host, response } = createHost();
    const filter = new InstrumentsExceptionFilter();

    filter.catch('password=secret-value', host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      message: 'Instrument search could not be completed.',
    });
    expect(String(log.mock.calls[0]?.[0])).not.toContain('secret-value');
  });
});
