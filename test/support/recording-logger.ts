import type {
  OperationalLogFields,
  OperationalLogger,
} from '../../src/shared/logging/operational-logger.js';

export type RecordedLevel = 'info' | 'warn' | 'error';

export interface RecordedLog {
  readonly level: RecordedLevel;
  readonly event: string;
  readonly fields: OperationalLogFields;
}

export class RecordingLogger implements OperationalLogger {
  readonly entries: RecordedLog[] = [];

  info(event: string, fields: OperationalLogFields = {}): void {
    this.entries.push({ level: 'info', event, fields });
  }

  warn(event: string, fields: OperationalLogFields = {}): void {
    this.entries.push({ level: 'warn', event, fields });
  }

  error(event: string, fields: OperationalLogFields = {}): void {
    this.entries.push({ level: 'error', event, fields });
  }

  events(level?: RecordedLevel): readonly string[] {
    return this.entries
      .filter((entry) => level === undefined || entry.level === level)
      .map(({ event }) => event);
  }
}
