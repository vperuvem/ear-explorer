Get-ChildItem -Path 'C:\Users\PVenkatesh\Downloads' -Recurse -Depth 3 -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 't.?device|ear.?tester' } |
    ForEach-Object { $_.FullName }
