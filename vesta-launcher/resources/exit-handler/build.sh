#!/bin/bash
# Build script for exit-handler.jar
# Requires JDK 8+ installed

echo "Building exit-handler.jar..."

# Create output directories
mkdir -p out/net/vesta

# Compile with Java 8 target for maximum compatibility
javac --release 8 -d out src/net/vesta/ExitHandler.java
if [ $? -ne 0 ]; then
    echo "Compilation failed!"
    exit 1
fi

# Create manifest
echo "Main-Class: net.vesta.ExitHandler" > out/MANIFEST.MF

# Create JAR
cd out
jar cfm ../exit-handler.jar MANIFEST.MF net/vesta/ExitHandler.class
cd ..

if [ -f "exit-handler.jar" ]; then
    echo "Success! Created exit-handler.jar"
    ls -la exit-handler.jar
else
    echo "Failed to create JAR"
    exit 1
fi
