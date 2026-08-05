
import { DataExtractorService } from './dataExtractorService';
import { Config } from './config';

async function verifyL1H() {
    const res = await DataExtractorService.getInstance().extractPayrollData(3, 2026, 'ALL', 'ALL', undefined, Config.DB_PROFILE, false, true);
    const l1hRows = res.data_rows.filter(r => r.gang_code?.trim() === 'L1H');
    
    const totalPphAll = l1hRows.reduce((s, r) => s + (Number(r.pph21_ter) || 0), 0);
    const totalPphActive = l1hRows.filter(r => (Number(r.jumlah_hk) || 0) > 0).reduce((s, r) => s + (Number(r.pph21_ter) || 0), 0);
    
    console.log(`Total L1H rows: ${l1hRows.length}`);
    console.log(`Total PPh All: ${totalPphAll}`);
    console.log(`Total PPh Active (HK > 0): ${totalPphActive}`);
    console.log(`Difference: ${totalPphAll - totalPphActive}`);
    
    l1hRows.filter(r => (Number(r.jumlah_hk) || 0) === 0 && Number(r.pph21_ter) > 0).forEach(r => {
        console.log(`Employee with PPh but HK=0: ${r.emp_code} | ${r.nama} | PPh: ${r.pph21_ter}`);
    });
}

verifyL1H().catch(console.error);
