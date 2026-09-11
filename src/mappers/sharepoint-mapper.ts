/**
 * SharePoint `odata=verbose` → clean, flat JSON mapper.
 *
 * Normalizes SharePoint's noisy REST shape: lookup/user companion `*Id` fields
 * are ignored, dates become ISO 8601, lookups resolve to `{ id, title }`, and
 * users resolve to `{ id, displayName, login }` (claims prefix stripped).
 *
 * @module mappers/sharepoint-mapper
 */
import { LIST_NAMES } from '../constants';

/** How a given SharePoint field should be mapped. */
export type FieldKind =
  'text' | 'number' | 'boolean' | 'date' | 'lookup' | 'user' | 'lookupMulti' | 'multiText';

/** Description of a single SharePoint field's output mapping. */
export interface FieldSpec {
  /** Output property name (camelCase). */
  name: string;
  kind: FieldKind;
}

/** A map of SharePoint field name → output spec. */
export type FieldSpecs = Record<string, FieldSpec>;

/** A resolved SharePoint lookup reference. */
export interface LookupRef {
  id: number;
  title: string;
}

/** A resolved SharePoint user reference. */
export interface UserRef {
  id: number;
  displayName: string;
  login: string;
}

/** A mapped (flattened) list item. */
export type MappedItem = Record<string, unknown>;

export const PROJECT_FIELDS: FieldSpecs = {
  Id: { name: 'id', kind: 'number' },
  Title: { name: 'title', kind: 'text' },
  Description: { name: 'description', kind: 'text' },
  Owner: { name: 'owner', kind: 'user' },
  StartDate: { name: 'startDate', kind: 'date' },
  EndDate: { name: 'endDate', kind: 'date' },
  Budget: { name: 'budget', kind: 'number' },
  ActualCost: { name: 'actualCost', kind: 'number' },
  Status: { name: 'status', kind: 'text' },
  PermittedGroups: { name: 'permittedGroups', kind: 'multiText' },
};

export const TASK_FIELDS: FieldSpecs = {
  Id: { name: 'id', kind: 'number' },
  Title: { name: 'title', kind: 'text' },
  Project: { name: 'project', kind: 'lookup' },
  AssignedTo: { name: 'assignedTo', kind: 'user' },
  Status: { name: 'status', kind: 'text' },
  DueDate: { name: 'dueDate', kind: 'date' },
  PercentComplete: { name: 'percentComplete', kind: 'number' },
  PermittedGroups: { name: 'permittedGroups', kind: 'multiText' },
};

export const MILESTONE_FIELDS: FieldSpecs = {
  Id: { name: 'id', kind: 'number' },
  Title: { name: 'title', kind: 'text' },
  Project: { name: 'project', kind: 'lookup' },
  DueDate: { name: 'dueDate', kind: 'date' },
  Status: { name: 'status', kind: 'text' },
  Dependencies: { name: 'dependencies', kind: 'lookupMulti' },
  PermittedGroups: { name: 'permittedGroups', kind: 'multiText' },
};

export const ESCALATION_FIELDS: FieldSpecs = {
  Id: { name: 'id', kind: 'number' },
  Title: { name: 'title', kind: 'text' },
  Project: { name: 'project', kind: 'lookup' },
  IssueDescription: { name: 'issueDescription', kind: 'text' },
  Priority: { name: 'priority', kind: 'text' },
  Status: { name: 'status', kind: 'text' },
  CreatedBy: { name: 'createdBy', kind: 'user' },
  CreatedDate: { name: 'createdDate', kind: 'date' },
  AssignedTo: { name: 'assignedTo', kind: 'user' },
  DueDate: { name: 'dueDate', kind: 'date' },
  PermittedGroups: { name: 'permittedGroups', kind: 'multiText' },
};

export const ALERT_FIELDS: FieldSpecs = {
  Id: { name: 'id', kind: 'number' },
  Title: { name: 'title', kind: 'text' },
  AlertType: { name: 'alertType', kind: 'text' },
  RelatedItemId: { name: 'relatedItemId', kind: 'number' },
  Recipients: { name: 'recipients', kind: 'text' },
  SentDate: { name: 'sentDate', kind: 'date' },
  Status: { name: 'status', kind: 'text' },
};

export const AUDIT_LOG_FIELDS: FieldSpecs = {
  Id: { name: 'id', kind: 'number' },
  Title: { name: 'title', kind: 'text' },
  ToolName: { name: 'toolName', kind: 'text' },
  Action: { name: 'action', kind: 'text' },
  Parameters: { name: 'parameters', kind: 'text' },
  UserId: { name: 'userId', kind: 'text' },
  Timestamp: { name: 'timestamp', kind: 'date' },
  Duration: { name: 'duration', kind: 'number' },
  Result: { name: 'result', kind: 'text' },
  IPAddress: { name: 'ipAddress', kind: 'text' },
};

/** Returns the field specs for a known list title (empty for unknown lists). */
export function fieldSpecsForList(listName: string): FieldSpecs {
  switch (listName) {
    case LIST_NAMES.PROJECTS:
      return PROJECT_FIELDS;
    case LIST_NAMES.TASKS:
      return TASK_FIELDS;
    case LIST_NAMES.MILESTONES:
      return MILESTONE_FIELDS;
    case LIST_NAMES.ESCALATIONS:
      return ESCALATION_FIELDS;
    case LIST_NAMES.ALERTS:
      return ALERT_FIELDS;
    case LIST_NAMES.AI_AUDIT_LOG:
      return AUDIT_LOG_FIELDS;
    default:
      return {};
  }
}

/** Maps a single verbose item into flat, camelCase JSON using the given specs. */
export function mapItem(raw: unknown, specs: FieldSpecs): MappedItem {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const source = raw as Record<string, unknown>;
  const result: MappedItem = {};
  for (const [spField, spec] of Object.entries(specs)) {
    const value = source[spField];
    if (value == null) {
      continue;
    }
    result[spec.name] = mapValue(value, spec.kind);
  }
  return result;
}

/** Converts a SharePoint `/Date(…)/` value to an ISO 8601 string. */
export function mapDate(value: unknown): string {
  if (typeof value === 'string') {
    const match = /\/Date\((-?\d+)([+-]\d+)?\)\//.exec(value);
    if (match) {
      return new Date(Number(match[1])).toISOString();
    }
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

/** Resolves a lookup value to `{ id, title }` (or null). */
export function mapLookup(value: unknown): LookupRef | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const id = toNumber(obj.Id);
  if (id === null) {
    return null;
  }
  return { id, title: typeof obj.Title === 'string' ? obj.Title : '' };
}

/** Resolves a user value to `{ id, displayName, login }` (or null). */
export function mapUser(value: unknown): UserRef | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const id = toNumber(obj.Id);
  if (id === null) {
    return null;
  }
  return {
    id,
    displayName: typeof obj.Title === 'string' ? obj.Title : '',
    login: extractLogin(obj.Name),
  };
}

/** Resolves a (possibly multi-valued) lookup into an array of `{ id, title }`. */
export function mapLookupMulti(value: unknown): LookupRef[] {
  if (Array.isArray(value)) {
    return value.map(mapLookup).filter((item): item is LookupRef => item !== null);
  }
  if (typeof value === 'object' && value !== null) {
    const results = (value as Record<string, unknown>).results;
    if (Array.isArray(results)) {
      return results.map(mapLookup).filter((item): item is LookupRef => item !== null);
    }
  }
  const single = mapLookup(value);
  return single ? [single] : [];
}

/** Maps a multi-value text field (array or `{ results }`) to `string[]`. */
export function mapStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => (typeof entry === 'string' ? entry : String(entry)));
  }
  if (typeof value === 'object' && value !== null) {
    const results = (value as Record<string, unknown>).results;
    if (Array.isArray(results)) {
      return results.map((entry) => (typeof entry === 'string' ? entry : String(entry)));
    }
  }
  return [];
}

function mapValue(value: unknown, kind: FieldKind): unknown {
  switch (kind) {
    case 'text':
      return typeof value === 'string' ? value : String(value);
    case 'number':
      return Number(value);
    case 'boolean':
      if (typeof value === 'boolean') {
        return value;
      }
      return value === 1 || value === '1' || value === 'true' || value === 'True';
    case 'date':
      return mapDate(value);
    case 'lookup':
      return mapLookup(value);
    case 'user':
      return mapUser(value);
    case 'lookupMulti':
      return mapLookupMulti(value);
    case 'multiText':
      return mapStringArray(value);
    default:
      return value;
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function extractLogin(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const parts = value.split('|');
  return parts[parts.length - 1] ?? value;
}
