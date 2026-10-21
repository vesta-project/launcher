# Run only the opt-in real ServerManager test. No launcher windows are created.
$ErrorActionPreference = 'Stop'
if ($env:VESTA_LIVE_AGENT -ne '1') { throw 'Set VESTA_LIVE_AGENT=1 and the agent fixture paths documented in docs/development/server-client-followup.md.' }
$launcherWorkspace = Split-Path -Parent $PSScriptRoot
Push-Location $launcherWorkspace
try {
    $artifacts = & cargo test -p vesta-launcher --lib --no-run --message-format=json | ForEach-Object { $_ | ConvertFrom-Json }
    if ($LASTEXITCODE -ne 0) { throw 'Failed to build launcher tests.' }
    $testBinary = $artifacts | Where-Object { $_.reason -eq 'compiler-artifact' -and $_.executable -and $_.target.name -eq 'vesta_launcher' } | Select-Object -Last 1 -ExpandProperty executable
    if (-not $testBinary) { throw 'Cargo did not return the launcher test executable.' }
    # Tauri's normal binary has this manifest; Rust's lib-test executable does not.
    # TaskDialogIndirect requires activation of Common Controls v6 before loading.
    $manifestTool = Get-Command mt.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
    if (-not $manifestTool) {
        $manifestTool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\mt.exe' -ErrorAction SilentlyContinue | Sort-Object FullName | Select-Object -Last 1 -ExpandProperty FullName
    }
    if (-not $manifestTool) { throw 'Windows SDK mt.exe is required to embed the lib-test Common Controls v6 manifest.' }
    & $manifestTool -manifest (Join-Path $launcherWorkspace 'vesta-launcher/src-tauri/tests/servers-live.manifest') "-outputresource:${testBinary};#1"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to embed the test manifest.' }
    & $testBinary servers::tests::live_manager_storage_events_retry_and_restart --ignored --nocapture
    if ($LASTEXITCODE -ne 0) { throw 'The live ServerManager test failed.' }
} finally {
    Pop-Location
}
