export function normalizeDaftarUpahDownloadVariant(value) {
  return String(value || '').trim().toLowerCase() || 'workbook';
}

export function getDaftarUpahDownloadActionCopy(isLoading = false) {
  const variantLabel = 'Workbook';

  if (isLoading) {
    return {
      label: 'Mengunduh Daftar Upah...',
      icon: '...',
      title: 'Unduh file Daftar Upah sedang diproses',
      variantLabel,
    };
  }

  return {
    label: 'Unduh Daftar Upah',
    icon: 'XLS',
    title: 'Unduh file Daftar Upah dengan sheet Detail, Ringkas, dan Print',
    variantLabel,
  };
}
