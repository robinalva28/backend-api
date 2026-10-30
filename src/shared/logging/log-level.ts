export type LogLevel = 'error' | 'warn' | 'info';

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  error: 0,
  warn: 1,
  info: 2,
};

export const DEFAULT_SLOW_REQUEST_THRESHOLD_MS = 1000;

export function readLogLevel(value: string | undefined): LogLevel {
  if (value === undefined || value.trim() === '') {
    return 'info';
  }

  const normalized = value.trim().toLowerCase();

  if (!Object.hasOwn(LEVEL_PRIORITY, normalized)) {
    throw new Error('LOG_LEVEL must be one of error, warn or info.');
  }

  return normalized as LogLevel;
}

export function isLogLevelEnabled(
  configured: LogLevel,
  level: LogLevel,
): boolean {
  return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[configured];
}

export function readSlowRequestThresholdMs(
  value: string | undefined,
): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_SLOW_REQUEST_THRESHOLD_MS;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3_600_000) {
    throw new Error(
      'SLOW_REQUEST_THRESHOLD_MS must be an integer between 1 and 3600000.',
    );
  }

  return parsed;
}
