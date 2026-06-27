# LAPORAN AUDIT INVESTIGASI SISTEM PAYROLL
## PT Rebinmas Daftar Upah Portal

**Tanggal Investigasi:** 2026-06-05  
**Auditor:** Claude Code - Senior Software Engineer, Payroll System Auditor, Database Analyst, Code Quality Reviewer  
**Versi:**1.0

---

## 1. EXECUTIVE SUMMARY

### Kualitas Umum
Sistem payroll ini memiliki fondasi yang cukup solid dengan pemisahan concern yang jelas antara:
- Backend (Bun + Elysia) untuk logic bisnis dan API
- Frontend (React + Vite) untuk UI
- Database layer menggunakan SQL Gateway untuk akses MSSQL

**Strengths (Kekuatan):**
1. `PayrollCalculator` - centralized calculation engine dengan formula yang terdokumentasi dengan baik
2. Modular service structure dengan singleton pattern
3. Adanya test suite untuk komponen kritis
4. Audit trail mechanism melalui `sync_status` dan `remarks` field
5. Separation of concerns antara data extraction, calculation, dan presentation

**Kelemahan Umum:**
1. **Data consistency enforcement** - tidak ada database constraint yang kuat
2. **Transaction handling** - sebagian besar write operations tidak menggunakan transaction
3. **Audit logging** - belum ada dedicated audit log table
4. **Error handling** - sebagian besar try-catch block terlalu generic
5. **Code organization** - beberapa file terlalu besar (>2000 lines)

### Risiko Utama
| Risiko | Severity | Probability | Impact |
|--------|----------|-------------|--------|
| Amount vs metadata_json mismatch | HIGH | MEDIUM | Data payroll tidak akurat |
| Double calculation / double deduction | HIGH | LOW | Karyawan underpaid/overpaid |
| Race condition pada save operations | MEDIUM | MEDIUM | Data corruption |
| SQL injection pada dynamic queries | MEDIUM | LOW | Data breach |
| Missing audit trail | HIGH | HIGH | Tidak bisa track perubahan |

### Area Paling Berbahaya
1. **Manual Adjustment System** - tidak ada validasi amount vs metadata_json total
2. **DataExtractorService** (266KB+) - single file terlalu besar, single point of failure
3. **PayrollCalculator integration** - ada duplikasi formula antara backend dan frontend
4. **Excel Import** - tidak ada duplicate check sebelum insert

### Prioritas Perbaikan
1. **Immediate (1-7 hari):** Fix metadata_json sync validation
2. **Short-term (2-4 minggu):** Refactor dataExtractorService, add transaction support
3. **Medium-term (1-2 bulan):** Implement audit log, enhance validation layer
4. **Long-term (3+ bulan):** Full modularization, performance optimization

---

## 2. CRITICAL BUGS

### BUG-001: Metadata JSON Total Tidak Sinkron dengan Amount
| Field | Value |
|-------|-------|
| **File/Lokasi** | `backend/src/services/manualAdjustmentService.ts:458-478` |
| **Severity** | CRITICAL |
| **Dampak** | amount di database tidak match dengan total detail di metadata_json |
| **Skenario** | User edit PREMI PRUNING via popup, masukkan 3 subblok dengan jumlah 1000, 2000, 1500. Total metadata = 4500. Tapi amount field tidak diupdate otomatis. |

**Kode Bermasalah:**
```typescript
function resolveDetailTotalSync(data: ManualAdjustment, normalizedAdjustmentName: string, metadataJsonStr: string | null, fallbackAmount: number): { amount: number; metadataJsonStr: string | null } {
    if (String(data.adjustment_type || "").trim().toUpperCase() !== "PREMI") return { amount: fallbackAmount, metadataJsonStr };
    if (!DETAIL_TOTAL_SYNC_PREMI_NAMES.has(normalizedAdjustmentName)) return { amount: fallbackAmount, metadataJsonStr };
    // ...
 const calculatedTotal = calculateManualAdjustmentMetadataTotal(metadata);
    let syncedAmount = fallbackAmount;
    if (Number.isFinite(calculatedTotal) && Math.abs(calculatedTotal) > 0.01) {
        syncedAmount = calculatedTotal;
    }
    // ⚠️ PROBLEM: syncedAmount tidak digunakan jika fallbackAmount adalah 0
    return { amount: syncedAmount, metadataJsonStr: JSON.stringify({ ...(metadata as any), total_amount: syncedAmount }) };
}
```

**Rekomendasi Fix:**
```typescript
// Pastikan amount SELALU di-sync dengan metadata total
function resolveDetailTotalSync(data: ManualAdjustment, ...): { amount: number; metadataJsonStr: string | null } {
    const calculatedTotal = calculateManualAdjustmentMetadataTotal(metadata);
    // ⚠️ WAJIB: amount harus selalu = calculatedTotal untuk detail premi
    return { 
        amount: calculatedTotal,  // <- bukan fallbackAmount
        metadataJsonStr: JSON.stringify({ ...metadata, total_amount: calculatedTotal }) 
    };
}
```

---

### BUG-002: Duplicate Employee Mapping Issue
| Field | Value |
|-------|-------|
| **File/Lokasi** | `backend/src/services/employeeIdentityResolverService.ts` |
| **Severity** | HIGH |
| **Dampak** | Karyawan salah di-map, payroll goes to wrong person |
| **Skenario** | NIK duplikat di database (misalnya 2 employee dengan NIK sama tapi berbeda emp_code). Payroll extraction mengambil yang salah. |

**Status:** Sudah ada `DuplicateNikMitigationService` untuk mitigate issue ini. Perlu di-audit apakah semua flow sudah menggunakan service ini.

---

### BUG-003: No Transaction on Multi-Statement Operations
| Field | Value |
|-------|-------|
| **File/Lokasi** | `backend/src/services/manualAdjustmentService.ts:2228-2245` |
| **Severity** | HIGH |
| **Dampak** | Partial update jika salah satu statement gagal |
| **Skenario** | User save manual adjustment - INSERT berhasil tapi UPDATE gagal. Database dalam kondisi inconsistent. |

**Kode Bermasalah:**
```typescript
// Upsert dilakukan dengan 2 statement terpisah tanpa transaction
const insertSql = `INSERT INTO dbo.payroll_manual_adjustments (...) VALUES (...)`;
const updateSql = `UPDATE dbo.payroll_manual_adjustments SET ... WHERE id = ?`;
// ⚠️ PROBLEM: Tidak ada transaction wrapper
```

**Rekomendasi Fix:**
```typescript
await this.db.transaction([
    { sql: updateSql, params: updateParams },
    { sql: insertSql, params: insertParams }
]);
```

---

### BUG-004: Frontend-Backend Formula Duplication
| Field | Value |
|-------|-------|
| **File/Lokasi** | `frontend/src/pages/Report.jsx` vs `backend/src/services/payroll/components/PayrollCalculator.ts` |
| **Severity** | MEDIUM |
| **Dampak** | Potential mismatch antara web report dan print out |
| **Skenario** | PayrollCalculator di backend diupdate tapi frontend Report.jsx tidak. Total gaji berbeda antara web dan print. |

**Status:** Sudah ada `payrollTotalsCalculator.ts` di backend yang mereplikasi exact frontend logic. Tapi perlu verification bahwa semua totals match.

---

### BUG-005: Hardcoded Database Profile in Queries
| Field | Value |
|-------|-------|
| **File/Lokasi** | Multiple services |
| **Severity** | MEDIUM |
| **Dampak** | Query salah database, data tidak konsisten |
| **Skenario** | Query payroll menggunakan `SERVER_PROFILE_2` tapi seharusnya `SERVER_PROFILE_1` untuk history. |

**Contoh:**
```typescript
// di manualAdjustmentService.ts:338-339
const histDb = Database.getExtendedInstance(); //SERVER_PROFILE_1
// vs
const db = Database.getInstance(); //SERVER_PROFILE_2 (default)
```

---

## 3. DATA CONSISTENCY ISSUES

### ISSUE-001: Amount vs Metadata JSON Mismatch
| Aspek | Detail |
|-------|--------|
| **Tabel/Field** | `payroll_manual_adjustments.amount` vs `payroll_manual_adjustments.metadata_json` |
| **Logic Terkait** | `resolveDetailTotalSync()`, `calculateManualAdjustmentMetadataTotal()` |
| **Risiko** | Selisih payroll karena total detail tidak match dengan amount |
| **Validasi** | Belum ada automated validation |

**Query Pengecekan:**
```sql
-- Cek amount vs metadata_json total mismatch
SELECT 
    id, emp_code, adjustment_name, amount,
    metadata_json,
    CASE 
        WHEN metadata_json IS NOT NULL 
        THEN JSON_VALUE(metadata_json, '$.total_amount')
 END AS metadata_total,
    CASE 
        WHEN metadata_json IS NOT NULL 
        THEN JSON_VALUE(metadata_json, '$.total_amount')
    END - amount AS diff
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE JSON_VALUE(metadata_json, '$.total_amount') IS NOT NULL
 AND JSON_VALUE(metadata_json, '$.total_amount') <> amount
    AND adjustment_type = 'PREMI'
ORDER BY diff DESC;
```

**Cara Memperbaiki:**
1. Add trigger di database untuk validasi
2. Add validation di service layer sebelum save
3. Add scheduled job untuk auto-sync

---

### ISSUE-002: Duplicate Employee in Same Payroll Period
| Aspek | Detail |
|-------|--------|
| **Tabel/Field** | `payroll_manual_adjustments` dengan period + emp_code |
| **Logic Terkait** | `saveAdjustment()` upsert logic |
| **Risiko** | Double adjustment untuk employee yang sama |
| **Validasi** | Cek dengan query di bawah |

**Query Pengecekan:**
```sql
-- Cek duplicate employee dalam periode yang sama
SELECT 
    period_month, period_year, emp_code, adjustment_name,
    COUNT(*) as cnt,
    SUM(amount) as total_amount
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
GROUP BY period_month, period_year, emp_code, adjustment_name
HAVING COUNT(*) > 1
ORDER BY cnt DESC;
```

---

### ISSUE-003: Invalid Metadata JSON Format
| Aspek | Detail |
|-------|--------|
| **Tabel/Field** | `payroll_manual_adjustments.metadata_json` |
| **Logic Terkait** | `parseManualAdjustmentMetadata()` |
| **Risiko** | Parse error, data tidak bisa diproses |
| **Validasi** | Perlu check JSON validity |

**Query Pengecekan:**
```sql
-- Cek invalid JSON
SELECT id, emp_code, metadata_json
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL
    AND LEN(metadata_json) > 0
    AND TRY_CAST(metadata_json AS JSON) IS NULL;
```

---

### ISSUE-004: Employee Not in Master Table
| Aspek | Detail |
|-------|--------|
| **Tabel/Field** | `payroll_manual_adjustments.emp_code` vs `HR_EMPLOYEE.EmpCode` |
| **Logic Terkait** | Employee resolution services |
| **Risiko** | Orphan adjustment records |

**Query Pengecekan:**
```sql
-- Cek emp_code tidak ada di master
SELECT DISTINCT ma.emp_code, ma.period_month, ma.period_year
FROM extend_db_ptrj.dbo.payroll_manual_adjustments ma
LEFT JOIN db_ptrj.dbo.HR_EMPLOYEE e ON RTRIM(e.EmpCode) = RTRIM(ma.emp_code)
WHERE e.EmpCode IS NULL
    AND ma.emp_code IS NOT NULL
ORDER BY ma.period_year DESC, ma.period_month DESC;
```

---

### ISSUE-005: Period Cross-Contamination
| Aspek | Detail |
|-------|--------|
| **Tabel/Field** | Semua tabel payroll dengan period_month/year |
| **Logic Terkait** | Filter logic di semua service |
| **Risiko** | Data bulan lain tercampur |

**Query Pengecekan:**
```sql
-- Cek data dengan period tidak valid
SELECT id, emp_code, period_month, period_year, adjustment_name
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE period_month < 1 OR period_month > 12
    OR period_year < 2000 OR period_year > 2100;
```

---

## 4. CODE QUALITY REVIEW

### 4.1 Modularitas

**Masalah:**
| File | Lines | Issue |
|------|-------|-------|
| `dataExtractorService.ts` | 266KB+ | Terlalu besar, single point of failure |
| `payroll.ts` (API) | 3359 lines | Terlalu banyak route dalam satu file |
| `CustomPayrollTable.jsx` | 2600+ lines | Frontend component terlalu besar |

**Rekomendasi Struktur Folder Baru:**
```
backend/src/
├── modules/
│   ├── payroll/
│   │   ├── controller/ # payroll.ts routes
│   │   ├── service/ # PayrollCalculator, PayrollService
│   │   ├── repository/       # Data access layer
│   │   ├── validator/        # Input validation
│   │   ├── dto/              # Request/Response types
│   │   └── types/            # Internal types
│   ├── adjustment/
│   │   ├── controller/
│   │   ├── service/
│   │   ├── repository/
│   │   └── validator/
│   ├── employee/
│   ├── gang/
│   ├── division/
│   ├── audit/
│   │   ├── AuditLogService.ts
│   │   ├── AuditLogRepository.ts
│   │   └── types/
│   └── report/
├── services/ # Shared services (non-payroll specific)
├── repositories/             # Shared repositories
└── utils/
```

---

### 4.2 Duplikasi Logic

**Found Duplications:**

1. **Payroll Calculation Formula**
   - Backend: `PayrollCalculator.ts`
   - Frontend: `Report.jsx`, `PayrollAggregator.js`
   - **Risk:** Mismatch antara backend calculation dan frontend display

2. **Total Calculation**
   - Backend: `payrollTotalsCalculator.ts`
   - Frontend: `Report.jsx` (calculateTotalRow)
   - **Risk:** Same as above

3. **Employee Identity Resolution**
   - Multiple services tanpa clear hierarchy
   - `employeeIdentityResolverService.ts`
   - `DuplicateNikMitigationService.ts`
   - `NikToNewestEmpCodeService.ts`

---

### 4.3 Naming Issues

| Current | Recommended | Reason |
|---------|-------------|--------|
| `adjustment_type` | `category` atau pertahankan `adjustment_type` | Sudah too late to change |
| `metadata_json` | `detail_metadata` | Lebih descriptive |
| `DETAIL_TOTAL_SYNC_PREMI_NAMES` | `PREMI_WITH_DETAIL_SYNC` | Naming convention consistency |
| `AUTO_BUFFER` | `SYSTEM_ADJUSTMENT` | Lebih clear purpose |

---

### 4.4 File/Fungsi Terlalu Besar

**Need Refactoring:**

1. **`dataExtractorService.ts`**
   - Pecah jadi: `AttendanceExtractor`, `PremiumExtractor`, `DeductionExtractor`, dll
   - Already started: `extractors/` folder exists

2. **`manualAdjustmentService.ts`**
   - Pecah jadi service terpisah per concern
   - `AdjustmentQueryService`, `AdjustmentSaveService`, `AdjustmentValidationService`

3. **`CustomPayrollTable.jsx`**
   - Pecah jadi: `PayrollTable`, `PayrollCell`, `PayrollHeader`, `PayrollToolbar`, dll

---

## 5. DATABASE REVIEW

### 5.1 Tabel Bermasalah

| Tabel | Issue | Rekomendasi |
|-------|-------|--------------|
| `payroll_manual_adjustments` | Tidak ada unique constraint di (period, emp_code, adjustment_name) | Add UNIQUE constraint |
| `payroll_manual_adjustments` | metadata_json tidak ada CHECK constraint untuk valid JSON | Add CHECK constraint |
| `payroll_history_header` | Tidak ada index di (period_month, period_year, division_code) | Add composite index |

### 5.2 Index Kurang

```sql
-- Recommended indexes untuk payroll_manual_adjustments
CREATE INDEX IX_payroll_manual_adjustments_period_emp 
ON dbo.payroll_manual_adjustments (period_month, period_year, emp_code);

CREATE INDEX IX_payroll_manual_adjustments_period_gang
ON dbo.payroll_manual_adjustments (period_month, period_year, gang_code);

CREATE INDEX IX_payroll_manual_adjustments_period_div
ON dbo.payroll_manual_adjustments (period_month, period_year, division_code);

-- Unique constraint untuk prevent duplicate
CREATE UNIQUE INDEX UX_payroll_manual_adjustments_period_emp_adj
ON dbo.payroll_manual_adjustments (period_month, period_year, emp_code, adjustment_name, gang_code)
WHERE id IS NOT NULL;
```

### 5.3 Query Berisiko

**Dynamic SQL tanpa parameterized queries:**
```typescript
// ⚠️ RISK: LIKE query dengan string concatenation
const query = `WHERE ${cond.sql} AND t.DocDesc LIKE '%${filter}%'`;

// ✅ RECOMMENDED: Use parameterized queries
const query = `WHERE ${cond.sql} AND t.DocDesc LIKE @filter`;
```

**Missing transaction wrapper:**
```typescript
// ⚠️ RISK: Multiple writes tanpa transaction
await db.query(insertSql, params);
await db.query(updateSql, params);
await db.query(deleteSql, params);

// ✅ RECOMMENDED: Wrap in transaction
await db.transaction([
    { sql: insertSql, params },
    { sql: updateSql, params },
    { sql: deleteSql, params }
]);
```

---

## 6. PAYROLL LOGIC REVIEW

### 6.1 Formula yang Perlu Dikunci

**PayrollCalculator.ts** sudah mendokumentasikan formula dengan baik:
```typescript
// UPAH KOTOR = gaji_pokok + total_tunjangan + total_premi
// JUMLAH UPAH KOTOR = UPAH KOTOR - pot_koreksi + pendapatan_lainnya
// TOTAL POTONGAN = astek + bpjs_kes + bpjs_pensiun + spsi + pph21 + other + pendapatan_lainnya
// UPAH BERSIH = jumlah_upah_kotor - total_potongan + premi_pph
```

**Critical Rules:**
1. ⚠️ **koreksi TIDAK masuk total_potongan** - sudah di-subtract di jumlah_upah_kotor
2. ⚠️ **pendapatan_lainnya WAJIB masuk total_potongan** - karena di-add di jumlah_upah_kotor
3. ⚠️ **premi_pph adalah ADDITION** - bukan deduction

### 6.2 Bagian Ambigu

| Location | Issue |
|----------|-------|
| `PayrollCalculator.ts:216` | `require()` inside static method - potential issue di ESM context |
| `dataExtractorService.ts` | Logic spread di266KB+ - sulit trace flow |
| `manualAdjustmentApplier.ts:106-112` | Metadata parsing tidak ada error handling |

### 6.3 Double Calculation Risk

**Found:**
```typescript
// ⚠️ DIFF: di komponen_potongan.subtotal, lainnya di-add
komponen_potongan.subtotal =
    komponen_potongan.astek +
    komponen_potongan.bpjs_kes +
    // ...
    komponen_potongan.lainnya;  // <- pendapatan_lainnya di-add di sini

// ⚠️ DOUBLE: di total_potongan juga pendapatan_lainnya di-subtract
// UPAH BERSIH = jumlah_upah_kotor - total_potongan + premi_pph
// dimana: total_potongan SUDAH termasuk pendapatan_lainnya
```

**Verification needed:** Apakah ini sudah benar di PayrollCalculator atau ada double-counting?

---

## 7. SECURITY REVIEW

### 7.1 SQL Injection

**Status:** ⚠️ MEDIUM RISK

**Mitigations in place:**
- Parameterized queries (`?` placeholders)
- SQL Gateway abstracts direct SQL access

**Potential issues:**
```typescript
// ⚠️ LIKE query dengan pattern langsung di SQL
WHERE UPPER(t.DocDesc) LIKE 'PREMI%'

// ✅ Sudah aman karena static pattern
```

### 7.2 API Authentication

**Status:** ✅ GOOD

- API Key bypass untuk automation (`Config.API_KEY_BYPASS`)
- JWT token untuk UI users
- Role-based access control (`UserRole.ADMIN`, `UserRole.KERANI`)

### 7.3 Exposure Data

**Issues found:**
```typescript
// ⚠️ Console.log sensitive data
console.log(`[manual-edit] Incoming payload:`, JSON.stringify({
    nik: data.nik,  // ⚠️ PII exposure
    emp_code: data.emp_code,
    amount: data.amount
}));
```

**Recommendation:** Sanitize logging - jangan log NIK/password/sensitive data

### 7.4 File Upload

**Status:** ⚠️ NEEDS REVIEW

Excel import validation perlu dicek:
- File type validation
- Max file size
- Content sanitization
- Duplicate detection

---

## 8. AUDITABILITY REVIEW

### 8.1 Current Audit Mechanism

**What exists:**
| Field | Table | Purpose |
|-------|-------|---------|
| `created_at` | payroll_manual_adjustments | Track creation time |
| `created_by` | payroll_manual_adjustments | Track creator |
| `updated_at` | payroll_manual_adjustments | Track last update |
| `updated_by` | payroll_manual_adjustments | Track last updater |
| `sync_status` | payroll_manual_adjustments | Track ADTRANS sync status |
| `remarks` | payroll_manual_adjustments | Pipe-delimited audit info |

### 8.2 Missing Audit Features

| Feature | Status | Recommendation |
|---------|--------|----------------|
| Before/After value tracking | ❌ MISSING | Add to audit log |
| Action type (CREATE/UPDATE/DELETE) | ⚠️ PARTIAL | Extend remarks format |
| Source file for imports | ❌ MISSING | Add import_batch_id |
| Payroll locking | ⚠️ PARTIAL | `is_locked` di history_header |
| Approval workflow | ❌ MISSING | Need workflow system |

### 8.3 Recommended Audit Log Table

```sql
CREATE TABLE dbo.payroll_audit_log (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    action_type NVARCHAR(50) NOT NULL,  -- CREATE, UPDATE, DELETE, RECALCULATE, IMPORT, EXPORT, PRINT
    table_name NVARCHAR(100) NOT NULL,
    record_id BIGINT NULL,
    period_month INT NULL,
    period_year INT NULL,
    emp_code NVARCHAR(50) NULL,
    gang_code NVARCHAR(50) NULL,
    division_code NVARCHAR(50) NULL,
    field_name NVARCHAR(100) NULL,
    before_value NVARCHAR(MAX) NULL,
    after_value NVARCHAR(MAX) NULL,
    change_reason NVARCHAR(500) NULL,
    source_file NVARCHAR(255) NULL,
    import_batch_id NVARCHAR(50) NULL,
    created_by NVARCHAR(100) NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    client_ip NVARCHAR(50) NULL,
    user_agent NVARCHAR(255) NULL,
    
    CONSTRAINT CHK_action_type CHECK (action_type IN ('CREATE', 'UPDATE', 'DELETE', 'RECALCULATE', 'IMPORT', 'EXPORT', 'PRINT', 'LOCK', 'UNLOCK'))
);

CREATE INDEX IX_payroll_audit_log_period ON dbo.payroll_audit_log (period_year, period_month);
CREATE INDEX IX_payroll_audit_log_emp ON dbo.payayroll_audit_log (emp_code);
CREATE INDEX IX_payroll_audit_log_created ON dbo.payroll_audit_log (created_at);
```

---

## 9. REFACTORING PLAN

### Phase 1: Stabilization (1-2 minggu)
**Tujuan:** Fix critical bugs dan stabilize existing functionality

| Task | File | Priority | Risk |
|------|------|----------|------|
| Fix metadata_json sync | manualAdjustmentService.ts | CRITICAL | LOW |
| Add transaction wrapper | manualAdjustmentService.ts | HIGH | MEDIUM |
| Add validation layer | semua service | HIGH | MEDIUM |
| Sanitize logging | semua file | MEDIUM | LOW |

### Phase 2: Data Consistency Enforcement (2-4 minggu)
**Tujuan:** Ensure data integrity dengan database constraints

| Task | File | Priority | Risk |
|------|------|----------|------|
| Add unique constraint | DB migration | HIGH | HIGH |
| Add JSON validation | DB migration | HIGH | LOW |
| Add indexes | DB migration | MEDIUM | LOW |
| Create validation service | backend/src/services/validation/ | HIGH | MEDIUM |

### Phase 3: Modularization (1-2 bulan)
**Tujuan:** Pecah file besar jadi modul-modul terpisah

| Task | File | Priority | Risk |
|------|------|----------|------|
| Pecah dataExtractorService | extractors/ | HIGH | HIGH |
| Pecah manualAdjustmentService | modules/adjustment/ | HIGH | HIGH |
| Pecah CustomPayrollTable | components/ | MEDIUM | MEDIUM |
| Create dedicated payroll module | modules/payroll/ | MEDIUM | MEDIUM |

### Phase 4: Audit& Security (1-2 bulan)
**Tujuan:** Enhance audit trail dan security

| Task | File | Priority | Risk |
|------|------|----------|------|
| Create audit log table | DB migration | HIGH | MEDIUM |
| Implement audit service | audit/AuditLogService.ts | HIGH | MEDIUM |
| Add audit logging to writes | semua write operations | HIGH | MEDIUM |
| Enhance RBAC | auth services | MEDIUM | LOW |

### Phase 5: Testing & Monitoring (ongoing)
**Tujuan:** Ensure reliability dengan comprehensive testing

| Task | Priority | Risk |
|------|----------|------|
| Unit tests untuk PayrollCalculator | CRITICAL | LOW |
| Integration tests untuk API | HIGH | MEDIUM |
| Metadata consistency tests | HIGH | LOW |
| Report total verification tests | HIGH | LOW |
| Performance monitoring | MEDIUM | LOW |

---

## 10. RECOMMENDED ARCHITECTURE

### 10.1 Folder Structure

```
portal-daftar-upah-services/
├── backend/
│   └── src/
│       ├── modules/
│       │   ├── payroll/
│       │   │   ├── controller/
│       │   │   │   └── payrollRoutes.ts
│       │   │   ├── service/
│       │   │   │   ├── PayrollService.ts
│       │   │   │   ├── PayrollCalculator.ts
│       │   │   │   └── PayrollValidator.ts
│       │   │   ├── repository/
│       │   │   │   └── PayrollRepository.ts
│       │   │   ├── dto/
│       │   │   │   ├── PayrollRequest.ts
│       │   │   │   └── PayrollResponse.ts
│       │   │   └── types/
│       │   │       └── index.ts
│       │   ├── adjustment/
│       │   │   ├── controller/
│       │   │   ├── service/
│       │   │   ├── repository/
│       │   │   └── validator/
│       │   ├── employee/
│       │   ├── audit/
│       │   │   ├── AuditLogService.ts
│       │   │   ├── AuditLogRepository.ts
│       │   │   └── types/
│       │   └── report/
│       ├── services/           # Shared services
│       ├── repositories/       # Shared repositories
│       ├── utils/
│       └── types/
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── payroll/
│       │   │   ├── PayrollTable/
│       │   │   ├── PayrollCell/
│       │   │   ├── PayrollHeader/
│       │   │   └── PayrollToolbar/
│       │   └── common/
│       ├── pages/
│       ├── services/
│       └── utils/
└── dokumentasi/
    └── debugging/
```

### 10.2 Service Pattern

```typescript
// Pattern untuk semua service
export class PayrollService {
    private static instance: PayrollService;
    private repository: PayrollRepository;
    private validator: PayrollValidator;
    private auditService: AuditLogService;
    
    private constructor() {
        this.repository = new PayrollRepository();
        this.validator = new PayrollValidator();
        this.auditService = AuditLogService.getInstance();
    }
    
    public static getInstance(): PayrollService {
        if (!PayrollService.instance) {
            PayrollService.instance = new PayrollService();
        }
        return PayrollService.instance;
    }
    
    public async calculatePayroll(input: PayrollInput): Promise<PayrollResult> {
        // 1. Validate input
        this.validator.validate(input);
        
        // 2. Calculate
        const result = PayrollCalculator.calculate(input);
        
        // 3. Audit log
        await this.auditService.log({
            action: 'CALCULATE',
            empCode: input.empCode,
            result: result
        });
        
        return result;
    }
}
```

### 10.3 Repository Pattern

```typescript
export class PayrollRepository {
    private db: Database;
    
    constructor() {
        this.db = Database.getInstance();
    }
    
    public async findByPeriod(month: number, year: number): Promise<PayrollRow[]> {
        return this.db.query(
            `SELECT * FROM payroll_data WHERE period_month = ? AND period_year = ?`,
            [month, year]
        );
    }
    
    public async saveWithAudit(data: PayrollData, user: string): Promise<void> {
        await this.db.transaction([
            { sql: 'INSERT INTO payroll_data (...) VALUES (...)', params: [...] },
            { sql: 'INSERT INTO audit_log (...) VALUES (...)', params: [...] }
        ]);
    }
}
```

---

## 11. ACTIONABLE FIXES

### FIX-001: Metadata JSON Sync Validation
**File:** `backend/src/services/manualAdjustmentService.ts`  
**Line:** ~458-478

**Masalah:** `fallbackAmount` digunakan padahal seharusnya `calculatedTotal`

**Patch:**
```typescript
function resolveDetailTotalSync(data: ManualAdjustment, normalizedAdjustmentName: string, metadataJsonStr: string | null, fallbackAmount: number): { amount: number; metadataJsonStr: string | null } {
    if (String(data.adjustment_type || "").trim().toUpperCase() !== "PREMI") {
        return { amount: fallbackAmount, metadataJsonStr };
    }
    if (!DETAIL_TOTAL_SYNC_PREMI_NAMES.has(normalizedAdjustmentName)) {
        return { amount: fallbackAmount, metadataJsonStr };
    }

    const metadata = premiumDefinitionService.parseMetadata(metadataJsonStr);
    if (!metadata || metadata.input_type === "amount") {
        return { amount: fallbackAmount, metadataJsonStr };
    }

    const calculatedTotal = calculateManualAdjustmentMetadataTotal(metadata);
    
    // ✅ FIX: Selalu gunakan calculatedTotal untuk detail premi
    return {
        amount: calculatedTotal,  // <- Ubah dari syncedAmount/fallbackAmount
        metadataJsonStr: JSON.stringify({ 
            ...(metadata as any), 
            total_amount: calculatedTotal 
        })
    };
}
```

---

### FIX-002: Add Transaction Wrapper
**File:** `backend/src/services/manualAdjustmentService.ts`  
**Line:** ~2228-2245

**Masalah:** Upsert dilakukan tanpa transaction

**Patch:**
```typescript
// Di dalam saveAdjustment()
const queries = [];

// Build update query
if (existingId) {
    queries.push({
        sql: `UPDATE dbo.payroll_manual_adjustments SET 
            amount = ?, remarks = ?, metadata_json = ?, updated_at = GETDATE(), updated_by = ?
            WHERE id = ?`,
        params: [finalAmount, remarks, metadataJsonStr, username, existingId]
    });
} else {
    queries.push({
        sql: `INSERT INTO dbo.payroll_manual_adjustments 
            (period_month, period_year, emp_code, nik, emp_name, gang_code, division_code,
             adjustment_type, adjustment_name, amount, remarks, metadata_json, ad_code, 
             task_code, base_task_code, task_desc, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE())`,
        params: [/* ... all fields ... */]
    });
}

// ✅ FIX: Execute dalam transaction
await this.db.transaction(queries);
```

---

### FIX-003: Add Input Validation
**File:** `backend/src/services/manualAdjustmentService.ts`  
**Tambah baru:** Validation function

**Patch:**
```typescript
function validateManualAdjustmentInput(data: ManualAdjustment): void {
    // Period validation
    if (!Number.isInteger(data.period_month) || data.period_month < 1 || data.period_month > 12) {
        throw new Error('period_month harus 1-12');
    }
    if (!Number.isInteger(data.period_year) || data.period_year < 2000) {
        throw new Error('period_year tidak valid');
    }
    
    // Amount validation
    if (!Number.isFinite(data.amount)) {
        throw new Error('amount harus number valid');
    }
    
    // Metadata JSON validation
    if (data.metadata_json) {
        try {
            const parsed = JSON.parse(data.metadata_json);
            if (parsed.items && Array.isArray(parsed.items)) {
                const sum = parsed.items.reduce((s, item) => s + (Number(item.jumlah) || 0), 0);
                if (Math.abs(sum - data.amount) > 0.01) {
                    console.warn(`[Validation] Amount mismatch: ${data.amount} vs metadata sum: ${sum}`);
                }
            }
        } catch (e) {
            throw new Error('metadata_json format tidak valid');
        }
    }
    
    // Employee code validation
    if (!data.emp_code || !data.emp_code.trim()) {
        throw new Error('emp_code wajib diisi');
    }
}
```

---

### FIX-004: Sanitize Logging
**File:** `backend/src/api/payroll.ts`  
**Line:** ~556-566

**Patch:**
```typescript
// ⚠️ BEFORE: Log sensitive data
console.log(`[manual-edit] Incoming payload:`, JSON.stringify({
    nik: data.nik,  // ⚠️ PII
    emp_code: data.emp_code,
    amount: data.amount
}));

// ✅ AFTER: Sanitized logging
console.log(`[manual-edit] Incoming payload:`, JSON.stringify({
    period: `${data.period_month}/${data.period_year}`,
    emp_code: data.emp_code,  // emp_code OK to log
    adjustment_type: data.adjustment_type,
    adjustment_name: data.adjustment_name,
    // amount OK to log
    has_metadata: !!data.metadata_json
 // nik removed - PII
}));
```

---

## 12. SQL CHECKLIST

### 12.1 Amount vs Metadata JSON Mismatch
```sql
-- Cek amount tidak sama dengan total metadata_json.items
SELECT 
    ma.id,
    ma.period_month,
    ma.period_year,
    ma.emp_code,
    ma.adjustment_name,
    ma.amount AS stored_amount,
    JSON_VALUE(ma.metadata_json, '$.total_amount') AS metadata_total,
    ma.amount - TRY_CAST(JSON_VALUE(ma.metadata_json, '$.total_amount') AS DECIMAL(18,2)) AS diff
FROM extend_db_ptrj.dbo.payroll_manual_adjustments ma
WHERE ma.metadata_json IS NOT NULL
    AND TRY_CAST(JSON_VALUE(ma.metadata_json, '$.total_amount') AS DECIMAL(18,2)) IS NOT NULL
    AND ABS(ma.amount - TRY_CAST(JSON_VALUE(ma.metadata_json, '$.total_amount') AS DECIMAL(18,2))) > 0.01
ORDER BY diff DESC;
```

### 12.2 Duplicate Employee Payroll Item
```sql
-- Cek duplicate employee dalam periode yang sama
SELECT 
    period_month,
    period_year,
    emp_code,
    gang_code,
    adjustment_name,
    COUNT(*) AS duplicate_count,
    SUM(amount) AS total_amount
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE period_month BETWEEN 1 AND 12
    AND period_year >= 2020
GROUP BY period_month, period_year, emp_code, gang_code, adjustment_name
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;
```

### 12.3 Employee Not in Master
```sql
-- Cek emp_code tidak ada di master employee
SELECT DISTINCT
    ma.emp_code,
    ma.period_month,
    ma.period_year,
    ma.adjustment_name
FROM extend_db_ptrj.dbo.payroll_manual_adjustments ma
LEFT JOIN db_ptrj.dbo.HR_EMPLOYEE e 
    ON RTRIM(e.EmpCode) = RTRIM(ma.emp_code)
WHERE e.EmpCode IS NULL
    AND ma.emp_code IS NOT NULL
    AND ma.emp_code <> ''
ORDER BY ma.period_year DESC, ma.period_month DESC;
```

### 12.4 Invalid Metadata JSON
```sql
-- Cek metadata_json invalid
SELECT 
    id,
    emp_code,
    adjustment_name,
    metadata_json
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL
    AND LEN(metadata_json) > 0
    AND TRY_CAST(metadata_json AS JSON) IS NULL;
```

### 12.5 Period Empty/Invalid
```sql
-- Cek period kosong atau tidak valid
SELECT 
    id,
    emp_code,
    period_month,
    period_year,
    adjustment_name
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE period_month IS NULL 
    OR period_month < 1 
    OR period_month > 12
    OR period_year IS NULL
    OR period_year < 2000
    OR period_year > 2100;
```

### 12.6 Amount Null
```sql
-- Cek amount null atau tidak valid
SELECT 
    id,
    emp_code,
    period_month,
    period_year,
    adjustment_name,
    amount
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE amount IS NULL
    OR NOT NumberIsValid(amount)  -- depends on DB
    OR amount < 0;  -- adjust if negative is valid
```

### 12.7 Cross-Period Data Contamination
```sql
-- Cek data payroll yang span multiple months
SELECT 
    emp_code,
    gang_code,
    COUNT(DISTINCT period_month) AS month_count,
    MIN(period_year * 100 + period_month) AS min_period,
    MAX(period_year * 100 + period_month) AS max_period
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE adjustment_type = 'PREMI'
GROUP BY emp_code, gang_code
HAVING COUNT(DISTINCT period_month) > 1
ORDER BY month_count DESC;
```

### 12.8 Report vs Source Table Comparison
```sql
-- Compare total from adjustment table vs PR_ADTRANS
SELECT 
    ma.adjustment_name,
    ma.period_month,
    ma.period_year,
    SUM(ma.amount) AS adjustment_total,
    (SELECT SUM(ln.Amount) 
     FROM db_ptrj.dbo.PR_ADTRANS adt
     JOIN db_ptrj.dbo.PR_ADTRANSLN ln ON adt.ID = ln.MasterID
     WHERE adt.DocDesc LIKE '%' + ma.adjustment_name + '%'
        AND YEAR(adt.DocDate) = ma.period_year
        AND MONTH(adt.DocDate) = ma.period_month) AS adtrans_total,
    SUM(ma.amount) - 
        (SELECT SUM(ln.Amount) 
         FROM db_ptrj.dbo.PR_ADTRANS adt
         JOIN db_ptrj.dbo.PR_ADTRANSLN ln ON adt.ID = ln.MasterID
         WHERE adt.DocDesc LIKE '%' + ma.adjustment_name + '%'
            AND YEAR(adt.DocDate) = ma.period_year
            AND MONTH(adt.DocDate) = ma.period_month) AS diff
FROM extend_db_ptrj.dbo.payroll_manual_adjustments ma
WHERE ma.period_month = 4
    AND ma.period_year = 2026
GROUP BY ma.adjustment_name, ma.period_month, ma.period_year;
```

---

## 13. TEST CASE CHECKLIST

### 13.1 Payroll Calculation Tests
- [ ] `PayrollCalculator.calculate()` dengan input normal
- [ ] `PayrollCalculator.calculate()` dengan koreksi negatif
- [ ] `PayrollCalculator.calculate()` dengan pendapatan_lainnya (THR/Bonus)
- [ ] `PayrollCalculator.calculate()` dengan premi_pph
- [ ] Verify: upah_bersih = jumlah_upah_kotor - total_potongan + premi_pph
- [ ] Verify: koreksi TIDAK masuk total_potongan
- [ ] Verify: pendapatan_lainnya WAJIB masuk total_potongan

### 13.2 Import Duplicate Tests
- [ ] Import Excel dengan emp_code duplikat - harus reject
- [ ] Import Excel dengan period duplikat - harus update/reject
- [ ] Import Excel dengan missing required columns - harus reject
- [ ] Import Excel dengan invalid date format - harus reject

### 13.3 Metadata Sync Tests
- [ ] Save PREMI PRUNING dengan3 subblok - amount harus = sum items
- [ ] Update amount manual - metadata_json.total_amount harus sync
- [ ] Save dengan invalid JSON di metadata_json - harus reject
- [ ] Save PREMI TIKET (amount type) - metadata_json tidak wajib

### 13.4 Report Total Tests
- [ ] Backend `calculatePayrollTotals()` vs frontend `calculateTotalRow()`
- [ ] Grand total = sum of all gang totals
- [ ] Gang total = sum of all employee totals
- [ ] Total_premi = sum of all dynamic premi columns

### 13.5 Print Total Tests
- [ ] Print total = web report total
- [ ] Print dengan pagination - semua data tercetak
- [ ] Print grouping (gang/division) sesuai
- [ ] Print format Rupiah sesuai format Indonesia

### 13.6 Employee Mapping Tests
- [ ] Emp_code resolution - NIK to EmpCode mapping
- [ ] Duplicate NIK handling - harus pilih yang terbaru
- [ ] Gang member resolution - emp_code ke gang_code
- [ ] Division resolution - gang_code ke division_code

### 13.7 Gang Mapping Tests
- [ ] Gang prefix filtering
- [ ] Virtual division resolution (NRS, INF, WKS)
- [ ] Gang tidak ada di division - harus error

### 13.8 Delete/Update Safety Tests
- [ ] Delete adjustment - harus ada confirmation
- [ ] Update adjustment - harus ada audit trail
- [ ] Bulk delete - harus ada warning
- [ ] Delete hanya bisa oleh authorized user

### 13.9 Taxable/Non-Taxable Tests
- [ ] THR taxable - masuk penghasilan_bruto
- [ ] Bonus taxable - masuk penghasilan_bruto
- [ ] Premi non-taxable - tidak masuk penghasilan_bruto
- [ ] Koreksi tidak masuk total_potongan

### 13.10 Paid in THP Tests
- [ ] Premi_pph ADDED ke upah_bersih
- [ ] PPH21 DEDUCTED dari upah_bersih
- [ ] SPSI DEDUCTED dari upah_bersih
- [ ] Pendapatan_lainnya DI-ADD ke gross, DI-DEDUCT dari bersih

---

## 14. FINAL RECOMMENDATION

### 14.1 Apakah Sistem Layak Production?

**Status: CONDITIONAL YES**

Sistem ini memiliki fondasi yang baik dan sudah production-ready untuk use case dasar. Namun, ada beberapa area kritis yang perlu diperbaiki sebelum bisa dianggap fully production-ready untuk lingkungan enterprise:

**Yang sudah baik:**
- ✅ Payroll calculation logic sudah centralized dan well-documented
- ✅ Service layer pattern sudah implemented
- ✅ Basic authentication dan authorization sudah ada
- ✅ Basic audit trail sudah ada (sync_status, remarks)
- ✅ Test suite sudah ada untuk komponen kritis

**Yang perlu diperbaiki:**
- ⚠️ Metadata JSON sync validation belum ada
- ⚠️ Transaction handling belum konsisten
- ⚠️ Dedicated audit log table belum ada
- ⚠️ Beberapa file terlalu besar (maintainability risk)
- ⚠️ Validation layer belum centralized

### 14.2 Apa yang Harus Dibenahi Sebelum Dipakai Penuh?

**Critical (Sebelum Go-Live):**
1. Fix metadata_json sync validation (BUG-001)
2. Add transaction wrapper untuk write operations (BUG-003)
3. Add input validation untuk semua API endpoints
4. Sanitize logging - hapus PII dari console.log

**High Priority (1 bulan pertama):**
1. Create audit log table dan service
2. Add unique constraint di payroll_manual_adjustments
3. Refactor dataExtractorService untuk reduce complexity
4. Add comprehensive tests untuk PayrollCalculator

**Medium Priority (3 bulan pertama):**
1. Full modularization sesuai recommended architecture
2. Performance optimization untuk query payroll
3. Enhance RBAC dengan division-level permissions
4. Add payroll locking mechanism

### 14.3 Risiko Terbesar Jika Tidak Diperbaiki

| Risiko | Impact | Likelihood | Mitigation |
|--------|--------|------------|-------------|
| **Data Inconsistency** | Karyawan underpaid/overpaid | HIGH | Fix BUG-001, add validation |
| **Audit Failure** | Tidak bisa trace perubahan | HIGH | Create audit log table |
| **Data Corruption** | Orphan records, duplicates | MEDIUM | Add transaction, unique constraint |
| **Security Breach** | SQL injection, data exposure | LOW | Already has parameterized queries |
| **Performance Issue** | Slow query, timeout | MEDIUM | Add indexes, optimize queries |

### 14.4 Prioritas 7 Hari Pertama

| Day | Task | Deliverable |
|-----|------|------------|
| 1 | Fix BUG-001 (metadata sync) | Patch untuk resolveDetailTotalSync |
| 2 | Add transaction wrapper | Patch untuk saveAdjustment |
| 3 | Sanitize logging | Patch untuk semua console.log dengan PII |
| 4 | Add input validation | Validation function untuk manual adjustment |
| 5 | Create SQL checklist queries | SQL scripts untuk data validation |
| 6 | Document findings | Laporan audit final |
| 7 | Create fix plan | GitHub issues untuk semua findings |

### 14.5 Prioritas 30 Hari Pertama

| Week | Task | Deliverable |
|------|------|------------|
| Week 1 | Stabilization | Fix critical bugs (BUG-001, BUG-003) |
| Week 2 | Validation Layer | Centralized validation service |
| Week 3 | Audit Log | Audit log table dan service |
| Week 4 | Testing | Comprehensive test suite |
| Week 5-6 | Modularization | Refactor dataExtractorService |
| Week 7-8 | Security Enhancement | RBAC enhancement, security audit |
| Week 9-10 | Performance | Query optimization, indexing |
| Week 11-12 | Documentation | Update docs, create runbooks |

---

## 15. APPENDIX: FILE INVENTORY

### Critical Files untuk Payroll System

| File | Size | Purpose | Priority |
|------|------|---------|----------|
| `backend/src/services/dataExtractorService.ts` | 266KB+ | Main data extraction | CRITICAL |
| `backend/src/services/payroll/components/PayrollCalculator.ts` | 262 lines | Calculation engine | CRITICAL |
| `backend/src/services/manualAdjustmentService.ts` | 2400+ lines | Adjustment management | CRITICAL |
| `backend/src/api/payroll.ts` | 3359 lines | API routes | HIGH |
| `backend/src/services/payrollTotalsCalculator.ts` | 500+ lines | Total calculation | HIGH |
| `frontend/src/components/CustomPayrollTable.jsx` | 2600+ lines | Main table UI | HIGH |
| `backend/src/db/client.ts` | 400+ lines | Database access | HIGH |
| `backend/src/services/payroll/extractors/*.ts` | Various | Data extractors | MEDIUM |

### Files yang Perlu Refactoring

| File | Target Size | Action |
|------|-------------|--------|
| `dataExtractorService.ts` | <100KB | Pecah jadi extractors/ |
| `manualAdjustmentService.ts` | <500KB | Pecah jadi services/ |
| `payroll.ts` (API) | <1000 lines | Pecah jadi controller/ |
| `CustomPayrollTable.jsx` | <1000 lines | Pecah jadi components/ |

---

## 16. APPENDIX: TEST COMMAND REFERENCE

### Backend Tests
```bash
cd backend
bun run test                           # Run all tests
bun test src/services/payroll/components/PayrollCalculator.test.ts
bun test src/services/manualAdjustmentService.test.ts
bun test src/services/payrollTotalsCalculator.test.ts
```

### Frontend Tests
```bash
cd frontend
npx vitest run src/utils/payrollSourceMode.test.js
npx vitest run src/components/CustomPayrollTable.render.test.jsx
```

### Database Validation
```sql
-- Run SQL checklist queries dari section 12
-- Execute di SQL Server Management Studio atau via SQL Gateway
```

---

**End of Report**

*Generated by Claude Code - Senior Software Engineer, Payroll System Auditor*
*Date: 2026-06-05*
