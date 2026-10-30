import {
  Body,
  Controller,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { SubmitOrderUseCase } from '../../application/ports/in/submit-order.use-case.js';
import type { OrderIntent } from '../../domain/order-intent.js';
import type { PersistedOrderStatus } from '../../domain/persisted-order.js';
import { SUBMIT_ORDER_USE_CASE } from '../../orders.tokens.js';
import { annotateRequestOrderId } from '../../../shared/logging/request-context.js';
import { SubmitOrderBodyPipe } from './submit-order-body.pipe.js';
import { SubmitOrderExceptionFilter } from './submit-order-exception.filter.js';
import { requireSubmitOrderIdempotencyKey } from './submit-order-idempotency-key.js';
import { requireSubmitOrderRouteId } from './parse-submit-order-route-id.js';

export interface SubmitOrderHttpResponse {
  readonly order: {
    readonly id: number;
    readonly status: PersistedOrderStatus;
  };
}

@Controller('users')
@UseFilters(SubmitOrderExceptionFilter)
export class SubmitOrderController {
  constructor(
    @Inject(SUBMIT_ORDER_USE_CASE)
    private readonly submitOrder: SubmitOrderUseCase,
  ) {}

  @Post(':userId/orders')
  async submit(
    @Param('userId') userIdText: string,
    @Req() request: Request,
    @Body(SubmitOrderBodyPipe) intent: OrderIntent,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SubmitOrderHttpResponse> {
    const userId = requireSubmitOrderRouteId(userIdText);
    const idempotencyKey = requireSubmitOrderIdempotencyKey(request);
    const result = await this.submitOrder.execute({
      userId,
      idempotencyKey,
      intent,
    });

    annotateRequestOrderId(result.orderId);
    response.status(result.replayed ? 200 : 201);

    return {
      order: {
        id: result.orderId,
        status: result.status,
      },
    };
  }
}
