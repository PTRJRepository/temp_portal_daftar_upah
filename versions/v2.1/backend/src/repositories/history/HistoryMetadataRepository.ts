import { Database } from "../../db/client";
import { Config } from "../../config";
import type { HistoryMetadata } from "../../types/history/HistoryTypes";

export class HistoryMetadataRepository {
    private static instance: HistoryMetadataRepository;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE);
    }

    public static getInstance(): HistoryMetadataRepository {
        if (!HistoryMetadataRepository.instance) {
            HistoryMetadataRepository.instance = new HistoryMetadataRepository();
        }
        return HistoryMetadataRepository.instance;
    }

    public async save(data: HistoryMetadata): Promise<void> {
        const cols = Object.keys(data).filter(k => (data as any)[k] !== undefined);
        const sql = `INSERT INTO dbo.history_metadata (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
        await this.db.query(sql, cols.map(k => (data as any)[k]));
    }
}

export const historyMetadataRepository = HistoryMetadataRepository.getInstance();
