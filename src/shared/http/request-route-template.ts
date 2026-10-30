import { parsePositiveInt32RouteId } from '../parse-positive-int32-route-id.js';

export interface RequestRouteDetails {
  readonly route: string;
  readonly accountUserId?: number;
  readonly orderId?: number;
}

interface RouteDefinition {
  readonly pattern: RegExp;
  readonly route: string;
  readonly accountGroup?: number;
  readonly orderGroup?: number;
}

// Match Express's current default: case-insensitive, with optional trailing slash.
const ROUTES: readonly RouteDefinition[] = [
  {
    pattern: /^\/users\/([^/]+)\/orders\/([^/]+)\/cancel\/?$/i,
    route: '/users/:userId/orders/:orderId/cancel',
    accountGroup: 1,
    orderGroup: 2,
  },
  {
    pattern: /^\/users\/([^/]+)\/portfolio\/?$/i,
    route: '/users/:userId/portfolio',
    accountGroup: 1,
  },
  {
    pattern: /^\/users\/([^/]+)\/orders\/?$/i,
    route: '/users/:userId/orders',
    accountGroup: 1,
  },
  {
    pattern: /^\/instruments\/?$/i,
    route: '/instruments',
  },
  {
    pattern: /^\/openapi\.json\/?$/i,
    route: '/openapi.json',
  },
  {
    pattern: /^\/docs(?:\/.*)?$/i,
    route: '/docs',
  },
  {
    pattern: /^\/$/,
    route: '/',
  },
];

/**
 * Maps a raw pathname to a route template. It never returns the raw path, so
 * account and order identifiers are not copied from the URL into access logs.
 */
export function resolveRequestRoute(pathname: string): RequestRouteDetails {
  for (const definition of ROUTES) {
    const match = definition.pattern.exec(pathname);

    if (match === null) {
      continue;
    }

    return {
      route: definition.route,
      ...readIdentifier(match[definition.accountGroup ?? -1], 'accountUserId'),
      ...readIdentifier(match[definition.orderGroup ?? -1], 'orderId'),
    };
  }

  return { route: '<unmatched>' };
}

function readIdentifier(
  value: string | undefined,
  key: 'accountUserId' | 'orderId',
): Partial<RequestRouteDetails> {
  if (value === undefined) {
    return {};
  }

  let decoded: string;

  try {
    decoded = decodeURIComponent(value);
  } catch {
    return {};
  }

  const parsed = parsePositiveInt32RouteId(decoded);

  return parsed === null ? {} : { [key]: parsed };
}
