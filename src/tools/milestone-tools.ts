/**
 * Milestone-scoped MCP tool: list milestones for a project, due-date ascending.
 *
 * @module tools/milestone-tools
 */
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { LIST_NAMES } from '../constants';
import { MILESTONE_FIELDS, mapItem } from '../mappers/sharepoint-mapper';
import { PermissionService } from '../services/permission-service';
import type { SharePointClient } from '../sharepoint/client';
import { defaultPermissionsService, filterForUser, parseId, textResult } from './common';

export const getMilestonesByProjectSchema = {
  projectId: z.string().min(1),
  includeCompleted: z.boolean().optional(),
  userId: z.string().optional(),
};

export interface GetMilestonesByProjectArgs {
  projectId: string;
  includeCompleted?: boolean;
  userId?: string;
}

export function createGetMilestonesByProjectHandler(
  client: SharePointClient,
  permissions: PermissionService = defaultPermissionsService,
) {
  return async (args: GetMilestonesByProjectArgs): Promise<CallToolResult> => {
    const projectId = parseId(args.projectId);
    const includeCompleted = args.includeCompleted ?? true;
    const filter = includeCompleted
      ? `ProjectId eq ${projectId}`
      : `(ProjectId eq ${projectId}) and (Status ne 'Completed')`;
    const rows = await client.queryList(LIST_NAMES.MILESTONES, { filter, orderby: 'DueDate asc' });
    const mapped = rows.map((row) => mapItem(row, MILESTONE_FIELDS));
    return textResult(await filterForUser(permissions, args.userId, mapped));
  };
}
