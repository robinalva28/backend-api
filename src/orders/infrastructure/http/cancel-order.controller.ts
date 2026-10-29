import {
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  UseFilters,
} from '@nestjs/common';
import type { CancelOrderUseCase } from '../../application/ports/in/cancel-order.use-case.js';
import { CANCEL_ORDER_USE_CASE } from '../../orders.tokens.js';
import { CancelOrderExceptionFilter } from './cancel-order-exception.filter.js';
import { requireCancelOrderRouteId } from './parse-cancel-order-route-id.js';

export interface CancelOrderHttpResponse {
  readonly order: {
    readonly id: number;
    readonly status: 'CANCELLED';
  };
}

@Controller('users')
@UseFilters(CancelOrderExceptionFilter)
export class CancelOrderController {
  constructor(
    @Inject(CANCEL_ORDER_USE_CASE)
    private readonly cancelOrder: CancelOrderUseCase,
  ) {}

  @Post(':userId/orders/:orderId/cancel')
  @HttpCode(200)
  async cancel(
    @Param('userId') userIdText: string,
    @Param('orderId') orderIdText: string,
  ): Promise<CancelOrderHttpResponse> {
    const userId = requireCancelOrderRouteId(userIdText);
    const orderId = requireCancelOrderRouteId(orderIdText);
    const result = await this.cancelOrder.execute({ userId, orderId });

    return {
      order: {
        id: result.orderId,
        status: result.status,
      },
    };
  }
}
