@echo off
chcp 65001 >nul
title Importador de Dados Escolares - Projeto Sage
color 0A

echo.
echo ============================================================
echo    🚀 Importador de Dados Escolares - Banco SAGE
echo ============================================================
echo.

:: Caminho fixo dos arquivos
set "CURRENT_DIR=%~dp0"
set "MYSQL_PATH=C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
set "PYTHON_PATH=python"
set "SCRIPT_PATH=%CURRENT_DIR%inserir_dados.py"

:: ============================================================
:: 3️⃣ - Executar o script Python
:: ============================================================
echo.
echo Executando o script inserir_dados.py...
echo.

if not exist "%SCRIPT_PATH%" (
    echo ❌ ERRO: Script Python não encontrado em "%SCRIPT_PATH%".
    pause
    exit /b
)

"%PYTHON_PATH%" "%SCRIPT_PATH%"
if %errorlevel% neq 0 (
    echo ❌ ERRO: Falha ao executar o script Python.
    pause
    exit /b
)

:: ============================================================
:: ✅ Finalização
:: ============================================================
echo.
echo ============================================================
echo ✅ Processo concluído com sucesso!
echo ============================================================
echo.
pause
