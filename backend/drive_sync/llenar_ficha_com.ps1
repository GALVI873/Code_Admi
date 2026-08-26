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
param(
  [Parameter(Mandatory=$true)][string]$RutaExcel,
  [Parameter(Mandatory=$true)][string]$RutaJson
)

$ErrorActionPreference = 'Stop'
$datos = Get-Content -Raw -Encoding UTF8 $RutaJson | ConvertFrom-Json

function Release-Com($obj) {
  if ($obj) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($obj) | Out-Null }
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

  foreach ($prop in $datos.PSObject.Properties) {
    $celda = $prop.Name
    $valor = $prop.Value
    if ($null -eq $valor -or $valor -eq '') { continue }
    $rango = $ws.Range($celda)
    try {
      if ($valor -is [int] -or $valor -is [long] -or $valor -is [double]) {
        $rango.Value2 = [double]$valor
      } else {
        $rango.Value2 = [string]$valor
      }
    } catch {
      Write-Output "FALLO en celda $celda (valor=$valor): $($_.Exception.Message)"
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
