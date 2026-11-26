param([ValidateSet('Start','Stop','Backup')][string]$Action = 'Start', [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $projectDir 'data'
$runtimeFile = Join-Path $dataDir 'runtime.json'
function Find-PatoliNode {
    $candidate = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($candidate) { return $candidate.Source }
    $packages = Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' -ErrorAction SilentlyContinue | Sort-Object Version -Descending
    foreach ($package in $packages) {
        $candidatePath = Join-Path $package.InstallLocation 'dependencies\node\bin\node.exe'
        if (Test-Path -LiteralPath $candidatePath) { return $candidatePath }
    }
    throw 'No se encontro Node.js. Instala Node.js 24 o posterior desde https://nodejs.org y vuelve a abrir Patoli.'
}
function Read-PatoliRuntime {
    if (!(Test-Path -LiteralPath $runtimeFile)) { return $null }
    try {
        $info = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
        if ($info.url -ne 'http://127.0.0.1:3000') { return $null }
        $health = Invoke-RestMethod -Uri ($info.url + '/api/health') -TimeoutSec 2
        if ($health.app -eq 'Patoli' -and $health.instance -eq $info.instance) { return $info }
    } catch { return $null }
    return $null
}
try {
    if ($Action -eq 'Stop') {
        $running = Read-PatoliRuntime
        if ($running) {
            $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($running.pid)"
            $expectedScript = Join-Path $projectDir 'server.mjs'
            if (!$processInfo -or !$processInfo.CommandLine.Contains($expectedScript)) { throw 'No se pudo identificar el proceso de Patoli. No se detuvo ningun programa.' }
            Stop-Process -Id $running.pid
            Write-Host 'Patoli se detuvo. Tus datos permanecen guardados.'
        } else { Write-Host 'Patoli ya esta detenido.' }
        exit 0
    }
    $nodePath = Find-PatoliNode
    $nodeVersion = & $nodePath --version
    $nodeMajor = [int]($nodeVersion.TrimStart('v').Split('.')[0])
    if ($nodeMajor -lt 24) { throw 'Patoli necesita Node.js 24 o posterior.' }
    if ($Action -eq 'Backup') {
        & $nodePath (Join-Path $PSScriptRoot 'respaldo.mjs')
        exit $LASTEXITCODE
    }
    $running = Read-PatoliRuntime
    if (!$running) {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        $scriptPath = Join-Path $projectDir 'server.mjs'
        $serverProcess = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $scriptPath + '"')) -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataDir 'server.log') -RedirectStandardError (Join-Path $dataDir 'server-error.log') -PassThru
        for ($attempt=0; $attempt -lt 40; $attempt++) {
            Start-Sleep -Milliseconds 250
            $running = Read-PatoliRuntime
            if ($running) { break }
            if ($serverProcess.HasExited) { break }
        }
        if (!$running) { throw 'No se pudo iniciar Patoli. Revisa data\server-error.log. Es posible que el puerto 3000 este ocupado.' }
    }
    $configuration = Invoke-RestMethod -Uri ($running.url + '/api/config') -TimeoutSec 3
    $launchUrl = $running.url
    if ($configuration.setupRequired) {
        if ($running.startUrl -notmatch '^http://127\.0\.0\.1:3000/configurar\.html#[a-f0-9]{64}$') { throw 'No se encontro un enlace valido de configuracion. Deten Patoli y vuelve a iniciarlo.' }
        $launchUrl = $running.startUrl
    }
    if (!$NoBrowser) { Start-Process -FilePath $launchUrl }
    Write-Host 'Patoli esta listo en http://127.0.0.1:3000'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
