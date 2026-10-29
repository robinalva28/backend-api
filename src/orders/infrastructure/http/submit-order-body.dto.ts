import { IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { IsSubmitOrderDecimal } from './submit-order-decimal.js';

/** PostgreSQL `INT` maximum for route ids, `instrumentId` and `size`. */
const MAX_INT32 = 2_147_483_647;

export const SUBMIT_ORDER_SIDES = ['BUY', 'SELL'] as const;
export const SUBMIT_ORDER_TYPES = ['MARKET', 'LIMIT'] as const;

export type SubmitOrderSide = (typeof SUBMIT_ORDER_SIDES)[number];
export type SubmitOrderType = (typeof SUBMIT_ORDER_TYPES)[number];

/**
 * HTTP body shape. Property decorators reject missing, null and mistyped
 * values; the pipe adds the cross-field size/amount/price rules. Unknown
 * properties, including `currency`, are rejected by the pipe's validation.
 */
export class SubmitOrderBodyDto {
  @IsInt()
  @Min(1)
  @Max(MAX_INT32)
  instrumentId!: number;

  @IsIn(SUBMIT_ORDER_SIDES)
  side!: SubmitOrderSide;

  @IsIn(SUBMIT_ORDER_TYPES)
  type!: SubmitOrderType;

  @ValidateIf((body: SubmitOrderBodyDto) => body.size !== undefined)
  @IsInt()
  @Min(1)
  @Max(MAX_INT32)
  size?: number;

  @ValidateIf((body: SubmitOrderBodyDto) => body.amount !== undefined)
  @IsSubmitOrderDecimal()
  amount?: string;

  @ValidateIf((body: SubmitOrderBodyDto) => body.price !== undefined)
  @IsSubmitOrderDecimal({ maxIntegerDigits: 8 })
  price?: string;
}
