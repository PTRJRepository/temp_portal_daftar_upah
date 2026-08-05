import { Database } from "../../db/client";
import { Config } from "../../config";
import type { HistoryTaskreg, HistoryAdtrans } from "../../types/history/HistoryTypes";
import { error as logError } from "../../utils/logger";

const CATEGORY = "TransactionHistoryRepository";

export class TransactionHistoryRepository {
    private static instance: TransactionHistoryRepository;
    private db: Database;

    private constructor() {
        // Transactions always use extend_db_ptrj_transaksi in history mode
        const dbName = Config.RUN_MODE === 'prod' ? Config.DB_EXTEND_TRANS_DATABASE : Config.DB_DATABASE;
        this.db = Database.getInstance(dbName, Config.DB_EXTEND_PROFILE);
    }

    public static getInstance(): TransactionHistoryRepository {
        if (!TransactionHistoryRepository.instance) {
            TransactionHistoryRepository.instance = new TransactionHistoryRepository();
        }
        return TransactionHistoryRepository.instance;
    }

    public async saveTaskreg(data: HistoryTaskreg): Promise<void> {
        const columns = Object.keys(data).filter(k => (data as any)[k] !== undefined);
        const sql = `INSERT INTO dbo.history_taskreg (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
        await this.db.query(sql, columns.map(k => (data as any)[k]));
    }

    public async saveAdtrans(data: HistoryAdtrans): Promise<void> {
        const columns = Object.keys(data).filter(k => (data as any)[k] !== undefined);
        const sql = `INSERT INTO dbo.history_adtrans (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
        await this.db.query(sql, columns.map(k => (data as any)[k]));
    }
}

export const transactionHistoryRepository = TransactionHistoryRepository.getInstance();
