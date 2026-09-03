# Registra (o actualiza) la tarea programada "DentalCargaDiaria":
# todos los días a las 08:30, ejecuta scripts\run-daily.cmd con el usuario actual,
# solo cuando el usuario tiene la sesión iniciada (el equipo debe estar encendido).
#
# Uso (PowerShell, desde cualquier carpeta):
#   powershell -ExecutionPolicy Bypass -File C:\Proyectos\dental-carga-diaria\scripts\registrar-tarea.ps1
# Para quitarla:  schtasks /Delete /TN DentalCargaDiaria /F

$taskName = 'DentalCargaDiaria'
$launcher = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\run-daily.cmd'
if (-not (Test-Path $launcher)) { throw "No se encontró $launcher" }

$hora = if ($args.Count -ge 1) { $args[0] } else { '08:30' }

schtasks /Create /F /SC DAILY /ST $hora /TN $taskName /TR "`"$launcher`"" /RL LIMITED | Out-Host
if ($LASTEXITCODE -ne 0) { throw "schtasks devolvió el código $LASTEXITCODE" }

Write-Host ""
Write-Host "Tarea '$taskName' registrada para las $hora todos los días." -ForegroundColor Green
Write-Host "Ver estado:      schtasks /Query /TN $taskName /V /FO LIST"
Write-Host "Ejecutar ahora:  schtasks /Run /TN $taskName"
Write-Host "Eliminar:        schtasks /Delete /TN $taskName /F"
