# Escribe valores puntuales en la hoja "Ficha" de un Excel de calculo usando
# automatizacion COM de Excel real (no una libreria que reconstruye el
# archivo) -- unica forma verificada de no romper formato/formulas del resto
# del libro (con SheetJS un simple ida-y-vuelta sin cambios infla el archivo
# de 149 KB a 5.4 MB).
#
# Importante: libera CADA objeto COM (Range, Sheet, Workbook, Application) o
# Excel queda como proceso zombie con el archivo bloqueado -- eso ya causo
# que una segunda corrida escribiera sobre una sesion vieja sin persistir.
param(
  [Parameter(Mandatory=$true)][string]$RutaExcel,
  [Parameter(Mandatory=$true)][string]$RutaJson
)

$ErrorActionPreference = 'Stop'
$datos = Get-Content -Raw -Encoding UTF8 $RutaJson | ConvertFrom-Json

function Release-Com($obj) {
  if ($obj) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($obj) | Out-Null }
}

$excel = New-Object -ComObject Excel.Application
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
  $excel.Quit()
  Release-Com $excel
  Remove-Variable excel, wb, ws -ErrorAction SilentlyContinue
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}
