/**
 * Typed error hierarchy for the SharePoint AI Project Management Assistant.
 *
 * Every expected failure derives from {@link AppError} so callers can
 * distinguish typed, recoverable failures (config, validation, permission,
 * SharePoint) from unexpected runtime errors. Errors are never swallowed
 * silently; they carry a `cause` where a lower-level error is the origin.
 *
 * @module errors
 */

/** Common options accepted by every {@link AppError} subclass. */
export interface AppErrorOptions {
  /** The original error that caused this one, if any. */
  cause?: unknown;
}

/**
 * Base class for all application errors.
 *
 * Sets `name` to the concrete class name so error types survive serialization
 * and are easy to identify in logs and tests.
 */
export class AppError extends Error {
  public constructor(message: string, options?: AppErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Thrown when required configuration is missing or invalid (fail-fast). */
export class ConfigError extends AppError {
  public constructor(message: string, options?: AppErrorOptions) {
    super(message, options);
  }
}

/**
 * Thrown when a SharePoint REST call fails.
 *
 * Preserves the original HTTP status code and response body so callers can
 * inspect SharePoint's own error message.
 */
export class SharePointError extends AppError {
  public readonly statusCode: number;
  public readonly body: unknown;

  public constructor(
    message: string,
    statusCode: number,
    body: unknown,
    options?: AppErrorOptions,
  ) {
    super(message, options);
    this.statusCode = statusCode;
    this.body = body;
  }
}

/** Thrown when tool input fails schema validation. */
export class ValidationError extends AppError {
  public constructor(message: string, options?: AppErrorOptions) {
    super(message, options);
  }
}

/** Thrown when a user lacks permission for the requested action. */
export class PermissionError extends AppError {
  public constructor(message: string, options?: AppErrorOptions) {
    super(message, options);
  }
}

/** Thrown when the self-hosted embedding provider fails or returns a wrong-sized vector. */
export class EmbeddingProviderError extends AppError {
  public constructor(message: string, options?: AppErrorOptions) {
    super(message, options);
  }
}

/** Thrown when document text extraction fails (e.g. corrupt or unsupported file). */
export class ExtractionError extends AppError {
  public constructor(message: string, options?: AppErrorOptions) {
    super(message, options);
  }
}

/** Thrown when the pgvector store cannot fulfill an operation. */
export class VectorStoreError extends AppError {
  public constructor(message: string, options?: AppErrorOptions) {
    super(message, options);
  }
}

/** Thrown when the LLM (chat) provider fails or the agent loop cannot converge. */
export class LLMProviderError extends AppError {
  public constructor(message: string, options?: AppErrorOptions) {
    super(message, options);
  }
}
