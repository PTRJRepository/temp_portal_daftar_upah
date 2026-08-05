import { Database } from "../../db/client";
import { Config } from "../../config";
import type { HistoryHrEmployee, HistoryHrGang, HistoryGangMember } from "../../types/history/HistoryTypes";
import { error as logError } from "../../utils/logger";

const CATEGORY = "HrHistoryRepository";

export class HrHistoryRepository {
    private static instance: HrHistoryRepository;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE);
    }

    public static getInstance(): HrHistoryRepository {
        if (!HrHistoryRepository.instance) {
            HrHistoryRepository.instance = new HrHistoryRepository();
        }
        return HrHistoryRepository.instance;
    }

    public async saveEmployee(data: HistoryHrEmployee): Promise<void> {
        const cols = Object.keys(data).filter(k => (data as any)[k] !== undefined);
        await this.db.query(`INSERT INTO dbo.history_hr_employee (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(k => (data as any)[k]));
    }

    public async saveGang(data: HistoryHrGang): Promise<void> {
        const cols = Object.keys(data).filter(k => (data as any)[k] !== undefined);
        await this.db.query(`INSERT INTO dbo.history_hr_gang (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(k => (data as any)[k]));
    }

    public async saveGangMember(data: HistoryGangMember): Promise<void> {
        const cols = Object.keys(data).filter(k => (data as any)[k] !== undefined);
        await this.db.query(`INSERT INTO dbo.history_gang_member (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(k => (data as any)[k]));
    }
}

export const hrHistoryRepository = HrHistoryRepository.getInstance();
