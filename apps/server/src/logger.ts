import { pino, type Logger } from 'pino';
import type { Config } from './config';

export type { Logger };

export function createLogger(level: Config['logLevel']): Logger {
  return pino({ level, base: { service: 'de-trainer' }, timestamp: pino.stdTimeFunctions.isoTime });
}
