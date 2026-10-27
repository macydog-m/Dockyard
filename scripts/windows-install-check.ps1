param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$UpgradeInstaller,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$enc = [System.Text.UTF8Encoding]::new($false)
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$upgradePath = (Resolve-Path -LiteralPath $UpgradeInstaller).Path
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$existing = @(Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Dockyard' })
if ($existing.Count -gt 0) { throw 'An existing Dockyard installation was found. Use a clean test account or VM; this check will not replace it.' }
$checkRoot = Join-Path $outputRoot ('dockyard-install-check-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $checkRoot | Out-Null
$installDir = Join-Path $checkRoot '中文安装 Application'
$dataDir = Join-Path $checkRoot '保留数据 Dockyard'
$appExe = Join-Path $installDir 'Dockyard.exe'
$checkScript = Join-Path $installDir 'resources\app\runtime-check.cjs'
$report = [ordered]@{ passed = $false; machine = 'local Windows'; cleanMachineClaim = $false; checkRoot = $checkRoot; stages = @() }
function Assert-ScopedInstall {
  $resolvedRoot = [System.IO.Path]::GetFullPath($checkRoot).TrimEnd('\') + '\'
  $resolvedTarget = [System.IO.Path]::GetFullPath($installDir)
  if (!$resolvedTarget.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Install target escaped the test root.' }
}
function Invoke-Installer([string]$Executable) {
  Assert-ScopedInstall
  $process = Start-Process -FilePath $Executable -ArgumentList @('/S', '/currentuser', ("/D=" + $installDir)) -PassThru -WindowStyle Hidden
  if (!$process.WaitForExit(120000)) { throw 'Installer timeout; inspect the test directory before retrying.' }
  if ($process.ExitCode -ne 0) { throw ('Installer failed: ' + $process.ExitCode) }
  if (!(Test-Path -LiteralPath $appExe)) { throw 'Installed application not found in the requested test directory.' }
}
function Invoke-RuntimeCheck([bool]$Seed) {
  $taskPreviousPath = $env:PATH
  $taskPreviousNodeMode = $env:ELECTRON_RUN_AS_NODE
  try {
    $env:PATH = $env:SystemRoot + ';' + (Join-Path $env:SystemRoot 'System32')
    $env:ELECTRON_RUN_AS_NODE = '1'
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $appExe
    $startInfo.Arguments = '"' + $checkScript + '" --data-dir "' + $dataDir + '"' + $(if ($Seed) { ' --seed' } else { '' })
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $runtimeProcess = [System.Diagnostics.Process]::Start($startInfo)
    $stdoutTask = $runtimeProcess.StandardOutput.ReadToEndAsync()
    $stderrTask = $runtimeProcess.StandardError.ReadToEndAsync()
    if (!$runtimeProcess.WaitForExit(60000)) { $runtimeProcess.Kill(); throw 'Bundled runtime verification timed out.' }
    $raw = $stdoutTask.GetAwaiter().GetResult()
    $diagnostics = $stderrTask.GetAwaiter().GetResult()
    if ($runtimeProcess.ExitCode -ne 0) { throw ('Bundled runtime verification failed: ' + $diagnostics) }
    $result = $raw | ConvertFrom-Json
    if (!$result.passed) { throw 'Bundled runtime did not confirm success.' }
    return $result
  } finally {
    $env:PATH = $taskPreviousPath
    $env:ELECTRON_RUN_AS_NODE = $taskPreviousNodeMode
  }
}
function Read-DataHashes {
  $map = [ordered]@{}
  Get-ChildItem -LiteralPath $dataDir -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($dataDir.Length + 1)
    $map[$relative] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
  }
  return ($map | ConvertTo-Json -Compress)
}
try {
  Invoke-Installer $installerPath
  $first = Invoke-RuntimeCheck $true
  $before = Read-DataHashes
  $report.stages += [ordered]@{ stage = 'install'; passed = $true; version = $first.version; globalNodeOnPath = $false }
  Invoke-Installer $upgradePath
  $second = Invoke-RuntimeCheck $false
  if ($first.version -eq $second.version) { throw 'Upgrade installer must carry a different app version.' }
  if ((Read-DataHashes) -ne $before) { throw 'Upgrade changed resource metadata.' }
  $report.stages += [ordered]@{ stage = 'upgrade'; passed = $true; version = $second.version; dataUnchanged = $true }
  Assert-ScopedInstall
  $uninstaller = Join-Path $installDir 'Uninstall Dockyard.exe'
  if (!(Test-Path -LiteralPath $uninstaller)) { throw 'Expected uninstaller missing.' }
  $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -WindowStyle Hidden
  if (!$process.WaitForExit(120000)) { throw 'Uninstaller timeout.' }
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ((Test-Path -LiteralPath $appExe) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
  if (Test-Path -LiteralPath $appExe) { throw 'Uninstaller did not remove the application.' }
  if ((Read-DataHashes) -ne $before) { throw 'Uninstaller changed resource metadata.' }
  if ([System.IO.File]::ReadAllText($first.source, [System.Text.Encoding]::UTF8) -ne 'ORIGINAL_KEEP') { throw 'Original source changed.' }
  $remaining = @(Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Dockyard' })
  if ($remaining.Count -ne 0) { throw 'Uninstall registration remains.' }
  $report.stages += [ordered]@{ stage = 'uninstall'; passed = $true; dataUnchanged = $true; sourcePreserved = $true }
  $report.passed = $true
} finally {
  $json = $report | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText((Join-Path $checkRoot 'report.json'), $json, $enc)
  Write-Output $json
}
