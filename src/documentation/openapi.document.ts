/**
 * Explicit OpenAPI 3.0.3 description of the four public HTTP operations.
 *
 * This is the only definition used by both `/openapi.json` and Swagger UI.
 * It is static infrastructure data: importing or serving it does not import,
 * instantiate or execute any use case, repository or SQL query.
 */
export const OPENAPI_DOCUMENT = {
  openapi: '3.0.3',
  info: {
    title: 'backend API',
    version: '0.0.0',
    description:
      'API de acciones en ARS. Sin autenticación. Porcentajes redondeados a dos ' +
      'decimales.',
  },
  tags: [
    {
      name: 'Instrumentos',
    },
    {
      name: 'Portfolio',
    },
    {
      name: 'Órdenes',
    },
  ],
  paths: {
    '/instruments': {
      get: {
        tags: ['Instrumentos'],
        operationId: 'searchInstruments',
        summary: 'Buscar acciones',
        description:
          'Coincidencias literales por ticker o nombre, sin distinguir mayúsculas. Solo ' +
          'instrumentos ACCIONES.',
        parameters: [{ $ref: '#/components/parameters/InstrumentQuery' }],
        responses: {
          '200': { $ref: '#/components/responses/InstrumentSearchSuccess' },
          '400': { $ref: '#/components/responses/InvalidRequest' },
          '500': { $ref: '#/components/responses/InstrumentSearchUnavailable' },
        },
      },
    },
    '/users/{userId}/portfolio': {
      get: {
        tags: ['Portfolio'],
        operationId: 'getPortfolio',
        summary: 'Consultar portfolio',
        description: 'Valor de cuenta, efectivo disponible y posiciones ejecutadas.',
        parameters: [{ $ref: '#/components/parameters/UserIdPath' }],
        responses: {
          '200': { $ref: '#/components/responses/PortfolioSuccess' },
          '400': { $ref: '#/components/responses/InvalidRequest' },
          '404': { $ref: '#/components/responses/PortfolioUserNotFound' },
          '500': { $ref: '#/components/responses/PortfolioUnavailable' },
        },
      },
    },
    '/users/{userId}/orders': {
      post: {
        tags: ['Órdenes'],
        operationId: 'submitOrder',
        summary: 'Enviar orden',
        description:
          'Compra o venta de acciones. MARKET usa el último close; LIMIT usa el precio ' +
          'indicado.',
        parameters: [
          { $ref: '#/components/parameters/UserIdPath' },
          { $ref: '#/components/parameters/IdempotencyKeyHeader' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SubmitOrderRequest' },
              examples: {
                limitBySize: {
                  summary: 'LIMIT por cantidad',
                  value: {
                    instrumentId: 47,
                    side: 'BUY',
                    type: 'LIMIT',
                    size: 3,
                    price: '10.00',
                  },
                },
                limitByAmount: {
                  summary: 'LIMIT por monto',
                  value: {
                    instrumentId: 47,
                    side: 'SELL',
                    type: 'LIMIT',
                    amount: '1000.00',
                    price: '300.00',
                  },
                },
                marketBySize: {
                  summary: 'MARKET por cantidad',
                  value: {
                    instrumentId: 47,
                    side: 'BUY',
                    type: 'MARKET',
                    size: 3,
                  },
                },
                marketByAmount: {
                  summary: 'MARKET por monto',
                  value: {
                    instrumentId: 47,
                    side: 'SELL',
                    type: 'MARKET',
                    amount: '1000.00',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': { $ref: '#/components/responses/SubmitOrderCreated' },
          '200': { $ref: '#/components/responses/SubmitOrderReplayed' },
          '400': { $ref: '#/components/responses/InvalidRequest' },
          '404': { $ref: '#/components/responses/SubmitOrderNotFound' },
          '409': { $ref: '#/components/responses/SubmitOrderConflict' },
          '500': { $ref: '#/components/responses/SubmitOrderUnavailable' },
        },
      },
    },
    '/users/{userId}/orders/{orderId}/cancel': {
      post: {
        tags: ['Órdenes'],
        operationId: 'cancelOrder',
        summary: 'Cancelar una orden',
        description: 'Solo cancela órdenes NEW. Sin body; Idempotency-Key no se utiliza.',
        parameters: [
          { $ref: '#/components/parameters/UserIdPath' },
          { $ref: '#/components/parameters/OrderIdPath' },
        ],
        responses: {
          '200': { $ref: '#/components/responses/CancelOrderSuccess' },
          '400': { $ref: '#/components/responses/InvalidRequest' },
          '404': { $ref: '#/components/responses/CancelOrderNotFound' },
          '409': { $ref: '#/components/responses/CancelOrderConflict' },
          '500': { $ref: '#/components/responses/CancelOrderUnavailable' },
        },
      },
    },
  },
  components: {
    parameters: {
      InstrumentQuery: {
        name: 'query',
        in: 'query',
        required: true,
        description:
          'Texto único: 1–255 caracteres Unicode después de trim, sin normalizar tildes. ' +
          'Se rechazan vacíos, repeticiones, estructuras y parámetros adicionales. El ' +
          'límite se aplica después del recorte, no al valor crudo.',
        schema: {
          type: 'string',
        },
        example: 'pamp',
      },
      UserIdPath: {
        name: 'userId',
        in: 'path',
        required: true,
        description: 'Dígitos ASCII; valor entre 1 y 2147483647. Admite ceros iniciales.',
        schema: {
          type: 'string',
          pattern: '^[0-9]+$',
        },
        example: '1',
      },
      OrderIdPath: {
        name: 'orderId',
        in: 'path',
        required: true,
        description: 'Dígitos ASCII; valor entre 1 y 2147483647. Admite ceros iniciales.',
        schema: {
          type: 'string',
          pattern: '^[0-9]+$',
        },
        example: '5',
      },
      IdempotencyKeyHeader: {
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        description:
          'UUID hexadecimal, único por usuario. Una sola cabecera; se normaliza a ' +
          'minúsculas. Admite cualquier versión o variante, incluido el UUID nulo.',
        schema: {
          type: 'string',
          pattern:
            '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
        },
        example: '123e4567-e89b-12d3-a456-426614174000',
      },
    },
    schemas: {
      Message: {
        type: 'object',
        additionalProperties: false,
        required: ['message'],
        properties: {
          message: { type: 'string' },
        },
      },
      Instrument: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'ticker', 'name'],
        properties: {
          id: { type: 'integer', format: 'int32', minimum: 1 },
          ticker: { type: 'string', nullable: true },
          name: { type: 'string', nullable: true },
        },
      },
      PortfolioPosition: {
        type: 'object',
        additionalProperties: false,
        required: [
          'instrumentId',
          'ticker',
          'name',
          'quantity',
          'positionValue',
          'totalReturnPercent',
          'dailyReturnPercent',
        ],
        properties: {
          instrumentId: { type: 'integer', format: 'int32', minimum: 1 },
          ticker: { type: 'string', nullable: true },
          name: { type: 'string', nullable: true },
          quantity: {
            type: 'integer',
            description: 'Tenencia ejecutada; conserva cantidades históricas negativas.',
          },
          positionValue: {
            type: 'string',
            pattern: '^-?[0-9]+\\.[0-9]{2}$',
            description: 'Cantidad ejecutada × último close.',
          },
          totalReturnPercent: {
            type: 'number',
            nullable: true,
            description:
              'Rendimiento sobre costo promedio móvil; null si el costo no es ' +
              'calculable, incluida una tenencia negativa.',
          },
          dailyReturnPercent: {
            type: 'number',
            nullable: true,
            description:
              '100 × (close − previousClose) / previousClose; null sin previousClose ' +
              'válido.',
          },
        },
      },
      Portfolio: {
        type: 'object',
        additionalProperties: false,
        required: ['totalValue', 'availableCash', 'positions'],
        properties: {
          totalValue: {
            type: 'string',
            pattern: '^-?[0-9]+\\.[0-9]{2}$',
            description:
              'Efectivo contable más valor de posiciones. Las reservas no se descuentan ' +
              'del total.',
          },
          availableCash: {
            type: 'string',
            pattern: '^-?[0-9]+\\.[0-9]{2}$',
            description: 'Efectivo contable menos reservas de compras NEW.',
          },
          positions: {
            type: 'array',
            description: 'Cantidad distinta de cero; orden por instrumentId.',
            items: { $ref: '#/components/schemas/PortfolioPosition' },
          },
        },
      },
      OrderCreatedStatus: {
        type: 'string',
        enum: ['NEW', 'FILLED', 'REJECTED'],
      },
      OrderReplayedStatus: {
        type: 'string',
        enum: ['NEW', 'FILLED', 'REJECTED', 'CANCELLED'],
      },
      SubmitOrderCreatedResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['order'],
        properties: {
          order: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'status'],
            properties: {
              id: { type: 'integer', format: 'int32', minimum: 1 },
              status: { $ref: '#/components/schemas/OrderCreatedStatus' },
            },
          },
        },
      },
      SubmitOrderReplayedResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['order'],
        properties: {
          order: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'status'],
            properties: {
              id: { type: 'integer', format: 'int32', minimum: 1 },
              status: { $ref: '#/components/schemas/OrderReplayedStatus' },
            },
          },
        },
      },
      CancelOrderResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['order'],
        properties: {
          order: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'status'],
            properties: {
              id: { type: 'integer', format: 'int32', minimum: 1 },
              status: { type: 'string', enum: ['CANCELLED'] },
            },
          },
        },
      },
      SubmitOrderLimitBySize: {
        type: 'object',
        additionalProperties: false,
        required: ['instrumentId', 'side', 'type', 'size', 'price'],
        properties: {
          instrumentId: { $ref: '#/components/schemas/InstrumentId' },
          side: { $ref: '#/components/schemas/OrderSide' },
          type: { type: 'string', enum: ['LIMIT'] },
          size: { $ref: '#/components/schemas/OrderSize' },
          price: { $ref: '#/components/schemas/LimitPrice' },
        },
      },
      SubmitOrderLimitByAmount: {
        type: 'object',
        additionalProperties: false,
        required: ['instrumentId', 'side', 'type', 'amount', 'price'],
        properties: {
          instrumentId: { $ref: '#/components/schemas/InstrumentId' },
          side: { $ref: '#/components/schemas/OrderSide' },
          type: { type: 'string', enum: ['LIMIT'] },
          amount: { $ref: '#/components/schemas/OrderAmount' },
          price: { $ref: '#/components/schemas/LimitPrice' },
        },
      },
      SubmitOrderMarketBySize: {
        type: 'object',
        additionalProperties: false,
        required: ['instrumentId', 'side', 'type', 'size'],
        properties: {
          instrumentId: { $ref: '#/components/schemas/InstrumentId' },
          side: { $ref: '#/components/schemas/OrderSide' },
          type: { type: 'string', enum: ['MARKET'] },
          size: { $ref: '#/components/schemas/OrderSize' },
        },
      },
      SubmitOrderMarketByAmount: {
        type: 'object',
        additionalProperties: false,
        required: ['instrumentId', 'side', 'type', 'amount'],
        properties: {
          instrumentId: { $ref: '#/components/schemas/InstrumentId' },
          side: { $ref: '#/components/schemas/OrderSide' },
          type: { type: 'string', enum: ['MARKET'] },
          amount: { $ref: '#/components/schemas/OrderAmount' },
        },
      },
      SubmitOrderRequest: {
        oneOf: [
          { $ref: '#/components/schemas/SubmitOrderLimitBySize' },
          { $ref: '#/components/schemas/SubmitOrderLimitByAmount' },
          { $ref: '#/components/schemas/SubmitOrderMarketBySize' },
          { $ref: '#/components/schemas/SubmitOrderMarketByAmount' },
        ],
      },
      InstrumentId: {
        type: 'integer',
        format: 'int32',
        minimum: 1,
        maximum: 2147483647,
        description: 'ID de un instrumento ACCIONES; otros tipos se rechazan.',
      },
      OrderSize: {
        type: 'integer',
        format: 'int32',
        minimum: 1,
        maximum: 2147483647,
        description: 'Cantidad exacta de acciones enteras.',
      },
      OrderAmount: {
        type: 'string',
        pattern: '^(?=.*[1-9])[0-9]+(?:\\.[0-9]{1,2})?$',
        description:
          'Monto positivo para BUY o SELL, con hasta dos decimales escritos y ceros ' +
          'iniciales admitidos. La cantidad es amount dividido por el precio, redondeada ' +
          'hacia abajo; cero acciones se rechaza.',
      },
      LimitPrice: {
        type: 'string',
        pattern: '^(?=.*[1-9])0*[0-9]{1,8}(?:\\.[0-9]{1,2})?$',
        description:
          'Precio positivo: hasta ocho dígitos enteros normalizados y dos decimales ' +
          'escritos. Admite ceros iniciales.',
      },
      OrderSide: {
        type: 'string',
        enum: ['BUY', 'SELL'],
      },
    },
    responses: {
      InstrumentSearchSuccess: {
        description:
          'Ordenadas por ticker e id. Array vacío si no hay coincidencias; ticker y name ' +
          'conservan nulos.',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/Instrument' },
            },
            examples: {
              pamp: {
                summary: 'Coincidencia por ticker',
                value: [
                  { id: 47, ticker: 'PAMP', name: 'Pampa Holding S.A.' },
                ],
              },
              withoutMatches: {
                summary: 'Sin coincidencias',
                value: [],
              },
            },
          },
        },
      },
      PortfolioSuccess: {
        description: 'Lectura consistente del portfolio.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Portfolio' },
            examples: {
              seed: {
                summary: 'Datos iniciales, incluida la posición negativa',
                value: {
                  totalValue: '889756.00',
                  availableCash: '627500.00',
                  positions: [
                    {
                      instrumentId: 31,
                      ticker: 'BMA',
                      name: 'Banco Macro S.A.',
                      quantity: -10,
                      positionValue: '-15028.00',
                      totalReturnPercent: null,
                      dailyReturnPercent: -1.15,
                    },
                    {
                      instrumentId: 47,
                      ticker: 'PAMP',
                      name: 'Pampa Holding S.A.',
                      quantity: 40,
                      positionValue: '37034.00',
                      totalReturnPercent: -0.45,
                      dailyReturnPercent: 0.44,
                    },
                    {
                      instrumentId: 54,
                      ticker: 'METR',
                      name: 'MetroGAS S.A.',
                      quantity: 500,
                      positionValue: '114750.00',
                      totalReturnPercent: -8.2,
                      dailyReturnPercent: -1.08,
                    },
                  ],
                },
              },
              withoutPositions: {
                summary: 'Cuenta existente sin posiciones',
                value: {
                  totalValue: '0.00',
                  availableCash: '0.00',
                  positions: [],
                },
              },
            },
          },
        },
      },
      SubmitOrderCreated: {
        description:
          'Orden creada: MARKET queda FILLED; LIMIT queda NEW y reserva recursos. Sin ' +
          'recursos suficientes queda REJECTED, sin ejecución ni reserva.',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/SubmitOrderCreatedResponse',
            },
            examples: {
              limitNew: {
                summary: 'LIMIT creada y reservada',
                value: { order: { id: 5, status: 'NEW' } },
              },
              marketFilled: {
                summary: 'MARKET ejecutada',
                value: { order: { id: 6, status: 'FILLED' } },
              },
              insufficientRejected: {
                summary: 'Insuficiencia persistida como REJECTED',
                value: { order: { id: 7, status: 'REJECTED' } },
              },
            },
          },
        },
      },
      SubmitOrderReplayed: {
        description:
          'Misma clave e intención: devuelve el estado actual sin nuevos efectos, ' +
          'incluido CANCELLED.',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/SubmitOrderReplayedResponse',
            },
            examples: {
              new: {
                summary: 'Reenvío de una LIMIT todavía NEW',
                value: { order: { id: 5, status: 'NEW' } },
              },
              filled: {
                summary: 'Reenvío de una orden ejecutada',
                value: { order: { id: 6, status: 'FILLED' } },
              },
              rejected: {
                summary: 'Reenvío de una orden rechazada',
                value: { order: { id: 7, status: 'REJECTED' } },
              },
              cancelled: {
                summary: 'Reenvío de una orden cancelada',
                value: { order: { id: 5, status: 'CANCELLED' } },
              },
            },
          },
        },
      },
      CancelOrderSuccess: {
        description:
          'Orden CANCELLED y reserva liberada. Repetir la cancelación no agrega efectos.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CancelOrderResponse' },
            example: { order: { id: 5, status: 'CANCELLED' } },
          },
        },
      },
      InvalidRequest: {
        description: 'Parámetros, cabeceras o cuerpo inválidos.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Message' },
            example: { message: 'Invalid request.' },
          },
        },
      },
      InstrumentSearchUnavailable: {
        description: 'No se pudo completar la búsqueda.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Message' },
            example: { message: 'Instrument search could not be completed.' },
          },
        },
      },
      PortfolioUserNotFound: {
        description: 'Usuario inexistente.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Message' },
            example: { message: 'User not found.' },
          },
        },
      },
      PortfolioUnavailable: {
        description:
          'Cotización necesaria ausente o inválida, o fallo técnico. No devuelve ' +
          'resultados parciales.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Message' },
            example: { message: 'Portfolio could not be retrieved.' },
          },
        },
      },
      SubmitOrderNotFound: {
        description: 'Usuario o instrumento inexistente.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Message' },
            example: { message: 'User or instrument not found.' },
          },
        },
      },
      SubmitOrderConflict: {
        description: 'La misma clave ya fue usada con otra intención.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Message' },
            example: {
              message:
                'The idempotency key was already used with a different request.',
            },
          },
        },
      },
      SubmitOrderUnavailable: {
        description:
          'Fallo técnico. No confirma si la orden se guardó; reenviar con el mismo UUID.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Message' },
            example: { message: 'Order could not be completed.' },
          },
        },
      },
      CancelOrderNotFound: {
        description: 'Orden inexistente, ajena o de un usuario inexistente.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Message' },
            example: { message: 'Order not found.' },
          },
        },
      },
      CancelOrderConflict: {
        description: 'La orden está FILLED o REJECTED y no puede cancelarse.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Message' },
            example: { message: 'Order cannot be cancelled.' },
          },
        },
      },
      CancelOrderUnavailable: {
        description: 'Fallo técnico; no confirma si la cancelación ocurrió.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Message' },
            example: {
              message: 'Order cancellation could not be completed.',
            },
          },
        },
      },
    },
  },
} as const;
