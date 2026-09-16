let
    Source = Table.FromRecords(Dataset[tasks], type table [id=text, projectId=text, title=text, startDate=nullable text, dueDate=nullable text, percentComplete=nullable number, isMilestone=logical, status=text, overdue=logical], MissingField.UseNull),
    Dates = Table.TransformColumns(Source, {{"startDate", each if _ = null then null else DateTimeZone.From(_), type nullable datetimezone}, {"dueDate", each if _ = null then null else DateTimeZone.From(_), type nullable datetimezone}})
in
    Dates
