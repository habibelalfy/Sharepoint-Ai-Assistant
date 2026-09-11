import { describe, expect, it, jest } from '@jest/globals';
import { EmptyADGroupProvider, PermissionService } from '../../src/services/permission-service';
import { mockSharePointClient } from '../helpers';

interface PermittedItem {
  id: number;
  permittedGroups?: string[];
}

describe('PermissionService.filterByPermissions', () => {
  it('keeps public items and items matching the user\u2019s groups', () => {
    const service = new PermissionService();
    const items: PermittedItem[] = [
      { id: 1 },
      { id: 2, permittedGroups: [] },
      { id: 3, permittedGroups: ['PMO'] },
      { id: 4, permittedGroups: ['Engineering'] },
      { id: 5, permittedGroups: ['PMO', 'Engineering'] },
    ];
    expect(service.filterByPermissions(items, 'permittedGroups', ['PMO']).map((i) => i.id)).toEqual(
      [1, 2, 3, 5],
    );
  });

  it('returns only public items for a user with no groups', () => {
    const service = new PermissionService();
    const items: PermittedItem[] = [{ id: 1 }, { id: 2, permittedGroups: ['PMO'] }];
    expect(service.trimResultsByADGroups(items, []).map((i) => i.id)).toEqual([1]);
  });
});

describe('PermissionService.getUserADGroups', () => {
  it('delegates to the injected provider', async () => {
    const provider = {
      getUserADGroups: async (username: string): Promise<string[]> => [`grp-${username}`],
    };
    const service = new PermissionService(provider);
    await expect(service.getUserADGroups('alice')).resolves.toEqual(['grp-alice']);
  });

  it('resolves an empty set when no userId is supplied', async () => {
    const service = new PermissionService();
    await expect(service.resolveGroups(undefined)).resolves.toEqual([]);
  });
});

describe('PermissionService.hasProjectAccess', () => {
  it('returns true for a public project', async () => {
    const client = mockSharePointClient();
    jest.mocked(client.getItemById).mockResolvedValue({ Id: 1, Title: 'Public' });
    const service = new PermissionService(new EmptyADGroupProvider(), client);
    await expect(service.hasProjectAccess('alice', 1)).resolves.toBe(true);
  });

  it('returns false for a project restricted to other groups', async () => {
    const client = mockSharePointClient();
    jest.mocked(client.getItemById).mockResolvedValue({
      Id: 1,
      Title: 'Secret',
      PermittedGroups: { results: ['PMO'] },
    });
    const service = new PermissionService(new EmptyADGroupProvider(), client);
    await expect(service.hasProjectAccess('alice', 1)).resolves.toBe(false);
  });
});
