/**
 * Scheduled alerting: detection of overdue/upcoming items and notification.
 *
 * The detection helpers are pure and exported for testing. {@link AlertService}
 * wires them to SharePoint queries, the pluggable {@link EmailSender}, and the
 * Alerts list. The cron scheduler is injectable so tests can use a fake.
 *
 * @module services/alert-service
 */
import cron from 'node-cron';
import { LIST_NAMES } from '../constants';
import {
  MILESTONE_FIELDS,
  PROJECT_FIELDS,
  TASK_FIELDS,
  mapItem,
} from '../mappers/sharepoint-mapper';
import type { SharePointClient } from '../sharepoint/client';
import type { Milestone, Project, Task } from '../types/models';
import type { EmailSender } from './email-service';
import { ProjectHealthService } from './health-assessment';
import { isOverdue } from './shared';

/** Cron expressions for the three scheduled jobs. */
export interface AlertSchedules {
  overdue: string;
  milestones: string;
  healthCheck: string;
}

/** A started cron job; `stop` cancels it. */
export interface ScheduledJob {
  stop(): void;
}

/** Registers a cron job (thin seam so tests can inject a fake scheduler). */
export type Scheduler = (expression: string, task: () => void) => ScheduledJob;

/** A single overdue task or milestone. */
export interface OverdueItem {
  kind: 'task' | 'milestone';
  id: number;
  title: string;
  dueDate?: string;
  project?: string;
}

/** Shape of an alert row written to the Alerts list. */
export interface AlertRecord {
  title: string;
  alertType: string;
  relatedItemId?: number;
  recipients: string;
  status: string;
}

export interface AlertServiceOptions {
  scheduler?: Scheduler;
  recipients?: string[];
}

/** Default look-ahead window (days) for the upcoming-milestones check. */
export const DEFAULT_UPCOMING_DAYS = 7;

export class AlertService {
  public constructor(
    private readonly client: SharePointClient,
    private readonly emailSender: EmailSender,
    private readonly schedules: AlertSchedules,
    private readonly options: AlertServiceOptions = {},
  ) {}

  /** Registers the three scheduled jobs and returns their handles. */
  public startAlertScheduler(): ScheduledJob[] {
    return [
      this.scheduler(this.schedules.overdue, () => void this.checkOverdueItems()),
      this.scheduler(this.schedules.milestones, () => void this.checkUpcomingMilestones()),
      this.scheduler(this.schedules.healthCheck, () => void this.runHealthCheck()),
    ];
  }

  /** Detects overdue tasks/milestones, notifies, and returns the detected items. */
  public async checkOverdueItems(now: Date = new Date()): Promise<OverdueItem[]> {
    const [tasks, milestones] = await this.fetchTasksAndMilestones();
    const overdue = detectOverdueItems(tasks, milestones, now);
    if (overdue.length > 0) {
      await this.sendAlertEmail(
        this.recipients,
        'Overdue items require attention',
        formatOverdueBody(overdue),
      );
      await this.logAlert(
        {
          title: `${overdue.length} overdue item(s)`,
          alertType: 'Overdue',
          recipients: this.recipients.join(', '),
          status: 'Sent',
        },
        now,
      );
    }
    return overdue;
  }

  /** Detects milestones due within the look-ahead window, notifies, and returns them. */
  public async checkUpcomingMilestones(
    now: Date = new Date(),
    daysWithin: number = DEFAULT_UPCOMING_DAYS,
  ): Promise<Milestone[]> {
    const [, milestones] = await this.fetchTasksAndMilestones();
    const upcoming = detectUpcomingMilestones(milestones, now, daysWithin);
    if (upcoming.length > 0) {
      await this.sendAlertEmail(
        this.recipients,
        'Upcoming milestones',
        formatUpcomingBody(upcoming, daysWithin),
      );
      await this.logAlert(
        {
          title: `${upcoming.length} upcoming milestone(s)`,
          alertType: 'UpcomingMilestone',
          recipients: this.recipients.join(', '),
          status: 'Sent',
        },
        now,
      );
    }
    return upcoming;
  }

  /** Sends an alert email through the configured transport. */
  public sendAlertEmail(recipients: string[], subject: string, body: string): Promise<void> {
    return this.emailSender.sendEmail(recipients, subject, body);
  }

  /** Records an alert in the Alerts list. */
  public async logAlert(alert: AlertRecord, now: Date = new Date()): Promise<void> {
    await this.client.createItem(LIST_NAMES.ALERTS, {
      Title: alert.title,
      AlertType: alert.alertType,
      ...(alert.relatedItemId !== undefined ? { RelatedItemId: alert.relatedItemId } : {}),
      Recipients: alert.recipients,
      SentDate: now.toISOString(),
      Status: alert.status,
    });
  }

  private get scheduler(): Scheduler {
    return this.options.scheduler ?? nodeCronScheduler;
  }

  private get recipients(): string[] {
    return this.options.recipients ?? [];
  }

  private async runHealthCheck(now: Date = new Date()): Promise<void> {
    const healthService = new ProjectHealthService();
    const projectRows = await this.client.queryList(LIST_NAMES.PROJECTS);
    const projects = projectRows.map((row) => mapItem(row, PROJECT_FIELDS) as unknown as Project);

    const flagged: string[] = [];
    for (const project of projects.filter((p) => p.status !== 'Completed')) {
      const [taskRows, milestoneRows] = await Promise.all([
        this.client.queryList(LIST_NAMES.TASKS, { filter: `ProjectId eq ${project.id}` }),
        this.client.queryList(LIST_NAMES.MILESTONES, { filter: `ProjectId eq ${project.id}` }),
      ]);
      const health = healthService.assessProjectHealth(
        project,
        taskRows.map((row) => mapItem(row, TASK_FIELDS) as unknown as Task),
        milestoneRows.map((row) => mapItem(row, MILESTONE_FIELDS) as unknown as Milestone),
        now,
      );
      if (health.status !== 'Healthy') {
        flagged.push(`${project.title}: ${health.status} (${health.score})`);
      }
    }

    if (flagged.length > 0) {
      await this.sendAlertEmail(this.recipients, 'Project health check', flagged.join('\n'));
      await this.logAlert(
        {
          title: `${flagged.length} unhealthy project(s)`,
          alertType: 'HealthCheck',
          recipients: this.recipients.join(', '),
          status: 'Sent',
        },
        now,
      );
    }
  }

  private async fetchTasksAndMilestones(): Promise<[Task[], Milestone[]]> {
    const [taskRows, milestoneRows] = await Promise.all([
      this.client.queryList(LIST_NAMES.TASKS),
      this.client.queryList(LIST_NAMES.MILESTONES),
    ]);
    return [
      taskRows.map((row) => mapItem(row, TASK_FIELDS) as unknown as Task),
      milestoneRows.map((row) => mapItem(row, MILESTONE_FIELDS) as unknown as Milestone),
    ];
  }
}

/** Pure classifier: overdue (past-due, incomplete) tasks and milestones. */
export function detectOverdueItems(
  tasks: Task[],
  milestones: Milestone[],
  now: Date,
): OverdueItem[] {
  const result: OverdueItem[] = [];
  for (const task of tasks) {
    if (isOverdue(task.status, task.dueDate, now)) {
      result.push({
        kind: 'task',
        id: task.id,
        title: task.title,
        dueDate: task.dueDate,
        project: task.project?.title,
      });
    }
  }
  for (const milestone of milestones) {
    if (isOverdue(milestone.status, milestone.dueDate, now)) {
      result.push({
        kind: 'milestone',
        id: milestone.id,
        title: milestone.title,
        dueDate: milestone.dueDate,
        project: milestone.project?.title,
      });
    }
  }
  return result;
}

/** Pure classifier: incomplete milestones due within `daysWithin` days. */
export function detectUpcomingMilestones(
  milestones: Milestone[],
  now: Date,
  daysWithin: number = DEFAULT_UPCOMING_DAYS,
): Milestone[] {
  const horizon = now.getTime() + daysWithin * 24 * 60 * 60 * 1000;
  return milestones.filter((milestone) => {
    if (milestone.status === 'Completed' || !milestone.dueDate) {
      return false;
    }
    const due = new Date(milestone.dueDate).getTime();
    return !Number.isNaN(due) && due >= now.getTime() && due <= horizon;
  });
}

function formatOverdueBody(items: OverdueItem[]): string {
  return items
    .map((item) => `- [${item.kind}] ${item.title} (due ${item.dueDate ?? 'n/a'})`)
    .join('\n');
}

function formatUpcomingBody(milestones: Milestone[], daysWithin: number): string {
  return milestones
    .map(
      (milestone) =>
        `- ${milestone.title} (due ${milestone.dueDate ?? 'n/a'}, within ${daysWithin} days)`,
    )
    .join('\n');
}

/** Production scheduler backed by node-cron. */
function nodeCronScheduler(expression: string, task: () => void): ScheduledJob {
  const job = cron.schedule(expression, task);
  return { stop: () => job.stop() };
}
