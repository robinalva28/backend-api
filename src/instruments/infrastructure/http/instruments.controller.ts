import {
  Controller,
  Get,
  Inject,
  Query,
  UseFilters,
} from '@nestjs/common';
import type { SearchInstrumentsUseCase } from '../../application/ports/in/search-instruments.use-case.js';
import type { Instrument } from '../../domain/instrument.js';
import { SEARCH_INSTRUMENTS_USE_CASE } from '../../instruments.tokens.js';
import { InstrumentsExceptionFilter } from './instruments-exception.filter.js';
import { SearchInstrumentsQueryDto } from './search-instruments-query.dto.js';
import { SearchInstrumentsQueryPipe } from './search-instruments-query.pipe.js';

@Controller('instruments')
@UseFilters(InstrumentsExceptionFilter)
export class InstrumentsController {
  constructor(
    @Inject(SEARCH_INSTRUMENTS_USE_CASE)
    private readonly searchInstruments: SearchInstrumentsUseCase,
  ) {}

  @Get()
  async search(
    @Query(SearchInstrumentsQueryPipe) query: SearchInstrumentsQueryDto,
  ): Promise<Instrument[]> {
    return this.searchInstruments.execute({ query: query.query });
  }
}
