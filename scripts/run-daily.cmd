@echo off
rem Lanzador para el Programador de tareas de Windows. Ejecuta la carga diaria
rem y deja la salida en reports\scheduler.log (además del run.log de cada corrida).
setlocal EnableDelayedExpansion
cd /d "%~dp0.."
rem La tarea programada siempre corre sin ventana (el .env puede tener HEADLESS=false para pruebas).
set HEADLESS=true
if not exist reports mkdir reports
echo [%date% %time%] Inicio de la carga diaria >> reports\scheduler.log
node src\run-daily.js >> reports\scheduler.log 2>&1
set CODIGO=%errorlevel%
echo [%date% %time%] Fin de la carga diaria (codigo %CODIGO%) >> reports\scheduler.log

rem Codigo 1 = termino con errores en algunos items. Se reanuda UNA vez para reintentar
rem solo lo que falto (lo ya creado se omite). Codigo 2 = fallo fatal, no se reintenta.
if "%CODIGO%"=="1" (
  if exist reports\ultimo-runid.txt (
    for /f "usebackq delims=" %%i in ("reports\ultimo-runid.txt") do (
      echo [%date% %time%] Reanudando %%i para reintentar lo que fallo >> reports\scheduler.log
      node src\run-daily.js --resume %%i --no-git >> reports\scheduler.log 2>&1
      echo [%date% %time%] Fin de la reanudacion (codigo !errorlevel!) >> reports\scheduler.log
    )
  )
)
endlocal
