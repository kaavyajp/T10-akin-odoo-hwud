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

/** Build an admin audit of verified organizations and public records that belong to them. */
export function buildOrganizationVerificationReport(applications, surplus, needs) {
  const matchApplication = (record, ownerId, ownerName) => applications.find((application) => {
    const recordOwnerId = record[ownerId];
    if (recordOwnerId != null) return String(recordOwnerId) === String(application.id);
    return record[ownerName] === application.organizationName;
  });
  const rows = applications.map((application) => {
    const resourceCount = surplus.filter((item) => (item.status === 'available' || item.status === 'published')
      && matchApplication(item, 'donorId', 'donor')?.id === application.id).length;
    const needCount = needs.filter((need) => (need.status == null || need.status === 'open') && need.quantity > 0
      && matchApplication(need, 'organizationId', 'organization')?.id === application.id).length;
    const listed = resourceCount + needCount > 0;
    return {
      id: String(application.id),
      organizationName: application.organizationName,
      organizationType: application.organizationType,
      verificationStatus: application.status,
      registrationProvided: Boolean(application.registrationId),
      resourceCount,
      needCount,
      reviewedAt: application.reviewedAt ?? '',
      reviewerEmail: application.reviewerEmail ?? '',
      websiteStatus: application.status === 'approved'
        ? listed ? 'Verified and listed' : 'Verified; no active listings'
        : listed ? 'Review required; listed records found' : `Not verified (${application.status})`,
      exception: application.status !== 'approved' && listed,
    };
  });
  const untracked = new Map();
  for (const [records, ownerId, ownerName, kind] of [
    [surplus, 'donorId', 'donor', 'resource'],
    [needs, 'organizationId', 'organization', 'need'],
  ]) {
    for (const record of records) {
      const isListed = kind === 'resource'
        ? record.status === 'available' || record.status === 'published'
        : (record.status == null || record.status === 'open') && record.quantity > 0;
      if (!isListed || matchApplication(record, ownerId, ownerName)?.status === 'approved') continue;
      const name = record[ownerName] || 'Organization not linked to a verification record';
      const key = `${kind}:${record[ownerId] ?? name}`;
      const entry = untracked.get(key) ?? {
        id: key,
        organizationName: name,
        organizationType: kind === 'resource' ? 'company' : 'ngo',
        verificationStatus: 'missing',
        registrationProvided: false,
        resourceCount: 0,
        needCount: 0,
        reviewedAt: '',
        reviewerEmail: '',
        websiteStatus: 'Review required; listed records found',
        exception: true,
      };
      if (kind === 'resource') entry.resourceCount += 1;
      else entry.needCount += 1;
      untracked.set(key, entry);
    }
  }
  rows.push(...untracked.values());
  const exceptions = rows.filter((row) => row.exception);
  return {
    rows,
    exceptions,
    verifiedCount: rows.filter((row) => row.verificationStatus === 'approved').length,
    pendingCount: rows.filter((row) => row.verificationStatus === 'pending').length,
    rejectedCount: rows.filter((row) => row.verificationStatus === 'rejected').length,
    activeListings: rows.reduce((sum, row) => sum + row.resourceCount + row.needCount, 0),
    unverifiedListings: exceptions.reduce((sum, row) => sum + row.resourceCount + row.needCount, 0),
  };
}

/** Spreadsheet-safe export of the verification and public-listing audit. */
export function buildOrganizationVerificationCsv(applications, surplus, needs) {
  const report = buildOrganizationVerificationReport(applications, surplus, needs);
  const rows = [
    ['Organization', 'Type', 'Verification status', 'Registration reference present', 'Public resource listings', 'Open community needs', 'Website status', 'Reviewed at', 'Reviewer'],
    ...report.rows.map((record) => {
      return [
        record.organizationName,
        record.organizationType === 'ngo' ? 'NGO' : 'Business',
        record.verificationStatus,
        record.registrationProvided ? 'Yes' : 'No',
        record.resourceCount,
        record.needCount,
        record.websiteStatus,
        record.reviewedAt,
        record.reviewerEmail,
      ];
    }),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
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
