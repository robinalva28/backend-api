import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  createOrderIntent,
  type OrderIntent,
} from '../../domain/order-intent.js';
import { OrderIntentError } from '../../domain/order-intent.error.js';
import { SubmitOrderBodyDto } from './submit-order-body.dto.js';
import { INVALID_SUBMIT_ORDER_REQUEST_MESSAGE } from './http-messages.js';

const ALLOWED_BODY_FIELDS: ReadonlySet<string> = new Set([
  'instrumentId',
  'side',
  'type',
  'size',
  'amount',
  'price',
]);

@Injectable()
export class SubmitOrderBodyPipe
  implements PipeTransform<unknown, Promise<OrderIntent>>
{
  async transform(value: unknown): Promise<OrderIntent> {
    if (!isPlainObject(value)) {
      throw invalidRequest();
    }

    // Check the parsed JSON before class-transformer can drop own keys such as
    // `__proto__` and `constructor`.
    if (Object.keys(value).some((field) => !ALLOWED_BODY_FIELDS.has(field))) {
      throw invalidRequest();
    }

    const body = plainToInstance(SubmitOrderBodyDto, value);
    const errors = await validate(body, {
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: true,
    });

    if (errors.length > 0) {
      throw invalidRequest();
    }

    const hasSize = Object.hasOwn(value, 'size');
    const hasAmount = Object.hasOwn(value, 'amount');
    const hasPrice = Object.hasOwn(value, 'price');

    if (hasSize === hasAmount) {
      throw invalidRequest();
    }

    if (body.type === 'LIMIT' ? !hasPrice : hasPrice) {
      throw invalidRequest();
    }

    try {
      return createOrderIntent({
        instrumentId: body.instrumentId,
        side: body.side,
        type: body.type,
        size: hasSize ? String(body.size) : undefined,
        amount: hasAmount ? body.amount : undefined,
        limitPrice: hasPrice ? body.price : undefined,
      });
    } catch (error) {
      if (error instanceof OrderIntentError) {
        throw invalidRequest();
      }

      throw error;
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRequest(): BadRequestException {
  return new BadRequestException(INVALID_SUBMIT_ORDER_REQUEST_MESSAGE);
}
