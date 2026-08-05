/**
 * Centralized Logger System
 *
 * Environment Variables:
 * - LOG_LEVEL: DEBUG | INFO | WARN | ERROR (default: INFO)
 * - LOG_TO_FILE: true | false (default: true)
 * - LOG_FILE_PATH: path to error log file (default: logs/error.log)
 * - CLEAR_LOGS_ON_STARTUP: true | false (default: true)
 */

import { existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    SILENT = 99
}

class Logger {
    private level: LogLevel;
    private logToFile: boolean;
    private logFilePath: string;
    private clearLogsOnStartup: boolean;
    private errorBuffer: string[] = [];

    constructor() {
        // Parse log level from environment
        const levelStr = (process.env.LOG_LEVEL || "INFO").toUpperCase();
        this.level = LogLevel[levelStr as keyof typeof LogLevel] ?? LogLevel.INFO;

        // Parse config from environment
        this.logToFile = process.env.LOG_TO_FILE !== "false";
        this.logFilePath = process.env.LOG_FILE_PATH || join(process.cwd(), "logs", "error.log");
        this.clearLogsOnStartup = process.env.CLEAR_LOGS_ON_STARTUP !== "false";

        // Initialize log file
        this.initializeLogFile();
    }

    private initializeLogFile(): void {
        if (!this.logToFile) return;

        const logDir = join(process.cwd(), "logs");

        try {
            // Create logs directory if it doesn't exist
            if (!existsSync(logDir)) {
                require("fs").mkdirSync(logDir, { recursive: true });
            }

            // Clear log file on startup if configured
            if (this.clearLogsOnStartup && existsSync(this.logFilePath)) {
                require("fs").unlinkSync(this.logFilePath);
                this.writeToFile("=== LOGS CLEARED ON STARTUP ===\n");
            } else if (!existsSync(this.logFilePath)) {
                this.writeToFile("=== ERROR LOG STARTED ===\n");
            } else {
                // Append separator if file exists
                this.writeToFile("\n\n=== NEW RUNTIME SESSION ===\n");
            }
        } catch (e) {
            console.error("[Logger] Failed to initialize log file:", e);
        }
    }

    private writeToFile(message: string): void {
        if (!this.logToFile) return;

        try {
            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] ${message}\n`;
            require("fs").appendFileSync(this.logFilePath, logMessage);
        } catch (e) {
            // Don't use console.error to avoid infinite loops
            // Just silently fail
        }
    }

    private formatMessage(level: string, category: string, message: string, ...args: any[]): string {
        const timestamp = new Date().toISOString().split("T")[1].slice(0, -1);
        const argsStr = args.length > 0 ? ` ${args.map(a => JSON.stringify(a)).join(" ")}` : "";
        return `[${timestamp}] [${level}] [${category}] ${message}${argsStr}`;
    }

    private shouldLog(level: LogLevel): boolean {
        return level >= this.level;
    }

    /**
     * Debug level logging - for development only
     * Use for: query details, intermediate values, verbose operation tracking
     */
    public debug(category: string, message: string, ...args: any[]): void {
        if (!this.shouldLog(LogLevel.DEBUG)) return;
        const formatted = this.formatMessage("DEBUG", category, message, ...args);
        console.debug(formatted);
    }

    /**
     * Info level logging - for general operational info
     * Use for: request tracking, operation start/complete, startup info
     */
    public info(category: string, message: string, ...args: any[]): void {
        if (!this.shouldLog(LogLevel.INFO)) return;
        const formatted = this.formatMessage("INFO", category, message, ...args);
        console.log(formatted);
    }

    /**
     * Warning level logging - for potential issues
     * Use for: deprecation warnings, fallbacks, unexpected but recoverable situations
     */
    public warn(category: string, message: string, ...args: any[]): void {
        if (!this.shouldLog(LogLevel.WARN)) return;
        const formatted = this.formatMessage("WARN", category, message, ...args);
        console.warn(formatted);
        this.writeToFile(formatted);
    }

    /**
     * Error level logging - for errors and exceptions
     * Always logged to console and file
     */
    public error(category: string, message: string, error?: any, ...args: any[]): void {
        const errorStr = error ? ` Error: ${error instanceof Error ? error.message : JSON.stringify(error)}` : "";
        const formatted = this.formatMessage("ERROR", category, message + errorStr, ...args);
        console.error(formatted);

        // Always write errors to file
        this.writeToFile(formatted);

        // Stack trace if available
        if (error instanceof Error && error.stack) {
            const stackLines = error.stack.split("\n").slice(1, 4);
            stackLines.forEach(line => this.writeToFile(`  ${line.trim()}`));
        }

        // Buffer for current session errors
        this.errorBuffer.push(formatted);
    }

    /**
     * Get all errors from current session
     */
    public getSessionErrors(): string[] {
        return [...this.errorBuffer];
    }

    /**
     * Clear error buffer (not the file)
     */
    public clearErrorBuffer(): void {
        this.errorBuffer = [];
    }

    /**
     * Read log file contents
     */
    public readLogFile(): string {
        if (!existsSync(this.logFilePath)) return "";
        return readFileSync(this.logFilePath, "utf-8");
    }

    /**
     * Get current log level name
     */
    public getLevelName(): string {
        return LogLevel[this.level];
    }

    /**
     * Set log level dynamically
     */
    public setLevel(level: LogLevel): void {
        this.level = level;
    }
}

// Singleton instance
const logger = new Logger();

// Export convenience functions
export const debug = (category: string, message: string, ...args: any[]) => logger.debug(category, message, ...args);
export const info = (category: string, message: string, ...args: any[]) => logger.info(category, message, ...args);
export const warn = (category: string, message: string, ...args: any[]) => logger.warn(category, message, ...args);
export const error = (category: string, message: string, err?: any, ...args: any[]) => logger.error(category, message, err, ...args);

// Export logger instance for advanced usage
export default logger;
