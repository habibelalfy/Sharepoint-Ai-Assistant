# Project reporting and predictive warnings

## Available in this lab

After connecting, choose **Reports & delay warnings**. The dashboard reads published projects and tasks, displays current warning states, and downloads `project-reporting-dataset.json`. The JSON has schema version 1 and separate `projects`, `tasks`, `predictions`, and `history` arrays. Empty arrays are legitimate; unknown progress and dates remain null. A failed project/task fetch fails the refresh rather than returning a misleading partial dataset.

Power BI Report Server is not installed in this lab. No PBIX has been published or certified. The import queries below and optional embed/refresh configuration form the integration; the local reporting screen works without Power BI.

## Build a Power BI Desktop report from a download

1. Download the dataset from the assistant's reporting screen.
2. In Power BI Desktop, create a Text parameter `DataFile` with the local JSON file's absolute path.
3. Create a blank query named **Dataset**, paste `Dataset.m` into Advanced Editor, and disable load for that record query.
4. Create four queries named **Projects**, **Tasks**, **Predictions**, and **History**, using their respective `.m` files. The explicit schemas retain columns even with empty tables.
5. Relate Projects[id] (one) to Tasks[projectId], Predictions[projectId], and History[projectId], with filtering from Projects to the other tables. Add each expression from `Measures.dax` as a separate measure.
6. Create cards for Project Count, Task Count, Overdue Tasks, Delay Warnings, and Insufficient History. Add a project/progress bar chart, a warning table with predicted finish and explanation, and a progress-history line chart with a project slicer. Include the dataset generation timestamp in the report so viewers can assess freshness.
7. Use numeric progress as a 0–100 number, not Power BI's 0–1 percentage formatting. Do not interpret insufficient history as on track, or count unknown task progress as completed.

Refresh after downloading a newer JSON to the same path. File import does not refresh itself from the gateway. Power Query files have been supplied for use in Desktop; their execution and report rendering must be validated there because Desktop/Report Server is absent from this Linux lab.

## Optional authenticated live refresh

Use HTTPS at the gateway reverse proxy. Set `POWER_BI_DATASET_TOKEN` to at least 32 random characters in the server environment. This optional token is disabled by default and only authenticates GET `/api/analytics/dataset`; it cannot authenticate chat, configuration, or mutation endpoints. It reads the **server-startup configured SharePoint connection**, independent of interactive users changing their connection.

Replace Dataset's M expression with `Dataset-Live.m` and create a Text parameter `GatewayBaseUrl`. Configure the Web data-source credentials as Basic: username `powerbi`, password the export token. Keep the token in the Power BI credential store, never in the query text or URL. Configure the corresponding stored data-source credentials and refresh schedule in Report Server when available. Token rotation requires updating that credential store. Only grant this credential to people authorized to read the configured SharePoint account's project data.

A logged-in browser can also GET the dataset with its existing Bearer token; these interactive sessions expire after eight hours and are not intended as scheduled-refresh credentials. The API returns `Cache-Control: no-store`. No unauthenticated dataset endpoint is exposed.

## Optional Report Server embed

Set `POWER_BI_REPORT_URL` to an existing Report Server report URL and restart the gateway. The reporting screen appends `rs:embed=true` and embeds the report. No gateway credential is put in the iframe URL or sent to Report Server. The report authenticates the viewer independently through the report server's existing configuration. Use HTTPS for an HTTPS assistant page; cross-origin browser authentication and framing rules must allow the deployment.

Microsoft references: [Report Server iframe embedding](https://learn.microsoft.com/en-us/power-bi/report-server/quickstart-embed), [Power Query Web connector authentication](https://learn.microsoft.com/en-us/power-query/connectors/web/web).

## Forecast behavior

- `get_predictive_delay_warnings` is available to the assistant in Project Server mode. Optionally specify a project GUID. `get_reporting_dataset` exposes the full dataset.
- An hourly collector and each successful refresh record current published project progress. At most one latest observation per project per UTC day is retained, for 120 days. History is stored atomically next to the audit log in the persistent Docker volume, partitioned by SharePoint site. No synthetic history is added to live data.
- At least three daily observations spanning two calendar days are needed. Linear regression estimates percentage points completed per calendar day; remaining percentage divided by that rate yields the projected finish. The predicted finish is compared with the published scheduled finish to calculate nonnegative delay days.
- The result is an explainable trend forecast, **not a trained machine-learning model or a calibrated probability**. It assumes the recent rate continues and excludes working calendars, dependencies, effort weighting, resource limits, and future scope changes.
- A schedule change or declining progress resets the usable window. Missing progress, stale observations, no baseline, stalled progress, completion, and already-overdue schedules get explicit states rather than fabricated dates.
- Alerts appear in the reporting screen and chat responses. No email/Teams notification is sent. Automatic outbound notifications and ML training are outside this initial implementation.
- Access follows the existing connected-account model. It does not resolve the report's separate caller-specific permission gap. Exported history is restricted to currently returned project IDs. History does not claim knowledge of inaccessible/deleted projects.

Validation commands: run Jest for `test/analytics` and `test/api/analytics-routes.test.ts`; use `scripts/e2e-analytics.cjs` for browser verification with the configured lab connection. No SharePoint write is performed by reporting.
