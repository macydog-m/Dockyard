$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$iconAssets = Join-Path $PSScriptRoot '../apps/desktop/assets'
$iconSource = [System.Drawing.Bitmap]::new((Join-Path $iconAssets 'icon-source.png'))
try {
  function Get-IconPng([int]$size) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
    $stream = [System.IO.MemoryStream]::new()
    try {
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
      $graphics.DrawImage($iconSource, [System.Drawing.Rectangle]::new(0, 0, $size, $size), 0, 0, $iconSource.Width, $iconSource.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      return ,$stream.ToArray()
    } finally {
      $stream.Dispose()
      $attributes.Dispose()
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }

  [System.IO.File]::WriteAllBytes((Join-Path $iconAssets 'icon.png'), (Get-IconPng 1024))
  $sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
  $frames = @($sizes | ForEach-Object { ,(Get-IconPng $_) })
  $icoStream = [System.IO.MemoryStream]::new()
  $writer = [System.IO.BinaryWriter]::new($icoStream)
  try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($index = 0; $index -lt $sizes.Count; $index++) {
      $dimension = if ($sizes[$index] -eq 256) { 0 } else { $sizes[$index] }
      $writer.Write([byte]$dimension)
      $writer.Write([byte]$dimension)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([uint16]1)
      $writer.Write([uint16]32)
      $writer.Write([uint32]$frames[$index].Length)
      $writer.Write([uint32]$offset)
      $offset += $frames[$index].Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
    [System.IO.File]::WriteAllBytes((Join-Path $iconAssets 'icon.ico'), $icoStream.ToArray())
  } finally {
    $writer.Dispose()
    $icoStream.Dispose()
  }
  Write-Output 'Exported icon.png (1024px) and icon.ico (16/20/24/32/40/48/64/128/256px).'
} finally { $iconSource.Dispose() }
