/**
 * Shared helpers for MCP tool implementations.
 *
 * @module tools/common
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ValidationError } from '../errors';
import { PermissionService } from '../services/permission-service';

const MAX_FILTER_LENGTH = 1000;
const DISALLOWED_FILTER_CHARS = /[\r\n\0;]/;
const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_ ]*$/;
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/;

/** Wraps JSON data in the single text block MCP tools return. */
export function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/**
 * Sanitizes a user-supplied OData filter string.
 *
 * Rejects empty/oversized filters and control characters that could be used to
 * smuggle a second query or break out of the expression.
 */
export function sanitizeFilter(filter: string): string {
  const trimmed = filter.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FILTER_LENGTH) {
    throw new ValidationError(`Invalid OData filter: must be 1-${MAX_FILTER_LENGTH} characters`);
  }
  if (DISALLOWED_FILTER_CHARS.test(trimmed)) {
    throw new ValidationError('Invalid OData filter: contains disallowed characters');
  }
  return trimmed;
}

/** Escapes a string for safe embedding inside a single-quoted OData literal. */
export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/** Validates and dedupes a `$select` field list, returning undefined when empty. */
export function sanitizeFields(fields?: string[]): string[] | undefined {
  if (!fields || fields.length === 0) {
    return undefined;
  }
  const cleaned = [
    ...new Set(fields.map((field) => field.trim()).filter((field) => field.length > 0)),
  ];
  for (const field of cleaned) {
    if (!FIELD_NAME_PATTERN.test(field)) {
      throw new ValidationError(`Invalid field name: "${field}"`);
    }
  }
  return cleaned;
}

/** Parses an MCP string id argument into a non-negative integer. */
export function parseId(value: string): number {
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(value)) {
    throw new ValidationError(`Invalid id: "${value}" (expected a non-negative integer)`);
  }
  return Number(value);
}

/** Shared permission service default (empty provider → public-only filtering). */
export const defaultPermissionsService = new PermissionService();

/** Resolves the caller's groups and trims `items` to those they may see. */
export async function filterForUser<T>(
  permissions: PermissionService,
  userId: string | undefined,
  items: T[],
): Promise<T[]> {
  const groups = await permissions.resolveGroups(userId);
  return permissions.filterByPermissions(items, 'permittedGroups', groups);
}
