@echo off
rem Lanzador para el Programador de tareas de Windows. Ejecuta la carga diaria y deja la
rem salida en reports\scheduler.log (ademas del run.log de cada corrida).
rem Sin bloques entre parentesis: un ")" dentro de un echo rompe el bloque en cmd.
setlocal EnableDelayedExpansion
cd /d "%~dp0.."
rem La tarea programada siempre corre sin ventana (el .env puede tener HEADLESS=false para pruebas).
set HEADLESS=true
if not exist reports mkdir reports

echo [%date% %time%] Inicio de la carga diaria >> reports\scheduler.log
node src\run-daily.js >> reports\scheduler.log 2>&1
set CODIGO=!errorlevel!
echo [%date% %time%] Fin de la carga diaria, codigo !CODIGO! >> reports\scheduler.log

rem Codigo 1 = termino con errores en algunos items: se reanuda UNA vez para reintentar
rem solo lo que falto (lo ya creado se omite). Codigo 2 = fallo fatal, no se reintenta.
if not "!CODIGO!"=="1" goto :fin
if not exist reports\ultimo-runid.txt goto :fin
set /p RUNID=<reports\ultimo-runid.txt
echo [%date% %time%] Reanudando !RUNID! para reintentar lo que fallo >> reports\scheduler.log
node src\run-daily.js --resume !RUNID! --no-git >> reports\scheduler.log 2>&1
echo [%date% %time%] Fin de la reanudacion, codigo !errorlevel! >> reports\scheduler.log

:fin
endlocal
