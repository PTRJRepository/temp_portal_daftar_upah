/** @vitest-environment jsdom */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
const { act } = React;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

const getEmployeeHistoryMock = vi.fn();

vi.mock('../../services/employeeDetailService', () => ({
  getEmployeeHistory: (...args) => getEmployeeHistoryMock(...args),
}));

vi.mock('../../services/wagesService', () => ({
  fetchEmployeeWagesHistory: vi.fn(),
  getStatusBadge: () => ({ icon: 'OK', label: 'OK', bgColor: '#fff', color: '#111' }),
}));

import SalaryHistoryTable from './SalaryHistoryTable';

describe('SalaryHistoryTable payroll integrity', () => {
  it('shows deduction magnitudes and worker-only ASTEK in expanded history detail', async () => {
    getEmployeeHistoryMock.mockResolvedValueOnce({
      data: [{
        period_year: 2026,
        period_month: 4,
        period_label: 'April 2026',
        gang_code: 'A1',
        nama: 'Tester',
        jumlah_hk: 20,
        upah_dasar: 100000,
        gaji_pokok: 2000000,
        total_premi: 100000,
        premi_panen: 100000,
        premi_pph: 20000,
        pot_koreksi: -10000,
        koreksi_denda_panen: -5000,
        pot_astek_pekerja: 30000,
        pot_astek_majikan: 40000,
        pot_astek_jumlah: 70000,
        pot_spsi: -2000,
        pot_pph21: -7000,
        total_potongan: 39000,
        jumlah_upah_kotor: 2090000,
        upah_bersih: 2071000,
      }],
    });

    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<SalaryHistoryTable empCode="B001" months={12} />);
    });

    const summaryRow = container.querySelector('.sht-summary-row');
    await act(async () => {
      summaryRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Koreksi DENDA PANEN');
    expect(container.textContent).toContain('10.000');
    expect(container.textContent).toContain('5.000');
    expect(container.textContent).toContain('Astek Pekerja');
    expect(container.textContent).toContain('30.000');
    expect(container.textContent).not.toContain('70.000');
    expect(container.textContent).not.toContain('Premi PPH');

    await act(async () => {
      root.unmount();
    });
  });
});
