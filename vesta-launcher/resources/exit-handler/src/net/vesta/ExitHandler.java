package net.vesta;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Exit Handler for Vesta Launcher
 * 
 * Wraps Minecraft process to track exit time for accurate playtime calculation.
 * Streams stdout/stderr to console and log file, writes exit_status.json on exit.
 * 
 * Usage: java -jar exit-handler.jar --instance-id <id> --exit-file <path> --log-file <path> [--pre-launch-hook <cmd>] [--post-exit-hook <cmd>] -- <java> <args...>
 * 
 * Compiled with --release 8 for maximum Java version compatibility.
 */
public class ExitHandler {
    
    private static String instanceId;
    private static String exitFilePath;
    private static String logFilePath;
    private static String preLaunchHook;
    private static String postExitHook;
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
            } else if ("--pre-launch-hook".equals(arg) && i + 1 < args.length) {
                preLaunchHook = args[++i];
            } else if ("--post-exit-hook".equals(arg) && i + 1 < args.length) {
                postExitHook = args[++i];
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
            System.err.println("Usage: java -jar exit-handler.jar --instance-id <id> --exit-file <path> --log-file <path> [--pre-launch-hook <cmd>] [--post-exit-hook <cmd>] -- <java> <args...>");
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
            clearGamePidFile();
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
            
            // Run pre-launch hook if specified
            if (preLaunchHook != null && !preLaunchHook.trim().isEmpty()) {
                safePrintln(System.out, "[Hook] Executing pre-launch hook: " + preLaunchHook);
                int hookExitCode = executeHook(preLaunchHook);
                if (hookExitCode != 0) {
                    safePrintln(System.err, "[Hook] Pre-launch hook failed with exit code: " + hookExitCode);
                    exitCode = hookExitCode;
                    writeExitFile();
                    System.exit(hookExitCode);
                    return;
                }
                safePrintln(System.out, "[Hook] Pre-launch hook completed successfully");
            }
            
            // Start the game process
            ProcessBuilder pb = new ProcessBuilder(gameCommand);
            pb.redirectErrorStream(false); // Keep stdout and stderr separate
            
            gameProcess = pb.start();
            // Publish the real game PID immediately so the launcher can keep
            // tracking the session if this wrapper JVM dies early (sandbox
            // wrapper teardown, SIGPIPE on piped stdio, OOM, etc.).
            writeGamePidFile(getProcessId(gameProcess));
            
            // Stream handlers for stdout and stderr.
            // Never let a broken launcher pipe kill this JVM via SIGPIPE: log
            // file is authoritative; console forwarding is best-effort.
            Thread stdoutThread = new Thread(() -> streamOutput(gameProcess.getInputStream(), System.out, "stdout"), "stdout-reader");
            Thread stderrThread = new Thread(() -> streamOutput(gameProcess.getErrorStream(), System.err, "stderr"), "stderr-reader");
            
            stdoutThread.start();
            stderrThread.start();
            
            // Wait for game to exit
            exitCode = gameProcess.waitFor();
            
            // Wait for stream threads to finish
            stdoutThread.join(5000);
            stderrThread.join(5000);
            
            // Run post-exit hook if specified
            if (postExitHook != null && !postExitHook.trim().isEmpty()) {
                safePrintln(System.out, "[Hook] Executing post-exit hook: " + postExitHook);
                int hookExitCode = executeHook(postExitHook);
                if (hookExitCode != 0) {
                    safePrintln(System.err, "[Hook] Post-exit hook failed with exit code: " + hookExitCode);
                } else {
                    safePrintln(System.out, "[Hook] Post-exit hook completed successfully");
                }
            }
            
            // Write exit file
            clearGamePidFile();
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
     * Executes a hook command using the platform's shell
     */
    private static int executeHook(String commandStr) {
        try {
            boolean isWindows = System.getProperty("os.name").toLowerCase().contains("win");
            List<String> cmd = new ArrayList<>();
            if (isWindows) {
                cmd.add("cmd");
                cmd.add("/C");
                cmd.add(commandStr);
            } else {
                cmd.add("sh");
                cmd.add("-c");
                cmd.add(commandStr);
            }
            
            ProcessBuilder pb = new ProcessBuilder(cmd);
            // Inherit environment variables from the current process (which includes the game's env vars)
            pb.redirectErrorStream(true);
            
            Process p = pb.start();
            
            // Stream hook output to log file and console
            Thread outputThread = new Thread(() -> streamOutput(p.getInputStream(), System.out, "hook-output"), "hook-reader");
            outputThread.start();
            
            int code = p.waitFor();
            outputThread.join(5000);
            
            return code;
        } catch (Exception e) {
            System.err.println("[Hook] Error executing hook: " + e.getMessage());
            e.printStackTrace();
            return -1;
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
                // Write to log file first (authoritative for playtime/crash analysis)
                logWriter.println(line);
                // Best-effort console forward for the launcher; never abort the
                // session if the parent closed our stdout/stderr pipe.
                safePrintln(console, line);
            }
        } catch (IOException e) {
            // Stream closed, game exited
        }
    }

    private static void safePrintln(PrintStream console, String line) {
        if (console == null) {
            return;
        }
        try {
            console.println(line);
            if (console.checkError()) {
                // Broken pipe / closed console — stop forwarding further.
            }
        } catch (Exception ignored) {
            // Ignore; log file remains the source of truth.
        }
    }

    /**
     * Best-effort PID extraction compatible with Java 8+.
     */
    private static long getProcessId(Process process) {
        try {
            // Java 9+: Process.pid()
            java.lang.reflect.Method pidMethod = process.getClass().getMethod("pid");
            Object value = pidMethod.invoke(process);
            if (value instanceof Long) {
                return ((Long) value).longValue();
            }
            if (value instanceof Integer) {
                return ((Integer) value).longValue();
            }
        } catch (Exception ignored) {
            // Fall through to UNIX ProcessImpl hack for Java 8.
        }
        try {
            java.lang.reflect.Field field = process.getClass().getDeclaredField("pid");
            field.setAccessible(true);
            return field.getLong(process);
        } catch (Exception e) {
            System.err.println("[ExitHandler] Unable to resolve game PID: " + e.getMessage());
            return -1;
        }
    }

    private static File gamePidFile() {
        File exitFile = new File(exitFilePath);
        File exitDir = exitFile.getParentFile();
        if (exitDir == null) {
            return new File("game_pid");
        }
        return new File(exitDir, "game_pid");
    }

    private static void writeGamePidFile(long pid) {
        if (pid <= 0) {
            return;
        }
        try {
            File pidFile = gamePidFile();
            File parent = pidFile.getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }
            try (PrintWriter writer = new PrintWriter(new OutputStreamWriter(new FileOutputStream(pidFile), StandardCharsets.UTF_8))) {
                writer.print(Long.toString(pid));
            }
        } catch (Exception e) {
            System.err.println("[ExitHandler] Failed to write game PID file: " + e.getMessage());
        }
    }

    private static void clearGamePidFile() {
        try {
            File pidFile = gamePidFile();
            if (pidFile.exists() && !pidFile.delete()) {
                System.err.println("[ExitHandler] Failed to delete game PID file");
            }
        } catch (Exception e) {
            System.err.println("[ExitHandler] Failed to clear game PID file: " + e.getMessage());
        }
    }

    /**
     * Write exit status to JSON file
     */
    private static synchronized void writeExitFile() {
        if (hasWrittenExitFile) return;
        
        try {
            String timestamp = DateTimeFormatter.ISO_INSTANT.format(Instant.now());
            String json = String.format("{\n  \"instance_id\": \"%s\",\n  \"exit_code\": %d,\n  \"exited_at\": \"%s\"\n}", 
                instanceId, exitCode, timestamp);
                
            try (PrintWriter writer = new PrintWriter(new OutputStreamWriter(new FileOutputStream(exitFilePath), StandardCharsets.UTF_8))) {
                writer.print(json);
            }
            hasWrittenExitFile = true;
        } catch (Exception e) {
            System.err.println("[ExitHandler] Failed to write exit file: " + e.getMessage());
        }
    }
}
