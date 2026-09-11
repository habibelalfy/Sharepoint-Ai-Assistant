/**
 * Security/audit MCP tools: query audit logs and inspect a user's access.
 *
 * @module tools/security-tools
 */
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { LIST_NAMES } from '../constants';
import { PROJECT_FIELDS, mapItem } from '../mappers/sharepoint-mapper';
import type { AuditService } from '../services/audit-service';
import { PermissionService } from '../services/permission-service';
import type { SharePointClient } from '../sharepoint/client';
import type { Project } from '../types/models';
import { textResult } from './common';

export const getAuditLogsSchema = {
  userId: z.string().optional(),
  action: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
};

export interface GetAuditLogsArgs {
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
}

export function createGetAuditLogsHandler(audit: AuditService) {
  return async (args: GetAuditLogsArgs): Promise<CallToolResult> => {
    const logs = await audit.getAuditLogs(args);
    return textResult(logs);
  };
}

export const getUserPermissionsSchema = {
  userId: z.string().min(1),
};

export interface GetUserPermissionsArgs {
  userId: string;
}

export function createGetUserPermissionsHandler(
  permissions: PermissionService,
  client: SharePointClient,
) {
  return async (args: GetUserPermissionsArgs): Promise<CallToolResult> => {
    const groups = await permissions.getUserADGroups(args.userId);
    const projectRows = await client.queryList(LIST_NAMES.PROJECTS);
    const accessibleProjects = projectRows
      .map((row) => mapItem(row, PROJECT_FIELDS) as unknown as Project)
      .filter((project) => permissions.trimResultsByADGroups([project], groups).length === 1)
      .map((project) => ({ id: project.id, title: project.title }));

    return textResult({ userId: args.userId, groups, accessibleProjects });
  };
}
