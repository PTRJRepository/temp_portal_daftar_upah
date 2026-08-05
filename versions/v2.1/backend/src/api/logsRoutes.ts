import { Elysia } from "elysia";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { Config } from "../config";

/**
 * Logs API Routes
 * Provides endpoints to read error logs
 */
export const logsRoutes = new Elysia({ prefix: "/api/logs" })
    .get("/error", () => {
        const logPath = Config.LOG_FILE_PATH || join(process.cwd(), "logs", "error.log");

        if (!existsSync(logPath)) {
            return {
                success: true,
                exists: false,
                message: "Log file not found",
                content: ""
            };
        }

        try {
            const content = readFileSync(logPath, "utf-8");
            const stats = statSync(logPath);

            return {
                success: true,
                exists: true,
                size: stats.size,
                modified: stats.mtime.toISOString(),
                content: content
            };
        } catch (e) {
            return {
                success: false,
                exists: true,
                error: e instanceof Error ? e.message : String(e),
                content: ""
            };
        }
    })
    .get("/error/tail/:lines?", ({ params }) => {
        const logPath = Config.LOG_FILE_PATH || join(process.cwd(), "logs", "error.log");
        const linesCount = parseInt(params.lines || "100");

        if (!existsSync(logPath)) {
            return {
                success: true,
                exists: false,
                message: "Log file not found",
                content: ""
            };
        }

        try {
            const content = readFileSync(logPath, "utf-8");
            const allLines = content.split("\n");
            const tailLines = allLines.slice(-linesCount);

            return {
                success: true,
                exists: true,
                totalLines: allLines.length,
                requestedLines: linesCount,
                content: tailLines.join("\n")
            };
        } catch (e) {
            return {
                success: false,
                exists: true,
                error: e instanceof Error ? e.message : String(e),
                content: ""
            };
        }
    })
    .delete("/error", () => {
        const logPath = Config.LOG_FILE_PATH || join(process.cwd(), "logs", "error.log");

        if (!existsSync(logPath)) {
            return {
                success: true,
                message: "Log file not found, nothing to delete"
            };
        }

        try {
            require("fs").unlinkSync(logPath);
            return {
                success: true,
                message: "Log file deleted successfully"
            };
        } catch (e) {
            return {
                success: false,
                error: e instanceof Error ? e.message : String(e)
            };
        }
    })
    .get("/status", () => {
        return {
            logLevel: Config.LOG_LEVEL,
            logToFile: Config.LOG_TO_FILE,
            logFilePath: Config.LOG_FILE_PATH,
            clearLogsOnStartup: Config.CLEAR_LOGS_ON_STARTUP
        };
    });
