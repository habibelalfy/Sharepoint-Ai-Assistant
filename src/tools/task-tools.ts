/**
 * Task-scoped MCP tool: list tasks for a project, optionally filtered by status.
 *
 * @module tools/task-tools
 */
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { LIST_NAMES } from '../constants';
import { TASK_FIELDS, mapItem } from '../mappers/sharepoint-mapper';
import { PermissionService } from '../services/permission-service';
import type { SharePointClient } from '../sharepoint/client';
import {
  defaultPermissionsService,
  escapeODataString,
  filterForUser,
  parseId,
  textResult,
} from './common';

export const TASK_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Overdue'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const getTasksByProjectSchema = {
  projectId: z.string().min(1),
  status: z.enum(TASK_STATUSES).optional(),
  userId: z.string().optional(),
};

export interface GetTasksByProjectArgs {
  projectId: string;
  status?: TaskStatus;
  userId?: string;
}

export function createGetTasksByProjectHandler(
  client: SharePointClient,
  permissions: PermissionService = defaultPermissionsService,
) {
  return async (args: GetTasksByProjectArgs): Promise<CallToolResult> => {
    const projectId = parseId(args.projectId);
    const rows = await client.queryList(LIST_NAMES.TASKS, {
      filter: buildTaskFilter(projectId, args.status),
    });
    const mapped = rows.map((row) => mapItem(row, TASK_FIELDS));
    return textResult(await filterForUser(permissions, args.userId, mapped));
  };
}

/** Builds the `$filter` for tasks in a project, folding in an optional status. */
function buildTaskFilter(projectId: number, status?: TaskStatus): string {
  const clauses = [`ProjectId eq ${projectId}`];
  if (status) {
    clauses.push(
      status === 'Overdue' ? overdueClause() : `Status eq '${escapeODataString(status)}'`,
    );
  }
  return clauses.join(' and ');
}

/** OData clause for tasks that are past due but not yet completed. */
function overdueClause(): string {
  return `(Status ne 'Completed') and (DueDate lt datetime'${new Date().toISOString()}')`;
}
