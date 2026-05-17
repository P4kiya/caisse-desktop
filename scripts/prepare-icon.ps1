# Crop logo-2.png to a square and write build/icon.png (512) + build/icon.ico
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$desktop = Split-Path $PSScriptRoot -Parent
$buildDir = Join-Path $desktop 'build'
$logoPath = Join-Path $desktop 'logo-2.png'
if (-not (Test-Path $logoPath)) {
  $logoPath = Join-Path $desktop 'logo.png'
}

if (-not (Test-Path $logoPath)) {
  Write-Error "logo-2.png ou logo.png introuvable dans $desktop"
}

New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

$src = [System.Drawing.Image]::FromFile($logoPath)
try {
  $side = [Math]::Min($src.Width, $src.Height)
  $x = [int](($src.Width - $side) / 2)
  $y = [int](($src.Height - $side) / 2)

  $crop = New-Object System.Drawing.Bitmap $side, $side
  $g = [System.Drawing.Graphics]::FromImage($crop)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $srcRect = New-Object System.Drawing.Rectangle $x, $y, $side, $side
  $destRect = New-Object System.Drawing.Rectangle 0, 0, $side, $side
  $g.DrawImage($src, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()

  $outSize = 512
  $icon = New-Object System.Drawing.Bitmap $outSize, $outSize
  $g2 = [System.Drawing.Graphics]::FromImage($icon)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($crop, 0, 0, $outSize, $outSize)
  $g2.Dispose()
  $crop.Dispose()

  $pngOut = Join-Path $buildDir 'icon.png'
  $icon.Save($pngOut, [System.Drawing.Imaging.ImageFormat]::Png)
  $icon.Dispose()
  Write-Host "OK: $pngOut"
}
finally {
  $src.Dispose()
}

$icoOut = Join-Path $buildDir 'icon.ico'
cmd /c "cd /d `"$desktop`" && npx --yes png-to-ico build/icon.png > build\icon.ico"
if (-not (Test-Path $icoOut) -or (Get-Item $icoOut).Length -lt 100) {
  Write-Error "Echec generation icon.ico"
}
Write-Host "OK: $icoOut"
