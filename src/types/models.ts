/**
 * Platform-independent domain models.
 *
 * These describe the assistant's own view of project data after it has been
 * mapped out of SharePoint's verbose OData shape (see mappers/sharepoint-mapper).
 * Business-logic services operate on these types only — they never touch
 * SharePoint directly.
 *
 * @module domain/models
 */

/** A resolved user reference (login + display name). */
export interface UserReference {
  id: number;
  displayName: string;
  login: string;
}

/** A resolved lookup reference (id + title). */
export interface LookupReference {
  id: number;
  title: string;
}

export interface Project {
  id: number;
  title: string;
  description?: string;
  owner?: UserReference;
  startDate?: string;
  endDate?: string;
  budget?: number;
  actualCost?: number;
  status?: string;
  /** AD groups allowed to view this item; empty/absent = public. */
  permittedGroups?: string[];
}

export interface Task {
  id: number;
  title: string;
  project?: LookupReference;
  assignedTo?: UserReference;
  status?: string;
  dueDate?: string;
  percentComplete?: number;
  /** AD groups allowed to view this item; empty/absent = public. */
  permittedGroups?: string[];
}

export interface Milestone {
  id: number;
  title: string;
  project?: LookupReference;
  dueDate?: string;
  status?: string;
  /** Milestones this one depends on (prerequisites). */
  dependencies?: LookupReference[];
  /** AD groups allowed to view this item; empty/absent = public. */
  permittedGroups?: string[];
}

export type EscalationPriority = 'Low' | 'Medium' | 'High' | 'Critical';

export type EscalationStatus = 'Open' | 'In Progress' | 'Resolved' | 'Closed';

export interface Escalation {
  id: number;
  title: string;
  project?: LookupReference;
  issueDescription?: string;
  priority?: EscalationPriority;
  status?: EscalationStatus;
  createdBy?: UserReference;
  createdDate?: string;
  assignedTo?: UserReference;
  dueDate?: string;
  /** AD groups allowed to view this item; empty/absent = public. */
  permittedGroups?: string[];
}

export type AlertType = 'Overdue' | 'UpcomingMilestone' | 'HealthCheck';

export type AlertStatus = 'Pending' | 'Sent' | 'Failed';

export interface Alert {
  id: number;
  title: string;
  alertType?: AlertType;
  relatedItemId?: number;
  recipients?: string;
  sentDate?: string;
  status?: AlertStatus;
}
