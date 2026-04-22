$chromeCandidates = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$chromePath = $chromeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
$userDataDir = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'

if (!$chromePath) {
  Write-Error 'Chrome not found in standard install locations.'
  exit 1
}

Write-Host 'Close all existing Chrome windows first, then press Enter to continue.'
[void][System.Console]::ReadLine()

Start-Process -FilePath $chromePath -ArgumentList @(
  '--remote-debugging-port=9222',
  "--user-data-dir=$userDataDir",
  '--profile-directory=Default',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages'
)

Write-Host 'Chrome started with remote debugging on port 9222.'
