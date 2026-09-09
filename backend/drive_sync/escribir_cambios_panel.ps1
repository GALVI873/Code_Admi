# Corre los dos scripts que escriben de vuelta en el Excel real (Ficha de
# Obras Aceptadas y Ubicacion de Diario General) los cambios que Alfredo/
# Alvaro hicieron desde el panel — ver escribir_confirmaciones_aceptadas.js
# y escribir_ubicacion_diario_general.js. Ambos necesitan el mount Z:\ de
# Drive Desktop y Excel instalado, por eso corren SOLO en esta maquina
# (tarea programada local, no en el cron de GitHub Actions que corre en la
# nube sin Excel).
#
# Si Z:\ no esta disponible todavia (Drive Desktop apagado o sin montar),
# se sale sin hacer nada — la proxima corrida programada lo vuelve a
# intentar, no hace falta que alguien la dispare a mano.
$ErrorActionPreference = 'Continue'
# node imprime en UTF-8 — sin esto, PowerShell 5.1 lo decodifica con la
# codepage legacy de la consola y las tildes/eñes quedan corruptas en el log.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$raiz = "C:\Users\Valentina\Documents\Code_Admi\backend\drive_sync"
$carpetaLogs = Join-Path $raiz "logs"
New-Item -ItemType Directory -Force -Path $carpetaLogs | Out-Null
$log = Join-Path $carpetaLogs "escribir_cambios_panel.log"

function Escribir-Log($mensaje) {
  $linea = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $mensaje"
  Add-Content -Path $log -Value $linea -Encoding utf8
}

if (-not (Test-Path "Z:\DRIVE GALVI")) {
  Escribir-Log "Z:\ no esta montado (Drive Desktop apagado o sin iniciar sesion) - se omite esta corrida."
  exit 0
}

Set-Location $raiz
Escribir-Log "=== Inicio ==="

Escribir-Log "--- escribir_confirmaciones_aceptadas.js ---"
node escribir_confirmaciones_aceptadas.js 2>&1 | ForEach-Object { Add-Content -Path $log -Value $_ -Encoding utf8 }

Escribir-Log "--- escribir_ubicacion_diario_general.js ---"
node escribir_ubicacion_diario_general.js 2>&1 | ForEach-Object { Add-Content -Path $log -Value $_ -Encoding utf8 }

Escribir-Log "=== Fin ==="
