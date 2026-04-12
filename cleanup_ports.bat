@echo off
echo === EAR Explorer Port Cleanup ===
echo.

echo Step 1: Removing stale HTTP.sys urlacl entries...
for %%P in (3000 4747 5555 6789 7777 8080 8081 8082 9090) do (
    netsh http delete urlacl url=http://+:%%P/         >nul 2>&1 && echo   Removed http://+:%%P/
    netsh http delete urlacl url=http://localhost:%%P/  >nul 2>&1 && echo   Removed http://localhost:%%P/
    netsh http delete urlacl url=http://*:%%P/          >nul 2>&1 && echo   Removed http://*:%%P/
)

echo.
echo Step 2: Restoring dependent services...
net start IISADMIN >nul 2>&1 && echo   Started: IISADMIN
net start W3SVC    >nul 2>&1 && echo   Started: W3SVC
net start WAS      >nul 2>&1 && echo   Started: WAS
net start wuauserv >nul 2>&1 && echo   Started: wuauserv

echo.
echo Step 3: Remaining reservations for those ports:
netsh http show urlacl | findstr "3000 4747 5555 6789 7777 8080 8081 8082 9090"
if errorlevel 1 echo   All clear.
echo.
pause
