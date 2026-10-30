import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestLogContext {
  readonly requestId: string;
  accountUserId?: number;
  orderId?: number;
}

const requestLogContext = new AsyncLocalStorage<RequestLogContext>();

export function runWithRequestLogContext<T>(
  context: RequestLogContext,
  callback: () => T,
): T {
  return requestLogContext.run(context, callback);
}

export function currentRequestLogContext():
  | Readonly<RequestLogContext>
  | undefined {
  return requestLogContext.getStore();
}

export function currentRequestId(): string | undefined {
  return requestLogContext.getStore()?.requestId;
}

/**
 * Adds the already validated route order identifier to the active request
 * context. It is used by the HTTP adapter after a new order is persisted so the
 * final access event can report the order without logging the request body.
 */
export function annotateRequestOrderId(orderId: number): void {
  const context = requestLogContext.getStore();

  if (context === undefined || !isPositiveInt32(orderId)) {
    return;
  }

  context.orderId = orderId;
}

function isPositiveInt32(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}
