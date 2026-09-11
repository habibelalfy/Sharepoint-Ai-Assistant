# User Guide — Project Managers

This guide covers using the AI assistant to get answers about your projects and to
act on them (e.g. open an escalation). It assumes your administrator has deployed
the assistant and wired it to a desktop client (Claude Desktop / VS Code) and/or
the SharePoint web part.

## What you can ask

| Capability         | Example questions                                                    |
| ------------------ | -------------------------------------------------------------------- |
| **Query data**     | "Show all tasks for project Alpha", "List milestones due next week". |
| **Search**         | "Find projects about the customer portal".                           |
| **Project detail** | "Give me the full picture for project 12".                           |
| **Plan health**    | "How healthy is project 12?", "What's holding project Alpha back?".  |
| **Delay impact**   | "If milestone 5 slips 10 days, what else is affected?".              |
| **Statistics**     | "What's the progress and estimated completion for project 12?".      |
| **Escalations**    | "Open a High-priority escalation for project 12: budget overrun".    |

The assistant works from the live data in SharePoint, so answers reflect the lists
as they are right now.

## Escalations

Before creating or updating an escalation, the assistant will ask you to confirm.
You can say things like:

- "Open an escalation on project 12 — the go-live date is at risk."
- "Mark escalation 8 as Resolved."
- "Show me the open escalations for project 12."

Escalations are written to the **Escalations** list, so they show up in SharePoint
alongside your other project data.

## Permissions

The assistant only shows you what your Active Directory group membership allows.
If an item is restricted to certain groups, you will simply not see it — the
assistant will not tell you it exists. If you think you are missing data, ask your
administrator to review your AD group membership (see the Admin Guide).

## Scheduled alerts

The assistant sends scheduled email alerts (to the recipients configured by your
administrator) for:

- **Overdue** tasks and milestones.
- **Upcoming** milestones (within the look-ahead window).
- **Project health** — a weekly scan that flags projects scoring below "Healthy".

You do not need to do anything to receive these; your administrator sets the
schedule and recipients.

## Tips

- Be specific: name the project or ID when you can.
- The assistant never invents data — if it returns nothing, the list is empty or
  you do not have permission to see it.
- For write actions (escalations), the assistant will confirm first.
