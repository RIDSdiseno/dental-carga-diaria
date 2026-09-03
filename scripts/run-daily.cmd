@echo off
rem Lanzador para el Programador de tareas de Windows. Ejecuta la carga diaria
rem y deja la salida en reports\scheduler.log (además del run.log de cada corrida).
setlocal
cd /d "%~dp0.."
rem La tarea programada siempre corre sin ventana (el .env puede tener HEADLESS=false para pruebas).
set HEADLESS=true
if not exist reports mkdir reports
echo [%date% %time%] Inicio de la carga diaria >> reports\scheduler.log
node src\run-daily.js >> reports\scheduler.log 2>&1
echo [%date% %time%] Fin de la carga diaria (codigo %errorlevel%) >> reports\scheduler.log
endlocal
