/**
 * Permission enforcement: AD-group membership resolution and result filtering.
 *
 * Items carrying a non-empty `permittedGroups` list are restricted to callers
 * who belong to at least one of those groups; items without it are public.
 *
 * @module services/permission-service
 */
import { LIST_NAMES } from '../constants';
import { PROJECT_FIELDS, mapItem } from '../mappers/sharepoint-mapper';
import type { SharePointClient } from '../sharepoint/client';
import type { Project } from '../types/models';

/** Resolves a user's Active Directory group names (pluggable). */
export interface ADGroupProvider {
  getUserADGroups(username: string): Promise<string[]>;
}

/** Provider returning no groups (used when no directory integration is wired). */
export class EmptyADGroupProvider implements ADGroupProvider {
  public async getUserADGroups(): Promise<string[]> {
    return [];
  }
}

export class PermissionService {
  public constructor(
    private readonly provider: ADGroupProvider = new EmptyADGroupProvider(),
    private readonly client?: SharePointClient,
  ) {}

  public getUserADGroups(username: string): Promise<string[]> {
    return this.provider.getUserADGroups(username);
  }

  /** Resolves the caller's groups, or an empty set when no userId is supplied. */
  public async resolveGroups(userId?: string): Promise<string[]> {
    return userId ? this.getUserADGroups(userId) : [];
  }

  /** Filters items down to those the user's groups are allowed to see. */
  public filterByPermissions<T>(items: T[], permissionField: string, userGroups: string[]): T[] {
    return items.filter((item) => {
      const allowed = (item as Record<string, unknown>)[permissionField];
      if (!Array.isArray(allowed)) {
        return true; // no restriction → public
      }
      const allowedGroups = allowed as unknown as string[];
      if (allowedGroups.length === 0) {
        return true;
      }
      return allowedGroups.some((group) => userGroups.includes(group));
    });
  }

  /** Uniform filtering on the `permittedGroups` field. */
  public trimResultsByADGroups<T extends { permittedGroups?: string[] }>(
    items: T[],
    userGroups: string[],
  ): T[] {
    return this.filterByPermissions(items, 'permittedGroups', userGroups);
  }

  /** Whether a user's groups grant access to a single project. */
  public async hasProjectAccess(userId: string, projectId: number): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    const row = await this.client.getItemById(LIST_NAMES.PROJECTS, projectId);
    const project = mapItem(row, PROJECT_FIELDS) as unknown as Project;
    const groups = await this.getUserADGroups(userId);
    return this.trimResultsByADGroups([project], groups).length === 1;
  }
}
