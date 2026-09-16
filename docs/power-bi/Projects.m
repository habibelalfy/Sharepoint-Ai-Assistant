let
    Source = Table.FromRecords(Dataset[projects], type table [id=text, title=text, startDate=nullable text, endDate=nullable text, percentComplete=nullable number, lastPublishedDate=nullable text], MissingField.UseNull),
    Dates = Table.TransformColumns(Source, {{"startDate", each if _ = null then null else DateTimeZone.From(_), type nullable datetimezone}, {"endDate", each if _ = null then null else DateTimeZone.From(_), type nullable datetimezone}, {"lastPublishedDate", each if _ = null then null else DateTimeZone.From(_), type nullable datetimezone}})
in
    Dates
