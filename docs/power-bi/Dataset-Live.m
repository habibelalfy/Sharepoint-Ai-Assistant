// Alternative Dataset query. Create text parameter GatewayBaseUrl, e.g. https://assistant.example/.
// Choose Basic credentials in Data source settings: username powerbi, password the admin-provisioned export token.
// Never put the token in M code or a URL. Requires POWER_BI_DATASET_TOKEN and HTTPS at the gateway.
let
    Source = Json.Document(Web.Contents(GatewayBaseUrl, [RelativePath = "api/analytics/dataset"]))
in
    Source
