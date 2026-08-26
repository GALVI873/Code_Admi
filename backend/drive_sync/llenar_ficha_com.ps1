# Escribe valores puntuales en la hoja "Ficha" de un Excel de calculo usando
# automatizacion COM de Excel real (no una libreria que reconstruye el
# archivo) -- unica forma verificada de no romper formato/formulas del resto
# del libro (con SheetJS un simple ida-y-vuelta sin cambios infla el archivo
# de 149 KB a 5.4 MB).
#
# Limpieza de proceso: ni liberar cada objeto COM ni matar por texto de la
# linea de comando alcanza -- una vez que el workbook queda abierto, Windows
# reporta la ruta del archivo en vez de "-Embedding" (asi que ese filtro de
# texto ya no lo distingue de una sesion real), y liberar los COM no siempre
# mata el proceso. La unica forma confiable: anotar el PID exacto de la
# instancia que ESTE script lanza (por diferencia de procesos antes/despues)
# y matar ESE PID al final, pase lo que pase con el COM.
#
# Escritura por ETIQUETA, no por celda fija: la fila de cada campo (Vidrio,
# Persianas, RAL Silicona, etc.) varia de un Excel a otro -- algunas obras no
# tienen persianas y esas filas simplemente no existen en su plantilla, asi
# que todo lo de abajo se corre hacia arriba. Escribir en "B26" a ciegas
# aterrizaba en la fila equivocada en 13 de 36 obras de un batch real (un
# caso con perdida real de dato: Vidrio pisado por "SI" de Persianas). Ahora
# cada entrada trae su propia etiqueta a buscar en la columna A; si no
# aparece en esa Ficha, se omite (no se inventa una fila).
param(
  [Parameter(Mandatory=$true)][string]$RutaExcel,
  [Parameter(Mandatory=$true)][string]$RutaJson
)

$ErrorActionPreference = 'Stop'
$datos = Get-Content -Raw -Encoding UTF8 $RutaJson | ConvertFrom-Json

function Release-Com($obj) {
  if ($obj) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($obj) | Out-Null }
}

# Busca en la columna A (filas 1-60, rango mas que de sobra para la hoja
# Ficha) la primera fila cuyo texto matchee la regex de etiqueta, y devuelve
# su numero de fila (1-based) o $null si no aparece.
function Buscar-FilaPorEtiqueta($ws, [string]$etiquetaRegex) {
  for ($fila = 1; $fila -le 60; $fila++) {
    $texto = [string]$ws.Cells.Item($fila, 1).Value2
    if ($texto -and ($texto.Trim() -match $etiquetaRegex)) { return $fila }
  }
  return $null
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
  $ws = $wb.Sheets.Item("Ficha")

  foreach ($campo in $datos) {
    $valor = $campo.valor
    if ($null -eq $valor -or $valor -eq '') { continue }
    $fila = Buscar-FilaPorEtiqueta $ws $campo.etiqueta
    if ($null -eq $fila) {
      Write-Output "OMITIDO campo '$($campo.nombre)' (etiqueta '$($campo.etiqueta)' no encontrada en esta Ficha)"
      continue
    }
    $rango = $ws.Cells.Item($fila, $campo.columna)
    try {
      if ($valor -is [int] -or $valor -is [long] -or $valor -is [double]) {
        $rango.Value2 = [double]$valor
      } else {
        $rango.Value2 = [string]$valor
      }
    } catch {
      Write-Output "FALLO en campo $($campo.nombre) (fila=$fila, valor=$valor): $($_.Exception.Message)"
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
