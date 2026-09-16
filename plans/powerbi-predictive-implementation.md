# Power BI integration and predictive warnings — initial implementation

Implemented in response to the first two Absent features selected by the user.

## Delivered

- Authenticated reporting dataset endpoint and Reports & delay warnings page, with JSON download.
- Power Query import queries, measures, optional dedicated read-only live-refresh credential, and optional Report Server iframe configuration.
- Durable daily project progress history, hourly collection, explainable regression forecasts, and get_predictive_delay_warnings / get_reporting_dataset assistant tools.
- Explicit handling for missing history, empty published plans, completion, stalled progress, baseline/progress resets, and stale observations. No trained-model or probability claim.

## Verification

Production build passed. Analytics tests passed for forecast mathematics, concurrency/persistence, data scoping, and authenticated exports. Existing gateway and Project Server tool tests also passed. An isolated browser test with clearly labeled synthetic data verified rendering, warning state, dataset download, absent Report Server state, failed-refresh handling, and connection reset.

The gateway is deployed and healthy. Live browser verification was attempted twice but stopped at connection setup because the lab's Project Server returned HTTP 500 (reported by setup as temporary unavailability). No successful live-data forecast/AI tool round trip is claimed. See scripts/e2e-analytics.cjs for the prepared live test and scripts/e2e-analytics-ui.cjs for the synthetic test.

The user confirmed no Power BI Report Server exists in the lab. Therefore no actual Power BI report is published, embedded, or Desktop-validated. Integration instructions and M queries are in docs/power-bi/. Forecasts need three daily observations spanning two days, and a published plan, before useful dates can be estimated; production history was not seeded with fake observations.

The separately requested storage of six connection fields is still pending approval. It was excluded from this deployment; its proposed page was preserved at /tmp/pending-six-field-persistence.html.

## Live retry diagnosis

The user authorized sending project names and progress/warning data to DeepSeek for the predictive chat test. scripts/e2e-analytics.cjs now requires TEST_AI_CHAT=1 to opt into that external chat test; the default checks local reporting only.

Retry remained blocked. Authenticated SharePoint REST returned an IIS HTML HTTP 500 stating that the web application at http://68.210.202.109:80/PWA could not be found. Testing the previously configured Host bshare against the same server IP returned the same unmapped-web-application error. The app now recognizes this HTML response and presents a specific mapped-hostname/PWA-path error (HTTP 400), rather than a misleading temporary outage or password error. Build and 26 targeted tests passed. The exact working PWA URL is required to resume the live data test.
