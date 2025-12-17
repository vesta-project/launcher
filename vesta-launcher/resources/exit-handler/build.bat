@echo off
REM Build script for exit-handler.jar
REM Requires JDK 8+ installed

echo Building exit-handler.jar...

REM Create output directories
if not exist "out" mkdir out
if not exist "out\net\vesta" mkdir out\net\vesta

REM Compile with Java 8 target for maximum compatibility
javac --release 8 -d out src\net\vesta\ExitHandler.java
if errorlevel 1 (
    echo Compilation failed!
    exit /b 1
)

REM Create manifest
echo Main-Class: net.vesta.ExitHandler > out\MANIFEST.MF

REM Create JAR
cd out
jar cfm ..\exit-handler.jar MANIFEST.MF net\vesta\ExitHandler.class
cd ..

if exist "exit-handler.jar" (
    echo Success! Created exit-handler.jar
    dir exit-handler.jar
) else (
    echo Failed to create JAR
    exit /b 1
)
