# Escribe la columna "Ubicacion" de la hoja "Diario General" del Excel
# maestro (1. Diario General Galvi.xlsx) usando automatizacion COM de Excel
# real -- mismo motivo que llenar_ficha_com.ps1 (unica forma verificada de
# no romper formato/formulas del resto del libro).
#
# A diferencia de la Ficha (una fila por obra, se busca por ETIQUETA en la
# columna A), el Diario General es una tabla plana con una fila por item
# (material o tarea) -- no hay una sola columna que identifique la fila.
# Se busca por la combinacion de columnas que arma la "clave estable" del
# panel (Obra + Categoria + Descripcion + Proveedor + Material + Color, ver
# claveEstableDiario en diario_general.php): se lee toda la hoja de una sola
# vez (UsedRange.Value2, mucho mas rapido que celda por celda por COM) y se
# arma un diccionario clave->fila antes de escribir nada.
#
# Los nombres de columna a buscar (Categoria, Descripcion, Ubicacion...)
# llegan por el JSON en vez de como literales acá -- Windows PowerShell 5.1
# lee un .ps1 sin BOM con el codepage ANSI del sistema, no como UTF-8, así
# que una tilde escrita literal en este archivo llega corrupta en tiempo de
# ejecución (confirmado: 'Obra' funcionaba, 'Ubicación'/'Categoría' no). El
# JSON sí se lee forzando -Encoding UTF8 más abajo, así que ahí las tildes
# llegan bien.
param(
  [Parameter(Mandatory=$true)][string]$RutaExcel,
  [Parameter(Mandatory=$true)][string]$RutaJson
)

$ErrorActionPreference = 'Stop'
$payload = Get-Content -Raw -Encoding UTF8 $RutaJson | ConvertFrom-Json
$columnas = $payload.columnas
$datos = $payload.items

function Release-Com($obj) {
  if ($obj) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($obj) | Out-Null }
}

function Normalizar($valor) {
  if ($null -eq $valor) { return '' }
  return ([string]$valor).Trim().ToLowerInvariant()
}

function Clave($obra, $categoria, $descripcion, $proveedor, $material, $color) {
  return (Normalizar $obra) + '|' + (Normalizar $categoria) + '|' + (Normalizar $descripcion) + '|' + (Normalizar $proveedor) + '|' + (Normalizar $material) + '|' + (Normalizar $color)
}

$pidsAntes = @((Get-Process -Name EXCEL -ErrorAction SilentlyContinue).Id)

$excel = New-Object -ComObject Excel.Application
Start-Sleep -Milliseconds 300
$pidsDespues = @((Get-Process -Name EXCEL -ErrorAction SilentlyContinue).Id)
$miPid = $pidsDespues | Where-Object { $pidsAntes -notcontains $_ } | Select-Object -First 1

$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $null
$ws = $null
try {
  $wb = $excel.Workbooks.Open($RutaExcel)
  $ws = $wb.Sheets.Item("Diario General")

  $usedRange = $ws.UsedRange
  $valores = $usedRange.Value2
  $totalFilas = $usedRange.Rows.Count
  $totalColumnas = $usedRange.Columns.Count
  $filaBase = $usedRange.Row
  $columnaBase = $usedRange.Column

  # Fila de encabezado: la primera que tenga "Obra" en alguna columna.
  $filaHeader = -1
  for ($f = 1; $f -le $totalFilas; $f++) {
    for ($c = 1; $c -le $totalColumnas; $c++) {
      if ([string]$valores[$f, $c] -eq 'Obra') { $filaHeader = $f; break }
    }
    if ($filaHeader -ne -1) { break }
  }
  if ($filaHeader -eq -1) { throw "No se encontro la fila de encabezado (columna 'Obra') en la hoja Diario General" }

  function Buscar-Columna([string]$nombre) {
    for ($c = 1; $c -le $totalColumnas; $c++) {
      if ([string]$valores[$filaHeader, $c] -eq $nombre) { return $c }
    }
    return -1
  }

  $colObra = Buscar-Columna $columnas.obra
  $colCategoria = Buscar-Columna $columnas.categoria
  $colDescripcion = Buscar-Columna $columnas.descripcion
  $colProveedor = Buscar-Columna $columnas.proveedor
  $colMaterial = Buscar-Columna $columnas.material
  $colColor = Buscar-Columna $columnas.color
  $colUbicacion = Buscar-Columna $columnas.ubicacion

  if ($colObra -eq -1 -or $colUbicacion -eq -1) {
    throw "No se encontraron las columnas '$($columnas.obra)' y/o '$($columnas.ubicacion)' en el encabezado"
  }

  # Diccionario clave estable -> numero de fila REAL de la hoja (1-based).
  # Si hay filas duplicadas exactas se queda con la primera, igual
  # limitacion aceptada que el panel (claveEstableDiario en diario_general.php).
  $mapaFilas = @{}
  for ($f = $filaHeader + 1; $f -le $totalFilas; $f++) {
    $obra = $valores[$f, $colObra]
    if ([string]::IsNullOrWhiteSpace([string]$obra)) { continue }
    $clave = Clave $valores[$f, $colObra] $valores[$f, $colCategoria] $valores[$f, $colDescripcion] $valores[$f, $colProveedor] $valores[$f, $colMaterial] $valores[$f, $colColor]
    if (-not $mapaFilas.ContainsKey($clave)) {
      $mapaFilas[$clave] = $f + $filaBase - 1
    }
  }

  $columnaUbicacionReal = $colUbicacion + $columnaBase - 1

  foreach ($item in $datos) {
    $clave = Clave $item.obra $item.categoria $item.descripcion $item.proveedor $item.material $item.color
    if (-not $mapaFilas.ContainsKey($clave)) {
      Write-Output "OMITIDO (no encontrado en la hoja): $($item.obra) / $($item.descripcion) / $($item.material)"
      continue
    }
    $filaReal = $mapaFilas[$clave]
    $rango = $ws.Cells.Item($filaReal, $columnaUbicacionReal)
    try {
      $valor = $item.ubicacion
      if ($null -eq $valor) { $valor = '' }
      $rango.Value2 = [string]$valor
    } catch {
      Write-Output "FALLO escribiendo Ubicacion (fila=$filaReal, obra=$($item.obra)): $($_.Exception.Message)"
      throw
    } finally {
      Release-Com $rango
    }
  }

  $wb.Save()
  Write-Output "OK"
} finally {
  Release-Com $ws
  if ($wb) { $wb.Close($false) }
  Release-Com $wb
  try { $excel.Quit() } catch {}
  Release-Com $excel
  Remove-Variable excel, wb, ws -ErrorAction SilentlyContinue
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()

  if ($miPid) {
    Start-Sleep -Milliseconds 500
    $sigueVivo = Get-Process -Id $miPid -ErrorAction SilentlyContinue
    if ($sigueVivo) { Stop-Process -Id $miPid -Force -ErrorAction SilentlyContinue }
  }
}
