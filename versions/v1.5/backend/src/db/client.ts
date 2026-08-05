import { Config } from "../config";
import { debug, info, error as logError } from "../utils/logger";

interface QueryResponse {
    success: boolean;
    error?: string;
    data?: {
        recordset?: any[];
        rowsAffected?: number[];
        transactionCommitted?: boolean;
        [key: string]: any;
    };
}

interface BatchQuery {
    sql: string;
    params?: Record<string, any>;
    database?: string;
}

export class Database {
    private static instances: Map<string, Database> = new Map();
    private serverProfile: string;
    private databaseName: string;
    private baseUrl: string;
    private apiKey: string;
    private timeout: number;

    private constructor(database?: string, profile?: string) {
        this.serverProfile = profile || Config.DB_PROFILE;
        this.databaseName = database || Config.DEFAULT_DATABASE;
        this.apiKey = Config.DB_API_KEY;
        this.timeout = Config.DB_CONN_TIMEOUT;

        // Simple normalization: remove trailing slash
        let rawUrl = Config.DB_API_URL.trim();
        while (rawUrl.endsWith('/')) {
            rawUrl = rawUrl.slice(0, -1);
        }
        this.baseUrl = rawUrl;

        debug("DB", `Initialized with Profile: ${this.serverProfile}, DB: ${this.databaseName}`);
        debug("DB", `Gateway Base: ${this.baseUrl}`);
    }

    /**
     * Get database instance. Supports multiple database configurations:
     * - Default: db_ptrj with SERVER_PROFILE_1
     * - Extended: extend_db_ptrj with SERVER_PROFILE_1
     * - Venus: VenusHR14 with SERVER_PROFILE_3 (for Mill PKS data)
     */
    public static getInstance(database?: string, profile?: string): Database {
        const key = `${database || Config.DEFAULT_DATABASE}:${profile || Config.DB_PROFILE}`;

        if (!Database.instances.has(key)) {
            Database.instances.set(key, new Database(database, profile));
        }
        return Database.instances.get(key)!;
    }

    /**
     * Get VenusHR14 database instance (for Mill PKS data)
     */
    public static getVenusInstance(): Database {
        return Database.getInstance(Config.DB_VENUS_DATABASE, Config.DB_VENUS_PROFILE);
    }

    /**
     * Get Extended database instance (for aggregation history)
     */
    public static getExtendedInstance(): Database {
        return Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE);
    }

    /**
     * Get Mill database instance (for WM_TICKET / FFB weight data)
     */
    public static getMillInstance(): Database {
        return Database.getInstance(Config.DB_MILL_DATABASE, Config.DB_MILL_PROFILE);
    }

    private prepareParams(sql: string, params?: any[] | Record<string, any>): { sql: string; params: any[] | Record<string, any> } {
        if (!params) return { sql, params: {} };

        // Auto-convert Array params with ? placeholders to Named params with @pX placeholders
        // because the Python SQL Gateway requires named parameters.
        if (Array.isArray(params)) {
            const newParams: Record<string, any> = {};
            let newSql = sql;
            let paramIndex = 0;

            // Replace each ? occurrence with @p0, @p1, etc.
            newSql = newSql.replace(/\?/g, () => {
                const key = `p${paramIndex}`;
                newParams[key] = params[paramIndex] === undefined ? null : params[paramIndex];
                paramIndex++;
                return `@${key}`;
            });

            return { sql: newSql, params: newParams };
        }

        // For object parameters, ensure keys have @ prefix for the Python gateway
        // If SQL uses @p0, @p1 and params object has p0, p1 (without @), add @ prefix
        const newParams: Record<string, any> = {};
        for (const [key, value] of Object.entries(params)) {
            // Add @ prefix if not already present
            const newKey = key.startsWith('@') ? key : `@${key}`;
            newParams[newKey] = value === undefined ? null : value;
        }

        return { sql, params: newParams };
    }

    public async query<T = any>(sql: string, params?: any[] | Record<string, any>, timeout?: number): Promise<T[]> {
        const { sql: preparedSql, params: preparedParams } = this.prepareParams(sql, params);

        let attempt = 0;
        let delay = 500;
        const maxRetries = Config.DB_QUERY_RETRIES;
        const queryTimeout = timeout || this.timeout;

        while (attempt <= maxRetries) {
            try {
                const body = {
                    sql: preparedSql,
                    params: preparedParams,
                    server: this.serverProfile,
                    database: this.databaseName,
                    timeout: queryTimeout  // Pass custom timeout to gateway
                };

                // Debug log untuk setiap query (hanya jika LOG_LEVEL=DEBUG)
                if (attempt === 0) {
                    debug("DB_QUERY", `Query to ${this.serverProfile}/${this.databaseName} (timeout: ${queryTimeout}s)`);
                }

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), queryTimeout * 1000);

                const response = await fetch(`${this.baseUrl}/v1/query`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-api-key": this.apiKey
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text();
                    logError("DB", `Gateway Error (${response.status}): ${errorText}`, new Error(`HTTP ${response.status}`));
                    throw new Error(`Gateway returned ${response.status}: ${response.statusText} - ${errorText}`);
                }

                const result = (await response.json()) as QueryResponse;

                if (!result.success) {
                    throw new Error(result.error || "Unknown Gateway Error");
                }

                return (result.data?.recordset || []) as T[];

            } catch (error) {
                logError("DB", `Query failed (Attempt ${attempt + 1}/${maxRetries + 1})`, error);
                
                // Don't retry on timeout errors - they'll just timeout again
                const errMsg = error instanceof Error ? error.message : String(error);
                if (errMsg.includes('Timeout') || errMsg.includes('timeout') || errMsg.includes('30000ms')) {
                    logError("DB", `Timeout detected, skipping retries`);
                    throw error;
                }
                
                if (attempt >= maxRetries) throw error;
                await new Promise(r => setTimeout(r, delay));
                delay = Math.min(delay * 2, 2000);
                attempt++;
            }
        }
        return [];
    }

    public async transaction(queries: { sql: string; params?: any[] | Record<string, any> }[]): Promise<boolean> {
        const batchQueries: BatchQuery[] = queries.map(q => {
            const { sql, params } = this.prepareParams(q.sql, q.params);
            return { sql, params, database: this.databaseName };
        });

        try {
            const body = {
                server: this.serverProfile,
                queries: batchQueries,
                database: this.databaseName
            };

            const response = await fetch(`${this.baseUrl}/v1/query/batch`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": this.apiKey
                },
                body: JSON.stringify(body)
            });

            const result = (await response.json()) as QueryResponse;
            if (!result.success) {
                logError("DB_TRANSACTION", `Transaction failed: ${result.error}`);
                return false;
            }
            return !!result.data?.transactionCommitted;
        } catch (e) {
            logError("DB_TRANSACTION", "Transaction request failed", e);
            return false;
        }
    }

    /**
     * Execute a query and return the first result only
     */
    public async queryOne<T = any>(sql: string, params?: any[] | Record<string, any>): Promise<T | null> {
        const results = await this.query<T>(sql, params);
        return results.length > 0 ? results[0] : null;
    }

    /**
     * Execute a query and return count
     */
    public async count(sql: string, params?: any[] | Record<string, any>): Promise<number> {
        const result = await this.queryOne<{ count: number }>(sql, params);
        return result?.count || 0;
    }
}
