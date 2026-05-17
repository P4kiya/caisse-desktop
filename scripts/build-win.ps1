# Build Windows installer. Use -Publish only when GH_TOKEN is set.
param([switch] $Publish)

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$envFiles = @(
  (Join-Path $PSScriptRoot '..\.env'),
  (Join-Path $root '.env'),
  (Join-Path $root 'caisse-desktop\.env')
)

foreach ($file in $envFiles) {
  if (-not (Test-Path $file)) { continue }
  Get-Content $file | ForEach-Object {
    if ($_ -match '^\s*GH_TOKEN\s*=\s*(.+)$') {
      $env:GH_TOKEN = $Matches[1].Trim().Trim('"')
    }
  }
}

Set-Location (Join-Path $PSScriptRoot '..')

if ($Publish -and $env:GH_TOKEN) {
  Write-Host 'Build + publication GitHub...'
  npx electron-builder --win --publish always
} elseif ($Publish -and -not $env:GH_TOKEN) {
  Write-Host 'GH_TOKEN manquant — build local seulement (sans GitHub).'
  npx electron-builder --win
} else {
  Write-Host 'Build local : dist\Caisse Setup *.exe'
  npx electron-builder --win
}

$exe = Get-ChildItem dist -Filter 'Caisse Setup*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) {
  $dest = Join-Path $root "Caisse-Setup-$($exe.BaseName -replace 'Caisse Setup ','').exe"
  Copy-Item $exe.FullName (Join-Path $root $exe.Name) -Force
  Write-Host "OK : $($exe.FullName)"
  Write-Host "Copie : $(Join-Path $root $exe.Name)"
} else {
  Write-Warning 'Installateur introuvable dans dist\'
}
