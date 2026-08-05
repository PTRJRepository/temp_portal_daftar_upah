
import { Database } from "../db/client";

export class TunjanganService {

    static async initTable() {
        const db = Database.getExtendedInstance();
        try {
            await db.query(`
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='tunjangan_rate' AND TABLE_SCHEMA='dbo')
                BEGIN
                    CREATE TABLE tunjangan_rate (
                        id INT IDENTITY(1,1) PRIMARY KEY,
                        category VARCHAR(50) NOT NULL, -- e.g. 'JABATAN'
                        item_key VARCHAR(100) NOT NULL, -- e.g. 'Mandor'
                        rate DECIMAL(18, 2) DEFAULT 0,
                        updated_at DATETIME DEFAULT GETDATE(),
                        CONSTRAINT UQ_Tunjangan_Category_Key UNIQUE(category, item_key)
                    );
                END
            `);
            console.log("Verified 'tunjangan_rate' table.");
        } catch (e) {
            console.error("Failed to init 'tunjangan_rate' table:", e);
            throw e;
        }
    }

    static async seedJobTitleRates() {
        await this.initTable();
        const db = Database.getExtendedInstance();

        const rates = [
            { key: 'Mandor', rate: 3000 },
            { key: 'Kerani', rate: 3000 },
            { key: 'Helper', rate: 3000 },
            { key: 'Operator', rate: 3000 },
            { key: 'Supir', rate: 3000 },
            { key: 'Security', rate: 3000 },
            { key: 'Krani Buah', rate: 3000 },
            { key: 'Pemuat', rate: 3000 },
            { key: 'Karyawan', rate: 0 }
        ];

        try {
            for (const r of rates) {
                await db.query(`
                    MERGE INTO tunjangan_rate AS target
                    USING (SELECT 'JABATAN' AS category, ? AS item_key, ? AS rate) AS source
                    ON (target.category = source.category AND target.item_key = source.item_key)
                    WHEN MATCHED THEN
                        UPDATE SET rate = source.rate, updated_at = GETDATE()
                    WHEN NOT MATCHED THEN
                        INSERT (category, item_key, rate, updated_at)
                        VALUES (source.category, source.item_key, source.rate, GETDATE());
                `, [r.key, r.rate]);
            }
            console.log("Seeded 'JABATAN' rates.");
            return true;
        } catch (e) {
            console.error("Failed to seed rates:", e);
            throw e;
        }
    }

    static async getRates(category: string): Promise<Record<string, number>> {
        const db = Database.getExtendedInstance();
        try {
            const rows = await db.query<{ item_key: string, rate: number }>(`
                SELECT item_key, rate FROM tunjangan_rate WHERE category = ?
            `, [category]);

            const result: Record<string, number> = {};
            for (const r of rows) {
                result[r.item_key] = r.rate;
            }
            return result;
        } catch (e) {
            console.error(`Failed to get rates for ${category}:`, e);
            return {};
        }
    }
}
