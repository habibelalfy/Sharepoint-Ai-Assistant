/**
 * Application logging (structured JSON via pino).
 *
 * Logs are written to **stderr** so stdout remains reserved for the MCP stdio
 * transport's JSON-RPC messages. In production, stderr is collected by the log
 * shipper.
 *
 * @module logging
 */
import pino from 'pino';

/**
 * Creates a pino logger writing structured JSON to stderr.
 *
 * @param level - Minimum log level (e.g. "info").
 * @param name - Logger name (the service name).
 * @returns A configured pino logger.
 */
export function createLogger(level: string, name: string): ReturnType<typeof pino> {
  return pino({ level, name }, pino.destination(2));
}
