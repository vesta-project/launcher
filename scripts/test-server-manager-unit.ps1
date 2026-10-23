param(
    [string]$Filter = 'servers::',
    [ValidateRange(1, 8)][int]$TestThreads = 1
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This helper is for Windows native tests. Use cargo test on other hosts.' }
$taskRepo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$taskManifest = Join-Path $PSScriptRoot 'windows-native-tests.manifest'
$taskMtCommand = Get-Command mt.exe -ErrorAction SilentlyContinue
$taskMt = if ($taskMtCommand) { $taskMtCommand.Source } else {
    $taskSdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
    if (Test-Path -LiteralPath $taskSdk) {
        Get-ChildItem -LiteralPath $taskSdk -Directory |
            Where-Object { $_.Name -match '^10\.0\.\d+\.0$' } |
            Sort-Object { [version]$_.Name } -Descending |
            ForEach-Object { Join-Path $_.FullName 'x64/mt.exe' } |
            Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
}
if (!$taskMt) { throw 'Windows SDK mt.exe is required to embed the native test manifest.' }
$taskResults = Join-Path ([IO.Path]::GetTempPath()) ('vesta-native-unit-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskResults | Out-Null
Write-Host "Native unit test evidence: $taskResults"
$taskJson = Join-Path $taskResults 'build.jsonl'
$taskBuildErrors = Join-Path $taskResults 'build.log'
$taskTestLog = Join-Path $taskResults 'tests.log'
$taskPreviousIncremental = $env:CARGO_INCREMENTAL
Push-Location -LiteralPath $taskRepo
try {
    # Avoid the existing incremental fingerprint ICE; restore the caller's setting.
    $env:CARGO_INCREMENTAL = '0'
    # PowerShell 5 treats native stderr as ErrorRecords. Preserve it as evidence
    # and use the native exit code instead of failing on ordinary compiler output.
    $taskPreviousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & cargo test --locked -p vesta-launcher --lib --no-run --message-format=json > $taskJson 2> $taskBuildErrors
        $taskBuildExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $taskPreviousPreference }
    if ($taskBuildExit -ne 0) {
        Get-Content -LiteralPath $taskBuildErrors -Tail 25 | Write-Host
        throw "Native test build failed ($taskBuildExit); see $taskResults"
    }
    $taskArtifacts = @(Get-Content -LiteralPath $taskJson | ForEach-Object {
        $taskMessage = $_ | ConvertFrom-Json
        if ($taskMessage.reason -eq 'compiler-artifact' -and $taskMessage.profile.test -and
            $taskMessage.target.name -eq 'vesta_launcher' -and $taskMessage.executable) { $taskMessage }
    })
    if ($taskArtifacts.Count -ne 1) { throw 'Expected exactly one Cargo-reported launcher test executable.' }
    $taskExecutable = $taskArtifacts[0].executable
    # Modify only Cargo's disposable test binary, never the packaged application.
    & $taskMt -nologo '-manifest' $taskManifest "-outputresource:$taskExecutable;#1"
    if ($LASTEXITCODE -ne 0) { throw 'Native test manifest embedding failed.' }
    try {
        $ErrorActionPreference = 'Continue'
        & $taskExecutable $Filter "--test-threads=$TestThreads" > $taskTestLog 2>&1
        $taskTestExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $taskPreviousPreference }
    Get-Content -LiteralPath $taskTestLog | Write-Host
    if ($taskTestExit -ne 0) { throw "Native tests failed ($taskTestExit); see $taskTestLog" }
} finally {
    $env:CARGO_INCREMENTAL = $taskPreviousIncremental
    Pop-Location
}
