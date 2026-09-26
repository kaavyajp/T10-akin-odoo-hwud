const rangeDays = { '7d': 7, '30d': 30, '90d': 90, all: Infinity };
const transferStatuses = ['pending', 'approved', 'in_transit', 'delivered', 'cancelled'];
/** @typedef {'7d'|'30d'|'90d'|'all'} ReportRange */

/** @param {ReportRange} range @param {number} [now] */
export function buildTransferReport(records, surplus, range = '30d', now = Date.now()) {
  const days = rangeDays[range] ?? rangeDays['30d'];
  const startAt = Number.isFinite(days) ? now - days * 86_400_000 : 0;
  const included = records.filter((record) => {
    const timestamp = new Date(record.createdAt).getTime();
    return Number.isFinite(timestamp) && timestamp >= startAt;
  });
  const delivered = included.filter((record) => record.status === 'delivered');
  const foodDelivered = delivered.filter((transfer) => {
    const item = surplus.find((entry) => entry.id === transfer.surplusId);
    return item && (item.resourceType ?? 'Food') === 'Food';
  });
  const mealsEstimated = foodDelivered.reduce((total, transfer) => {
    const item = surplus.find((entry) => entry.id === transfer.surplusId);
    return total + transfer.quantity * (item?.unit === 'meals' ? 1 : 4);
  }, 0);
  const kilogramsEstimated = foodDelivered.reduce((total, transfer) => {
    const item = surplus.find((entry) => entry.id === transfer.surplusId);
    return total + Math.round(transfer.quantity * (item?.unit === 'kg' ? 1 : 2.2));
  }, 0);
  const bucketCount = range === '7d' ? 7 : 6;
  const earliest = included.reduce((minimum, record) => Math.min(minimum, new Date(record.createdAt).getTime()), now);
  const trendStart = range === 'all' ? Math.min(earliest, now - 30 * 86_400_000) : startAt;
  const bucketSize = Math.max(1, (now - trendStart) / bucketCount);
  const trend = Array.from({ length: bucketCount }, (_, index) => {
    const start = trendStart + index * bucketSize;
    const end = index === bucketCount - 1 ? now + 1 : trendStart + (index + 1) * bucketSize;
    const count = delivered.filter((record) => {
      const createdAt = new Date(record.createdAt).getTime();
      return createdAt >= start && createdAt < end;
    }).length;
    return { start, count };
  });
  const statusCounts = Object.fromEntries(transferStatuses.map((status) => [
    status, included.filter((record) => record.status === status).length,
  ]));
  return {
    records: included,
    deliveredCount: delivered.length,
    mealsEstimated,
    kilogramsEstimated,
    activeCount: included.filter((record) => ['pending', 'approved', 'in_transit'].includes(record.status)).length,
    statusCounts,
    trend,
  };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Export only report-relevant partner and transfer fields; escape formula-like cells for spreadsheets. */
export function buildTransferCsv(records, surplus, needs, statusLabels) {
  const rows = [
    ['Resource shared', 'Resource type', 'Category', 'Donor organization', 'Receiving organization', 'Quantity', 'Unit', 'Status', 'Date', 'Match score'],
    ...[...records].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((record) => {
      const item = surplus.find((entry) => entry.id === record.surplusId);
      const need = needs.find((entry) => entry.id === record.needId);
      return [
        item?.title ?? 'Resource donation', item?.resourceType ?? 'Food', item?.category ?? 'Other',
        item?.donor ?? 'Partner', need?.organization ?? 'Community partner', record.quantity,
        item?.unit ?? 'items', statusLabels[record.status] ?? record.status,
        new Date(record.createdAt).toISOString(), record.score,
      ];
    }),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
