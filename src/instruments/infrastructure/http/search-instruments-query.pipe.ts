import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { INVALID_SEARCH_REQUEST_MESSAGE } from './http-messages.js';
import { SearchInstrumentsQueryDto } from './search-instruments-query.dto.js';

@Injectable()
export class SearchInstrumentsQueryPipe implements PipeTransform<
  unknown,
  Promise<SearchInstrumentsQueryDto>
> {
  async transform(value: unknown): Promise<SearchInstrumentsQueryDto> {
    if (!isRecord(value)) {
      throw invalidRequest();
    }

    const keys = Object.keys(value);

    if (keys.length !== 1 || keys[0] !== 'query') {
      throw invalidRequest();
    }

    if (typeof value['query'] !== 'string') {
      throw invalidRequest();
    }

    const query = plainToInstance(SearchInstrumentsQueryDto, value);
    const errors = await validate(query, {
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: true,
    });

    if (errors.length > 0) {
      throw invalidRequest();
    }

    return query;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRequest(): BadRequestException {
  return new BadRequestException(INVALID_SEARCH_REQUEST_MESSAGE);
}
