/**
 * Project-scoped MCP tools: list querying, detail fetch, and substring search.
 *
 * @module tools/project-tools
 */
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { LIST_NAMES, type QueryableListName } from '../constants';
import {
  MILESTONE_FIELDS,
  PROJECT_FIELDS,
  TASK_FIELDS,
  fieldSpecsForList,
  mapItem,
} from '../mappers/sharepoint-mapper';
import { PermissionService } from '../services/permission-service';
import type { SharePointClient } from '../sharepoint/client';
import {
  defaultPermissionsService,
  escapeODataString,
  filterForUser,
  parseId,
  sanitizeFields,
  sanitizeFilter,
  textResult,
} from './common';

export const queryProjectDataSchema = {
  listName: z.enum([LIST_NAMES.PROJECTS, LIST_NAMES.TASKS, LIST_NAMES.MILESTONES]),
  filter: z.string().optional(),
  fields: z.array(z.string()).optional(),
  userId: z.string().optional(),
};

export interface QueryProjectDataArgs {
  listName: QueryableListName;
  filter?: string;
  fields?: string[];
  userId?: string;
}

export function createQueryProjectDataHandler(
  client: SharePointClient,
  permissions: PermissionService = defaultPermissionsService,
) {
  return async (args: QueryProjectDataArgs): Promise<CallToolResult> => {
    const filter = args.filter ? sanitizeFilter(args.filter) : undefined;
    const rows = await client.queryList(args.listName, {
      filter,
      select: sanitizeFields(args.fields),
    });
    const mapped = rows.map((row) => mapItem(row, fieldSpecsForList(args.listName)));
    return textResult(await filterForUser(permissions, args.userId, mapped));
  };
}

export const getProjectByIdSchema = {
  projectId: z.string().min(1),
  userId: z.string().optional(),
};

export interface GetProjectByIdArgs {
  projectId: string;
  userId?: string;
}

export function createGetProjectByIdHandler(
  client: SharePointClient,
  permissions: PermissionService = defaultPermissionsService,
) {
  return async (args: GetProjectByIdArgs): Promise<CallToolResult> => {
    const projectId = parseId(args.projectId);
    const [project, tasks, milestones] = await Promise.all([
      client.getItemById(LIST_NAMES.PROJECTS, projectId),
      client.queryList(LIST_NAMES.TASKS, { filter: `ProjectId eq ${projectId}` }),
      client.queryList(LIST_NAMES.MILESTONES, { filter: `ProjectId eq ${projectId}` }),
    ]);
    return textResult({
      project: mapItem(project, PROJECT_FIELDS),
      tasks: await filterForUser(
        permissions,
        args.userId,
        tasks.map((task) => mapItem(task, TASK_FIELDS)),
      ),
      milestones: await filterForUser(
        permissions,
        args.userId,
        milestones.map((milestone) => mapItem(milestone, MILESTONE_FIELDS)),
      ),
    });
  };
}

export const searchProjectsSchema = {
  query: z.string().min(1),
  limit: z.number().int().positive().max(100).optional(),
  userId: z.string().optional(),
};

export interface SearchProjectsArgs {
  query: string;
  limit?: number;
  userId?: string;
}

export function createSearchProjectsHandler(
  client: SharePointClient,
  permissions: PermissionService = defaultPermissionsService,
) {
  return async (args: SearchProjectsArgs): Promise<CallToolResult> => {
    const escaped = escapeODataString(args.query);
    const filter = `substringof('${escaped}',Title) or substringof('${escaped}',Description)`;
    const rows = await client.queryList(LIST_NAMES.PROJECTS, { filter, top: args.limit ?? 10 });
    const mapped = rows.map((row) => mapItem(row, PROJECT_FIELDS));
    return textResult(await filterForUser(permissions, args.userId, mapped));
  };
}
