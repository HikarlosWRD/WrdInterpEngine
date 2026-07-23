[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestUrl,

    [string]$InstallRoot = "$env:LOCALAPPDATA\WrdUtilities\InterpEngine",

    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Emit-Progress {
    param(
        [string]$Stage,
        [int]$Percent,
        [string]$Message
    )

    $data = @{
        stage = $Stage
        percent = $Percent
        message = $Message
    } | ConvertTo-Json -Compress

    Write-Output "WRD_PROGRESS $data"
}

$PythonArchiveUrl = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip"
$PythonArchiveSha256 = "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3"
$PipWheelUrl = "https://files.pythonhosted.org/packages/5d/95/6b5cb3461ea5673ba0995989746db58eb18b91b54dbf331e72f569540946/pip-26.1.2-py3-none-any.whl"
$PipWheelSha256 = "382ff9f685ee3bc25864f820aa50505825f10f5458ffff07e30a6d96e5715cab"

function Write-Step {
    param([string]$Message)

    Write-Host ""
    Write-Host "============================================================"
    Write-Host $Message
    Write-Host "============================================================"
}

function Resolve-Executable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable
    )

    if (Test-Path $Executable) {
        return (Resolve-Path $Executable).Path
    }

    $command = Get-Command $Executable -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw "Executavel nao encontrado: $Executable"
}

function Invoke-ProcessChecked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,

        [Parameter(Mandatory = $true)]
        [string[]]$ProcessArguments,

        [int[]]$AllowedExitCodes = @(0)
    )

    $resolvedExecutable = Resolve-Executable -Executable $Executable
    Write-Host "> $resolvedExecutable $($ProcessArguments -join ' ')"

    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"

        & $resolvedExecutable @ProcessArguments 2>&1 |
            ForEach-Object {
                Write-Host ([string]$_)
            }

        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $oldPreference
    }

    if ($null -eq $exitCode) {
        $exitCode = 0
    }

    if ($AllowedExitCodes -notcontains [int]$exitCode) {
        throw (
            "Comando falhou com codigo $exitCode`: " +
            "$resolvedExecutable $($ProcessArguments -join ' ')"
        )
    }
}

function Test-FileHash {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedSha256
    )

    if (-not (Test-Path $Path)) {
        return $false
    }

    $actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    return $actual -eq $ExpectedSha256.ToLowerInvariant()
}

function Download-VerifiedFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,

        [Parameter(Mandatory = $true)]
        [string]$Destination,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedSha256
    )

    if (Test-FileHash -Path $Destination -ExpectedSha256 $ExpectedSha256) {
        Write-Host "Arquivo ja existe e esta valido: $Destination"
        return
    }

    Remove-Item $Destination -Force -ErrorAction SilentlyContinue
    $errors = New-Object System.Collections.Generic.List[string]

    [Net.ServicePointManager]::SecurityProtocol = `
        [Net.ServicePointManager]::SecurityProtocol -bor `
        [Net.SecurityProtocolType]::Tls12

    try {
        Import-Module BitsTransfer -ErrorAction Stop
        Write-Host "Baixando com BITS..."
        Start-BitsTransfer `
            -Source $Url `
            -Destination $Destination `
            -ErrorAction Stop

        if (Test-FileHash -Path $Destination -ExpectedSha256 $ExpectedSha256) {
            return
        }

        $errors.Add("BITS baixou um arquivo com SHA-256 incorreto.")
    }
    catch {
        $errors.Add("BITS: $($_.Exception.Message)")
    }

    Remove-Item $Destination -Force -ErrorAction SilentlyContinue

    try {
        Write-Host "Baixando com Invoke-WebRequest..."
        Invoke-WebRequest `
            -Uri $Url `
            -OutFile $Destination `
            -UseBasicParsing `
            -ErrorAction Stop

        if (Test-FileHash -Path $Destination -ExpectedSha256 $ExpectedSha256) {
            return
        }

        $errors.Add("Invoke-WebRequest baixou um arquivo com SHA-256 incorreto.")
    }
    catch {
        $errors.Add("Invoke-WebRequest: $($_.Exception.Message)")
    }

    Remove-Item $Destination -Force -ErrorAction SilentlyContinue

    try {
        $curl = Get-Command curl.exe -ErrorAction Stop
        Write-Host "Baixando com curl..."
        Invoke-ProcessChecked `
            -Executable $curl.Source `
            -ProcessArguments @(
                "--fail",
                "--location",
                "--retry", "4",
                "--retry-delay", "2",
                "--connect-timeout", "30",
                "--output", $Destination,
                $Url
            )

        if (Test-FileHash -Path $Destination -ExpectedSha256 $ExpectedSha256) {
            return
        }

        $errors.Add("curl baixou um arquivo com SHA-256 incorreto.")
    }
    catch {
        $errors.Add("curl: $($_.Exception.Message)")
    }

    Remove-Item $Destination -Force -ErrorAction SilentlyContinue

    throw (
        "Falha ao baixar ou validar: $Url`n" +
        ($errors -join "`n")
    )
}

function Install-PortablePython {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DestinationRoot,

        [Parameter(Mandatory = $true)]
        [string]$DownloadRoot
    )

    $pythonRoot = Join-Path $DestinationRoot "python"
    $pythonExe = Join-Path $pythonRoot "python.exe"

    if (Test-Path $pythonRoot) {
        Remove-Item $pythonRoot -Recurse -Force
    }

    New-Item -ItemType Directory -Path $pythonRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $DownloadRoot -Force | Out-Null

    $pythonArchive = Join-Path $DownloadRoot "python-3.12.10-embed-amd64.zip"
    $pipWheel = Join-Path $DownloadRoot "pip-26.1.2-py3-none-any.whl"

    Write-Step "BAIXANDO PYTHON PORTATIL OFICIAL"
    Download-VerifiedFile `
        -Url $PythonArchiveUrl `
        -Destination $pythonArchive `
        -ExpectedSha256 $PythonArchiveSha256

    Write-Step "EXTRAINDO PYTHON PORTATIL"
    Expand-Archive `
        -Path $pythonArchive `
        -DestinationPath $pythonRoot `
        -Force

    if (-not (Test-Path $pythonExe)) {
        throw "O pacote do Python nao gerou python.exe."
    }

    $sitePackages = Join-Path $pythonRoot "Lib\site-packages"
    New-Item -ItemType Directory -Path $sitePackages -Force | Out-Null

    @(
        "python312.zip",
        ".",
        "Lib",
        "Lib\site-packages",
        "..\vendor\GMFSS_Fortuna",
        "import site"
    ) | Set-Content `
        -Path (Join-Path $pythonRoot "python312._pth") `
        -Encoding ASCII

    Write-Step "VALIDANDO PYTHON 3.12"
    Invoke-ProcessChecked `
        -Executable $pythonExe `
        -ProcessArguments @(
            "-c",
            "import sys; assert sys.version_info[:2] == (3, 12); print(sys.version); print(sys.executable)"
        )

    Write-Step "INSTALANDO PIP PORTATIL"
    Download-VerifiedFile `
        -Url $PipWheelUrl `
        -Destination $pipWheel `
        -ExpectedSha256 $PipWheelSha256

    Invoke-ProcessChecked `
        -Executable $pythonExe `
        -ProcessArguments @(
            "-m", "zipfile",
            "-e", $pipWheel,
            $sitePackages
        )

    Invoke-ProcessChecked `
        -Executable $pythonExe `
        -ProcessArguments @(
            "-m", "pip",
            "--version"
        )

    return $pythonExe
}



function Install-EngineDependencies {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InstallRoot,

        [Parameter(Mandatory = $true)]
        [string]$PythonExe
    )

    Write-Step "INSTALANDO ROCM, PYTORCH E DEPENDENCIAS"

    Invoke-ProcessChecked `
        -Executable $PythonExe `
        -ProcessArguments @(
            (Join-Path $InstallRoot "engine\install_runtime.py")
        )

    Write-Step "TESTANDO GPU AMD"

    Invoke-ProcessChecked `
        -Executable $PythonExe `
        -ProcessArguments @(
            (Join-Path $InstallRoot "engine\check_gpu.py")
        )
}

$installParent = Split-Path -Parent $InstallRoot
$logRoot = Join-Path $installParent "Logs"
$downloadCache = Join-Path $installParent "InstallerCache"
$backupRoot = "$InstallRoot.backup"

New-Item -ItemType Directory -Path $installParent -Force | Out-Null
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
New-Item -ItemType Directory -Path $downloadCache -Force | Out-Null

$logPath = Join-Path $logRoot (
    "install-engine-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log"
)

Start-Transcript -Path $logPath -Force | Out-Null

$tempRoot = Join-Path $env:TEMP (
    "WrdInterp-" + [guid]::NewGuid().ToString("N")
)
$extractRoot = Join-Path $tempRoot "extract"
$backupCreated = $false
$newInstallCreated = $false

try {
    Emit-Progress "manifest" 1 "Obtendo manifesto..."
    $manifest = Invoke-RestMethod -Uri $ManifestUrl -UseBasicParsing

    $statePath = Join-Path $InstallRoot "install-state.json"

    if ((Test-Path $statePath) -and -not $Force) {
        try {
            $state = Get-Content $statePath -Raw | ConvertFrom-Json

            if (
                $state.version -eq $manifest.version -and
                $state.status -eq "ready" -and
                (Test-Path (Join-Path $InstallRoot "python\python.exe"))
            ) {
                Emit-Progress "complete" 100 "Motor ja instalado."
                exit 0
            }
        }
        catch {
        }
    }

    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

    $assetPath = Join-Path `
        $downloadCache `
        ([string]$manifest.asset.name)

    Emit-Progress "download" 5 "Baixando motor..."

    Download-VerifiedFile `
        -Url ([string]$manifest.asset.url) `
        -Destination $assetPath `
        -ExpectedSha256 ([string]$manifest.asset.sha256)

    Emit-Progress "extract" 18 "Extraindo motor..."

    Expand-Archive `
        -Path $assetPath `
        -DestinationPath $extractRoot `
        -Force

    $payload = Join-Path $extractRoot "WrdInterpEngine"

    if (-not (
        Test-Path (Join-Path $payload "runtime-manifest.json")
    )) {
        throw "Pacote do motor invalido."
    }

    if (Test-Path $backupRoot) {
        Remove-Item $backupRoot -Recurse -Force
    }

    if (Test-Path $InstallRoot) {
        Move-Item -Path $InstallRoot -Destination $backupRoot
        $backupCreated = $true
    }

    Move-Item -Path $payload -Destination $InstallRoot
    $newInstallCreated = $true

    Emit-Progress "python" 25 "Preparando Python portatil..."

    $pythonExe = Install-PortablePython `
        -DestinationRoot $InstallRoot `
        -DownloadRoot $downloadCache

    Emit-Progress "dependencies" 38 "Instalando ROCm e PyTorch AMD..."

    Install-EngineDependencies `
        -InstallRoot $InstallRoot `
        -PythonExe $pythonExe

    Emit-Progress "activate" 97 "Finalizando instalacao..."

    @{
        status = "ready"
        version = [string]$manifest.version
        installerVersion = "1.4.0"
        installedAt = (Get-Date).ToUniversalTime().ToString("o")
        installRoot = $InstallRoot
        python = [string]$pythonExe
        entryPoint = (Join-Path $InstallRoot "engine\run_gmfss.py")
        pythonMode = "portable"
        logPath = $logPath
    } | ConvertTo-Json | Set-Content `
        -Path (Join-Path $InstallRoot "install-state.json") `
        -Encoding UTF8

    if (Test-Path $backupRoot) {
        Remove-Item $backupRoot -Recurse -Force
        $backupCreated = $false
    }

    Emit-Progress "complete" 100 "Motor instalado com sucesso."
}
catch {
    if ($newInstallCreated -and (Test-Path $InstallRoot)) {
        Remove-Item $InstallRoot -Recurse -Force `
            -ErrorAction SilentlyContinue
    }

    if ($backupCreated -and (Test-Path $backupRoot)) {
        Move-Item `
            -Path $backupRoot `
            -Destination $InstallRoot `
            -ErrorAction SilentlyContinue
    }

    Emit-Progress `
        "error" `
        0 `
        "$($_.Exception.Message) | Log: $logPath"

    throw
}
finally {
    Remove-Item $tempRoot -Recurse -Force `
        -ErrorAction SilentlyContinue

    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}
