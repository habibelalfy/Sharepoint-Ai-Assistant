import { describe, expect, it } from '@jest/globals';
import {
  MILESTONE_FIELDS,
  PROJECT_FIELDS,
  TASK_FIELDS,
  fieldSpecsForList,
  mapDate,
  mapItem,
  mapLookup,
  mapLookupMulti,
  mapUser,
} from '../../src/mappers/sharepoint-mapper';

describe('mapItem', () => {
  it('flattens a verbose project into camelCase JSON', () => {
    const raw = {
      Id: 5,
      Title: 'Project Alpha',
      Description: 'A test project',
      Owner: { Id: 7, Title: 'Alice', Name: 'i:0#.w|CORP\\alice' },
      StartDate: '/Date(1700000000000)/',
      EndDate: '/Date(1710000000000)/',
      Budget: 100000,
      ActualCost: 50000,
      Status: 'In Progress',
      __metadata: { type: 'SP.Data.ProjectsListItem' },
      OwnerId: 7,
    };
    expect(mapItem(raw, PROJECT_FIELDS)).toEqual({
      id: 5,
      title: 'Project Alpha',
      description: 'A test project',
      owner: { id: 7, displayName: 'Alice', login: 'CORP\\alice' },
      startDate: new Date(1700000000000).toISOString(),
      endDate: new Date(1710000000000).toISOString(),
      budget: 100000,
      actualCost: 50000,
      status: 'In Progress',
    });
  });

  it('maps tasks including lookup and user fields', () => {
    const task = {
      Id: 1,
      Title: 'Task A',
      ProjectId: 5,
      Project: { Id: 5, Title: 'Project Alpha' },
      AssignedTo: { Id: 7, Title: 'Alice', Name: 'i:0#.w|CORP\\alice' },
      Status: 'In Progress',
      DueDate: '/Date(1700000000000)/',
      PercentComplete: 0.5,
    };
    expect(mapItem(task, TASK_FIELDS)).toEqual({
      id: 1,
      title: 'Task A',
      project: { id: 5, title: 'Project Alpha' },
      assignedTo: { id: 7, displayName: 'Alice', login: 'CORP\\alice' },
      status: 'In Progress',
      dueDate: new Date(1700000000000).toISOString(),
      percentComplete: 0.5,
    });
  });

  it('skips null, missing, and non-object inputs', () => {
    expect(mapItem(null, PROJECT_FIELDS)).toEqual({});
    expect(mapItem({ Title: 'Only' }, TASK_FIELDS)).toEqual({ title: 'Only' });
    expect(mapItem({ Id: 3, Title: null }, PROJECT_FIELDS)).toEqual({ id: 3 });
  });
});

describe('mapDate', () => {
  it('converts /Date(...)/ to ISO 8601', () => {
    expect(mapDate('/Date(1700000000000)/')).toBe(new Date(1700000000000).toISOString());
  });

  it('passes through plain strings and Date instances', () => {
    expect(mapDate('2023-01-01')).toBe('2023-01-01');
    expect(mapDate(new Date(0))).toBe(new Date(0).toISOString());
  });
});

describe('mapLookup', () => {
  it('resolves id and title', () => {
    expect(mapLookup({ Id: 5, Title: 'Project Alpha' })).toEqual({ id: 5, title: 'Project Alpha' });
  });

  it('returns null for non-objects', () => {
    expect(mapLookup('x')).toBeNull();
  });
});

describe('mapUser', () => {
  it('strips the claims prefix from the login', () => {
    expect(mapUser({ Id: 7, Title: 'Alice', Name: 'i:0#.w|CORP\\alice' })).toEqual({
      id: 7,
      displayName: 'Alice',
      login: 'CORP\\alice',
    });
  });
});

describe('mapLookupMulti', () => {
  it('maps arrays and { results } collections', () => {
    expect(
      mapLookupMulti([
        { Id: 1, Title: 'M0' },
        { Id: 2, Title: 'M1' },
      ]),
    ).toEqual([
      { id: 1, title: 'M0' },
      { id: 2, title: 'M1' },
    ]);
    expect(mapLookupMulti({ results: [{ Id: 1, Title: 'M0' }] })).toEqual([{ id: 1, title: 'M0' }]);
    expect(mapLookupMulti(null)).toEqual([]);
  });
});

describe('fieldSpecsForList', () => {
  it('returns specs for known lists and empty for unknown', () => {
    expect(fieldSpecsForList('Projects')).toBe(PROJECT_FIELDS);
    expect(fieldSpecsForList('Tasks')).toBe(TASK_FIELDS);
    expect(fieldSpecsForList('Milestones')).toBe(MILESTONE_FIELDS);
    expect(fieldSpecsForList('Unknown')).toEqual({});
  });
});
