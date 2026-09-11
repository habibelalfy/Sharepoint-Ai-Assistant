/**
 * Escalation MCP tools: create, update, and query escalations.
 *
 * @module tools/escalation-tools
 */
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  DEFAULT_ESCALATION_STATUS,
  ESCALATION_PRIORITIES,
  ESCALATION_STATUSES,
  LIST_NAMES,
} from '../constants';
import { ESCALATION_FIELDS, PROJECT_FIELDS, mapItem } from '../mappers/sharepoint-mapper';
import { NoopAuditService, type AuditService } from '../services/audit-service';
import { PermissionService } from '../services/permission-service';
import type { EscalationPriority, EscalationStatus, Project } from '../types/models';
import type { SharePointClient } from '../sharepoint/client';
import {
  defaultPermissionsService,
  escapeODataString,
  filterForUser,
  parseId,
  textResult,
} from './common';

/** Injectable dependencies for the write tools (audit + clock). */
export interface EscalationToolOptions {
  audit?: AuditService;
  now?: () => Date;
}

export const createEscalationSchema = {
  projectId: z.string().min(1),
  issue: z.string().min(1),
  priority: z.enum(ESCALATION_PRIORITIES),
  assignedTo: z.string().optional(),
  dueDate: z.string().optional(),
  userId: z.string().optional(),
};

export interface CreateEscalationArgs {
  projectId: string;
  issue: string;
  priority: EscalationPriority;
  assignedTo?: string;
  dueDate?: string;
  userId?: string;
}

export function createCreateEscalationHandler(
  client: SharePointClient,
  options: EscalationToolOptions = {},
) {
  return async (args: CreateEscalationArgs): Promise<CallToolResult> => {
    const projectId = parseId(args.projectId);
    const now = options.now ?? (() => new Date());
    const audit = options.audit ?? new NoopAuditService();

    const projectRow = await client.getItemById(LIST_NAMES.PROJECTS, projectId);
    const project = mapItem(projectRow, PROJECT_FIELDS) as unknown as Project;
    const projectTitle = project.title || `Project ${projectId}`;

    const itemData: Record<string, unknown> = {
      Title: `Escalation: ${projectTitle}`,
      ProjectId: projectId,
      IssueDescription: args.issue,
      Priority: args.priority,
      Status: DEFAULT_ESCALATION_STATUS,
      CreatedDate: now().toISOString(),
    };
    if (args.assignedTo !== undefined) {
      itemData.AssignedTo = args.assignedTo;
    }
    if (args.dueDate !== undefined) {
      itemData.DueDate = args.dueDate;
    }

    const created = await client.createItem(LIST_NAMES.ESCALATIONS, itemData);
    const mapped = mapItem(created, ESCALATION_FIELDS);

    await audit.logAIAction({
      toolName: 'create_escalation',
      parameters: { projectId, issue: args.issue, priority: args.priority },
      userId: args.userId,
      timestamp: now().toISOString(),
      result: { id: mapped.id },
    });

    return textResult(mapped);
  };
}

export const updateEscalationSchema = {
  escalationId: z.string().min(1),
  issue: z.string().optional(),
  priority: z.enum(ESCALATION_PRIORITIES).optional(),
  status: z.enum(ESCALATION_STATUSES).optional(),
  assignedTo: z.string().optional(),
  dueDate: z.string().optional(),
  userId: z.string().optional(),
  // Immutable after creation — providing either key is rejected.
  projectId: z.never().optional(),
  createdBy: z.never().optional(),
};

export interface UpdateEscalationArgs {
  escalationId: string;
  issue?: string;
  priority?: EscalationPriority;
  status?: EscalationStatus;
  assignedTo?: string;
  dueDate?: string;
  userId?: string;
}

export function createUpdateEscalationHandler(
  client: SharePointClient,
  options: EscalationToolOptions = {},
) {
  return async (args: UpdateEscalationArgs): Promise<CallToolResult> => {
    const escalationId = parseId(args.escalationId);
    const now = options.now ?? (() => new Date());
    const audit = options.audit ?? new NoopAuditService();

    const itemData: Record<string, unknown> = {};
    if (args.issue !== undefined) itemData.IssueDescription = args.issue;
    if (args.priority !== undefined) itemData.Priority = args.priority;
    if (args.status !== undefined) itemData.Status = args.status;
    if (args.assignedTo !== undefined) itemData.AssignedTo = args.assignedTo;
    if (args.dueDate !== undefined) itemData.DueDate = args.dueDate;

    const updated = await client.updateItem(LIST_NAMES.ESCALATIONS, escalationId, itemData);
    const mapped = mapItem(updated, ESCALATION_FIELDS);

    await audit.logAIAction({
      toolName: 'update_escalation',
      parameters: { escalationId, fields: Object.keys(itemData) },
      userId: args.userId,
      timestamp: now().toISOString(),
      result: { id: mapped.id },
    });

    return textResult(mapped);
  };
}

export const getEscalationsByProjectSchema = {
  projectId: z.string().min(1),
  status: z.enum(ESCALATION_STATUSES).optional(),
  userId: z.string().optional(),
};

export interface GetEscalationsByProjectArgs {
  projectId: string;
  status?: EscalationStatus;
  userId?: string;
}

export function createGetEscalationsByProjectHandler(
  client: SharePointClient,
  permissions: PermissionService = defaultPermissionsService,
) {
  return async (args: GetEscalationsByProjectArgs): Promise<CallToolResult> => {
    const projectId = parseId(args.projectId);
    const filter = args.status
      ? `(ProjectId eq ${projectId}) and (Status eq '${escapeODataString(args.status)}')`
      : `ProjectId eq ${projectId}`;
    const rows = await client.queryList(LIST_NAMES.ESCALATIONS, { filter });
    const mapped = rows.map((row) => mapItem(row, ESCALATION_FIELDS));
    return textResult(await filterForUser(permissions, args.userId, mapped));
  };
}
