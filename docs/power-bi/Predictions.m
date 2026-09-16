let
    Source = Table.FromRecords(Dataset[predictions], type table [projectId=text, title=text, status=text, predictedFinish=nullable text, delayDays=nullable number, progressPerDay=nullable number, observations=number, historyDays=number, explanation=text], MissingField.UseNull),
    Dates = Table.TransformColumns(Source, {{"predictedFinish", each if _ = null then null else DateTimeZone.From(_), type nullable datetimezone}})
in
    Dates
