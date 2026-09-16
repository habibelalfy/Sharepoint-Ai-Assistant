let
    Source = Table.FromRecords(Dataset[history], type table [projectId=text, capturedAt=text, percentComplete=nullable number, plannedFinish=nullable text], MissingField.UseNull),
    Dates = Table.TransformColumns(Source, {{"capturedAt", each DateTimeZone.From(_), type datetimezone}, {"plannedFinish", each if _ = null then null else DateTimeZone.From(_), type nullable datetimezone}})
in
    Dates
