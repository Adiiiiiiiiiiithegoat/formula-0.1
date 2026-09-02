@echo off
REM ES modules need a real HTTP origin - file:// will not load them.
cd /d "%~dp0"
echo Formula 0.1 -> http://localhost:8080
python -m http.server 8080
