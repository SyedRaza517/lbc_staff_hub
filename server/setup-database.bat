@echo off
REM One-time database setup for the Staff Hub.
REM Creates the new tables/columns (the timetable table, document upload columns).
REM Safe and additive: it never deletes or changes existing data.
REM Just double-click this file. When it says "in sync", you are done.

cd /d "%~dp0"
echo.
echo ============================================================
echo   Setting up the database (creating the timetable table)...
echo ============================================================
echo.
call npx prisma db push
echo.
echo ============================================================
echo   If you see "Your database is now in sync" above, it worked.
echo   You can close this window and refresh the Timetable tab.
echo ============================================================
echo.
pause
