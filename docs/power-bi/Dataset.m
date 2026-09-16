// Create a text parameter DataFile pointing to the downloaded JSON file.
let
    Source = Json.Document(File.Contents(DataFile))
in
    Source
