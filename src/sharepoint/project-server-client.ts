import type { AxiosInstance } from 'axios';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import type { SharePointConnectionConfig } from '../config';
import { SharePointError, ValidationError } from '../errors';
import { createAuthenticatedAxios } from './auth';

type Row = Record<string, unknown>;
interface Envelope {
  d?: Row & { results?: Row[]; __next?: string };
  value?: Row[];
  'odata.nextLink'?: string;
}

export interface PublishedProject {
  id: string;
  title: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  percentComplete?: number;
  lastPublishedDate?: string;
}

export interface PublishedTask {
  id: string;
  projectId: string;
  title: string;
  startDate?: string;
  dueDate?: string;
  percentComplete?: number;
  isMilestone: boolean;
  status: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function projectGuid(id: string): string {
  if (!GUID.test(id))
    throw new ValidationError('Project Server IDs must be GUIDs returned by search_projects.');
  return id.toLowerCase();
}

/** Read-only Project Server REST adapter. Access uses the configured service account. */
export class ProjectServerClient {
  private readonly base: string;
  private readonly creating = new Set<string>();
  private readonly uncertain = new Map<string, string>();
  public constructor(
    private readonly http: AxiosInstance,
    siteUrl: string,
  ) {
    this.base = siteUrl.replace(/\/+$/, '') + '/_api/ProjectServer/';
  }
  public static async connect(config: SharePointConnectionConfig): Promise<ProjectServerClient> {
    return new ProjectServerClient(await createAuthenticatedAxios(config), config.siteUrl);
  }
  public async createProject(
    name: string,
    description?: string,
  ): Promise<{ status: string; project: PublishedProject }> {
    const title = name.trim();
    if (!title || title.length > 255 || /[\x00-\x1f]/.test(title))
      throw new ValidationError(
        'Project name must be 1–255 characters without control characters.',
      );
    if (description !== undefined && description.length > 4000)
      throw new ValidationError('Project description must not exceed 4000 characters.');
    const key = title.normalize('NFKC').toLowerCase();
    if (this.creating.has(key))
      throw new ValidationError('Creation of this project is already in progress.');
    this.creating.add(key);
    try {
      const existing = (await this.projects()).filter(
        (p) => p.title.trim().normalize('NFKC').toLowerCase() === key,
      );
      if (existing.length > 1)
        throw new ValidationError(
          'Multiple projects already have this name. Use their IDs to distinguish them.',
        );
      if (existing[0]) return { status: 'already_exists', project: existing[0] };
      const pending = this.uncertain.get(key);
      if (pending)
        throw new ValidationError(
          `An earlier creation could not be verified. Inspect project ${pending} in Project Server before retrying.`,
        );
      const context = await this.http.post(
        this.base.replace('ProjectServer/', 'contextinfo'),
        undefined,
        { timeout: 20000, maxRedirects: 0 },
      );
      const digest = context.data?.d?.GetContextWebInformation?.FormDigestValue;
      if (typeof digest !== 'string') throw new Error('SharePoint request digest is missing.');
      const id = randomUUID();
      this.uncertain.set(key, id);
      try {
        await this.http.post(
          this.base + 'Projects/Add',
          {
            parameters: {
              __metadata: { type: 'PS.ProjectCreationInformation' },
              Id: id,
              Name: title,
              ...(description === undefined ? {} : { Description: description }),
            },
          },
          { timeout: 30000, maxRedirects: 0, headers: { 'X-RequestDigest': digest } },
        );
        const project = await this.project(id);
        if (project.title !== title) throw new Error('Created project name did not match.');
        this.uncertain.delete(key);
        return { status: 'created', project };
      } catch (cause) {
        const status = axios.isAxiosError(cause) ? cause.response?.status : undefined;
        if (status === 401 || status === 403) {
          this.uncertain.delete(key);
          throw new SharePointError(
            'The configured SharePoint account is not allowed to create projects.',
            status,
            undefined,
          );
        }
        throw new SharePointError(
          `Project creation could not be verified${status ? ` (HTTP ${status})` : ''}. Inspect project ${id} before retrying; no automatic retry was performed.`,
          status ?? 502,
          undefined,
        );
      }
    } finally {
      this.creating.delete(key);
    }
  }
  public async projects(query = '', limit?: number): Promise<PublishedProject[]> {
    const rows = await this.collection('Projects');
    const needle = query.toLocaleLowerCase();
    const normalizedNeedle = normalizeProjectName(query);
    return rows
      .map(mapProject)
      .filter((p) => {
        const searchable = `${p.title} ${p.description ?? ''}`;
        return (
          searchable.toLocaleLowerCase().includes(needle) ||
          (normalizedNeedle.length > 0 &&
            normalizeProjectName(searchable).includes(normalizedNeedle))
        );
      })
      .slice(0, limit);
  }
  public async project(id: string): Promise<PublishedProject> {
    const body = await this.get(`${this.base}Projects('${projectGuid(id)}')`);
    if (!body.d || typeof body.d.Id !== 'string')
      throw new SharePointError('Project not found', 404, undefined);
    return mapProject(body.d);
  }
  public async tasks(id: string): Promise<PublishedTask[]> {
    const projectId = projectGuid(id);
    const rows = await this.collection(`Projects('${projectId}')/Tasks`);
    return rows.map((row) => {
      const progress = numberValue(row.PercentComplete);
      return {
        id: String(row.Id),
        projectId,
        title: String(row.Name ?? ''),
        startDate: dateValue(row.Start),
        dueDate: dateValue(row.Finish),
        percentComplete: progress,
        isMilestone: row.IsMilestone === true,
        status:
          progress === undefined
            ? 'Unknown'
            : progress >= 100
              ? 'Completed'
              : progress > 0
                ? 'In Progress'
                : 'Not Started',
      };
    });
  }
  private async collection(path: string): Promise<Row[]> {
    let next: string | undefined = this.base + path;
    const seen = new Set<string>();
    const rows: Row[] = [];
    while (next) {
      const url: URL = new URL(next, this.base);
      if (!url.href.startsWith(this.base) || seen.has(url.href)) {
        throw new SharePointError('Invalid Project Server pagination link', 502, undefined);
      }
      seen.add(url.href);
      const body = await this.get(url.href);
      const page = body.d?.results ?? body.value;
      if (!Array.isArray(page))
        throw new SharePointError('Invalid Project Server collection response', 502, undefined);
      rows.push(...page);
      const link = body.d?.__next ?? body['odata.nextLink'];
      next = link ? new URL(link, url).href : undefined;
    }
    return rows;
  }
  private async get(url: string): Promise<Envelope> {
    try {
      return (await this.http.get<Envelope>(url, { timeout: 20_000 })).data;
    } catch (cause) {
      if (axios.isAxiosError(cause) && !cause.response) {
        const timedOut = cause.code === 'ECONNABORTED' || cause.code === 'ETIMEDOUT';
        throw new SharePointError(
          timedOut
            ? 'Project Server connection timed out. Check the configured SharePoint hostname and server availability.'
            : 'Cannot connect to Project Server. Check the configured SharePoint hostname and network connectivity.',
          timedOut ? 504 : 502,
          undefined,
        );
      }
      const status = axios.isAxiosError(cause) ? (cause.response?.status ?? 502) : 502;
      const data = axios.isAxiosError(cause) ? cause.response?.data : undefined;
      const upstream =
        typeof data === 'string'
          ? data
          : (data?.['odata.error']?.message?.value ?? data?.error?.message?.value);
      const mappingError =
        typeof upstream === 'string' && /web application.*could not be found/i.test(upstream);
      throw new SharePointError(
        mappingError
          ? 'SharePoint does not recognize the configured site URL. Use its configured web-application hostname instead of an unmapped IP address.'
          : `Project Server request failed (HTTP ${status}).`,
        mappingError ? 400 : status,
        undefined,
      );
    }
  }
}

function normalizeProjectName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function dateValue(value: unknown): string | undefined {
  return typeof value === 'string' && !value.startsWith('0001-') ? value : undefined;
}
function mapProject(row: Row): PublishedProject {
  return {
    id: String(row.Id),
    title: String(row.Name ?? ''),
    description: typeof row.Description === 'string' ? row.Description : undefined,
    startDate: dateValue(row.StartDate),
    endDate: dateValue(row.FinishDate),
    percentComplete: numberValue(row.PercentComplete),
    lastPublishedDate: dateValue(row.LastPublishedDate),
  };
}
