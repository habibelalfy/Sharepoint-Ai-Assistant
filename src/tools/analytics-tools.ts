/**
 * Analytics MCP tools: plan health, milestone delay analysis, and statistics.
 *
 * These tools fetch data through the injected {@link SharePointClient}, map it
 * into domain models, and delegate the scoring/analysis to the platform-
 * independent services (which never touch SharePoint themselves).
 *
 * @module tools/analytics-tools
 */
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { LIST_NAMES } from '../constants';
import type { Milestone, Project, Task } from '../types/models';
import {
  MILESTONE_FIELDS,
  PROJECT_FIELDS,
  TASK_FIELDS,
  mapItem,
} from '../mappers/sharepoint-mapper';
import { ProjectHealthService } from '../services/health-assessment';
import { MilestoneDelayAnalysisService } from '../services/milestone-analysis';
import { computeProjectStatistics } from '../services/statistics';
import type { SharePointClient } from '../sharepoint/client';
import { parseId, textResult } from './common';

const healthService = new ProjectHealthService();
const delayService = new MilestoneDelayAnalysisService();

export const checkPlanHealthSchema = {
  projectId: z.string().min(1),
  userId: z.string().optional(),
};

export interface CheckPlanHealthArgs {
  projectId: string;
  userId?: string;
}

export function createCheckPlanHealthHandler(client: SharePointClient) {
  return async (args: CheckPlanHealthArgs): Promise<CallToolResult> => {
    const projectId = parseId(args.projectId);
    const [project, tasks, milestones] = await Promise.all([
      client.getItemById(LIST_NAMES.PROJECTS, projectId),
      client.queryList(LIST_NAMES.TASKS, { filter: `ProjectId eq ${projectId}` }),
      client.queryList(LIST_NAMES.MILESTONES, { filter: `ProjectId eq ${projectId}` }),
    ]);

    const health = healthService.assessProjectHealth(
      mapItem(project, PROJECT_FIELDS) as unknown as Project,
      tasks.map((task) => mapItem(task, TASK_FIELDS) as unknown as Task),
      milestones.map((milestone) => mapItem(milestone, MILESTONE_FIELDS) as unknown as Milestone),
    );
    return textResult(health);
  };
}

export const analyzeMilestoneDelaySchema = {
  milestoneId: z.string().min(1),
  delayDays: z.number().int().positive(),
  userId: z.string().optional(),
};

export interface AnalyzeMilestoneDelayArgs {
  milestoneId: string;
  delayDays: number;
  userId?: string;
}

export function createAnalyzeMilestoneDelayHandler(client: SharePointClient) {
  return async (args: AnalyzeMilestoneDelayArgs): Promise<CallToolResult> => {
    const milestoneId = String(parseId(args.milestoneId));
    const [milestones, tasks] = await Promise.all([
      client.queryList(LIST_NAMES.MILESTONES),
      client.queryList(LIST_NAMES.TASKS),
    ]);

    const result = delayService.analyzeDelayImpact(
      milestoneId,
      args.delayDays,
      milestones.map((milestone) => mapItem(milestone, MILESTONE_FIELDS) as unknown as Milestone),
      tasks.map((task) => mapItem(task, TASK_FIELDS) as unknown as Task),
    );
    return textResult(result);
  };
}

export const getProjectStatisticsSchema = {
  projectId: z.string().min(1),
  userId: z.string().optional(),
};

export interface GetProjectStatisticsArgs {
  projectId: string;
  userId?: string;
}

export function createGetProjectStatisticsHandler(client: SharePointClient) {
  return async (args: GetProjectStatisticsArgs): Promise<CallToolResult> => {
    const projectId = parseId(args.projectId);
    const [tasks, milestones] = await Promise.all([
      client.queryList(LIST_NAMES.TASKS, { filter: `ProjectId eq ${projectId}` }),
      client.queryList(LIST_NAMES.MILESTONES, { filter: `ProjectId eq ${projectId}` }),
    ]);

    const stats = computeProjectStatistics(
      tasks.map((task) => mapItem(task, TASK_FIELDS) as unknown as Task),
      milestones.map((milestone) => mapItem(milestone, MILESTONE_FIELDS) as unknown as Milestone),
    );
    return textResult(stats);
  };
}
