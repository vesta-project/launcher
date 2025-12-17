package net.vesta;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/**
 * Exit Handler for Vesta Launcher
 * 
 * Wraps Minecraft process to track exit time for accurate playtime calculation.
 * Streams stdout/stderr to console and log file, writes exit_status.json on exit.
 * 
 * Usage: java -jar exit-handler.jar --instance-id <id> --exit-file <path> --log-file <path> -- <java> <args...>
 * 
 * Compiled with --release 8 for maximum Java version compatibility.
 */
public class ExitHandler {
    
    private static String instanceId;
    private static String exitFilePath;
    private static String logFilePath;
    private static Process gameProcess;
    private static volatile int exitCode = -1;
    private static volatile boolean hasWrittenExitFile = false;
    
    public static void main(String[] args) {
        // Parse arguments
        List<String> gameCommand = new ArrayList<>();
        int i = 0;
        
        while (i < args.length) {
            String arg = args[i];
            
            if ("--instance-id".equals(arg) && i + 1 < args.length) {
                instanceId = args[++i];
            } else if ("--exit-file".equals(arg) && i + 1 < args.length) {
                exitFilePath = args[++i];
            } else if ("--log-file".equals(arg) && i + 1 < args.length) {
                logFilePath = args[++i];
            } else if ("--".equals(arg)) {
                // Everything after -- is the game command
                for (int j = i + 1; j < args.length; j++) {
                    gameCommand.add(args[j]);
                }
                break;
            }
            i++;
        }
        
        // Validate required arguments
        if (instanceId == null || exitFilePath == null || logFilePath == null || gameCommand.isEmpty()) {
            System.err.println("Usage: java -jar exit-handler.jar --instance-id <id> --exit-file <path> --log-file <path> -- <java> <args...>");
            System.err.println("Missing required arguments:");
            if (instanceId == null) System.err.println("  --instance-id");
            if (exitFilePath == null) System.err.println("  --exit-file");
            if (logFilePath == null) System.err.println("  --log-file");
            if (gameCommand.isEmpty()) System.err.println("  game command after --");
            System.exit(1);
            return;
        }
        
        // Register shutdown hook for graceful termination
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            // Kill child process if still running
            if (gameProcess != null && gameProcess.isAlive()) {
                gameProcess.destroy();
                try {
                    // Give it a moment to terminate gracefully
                    gameProcess.waitFor();
                } catch (InterruptedException e) {
                    gameProcess.destroyForcibly();
                }
            }
            // Write exit file if not already written
            writeExitFile();
        }, "ExitHandler-ShutdownHook"));
        
        try {
            // Create log file directory if needed
            File logFile = new File(logFilePath);
            File logDir = logFile.getParentFile();
            if (logDir != null && !logDir.exists()) {
                logDir.mkdirs();
            }
            
            // Create exit file directory if needed
            File exitFile = new File(exitFilePath);
            File exitDir = exitFile.getParentFile();
            if (exitDir != null && !exitDir.exists()) {
                exitDir.mkdirs();
            }
            
            // Start the game process
            ProcessBuilder pb = new ProcessBuilder(gameCommand);
            pb.redirectErrorStream(false); // Keep stdout and stderr separate
            
            gameProcess = pb.start();
            
            // Stream handlers for stdout and stderr
            Thread stdoutThread = new Thread(() -> streamOutput(gameProcess.getInputStream(), System.out, "stdout"), "stdout-reader");
            Thread stderrThread = new Thread(() -> streamOutput(gameProcess.getErrorStream(), System.err, "stderr"), "stderr-reader");
            
            stdoutThread.start();
            stderrThread.start();
            
            // Wait for game to exit
            exitCode = gameProcess.waitFor();
            
            // Wait for stream threads to finish
            stdoutThread.join(5000);
            stderrThread.join(5000);
            
            // Write exit file
            writeExitFile();
            
            // Exit with game's exit code
            System.exit(exitCode);
            
        } catch (Exception e) {
            System.err.println("[ExitHandler] Error: " + e.getMessage());
            e.printStackTrace();
            exitCode = 1;
            writeExitFile();
            System.exit(1);
        }
    }
    
    /**
     * Stream output from process to console and log file
     */
    private static void streamOutput(InputStream inputStream, PrintStream console, String streamName) {
        try (
            BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8));
            FileOutputStream fos = new FileOutputStream(logFilePath, true);
            PrintWriter logWriter = new PrintWriter(new OutputStreamWriter(fos, StandardCharsets.UTF_8), true)
        ) {
            String line;
            while ((line = reader.readLine()) != null) {
                // Write to console (for launcher to capture via LogCallback)
                console.println(line);
                // Write to log file
                logWriter.println(line);
            }
        } catch (IOException e) {
            // Stream closed, game exited
        }
    }
    
    /**
     * Write exit status JSON file
     */
    private static synchronized void writeExitFile() {
        if (hasWrittenExitFile) {
            return; // Only write once
        }
        hasWrittenExitFile = true;
        
        try {
            String timestamp = DateTimeFormatter.ISO_INSTANT.format(Instant.now());
            
            // Simple JSON without external dependencies
            String json = String.format(
                "{\n  \"instance_id\": \"%s\",\n  \"exit_code\": %d,\n  \"exited_at\": \"%s\"\n}\n",
                escapeJson(instanceId),
                exitCode,
                timestamp
            );
            
            try (FileOutputStream fos = new FileOutputStream(exitFilePath);
                 OutputStreamWriter writer = new OutputStreamWriter(fos, StandardCharsets.UTF_8)) {
                writer.write(json);
            }
            
        } catch (IOException e) {
            System.err.println("[ExitHandler] Failed to write exit file: " + e.getMessage());
        }
    }
    
    /**
     * Escape string for JSON
     */
    private static String escapeJson(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder();
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default: sb.append(c);
            }
        }
        return sb.toString();
    }
}
