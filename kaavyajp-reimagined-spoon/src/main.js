import { DemoAssistantAdapter, DemoExtractionAdapter, DemoResourceService, DemoSalesService, DemoVerificationService, OdooApiResourceService, OdooApiVerificationService, buildMatches, formatExpiry } from './services.js';
import { RESOURCE_CATEGORIES, RESOURCE_TYPES } from './data.js';
import { buildTransferCsv, buildTransferReport } from './reporting.js';
import { renderPublicHeader, renderPublicPage } from './public-pages.js';

let service = new DemoResourceService();
let verificationService = new DemoVerificationService();
const extractor = new DemoExtractionAdapter();
const assistant = new DemoAssistantAdapter();
const root = document.querySelector('#view-root');
const modalRoot = document.querySelector('#modal-root');
const toastRegion = document.querySelector('#toast-region');
const salesService = new DemoSalesService();
const names = { home: 'Home', pricing: 'Membership pricing', sales: 'Sales & partnerships', about: 'About us', 'why-us': 'Why Refound', quality: 'Quality & standards', faq: 'FAQs', terms: 'Terms & conditions', privacy: 'Privacy policy', copyright: 'Copyright & use', contact: 'Contact us', login: 'Sign in', signup: 'Join Refound', verification: 'Organization verification', assistant: 'Refound assistant', overview: 'Overview', surplus: 'Surplus listings', needs: 'Community needs', 'my-needs': 'My requests', matches: 'Smart matches', cart: 'Resource basket', messages: 'Order messages', transfers: 'Orders & delivery', reports: 'Reports', impact: 'Your impact', 'admin-verifications': 'Verification queue', 'admin-organizations': 'Partner organizations', 'admin-sales-leads': 'Sales enquiries' };
const portalMenus = {
  company: [['overview', 'Overview', '▦'], ['surplus', 'My surplus', '↗'], ['needs', 'Community needs', '♡'], ['matches', 'Smart matches', '⤳'], ['messages', 'Order messages', '✉'], ['transfers', 'Orders & delivery', '⇄'], ['reports', 'Reports', '▤'], ['impact', 'My impact', '◷'], ['verification', 'Organization status', '✓'], ['assistant', 'AI assistant', '✳']],
  ngo: [['overview', 'Overview', '▦'], ['my-needs', 'My requests', '♡'], ['matches', 'Browse resources', '⤳'], ['cart', 'Resource basket', '▣'], ['messages', 'Order messages', '✉'], ['transfers', 'Orders & delivery', '⇄'], ['reports', 'Reports', '▤'], ['impact', 'Community impact', '◷'], ['verification', 'Organization status', '✓'], ['assistant', 'AI assistant', '✳']],
  admin: [['overview', 'Admin overview', '▦'], ['admin-verifications', 'Review applications', '✓'], ['admin-organizations', 'Organizations', '♧'], ['admin-sales-leads', 'Membership enquiries', '◇'], ['surplus', 'All surplus', '↗'], ['needs', 'Community needs', '♡'], ['matches', 'All matches', '⤳'], ['messages', 'Order messages', '✉'], ['cart', 'Demo basket', '▣'], ['transfers', 'All orders & delivery', '⇄'], ['reports', 'Network reports', '▤'], ['impact', 'Impact reports', '◷'], ['assistant', 'AI assistant', '✳']],
};
const publicViews = new Set(['home', 'pricing', 'sales', 'about', 'why-us', 'quality', 'faq', 'terms', 'privacy', 'copyright', 'contact', 'login', 'signup', 'verification', 'assistant']);
let session = (() => {
  try {
    const saved = JSON.parse(sessionStorage.getItem('refound-demo-session') ?? 'null');
    return saved && ['company', 'ngo', 'admin'].includes(saved.role) && typeof saved.name === 'string' && typeof saved.email === 'string' ? saved : null;
  }
  catch (error) {
    console.error('Unable to load the demo session.', error);
    return null;
  }
})();
let activeView = session ? 'overview' : 'home';
let verificationRole = 'company';
let filter = 'All';
let query = '';
let assistantMessages = [];
let reportRange = '30d';
let selectedConversation = '';
let liveMode = false;
let liveLoginPath = '/api/session';

const icon = (name) => ({ Produce: '❋', Bakery: '▤', 'Prepared meals': '◒', Dairy: '◌', 'Medical equipment': '✚', 'Study resources': '▣', 'Other essentials': '↗', Other: '✳', 'First-aid kits': '✚', Textbooks: '▤', 'School supplies': '✎', 'Computers & calculators': '▣', Clothing: '♡' })[name] ?? '✳';
const resourceTypeOf = (item) => item.resourceType ?? 'Food';
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const shortDate = (value) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric' }).format(new Date(value));
const todayLabel = () => new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();
const formatDue = (value) => {
  const hours = Math.ceil((new Date(value).getTime() - Date.now()) / 3_600_000);
  if (hours <= 0) return 'Past due';
  return hours < 24 ? `Needed in ${hours}h` : `Needed in ${Math.floor(hours / 24)}d`;
};
const relativeTime = (value) => {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000));
  return hours < 1 ? 'Just now' : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};
const currency = (value) => new Intl.NumberFormat('en-US').format(value);
const getData = async () => Promise.all([service.getSurplus(), service.getNeeds(), service.getTransfers(), service.getMetrics()]);
const isVerified = async () => {
  if (!session || !['company', 'ngo'].includes(session.role)) return false;
  const own = (await verificationService.getApplications()).find((application) => application.email === session.email);
  if (liveMode && own) session.organizationStatus = own.status;
  if (liveMode && session.organizationStatus) return session.organizationStatus === 'approved';
  return own?.status === 'approved';
};
const categoryColors = (category) => `category-${category.toLowerCase().replace(/\s+/g, '-')}`;
const statusLabels = { pending_payment: 'Payment pending', pending: 'Awaiting company review', approved: 'Company arranging delivery', in_transit: 'On the way', delivered: 'Received by NGO', cancelled: 'Cancelled' };
const nextAction = { pending: 'Accept order', approved: 'Arrange delivery', in_transit: 'Confirm receipt' };

function pageHeading(eyebrow, title, description, action = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}

function metricCard(label, value, detail, glyph, color = 'green') {
  return `<article class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-glyph ${color}">${glyph}</span></div><div class="metric-value">${value}</div><div class="metric-detail">${detail}</div></article>`;
}

function surplusCard(item) {
  const pickupExpiry = new Date(item.availableUntil).getTime();
  const productExpiry = item.expiresAt ? new Date(item.expiresAt).getTime() : Infinity;
  const isUrgent = Math.min(pickupExpiry, productExpiry) - Date.now() < 18 * 3_600_000;
  return `<article class="listing-card">
    <div class="listing-icon ${categoryColors(resourceTypeOf(item))}">${icon(resourceTypeOf(item))}</div>
    <div class="listing-main"><div class="card-topline"><span class="category-tag ${categoryColors(resourceTypeOf(item))}">${escapeHtml(resourceTypeOf(item))}</span><span class="category-tag ${categoryColors(item.category)} listing-subcategory">${escapeHtml(item.category)}</span>${item.status === 'available' && isUrgent ? '<span class="urgency-tag">● Due soon</span>' : `<span class="status-dot ${item.status}">${item.status === 'available' ? 'Available' : item.status}</span>`}</div>
      <h3>${escapeHtml(item.title)}</h3><p class="muted">${escapeHtml(item.donor ?? 'Refound partner')} <span class="middot">·</span> ${escapeHtml(item.location)}</p>
      <div class="listing-meta"><strong>${item.quantity} ${escapeHtml(item.unit)} available</strong><span class="listing-price">${item.priceAED > 0 ? `AED ${Number(item.priceAED).toFixed(2)} / ${escapeHtml(item.unit)}` : 'Free'}</span></div><div class="item-order-by">Company order-by: ${formatExpiry(item.availableUntil)}</div>${item.expiresAt ? `<div class="item-expiry">Package/device use-by: ${new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(item.expiresAt))}</div>` : ''}${item.condition ? `<div class="resource-condition">${escapeHtml(item.condition)}</div>` : ''}
    </div>
    <button class="more-button" aria-label="More about ${escapeHtml(item.title)}" data-action="surplus-detail" data-id="${item.id}">↗</button>
  </article>`;
}

function needCard(need) {
  return `<article class="need-card"><div class="need-card-top"><span class="urgency-pill ${need.urgency}"><i></i>${need.urgency} need</span><span class="need-time">${formatDue(need.neededBy)}</span></div>
    <h3>${escapeHtml(need.organization)}</h3><p class="muted">${escapeHtml(need.location)} <span class="middot">·</span> Contact: ${escapeHtml(need.contact)}</p>
    <div class="need-request"><span class="category-tag ${categoryColors(resourceTypeOf(need))}">${escapeHtml(resourceTypeOf(need))} · ${escapeHtml(need.category)}</span><strong>${need.quantity} ${escapeHtml(need.unit)}</strong></div><p class="need-note">“${escapeHtml(need.note)}”</p><div class="need-specs"><span>Budget: ${need.maxPriceAED > 0 ? `up to AED ${Number(need.maxPriceAED).toFixed(2)} / unit` : 'donated resources only'}</span>${need.expiresAt ? `<span>Item must remain valid through ${shortDate(need.expiresAt)}</span>` : ''}${need.preferredCondition ? `<span>Condition: ${escapeHtml(need.preferredCondition)}</span>` : ''}${need.specifications ? `<span>${escapeHtml(need.specifications)}</span>` : ''}${need.storageInstructions ? `<span>Receiving: ${escapeHtml(need.storageInstructions)}</span>` : ''}</div></article>`;
}

function transferRow(transfer, surplus, need, compact = false) {
  const status = transfer.status;
  const isSeller = session?.role === 'admin' || (session?.role === 'company' && surplus?.donor === session.name);
  const isBuyer = session?.role === 'admin' || (session?.role === 'ngo' && need?.organization === session.name);
  const canAdvance = status === 'pending' ? isSeller : status === 'approved' ? isSeller : status === 'in_transit' ? isBuyer : false;
  const action = status === 'delivered'
    ? '<span class="done-mark">✓ Received</span>'
    : nextAction[status] && canAdvance
      ? `<button class="button button-small button-outline" data-action="${status === 'approved' ? 'arrange-delivery' : status === 'in_transit' ? 'confirm-receipt' : 'confirm-order'}" data-id="${transfer.id}">${nextAction[status]} <span>→</span></button>`
      : `<span class="transfer-waiting">${status === 'pending' ? 'Awaiting company' : status === 'approved' ? 'Awaiting company logistics' : status === 'in_transit' ? 'Awaiting NGO receipt' : 'Partner handoff'}</span>`;
  const threadId = transfer.orderId ?? transfer.id;
  return `<div class="transfer-row ${compact ? 'compact' : ''}">
    <div class="transfer-route"><div class="route-icon ${categoryColors(resourceTypeOf(surplus ?? {}))}">${icon(resourceTypeOf(surplus ?? {}))}</div><div><strong>${escapeHtml(surplus?.title ?? 'Resource')}</strong><small>${transfer.quantity} ${escapeHtml(surplus?.unit ?? 'items')} <span class="middot">→</span> ${escapeHtml(need?.organization ?? 'Community partner')}</small><small>${transfer.paymentStatus === 'no_charge' ? 'No charge' : `AED ${Number(transfer.paymentAmountAED ?? 0).toFixed(2)} · ${transfer.paymentStatus === 'simulated_paid' ? 'demo payment' : transfer.paymentStatus}`}</small></div></div>
    <div class="transfer-destination"><span class="muted">Receiving partner</span><strong>${escapeHtml(need?.organization ?? '—')}</strong></div>
    <span class="transfer-status ${status}">${statusLabels[status]}</span><div class="transfer-action">${action}<button class="order-message-link" data-action="open-order-messages" data-id="${threadId}">Message partner</button></div>${status !== 'pending' && transfer.logisticsMethod ? `<div class="delivery-detail"><strong>${escapeHtml(transfer.logisticsMethod)}</strong>${transfer.trackingReference ? ` · Ref ${escapeHtml(transfer.trackingReference)}` : ''}${transfer.expectedDeliveryAt ? ` · ETA ${shortDate(transfer.expectedDeliveryAt)}` : ''}${transfer.deliveryFeeAED ? ` · Delivery fee AED ${Number(transfer.deliveryFeeAED).toFixed(2)} (arranged by company)` : ''}${transfer.logisticsNotes ? `<small>${escapeHtml(transfer.logisticsNotes)}</small>` : ''}</div>` : ''}
  </div>`;
}

function overviewMatchRow(match) {
  const action = session?.role === 'ngo' && match.need.organization === session.name
    ? `<button class="match-arrow" aria-label="Add matched resource to basket" data-action="add-to-cart" data-surplus="${match.surplus.id}" data-need="${match.need.id}">＋</button>`
    : `<button class="match-arrow" aria-label="View company listing" data-action="surplus-detail" data-id="${match.surplus.id}">↗</button>`;
  return `<div class="match-row"><div class="match-badge">${match.score}<small>%</small></div><div class="match-copy"><strong>${escapeHtml(match.need.organization)}</strong><p>${match.quantity} ${escapeHtml(match.surplus.unit)} ${escapeHtml(match.surplus.category.toLowerCase())} · ${match.surplus.priceAED ? `AED ${Number(match.surplus.priceAED).toFixed(2)}/${escapeHtml(match.surplus.unit)}` : 'free'} · ${escapeHtml(match.need.urgency)} need</p></div>${action}</div>`;
}

function renderOverview(surplus, needs, transfers, metrics, verified = true) {
  const eligibleSurplus = session?.role === 'company' ? surplus.filter((item) => item.donor === session.name) : surplus;
  const eligibleNeeds = session?.role === 'ngo' ? needs.filter((item) => item.organization === session.name) : needs;
  const matches = buildMatches(eligibleSurplus, eligibleNeeds).slice(0, 3);
  const visibleTransfers = transfersForCurrentPortal(surplus, needs, transfers);
  const urgent = eligibleSurplus.filter((item) => item.status === 'available').sort((a, b) => {
    const deadline = (item) => Math.min(new Date(item.availableUntil).getTime(), item.expiresAt ? new Date(item.expiresAt).getTime() : Infinity);
    return deadline(a) - deadline(b);
  }).slice(0, 3);
  const active = visibleTransfers.filter((item) => item.status !== 'delivered' && item.status !== 'cancelled').slice(0, 3);
  const action = verified
    ? '<button class="button button-primary" data-action="open-listing"><span>＋</span> List resources</button>'
    : '<button class="button button-outline" data-view="verification">Complete organization verification <span>→</span></button>';
  const gate = verified ? '' : '<div class="verification-banner"><span>◷</span><div><strong>Your organization review is in progress.</strong><p>Browse the demo while an administrator reviews your application. Listing surplus and posting requests require approval.</p></div><button class="text-button" data-view="verification">View status →</button></div>';
  return `${pageHeading(todayLabel(), `Welcome, ${escapeHtml(session?.name ?? 'partner')} <span class="heading-wave">✳</span>`, verified ? 'Here’s what’s happening in your community today.' : 'Get set up with Refound while we review your organization.', action)}
    ${gate}
    <section class="metric-grid">
      ${metricCard('Meals rescued', currency(metrics.mealsRescued), '<span class="positive">↗ 18%</span> vs. last month', '↗')}
      ${metricCard('Food diverted', `${currency(metrics.kgDiverted)} <small>kg</small>`, 'Kept out of landfill', '◌', 'peach')}
      ${metricCard('People reached', currency(metrics.peopleReached), 'Across 12 community partners', '♧', 'lavender')}
      ${metricCard('Active listings', eligibleSurplus.filter((item) => item.status === 'available').length, `<span class="positive">${visibleTransfers.filter((item) => item.status === 'pending').length} need your approval</span>`, '▤', 'yellow')}
    </section>
    <section class="overview-grid">
      <div class="panel matches-panel">
        <div class="section-header"><div><div class="eyebrow">GOOD THINGS, RIGHT PLACE</div><h2>Best matches for you</h2></div><button class="link-button" data-view="matches">View all <span>→</span></button></div>
        ${matches.map(overviewMatchRow).join('') || '<p class="empty-state">No compatible matches yet. Add surplus or a community need to get started.</p>'}
      </div>
      <div class="panel community-panel">
        <div class="section-header"><div><div class="eyebrow">COMMUNITY PULSE</div><h2>Needs attention</h2></div><button class="link-button" data-view="needs">All needs <span>→</span></button></div>
        ${needs.filter((need) => need.urgency === 'critical' && need.quantity > 0 && new Date(need.neededBy).getTime() > Date.now()).slice(0, 3).map((need) => `<div class="pulse-row"><span class="pulse-mark">!</span><div><strong>${escapeHtml(need.organization)}</strong><p>${escapeHtml(need.note)}</p></div><span class="pulse-urgency">Critical</span></div>`).join('')}
      </div>
    </section>
    <section class="overview-grid lower-grid">
      <div class="panel">
        <div class="section-header"><div><div class="eyebrow">DON’T LET USEFUL THINGS WAIT</div><h2>Upcoming deadlines</h2></div><button class="link-button" data-view="surplus">All surplus <span>→</span></button></div>
        ${urgent.map((item) => { const deadline = Math.min(new Date(item.availableUntil).getTime(), item.expiresAt ? new Date(item.expiresAt).getTime() : Infinity); const deadlineLabel = item.expiresAt && deadline === new Date(item.expiresAt).getTime() ? `Use-by ${formatExpiry(item.expiresAt)}` : `Order-by ${formatExpiry(item.availableUntil)}`; return `<div class="expiring-row"><span class="expiring-icon ${categoryColors(resourceTypeOf(item))}">${icon(resourceTypeOf(item))}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(resourceTypeOf(item))} · ${item.quantity} ${escapeHtml(item.unit)} <span class="middot">·</span> ${escapeHtml(item.location)}</p></div><span class="expiring-time">${deadlineLabel}</span></div>`; }).join('')}
      </div>
      <div class="panel">
        <div class="section-header"><div><div class="eyebrow">THE HANDOFF</div><h2>In progress</h2></div><button class="link-button" data-view="transfers">All transfers <span>→</span></button></div>
        ${active.length ? active.map((transfer) => {
          const surplusItem = surplus.find((item) => item.id === transfer.surplusId);
          const needItem = needs.find((item) => item.id === transfer.needId);
          return `<div class="mini-transfer"><span class="mini-status ${transfer.status}"></span><div><strong>${escapeHtml(needItem?.organization ?? 'Partner')}</strong><p>${transfer.quantity} ${escapeHtml(surplusItem?.unit ?? 'items')} · ${statusLabels[transfer.status]}</p></div><span class="mini-date">${relativeTime(transfer.createdAt)}</span></div>`;
        }).join('') : '<p class="empty-state">No active handoffs right now.</p>'}
      </div>
    </section>
    <div class="bottom-note"><span>✳</span> Small actions add up. You’ve helped rescue <strong>${currency(metrics.mealsThisMonth)} meals</strong> this month.</div>`;
}

function renderSurplus(surplus) {
  const categories = ['All', ...RESOURCE_TYPES];
  const visibleSurplus = session?.role === 'company' ? surplus.filter((item) => item.donor === session.name) : surplus;
  const filtered = visibleSurplus.filter((item) => (filter === 'All' || resourceTypeOf(item) === filter) && `${item.title} ${resourceTypeOf(item)} ${item.category} ${item.location}`.toLowerCase().includes(query.toLowerCase()));
  return `${pageHeading('SHARE WHAT YOU HAVE', 'Surplus listings', 'Useful things, ready to find a good home.', '<button class="button button-primary" data-action="open-listing"><span>＋</span> List resources</button>')}
    <div class="list-toolbar"><div class="filter-tabs">${categories.map((category) => `<button class="filter-tab ${filter === category ? 'selected' : ''}" data-action="filter" data-filter="${category}">${category}</button>`).join('')}</div><label class="search-box"><span>⌕</span><input id="search-listings" type="search" placeholder="Search listings" value="${escapeHtml(query)}" /></label></div>
    <div class="surplus-grid">${filtered.map(surplusCard).join('') || '<div class="empty-panel">No listings found. Try another search or list new surplus.</div>'}</div>
    <div class="inline-tip"><span>✳</span><div><strong>Every listing gets a second look.</strong><p>We’ll check the details, spot nearby needs, and help coordinate a safe handoff.</p></div></div>`;
}

function renderNeeds(needs) {
  const openNeeds = needs.filter((need) => need.quantity > 0 && new Date(need.neededBy).getTime() > Date.now());
  return `${pageHeading('LISTEN FIRST', 'Community needs', 'Real requests for food, medical equipment, study resources, and other essentials.', '<span class="partner-count">✳ &nbsp;12 verified partners</span>')}
    <div class="needs-summary"><span class="needs-summary-dot"></span><strong>${openNeeds.length} open requests</strong><span>from community partners</span><span class="summary-divider"></span><span class="urgency-legend"><i class="critical"></i>Critical <i class="high"></i>High <i class="standard"></i>Standard</span></div>
    <div class="needs-grid">${[...openNeeds].sort((a, b) => ({ critical: 0, high: 1, standard: 2 })[a.urgency] - ({ critical: 0, high: 1, standard: 2 })[b.urgency]).map(needCard).join('') || '<div class="empty-panel">All partner requests are fulfilled. Check back soon.</div>'}</div>
    <div class="footer-note">Needs are shared by verified local partners. <button class="text-button" data-action="toast" data-message="Partner onboarding is available in the full Refound platform.">Learn about becoming a partner →</button></div>`;
}

function renderMatches(surplus, needs) {
  const eligibleSurplus = session?.role === 'company' ? surplus.filter((item) => item.donor === session.name) : surplus;
  const eligibleNeeds = session?.role === 'ngo' ? needs.filter((item) => item.organization === session.name) : needs;
  const matches = buildMatches(eligibleSurplus, eligibleNeeds);
  return `${pageHeading('SMARTER THAN A SPREADSHEET', 'Smart matches', 'Thoughtful recommendations for food and useful resources—with a reason for every match.', '<span class="match-explainer"><span class="spark-small">✳</span> Local matching engine</span>')}
    <div class="match-explainer-banner"><div class="explain-icon">✳</div><div><strong>Good fit, clearly explained.</strong><p>We weigh urgency, resource type and category, quantity-unit compatibility, item expiry, and pickup distance. No black boxes—just practical recommendations for people who need them.</p></div><button class="text-button" data-action="toast" data-message="Matching considers urgency (42%), resource/category fit (30%), expiry and freshness (20%), and partner proximity (12%).">How scoring works ↗</button></div>
    <div class="match-list">${matches.map((match) => {
      const canBuy = session?.role === 'ngo' && match.need.organization === session.name;
      const action = canBuy
        ? `<button class="button button-primary button-small" data-action="add-to-cart" data-surplus="${match.surplus.id}" data-need="${match.need.id}">Add to basket <span>→</span></button>`
        : session?.role === 'company' && match.surplus.donor === session.name
          ? `<button class="button button-outline button-small" data-action="surplus-detail" data-id="${match.surplus.id}">View my listing</button>`
          : '<span class="match-quantity">Sign in as a partner</span>';
      return `<article class="match-card"><div class="match-score"><span>${match.score}</span><small>match</small><div class="score-track"><i style="width:${match.score}%"></i></div></div><div class="match-details"><div class="match-detail-heading"><div><span class="urgency-pill ${match.need.urgency}"><i></i>${match.need.urgency}</span><h3>${escapeHtml(match.need.organization)}</h3></div><span class="match-quantity">${match.quantity} ${escapeHtml(match.surplus.unit)} available · ${match.surplus.priceAED > 0 ? `AED ${Number(match.surplus.priceAED).toFixed(2)}/${escapeHtml(match.surplus.unit)}` : 'Free'}</span></div><p class="match-source"><span class="category-tag ${categoryColors(resourceTypeOf(match.surplus))}">${escapeHtml(resourceTypeOf(match.surplus))}</span> ${escapeHtml(match.surplus.category)} <span class="middot">·</span> <strong>${escapeHtml(match.surplus.title)}</strong> <span class="middot">→</span> ${escapeHtml(match.need.organization)} <span class="middot">·</span> ${escapeHtml(match.need.location)}</p><div class="reason-list">${match.reasons.map((reason) => `<span><i>✓</i>${escapeHtml(reason)}</span>`).join('')}</div></div>${action}</article>`;
    }).join('') || '<div class="empty-panel">No suitable matches right now. Review your resource type, specifications, expiry, unit, and price budget.</div>'}</div>`;
}

function renderTransfers(surplus, needs, transfers) {
  const visibleTransfers = transfersForCurrentPortal(surplus, needs, transfers);
  const pending = visibleTransfers.filter((item) => item.status === 'pending').length;
  const active = visibleTransfers.filter((item) => ['approved', 'in_transit'].includes(item.status)).length;
  const resetButton = session?.role === 'admin' && !liveMode ? '<button class="button button-outline" data-action="reset-demo">↺ Reset demo</button>' : '';
  const sellerCopy = session?.role === 'company' ? 'You own delivery: confirm paid orders, choose the carrier, agree any delivery fee directly, and post tracking/ETA.' : session?.role === 'ngo' ? 'The company owns delivery logistics. Message them to agree the carrier and fee, track arrival, then confirm receipt here.' : 'Observe the partner-owned delivery agreement and receipt confirmations.';
  return `${pageHeading('REFOUND CHECKOUT → COMPANY-ARRANGED DELIVERY', 'Orders & delivery', 'Refound supports matching, communication, orders and handoff records. The selling company arranges physical delivery.', resetButton)}
    <div class="logistics-notice orders-explainer"><strong>Who handles what?</strong> ${liveMode ? 'NGO orders are recorded in Odoo; paid checkout stays disabled until a payment provider is configured.' : 'NGO places the order through the simulated demo checkout.'} The company confirms the order and arranges delivery, carrier, tracking, ETA, and any delivery cost directly with the NGO. Refound does not book couriers.</div>
    <div class="order-role-note">${escapeHtml(sellerCopy)}</div>
    <div class="transfer-stats"><div><span class="transfer-stat-icon gold">◷</span><span><strong>${pending}</strong><small>Awaiting company review</small></span></div><div><span class="transfer-stat-icon blue">⇄</span><span><strong>${active}</strong><small>Company fulfilment</small></span></div><div><span class="transfer-stat-icon green">✓</span><span><strong>${visibleTransfers.filter((item) => item.status === 'delivered').length}</strong><small>Received by NGOs</small></span></div></div>
    <section class="panel transfer-panel"><div class="section-header"><div><div class="eyebrow">HANDOFF TRACKER</div><h2>All transfers <span class="muted-count">${visibleTransfers.length}</span></h2></div><span class="live-status"><i></i> ${liveMode ? 'Odoo-backed' : 'Demo updates'}</span></div>
      <div class="transfer-table-head"><span>Surplus &amp; quantity</span><span>Receiving partner</span><span>Status</span><span>Next step</span></div>
      ${[...visibleTransfers].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((item) => transferRow(item, surplus.find((s) => s.id === item.surplusId), needs.find((n) => n.id === item.needId))).join('') || '<p class="empty-state">No transfers yet. Allocate a match to start your first handoff.</p>'}
    </section>
    <div class="handoff-steps"><div class="handoff-step"><span class="step-icon">01</span><div><strong>NGO checks out</strong><p>${liveMode ? 'Free orders are recorded in Odoo.' : 'Demo order and payment are simulated.'}</p></div></div><div class="step-connector"></div><div class="handoff-step"><span class="step-icon">02</span><div><strong>Company fulfils</strong><p>Company chooses carrier, pays transport, and records ETA.</p></div></div><div class="step-connector"></div><div class="handoff-step"><span class="step-icon">03</span><div><strong>NGO receives</strong><p>Check the delivered items and confirm receipt.</p></div></div></div>`;
}

function transfersForCurrentPortal(surplus, needs, transfers) {
  return session?.role === 'admin' ? transfers : session?.role === 'ngo'
    ? transfers.filter((transfer) => needs.find((need) => need.id === transfer.needId)?.organization === session.name)
    : transfers.filter((transfer) => surplus.find((item) => item.id === transfer.surplusId)?.donor === session.name);
}

function renderReports(surplus, needs, transfers) {
  const days = { '7d': 7, '30d': 30, '90d': 90, all: Infinity }[reportRange] ?? 30;
  const report = buildTransferReport(transfersForCurrentPortal(surplus, needs, transfers), surplus, reportRange);
  const records = report.records;
  const windowLabel = reportRange === 'all' ? 'All recorded activity' : `Last ${days} days`;
  const maxTrend = Math.max(1, ...report.trend.map((bucket) => bucket.count));
  const statuses = [['Needs approval', 'pending'], ['Approved', 'approved'], ['In transit', 'in_transit'], ['Delivered', 'delivered']];
  return `${pageHeading('MEASURE WHAT MATTERS', 'Reports', 'A clear view of completed handoffs and activity in your workspace.', '<button class="button button-outline" data-action="export-report">↓ Export CSV</button>')}
    <div class="report-toolbar"><label><span>REPORTING PERIOD</span><select id="report-range"><option value="7d" ${reportRange === '7d' ? 'selected' : ''}>Last 7 days</option><option value="30d" ${reportRange === '30d' ? 'selected' : ''}>Last 30 days</option><option value="90d" ${reportRange === '90d' ? 'selected' : ''}>Last 90 days</option><option value="all" ${reportRange === 'all' ? 'selected' : ''}>All recorded activity</option></select></label><span class="report-hint">Showing ${windowLabel.toLowerCase()} · ${records.length} handoffs</span></div>
    <section class="metric-grid report-metrics">${metricCard('Completed handoffs', report.deliveredCount, windowLabel, '✓')}${metricCard('Food rescued', `${currency(report.mealsEstimated)} <small>meals*</small>`, 'Food-only estimate from delivered quantities', '↗', 'peach')}${metricCard('Food diverted', `${currency(report.kilogramsEstimated)} <small>kg*</small>`, 'Food-only estimate, not a weighing record', '◌', 'lavender')}${metricCard('Active handoffs', report.activeCount, 'Pending, approved, or in transit', '⇄', 'yellow')}</section>
    <section class="report-grid"><article class="panel report-chart-panel"><div class="section-header"><div><div class="eyebrow">DELIVERED HANDOFFS</div><h2>Activity over time</h2></div><span class="chart-legend"><i></i> Deliveries</span></div><div class="report-chart" role="img" aria-label="Delivered handoffs by time period">${report.trend.map((bucket) => `<div class="chart-column"><strong>${bucket.count || ''}</strong><div class="chart-track"><i style="height:${bucket.count ? Math.max(8, bucket.count / maxTrend * 100) : 3}%"></i></div><small>${new Intl.DateTimeFormat('en', reportRange === 'all' ? { month: 'short' } : { month: 'numeric', day: 'numeric' }).format(new Date(bucket.start))}</small></div>`).join('')}</div></article><article class="panel report-status-panel"><div class="section-header"><div><div class="eyebrow">HANDOFF PIPELINE</div><h2>By status</h2></div></div>${statuses.map(([label, status]) => `<div class="status-summary-row"><span>${label}</span><strong>${report.statusCounts[status]}</strong></div>`).join('')}<div class="report-status-note">Partner actions update these ${liveMode ? 'Odoo-backed' : 'demo'} totals as a handoff progresses.</div></article></section>
    <section class="panel report-table-panel"><div class="section-header"><div><div class="eyebrow">THE PAPER TRAIL</div><h2>Handoff details <span class="muted-count">${records.length}</span></h2></div><button class="link-button" data-action="export-report">Download CSV →</button></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Resource shared</th><th>Community partner</th><th>Quantity</th><th>Status</th><th>Date</th></tr></thead><tbody>${[...records].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((record) => { const item = surplus.find((entry) => entry.id === record.surplusId); const need = needs.find((entry) => entry.id === record.needId); return `<tr><td>${escapeHtml(item?.title ?? 'Resource donation')}<small>${escapeHtml(resourceTypeOf(item ?? {}))} · ${escapeHtml(item?.category ?? 'Other')}</small></td><td>${escapeHtml(need?.organization ?? 'Community partner')}</td><td>${record.quantity} ${escapeHtml(item?.unit ?? 'items')}</td><td><span class="transfer-status ${record.status}">${statusLabels[record.status]}</span></td><td>${new Date(record.createdAt).toLocaleDateString()}</td></tr>`; }).join('') || '<tr><td colspan="5" class="report-empty">No handoffs for this reporting period yet.</td></tr>'}</tbody></table></div><p class="report-footnote">* Impact conversions count food items only and are illustrative estimates—not independently measured outcomes.${liveMode ? '' : ' All figures are local demo data and are not connected to Odoo.'}</p></section>`;
}

function renderImpact(metrics, transfers) {
  const deliveredCount = transfers.filter((item) => item.status === 'delivered').length;
  return `${pageHeading('GOOD IN MOTION', 'Your impact', 'A little surplus can make a lot of difference.', '<button class="button button-outline" data-action="toast" data-message="Your impact report is ready to share.">↗ Share impact</button>')}
    <div class="impact-hero"><div class="impact-hero-copy"><span class="impact-spark">✳</span><div class="eyebrow">MEADOW &amp; FIG · THIS YEAR</div><h2>Abundance,<br />put to good use.</h2><p>Every rescued item is a small win for our people and our planet.</p></div><div class="impact-orbit"><div class="orbit-ring"></div><div class="orbit-content"><span>MEALS<br />RESCUED</span><strong>${currency(metrics.mealsRescued)}</strong><small>and counting</small></div></div></div>
    <section class="impact-metrics">${metricCard('Food diverted', `${currency(metrics.kgDiverted)} <small>kg</small>`, 'Equivalent to 1,412 kg CO₂e avoided', '◌', 'peach')}${metricCard('People reached', currency(metrics.peopleReached), `Across ${metrics.partnerOrgs} local organizations`, '♧', 'lavender')}${metricCard('Successful handoffs', deliveredCount, 'Every one made a real difference', '✓', 'green')}</section>
    <div class="impact-bottom"><section class="panel impact-story"><div class="eyebrow">A COMMUNITY WIN</div><h2>“The produce boxes gave us a fresh start to the week.”</h2><p>— Maya, Harbor House Pantry</p><span class="story-flower">✳</span></section><section class="panel impact-breakdown"><div class="section-header"><div><div class="eyebrow">THIS MONTH</div><h2>Your contribution</h2></div></div><div class="breakdown-row"><span>Meals rescued</span><strong>${currency(metrics.mealsThisMonth)}</strong></div><div class="progress-bar"><i style="width:${Math.min(100, metrics.mealsThisMonth / 4)}%"></i></div><div class="breakdown-caption"><span>Monthly goal: 400 meals</span><span>${Math.min(100, Math.round(metrics.mealsThisMonth / 4))}%</span></div><div class="impact-partners"><span class="avatar-stack"><i>HH</i><i>SY</i><i>WT</i><i>+9</i></span><span>Making it happen together</span></div></section></div>`;
}

function renderNgoOverview(surplus, needs, transfers, metrics, verified) {
  const mine = needs.filter((need) => need.organization === session.name);
  const matches = buildMatches(surplus, mine).slice(0, 3);
  const gate = verified ? '' : '<div class="verification-banner"><span>◷</span><div><strong>Your partner review is in progress.</strong><p>You can explore Refound while your organization is reviewed. Publishing needs and accepting allocations require approval.</p></div><button class="text-button" data-view="verification">View status →</button></div>';
  return `${pageHeading(todayLabel(), `Welcome, ${escapeHtml(session.name)} <span class="heading-wave">✳</span>`, 'Make community needs easier to see—and good food easier to share.', verified ? '<button class="button button-primary" data-action="open-need"><span>＋</span> Share a need</button>' : '<button class="button button-outline" data-view="verification">Complete organization verification →</button>')}
    ${gate}<section class="metric-grid">${metricCard('Your open requests', mine.filter((need) => need.quantity > 0).length, 'Across your organization', '♡', 'lavender')}${metricCard('Potential matches', matches.length, 'Shared surplus to review', '⤳')}${metricCard('People reached', currency(metrics.peopleReached), 'Together with local partners', '♧', 'lavender')}${metricCard('Food saved', `${currency(metrics.kgDiverted)} <small>kg</small>`, 'Across the Refound network', '◌', 'peach')}</section>
    <section class="overview-grid"><div class="panel"><div class="section-header"><div><div class="eyebrow">YOUR OPEN REQUESTS</div><h2>Community needs</h2></div><button class="link-button" data-view="my-needs">View all →</button></div>${mine.slice(0, 3).map(needCard).join('') || '<p class="empty-state">Share your first community need to get started.</p>'}</div><div class="panel"><div class="section-header"><div><div class="eyebrow">POSSIBILITIES NEARBY</div><h2>Best surplus matches</h2></div><button class="link-button" data-view="matches">View matches →</button></div>${matches.map((match) => `<div class="match-row"><div class="match-badge">${match.score}<small>%</small></div><div class="match-copy"><strong>${escapeHtml(match.surplus.title)}</strong><p>${match.quantity} ${escapeHtml(match.surplus.unit)} · ${escapeHtml(match.surplus.donor ?? 'Local partner')}</p></div></div>`).join('') || '<p class="empty-state">Add an open request to see potential matches.</p>'}</div></section>`;
}

function renderAdminOverview(applications, transfers, metrics) {
  const pending = applications.filter((item) => item.status === 'pending').length;
  return `${pageHeading('REFOUND OPERATIONS', 'Admin overview <span class="heading-wave">✳</span>', 'Review partner applications and monitor marketplace operations.', '<button class="button button-primary" data-view="admin-verifications">Review applications <span>→</span></button>')}
    ${liveMode ? '' : '<div class="admin-demo-alert">⚠ Prototype only — this role selector is not administrator authentication or an access-control boundary.</div>'}
    <section class="metric-grid">${metricCard('Pending reviews', pending, 'Organization applications', '◷', 'yellow')}${metricCard(liveMode ? 'Verified partners' : 'Verified demo partners', applications.filter((item) => item.status === 'approved').length, 'Business &amp; community', '✓')}${metricCard('Active handoffs', transfers.filter((item) => ['pending', 'approved', 'in_transit'].includes(item.status)).length, 'Require partner coordination', '⇄', 'lavender')}${metricCard('Meals rescued', currency(metrics.mealsRescued), liveMode ? 'Network total' : 'Demo network lifetime', '↗')}</section>
    <section class="admin-shortcuts"><button data-view="admin-verifications"><span>01</span><strong>Review organization applications</strong><small>Check details, then approve or decline.</small><i>→</i></button><button data-view="admin-organizations"><span>02</span><strong>View partner organizations</strong><small>${liveMode ? 'See Odoo verification statuses.' : 'See demo verification statuses.'}</small><i>→</i></button><button data-view="transfers"><span>03</span><strong>Monitor handoffs</strong><small>Follow each handoff to delivery.</small><i>→</i></button></section>`;
}

function renderMyNeeds(needs, verified) {
  const mine = needs.filter((need) => need.organization === session.name);
  const action = verified
    ? '<button class="button button-primary" data-action="open-need"><span>＋</span> Share a need</button>'
    : '<button class="button button-outline" data-view="verification">Verify organization first →</button>';
  return `${pageHeading('YOUR ORGANIZATION', 'My requests', 'Keep community needs clear, current, and easy to match.', action)}${!verified ? '<div class="verification-banner"><span>◷</span><div><strong>Posting is enabled after organization review.</strong><p>Your draft requests are not public while the partner application is pending.</p></div><button class="text-button" data-view="verification">View status →</button></div>' : ''}<div class="needs-grid">${mine.map(needCard).join('') || '<div class="empty-panel">No requests from your organization yet. Share your first community need when you’re ready.</div>'}</div>`;
}

async function openNeedModal() {
  if (session?.role !== 'ngo') return toast('Only community organizations can post a request.');
  if (!await isVerified()) {
    activeView = 'verification';
    await render();
    toast('Organization approval is required before posting a request.');
    return;
  }
  openModal(`<button class="modal-close" data-action="close-modal" aria-label="Close">×</button><div class="eyebrow">NGO REQUIREMENT · DETAILED SPECIFICATION</div><h2>Tell companies exactly what helps</h2><p class="modal-intro">A complete requirement makes it easier for a company to check stock, confirm price, and arrange delivery to your receiving point.</p><form id="need-form" class="listing-form"><div class="form-grid"><label><span>Resource type</span><select name="resourceType">${RESOURCE_TYPES.map((type) => `<option>${escapeHtml(type)}</option>`).join('')}</select></label><label><span>Specific category</span><select name="category">${RESOURCE_CATEGORIES.Food.map((category) => `<option>${escapeHtml(category)}</option>`).join('')}</select></label><label><span>Quantity required</span><input name="quantity" type="number" min="1" max="9999" value="20" required /></label><label><span>Unit</span><input name="unit" required maxlength="24" list="need-units" value="boxes" placeholder="e.g. boxes, devices, kg" /><datalist id="need-units"><option>boxes</option><option>loaves</option><option>meals</option><option>crates</option><option>kg</option><option>kits</option><option>sets</option><option>books</option><option>coats</option><option>items</option><option>pairs</option><option>devices</option></datalist></label><label><span>Priority</span><select name="urgency"><option value="standard">Standard</option><option value="high">High</option><option value="critical">Critical</option></select></label><label><span>Need delivered by</span><input name="neededBy" type="datetime-local" required /></label><label><span>Maximum price per unit (AED)</span><input name="maxPriceAED" type="number" min="0" max="100000" step="0.01" value="0" required /><small class="form-help">AED 0 means donations only. Company delivery costs are arranged directly and shown separately.</small></label><label><span>Minimum remaining shelf life</span><input name="expiresAt" type="date" /><small class="form-help">Leave blank for non-expiring items. Food/medical resources must still be unexpired on arrival.</small></label><label class="form-wide"><span>Minimum acceptable condition</span><input name="preferredCondition" maxlength="160" placeholder="New/sealed, tested/working, clean/gently used…" /></label><label class="form-wide"><span>Exact specifications and exclusions</span><textarea name="specifications" rows="3" maxlength="700" placeholder="Brand/model, size, school year/edition, allergen limits, sealed status, parts included…"></textarea></label><label class="form-wide"><span>Delivery address / receiving point</span><input name="location" required maxlength="180" placeholder="District, receiving entrance, service hours, and delivery instructions" /></label><label class="form-wide"><span>Receiving, cold-chain, or storage arrangements</span><textarea name="storageInstructions" rows="2" maxlength="500" placeholder="Who can accept delivery, refrigeration capacity, access hours, loading point…"></textarea></label><label class="form-wide"><span>Why this resource is needed</span><textarea name="note" rows="3" required maxlength="700" placeholder="Who will use it, when needed, how many people it supports, and any context for the company."></textarea></label></div><div class="form-error" id="need-error" role="alert"></div><div class="logistics-notice"><strong>Your organization posts the requirement.</strong> The company confirms stock and price, collects payment through the demo checkout, and is responsible for arranging delivery. Discuss delivery costs directly before confirming.</div><button class="button button-primary modal-main-action" type="submit">Publish detailed requirement <span>→</span></button></form>`);
  updateNeedTypeControls('Food');
  const neededBy = modalRoot.querySelector('[name="neededBy"]');
  const soon = new Date(Date.now() + 24 * 3_600_000);
  soon.setMinutes(0, 0, 0);
  neededBy.value = new Date(soon.getTime() - soon.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function updateNeedTypeControls(resourceType) {
  const form = modalRoot.querySelector('#need-form');
  if (!form) return;
  const categories = RESOURCE_CATEGORIES[resourceType] ?? RESOURCE_CATEGORIES.Food;
  form.elements.namedItem('category').innerHTML = categories.map((item) => `<option>${escapeHtml(item)}</option>`).join('');
}

async function openAddToCartModal(surplusId, needId) {
  if (session?.role !== 'ngo') {
    toast('A verified NGO requestor adds matched resources to its basket. Companies publish stock and fulfil paid orders.');
    return;
  }
  if (!await isVerified()) {
    activeView = 'verification';
    await render();
    toast('Your organization needs approval before ordering.');
    return;
  }
  const [surplus, needs] = await Promise.all([service.getSurplus(), service.getNeeds()]);
  const item = surplus.find((record) => record.id === surplusId);
  const ownNeeds = needs.filter((record) => record.organization === session.name && record.quantity > 0);
  const need = ownNeeds.find((record) => record.id === needId) ?? ownNeeds.find((record) => scoreMatch(item, record));
  const match = item && need ? scoreMatch(item, need) : null;
  if (!item || !need || !match) return toast('This resource no longer meets your request, expiry, or price budget.');
  openModal(`<button class="modal-close" data-action="close-modal" aria-label="Close">×</button><div class="eyebrow">REVIEW REQUEST &amp; COMPANY OFFER</div><h2>Add to your resource basket</h2><p class="modal-intro">Refound records the order and product payment. The company will contact you to agree delivery, any transport charge, and the arrival time.</p><div class="order-review-card"><div><span>RESOURCE</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(resourceTypeOf(item))} · ${escapeHtml(item.category)}</small></div><div><span>CONDITION / SPECS</span><strong>${escapeHtml(item.condition || 'Ask the company')}</strong><small>${escapeHtml(item.specifications || item.notes || 'Confirm exact item details with the company.')}</small></div><div><span>NGO REQUIREMENT</span><strong>${escapeHtml(need.organization)} · ${escapeHtml(need.quantity)} ${escapeHtml(need.unit)}</strong><small>${escapeHtml(need.specifications || need.note)}</small></div><div><span>EXPIRY / STORAGE</span><strong>${item.expiresAt ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(item.expiresAt)) : 'No item expiry declared'}</strong><small>${escapeHtml(item.storageInstructions || 'Ask the company for handling requirements.')}</small></div></div><div class="order-price-line"><span>Resource price</span><strong>${item.priceAED > 0 ? `AED ${Number(item.priceAED).toFixed(2)} / ${escapeHtml(item.unit)}` : 'Free donation'}</strong></div><div class="order-price-line"><span>Delivery logistics</span><strong>Agreed directly with company</strong></div><form id="add-to-cart-form"><label class="field-label" for="cart-quantity">Quantity · ${escapeHtml(item.unit)} (budget max AED ${Number(need.maxPriceAED ?? 0).toFixed(2)} per unit)</label><input id="cart-quantity" name="quantity" type="number" min="1" max="${match.quantity}" value="${match.quantity}" required /><p class="form-help">Available now: ${item.quantity} ${escapeHtml(item.unit)}. Request remaining: ${need.quantity} ${escapeHtml(need.unit)}. Payment at checkout covers the resource only; delivery is coordinated by the selling company.</p><button type="submit" class="button button-primary modal-main-action">Add to basket <span>→</span></button></form>`);
  modalRoot.querySelector('#add-to-cart-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = Number(new FormData(event.currentTarget).get('quantity'));
    try {
      await service.addToCart(item.id, need.id, amount, session.name);
      closeModal();
      toast('Added to your basket. Review the payment and order details before checkout.');
      activeView = 'cart';
      await render();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to add this item to your basket.');
    }
  });
}

function renderCart(surplus, needs) {
  const basket = service.getCart().filter((line) => line.buyerOrganization === session?.name);
  const lines = basket.map((line) => ({
    line,
    item: surplus.find((record) => record.id === line.surplusId),
    need: needs.find((record) => record.id === line.needId),
  })).filter(({ item, need }) => item && need);
  const itemTotal = lines.reduce((sum, { line, item }) => sum + Number(item.priceAED ?? 0) * line.quantity, 0);
  const orderTotal = Math.round(itemTotal * 100) / 100;
  const verified = session?.role === 'ngo';
  const livePaymentBlocked = liveMode && orderTotal > 0;
  const paymentPanel = liveMode
    ? `<p class="payment-disclaimer">${orderTotal ? 'Live Odoo payment is not enabled. Paid orders are blocked until the organization activates a payment provider.' : 'No resource charge is due. A free order will be recorded in Odoo; the company will arrange delivery.'}</p>`
    : `<label class="cart-payment-choice"><span>Payment method · demo only</span><select id="cart-payment-method"><option value="demo-card">Card payment simulation</option><option value="demo-bank-transfer">Bank transfer simulation</option></select></label><p class="payment-disclaimer">No real payment or gateway request is made. Product payments are simulated in local demo storage. Delivery is not included and is arranged by the company with your organization.</p>`;
  return `${pageHeading('NGO RESOURCE BASKET', 'Review your order', 'Check item detail, quantity, request and item price before confirming the order.', '')}${!verified ? '<div class="verification-banner"><span>◷</span><div><strong>NGO checkout requires organization verification.</strong><p>A company arranges the delivery after accepting your paid or donation order.</p></div><button class="text-button" data-view="verification">View status →</button></div>' : ''}
    ${lines.length ? `<div class="cart-layout"><section class="cart-lines">${lines.map(({ line, item, need }) => `<article class="cart-line"><div class="cart-product-icon ${categoryColors(resourceTypeOf(item))}">${icon(resourceTypeOf(item))}</div><div class="cart-product-copy"><span class="category-tag ${categoryColors(resourceTypeOf(item))}">${escapeHtml(resourceTypeOf(item))} · ${escapeHtml(item.category)}</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.donor ?? 'Company')} · ${escapeHtml(item.location)}</p><p class="cart-request-context">Fulfils: <strong>${escapeHtml(need.organization)}</strong> · ${escapeHtml(need.specifications || need.note)}</p><div class="cart-detail-tags"><span>Condition: ${escapeHtml(item.condition || 'Confirm with company')}</span>${item.expiresAt ? `<span>Use by: ${new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(item.expiresAt))}</span>` : ''}<span>${escapeHtml(item.storageInstructions || 'Handling: confirm with company')}</span></div></div><div class="cart-line-controls"><strong>${item.priceAED > 0 ? `AED ${(Number(item.priceAED) * line.quantity).toFixed(2)}` : 'Free'}</strong><span>${item.priceAED > 0 ? `AED ${Number(item.priceAED).toFixed(2)} / ${escapeHtml(item.unit)}` : 'No resource charge'}</span><input aria-label="Quantity ${escapeHtml(item.title)}" type="number" min="1" max="${Math.min(item.quantity, need.quantity)}" value="${line.quantity}" data-cart-quantity="${escapeHtml(line.key)}" /><button class="text-button" data-action="remove-cart-line" data-key="${escapeHtml(line.key)}">Remove</button></div></article>`).join('')}</section><aside class="cart-summary"><div class="section-label">ORDER SUMMARY</div><h2>One clear total.</h2><div class="order-price-line"><span>Resources (${lines.length} line${lines.length === 1 ? '' : 's'})</span><strong>${orderTotal ? `AED ${orderTotal.toFixed(2)}` : 'Free'}</strong></div><div class="order-price-line"><span>Delivery</span><strong>Agreed directly with company</strong></div><div class="cart-summary-total"><span>Product total</span><strong>AED ${orderTotal.toFixed(2)}</strong></div>${paymentPanel}<button class="button button-primary button-large cart-checkout" data-action="checkout" ${verified && !livePaymentBlocked ? '' : 'disabled'}>${livePaymentBlocked ? 'Odoo payment provider required' : 'Confirm & place order'} <span>→</span></button><button class="text-button cart-continue" data-view="matches">← Back to matched resources</button></aside></div>` : '<div class="empty-panel">Your basket is empty. Open Smart matches, choose your requirement, then add a compatible company resource.<br /><br /><button class="button button-primary" data-view="matches">Browse matched resources →</button></div>'}`;
}

async function renderMessages(surplus, needs, transfers) {
  const visible = transfersForCurrentPortal(surplus, needs, transfers);
  const conversations = [...new Map(visible.map((transfer) => {
    const id = transfer.orderId ?? transfer.id;
    return [id, { id, transfer, surplus: surplus.find((item) => item.id === transfer.surplusId), need: needs.find((item) => item.id === transfer.needId) }];
  })).values()];
  if (!selectedConversation || !conversations.some((thread) => thread.id === selectedConversation)) selectedConversation = conversations[0]?.id ?? '';
  const selected = conversations.find((thread) => thread.id === selectedConversation);
  const messages = selected ? await service.getMessages(selected.id) : [];
  return `${pageHeading('KEEP THE HANDOFF CLEAR', 'Order messages', 'Discuss product details, payment confirmation, delivery cost, carrier and arrival time in one place.', '')}
    ${conversations.length ? `<div class="message-layout"><aside class="message-inbox"><div class="section-label">YOUR ORDER THREADS</div>${conversations.map((thread) => `<button class="message-thread-button ${thread.id === selectedConversation ? 'active' : ''}" data-action="select-conversation" data-id="${escapeHtml(thread.id)}"><strong>${escapeHtml(thread.need?.organization ?? 'Community partner')}</strong><small>${escapeHtml(thread.surplus?.title ?? 'Resource order')}</small><span>${escapeHtml(statusLabels[thread.transfer.status])}</span></button>`).join('')}</aside><section class="message-panel"><div class="message-panel-head"><div><div class="section-label">${escapeHtml(statusLabels[selected.transfer.status])}</div><h2>${escapeHtml(selected.surplus?.title ?? 'Resource order')}</h2><p>${escapeHtml(selected.need?.organization ?? 'Receiving organization')} · ${selected.transfer.quantity} ${escapeHtml(selected.surplus?.unit ?? 'items')}</p></div><span class="order-message-partner">${session?.role === 'company' ? escapeHtml(selected.need?.organization ?? 'Partner') : escapeHtml(selected.surplus?.donor ?? 'Company')}</span></div><div class="message-stream">${messages.map((message) => `<article class="message-bubble ${message.senderOrganization === session.name ? 'own' : ''}"><strong>${escapeHtml(message.senderOrganization)}${message.senderRole === 'admin' ? ' · Refound team' : ''}</strong><p>${escapeHtml(message.body)}</p><small>${shortDate(message.createdAt)}</small></article>`).join('') || '<div class="empty-state">Start the conversation. Confirm the product specifics and agree delivery directly with the company.</div>'}</div><form id="order-message-form" class="order-message-form" data-order="${escapeHtml(selected.id)}"><textarea name="message" rows="2" maxlength="1500" required placeholder="Message your order partner…"></textarea><button class="button button-primary">Send <span>→</span></button></form></section></div>` : '<div class="empty-panel">Order conversations appear here after an NGO places an order. Browse requests and matching resources to get started.</div>'}`;
}

async function render() {
  if (!root) return;
  document.title = `${names[activeView] ?? 'Refound'} — Refound`;
  const applications = session ? await verificationService.getApplications() : [];
  const leads = session?.role === 'admin' && !liveMode ? await salesService.getLeads() : [];
  const publicHeader = document.querySelector('#public-header');
  if (!session || publicViews.has(activeView)) {
    document.body.classList.add('public-mode');
    document.body.classList.toggle('signed-in-public', Boolean(session));
    document.body.removeAttribute('data-role');
    publicHeader.innerHTML = renderPublicHeader(activeView, session);
    document.querySelector('#workspace-nav').innerHTML = '';
    root.innerHTML = renderPublicPage(activeView, { applications, session, verificationRole, liveMode, loginPath: liveLoginPath });
    return;
  }
  const menu = portalMenus[session.role];
  if (!menu?.some(([view]) => view === activeView)) activeView = 'overview';
  document.body.classList.remove('public-mode', 'signed-in-public');
  document.body.dataset.role = session.role;
  publicHeader.innerHTML = '';
  const nav = document.querySelector('#workspace-nav');
  const visibleMenu = liveMode ? menu.filter(([view]) => !['admin-sales-leads', 'cart'].includes(view)) : menu;
  nav.innerHTML = visibleMenu.map(([view, label, glyph]) => `<button class="nav-item ${activeView === view ? 'active' : ''}" data-view="${view}"><span class="nav-icon">${glyph}</span>${label}${view === 'surplus' ? '<span class="nav-count" id="surplus-count"></span>' : ''}${view === 'my-needs' ? '<span class="nav-count" id="my-needs-count"></span>' : ''}${view === 'cart' ? `<span class="nav-count">${service.getCart().filter((line) => line.buyerOrganization === session.name).length || ''}</span>` : ''}${view === 'matches' ? '<span class="nav-count match-count"></span>' : ''}${view === 'transfers' ? '<span class="nav-count transfer-count"></span>' : ''}${view === 'admin-verifications' ? `<span class="nav-count ${applications.filter((item) => item.status === 'pending').length ? 'pending-count' : ''}">${applications.filter((item) => item.status === 'pending').length || ''}</span>` : ''}${view === 'admin-sales-leads' && leads.filter((lead) => lead.status === 'new').length ? `<span class="nav-count">${leads.filter((lead) => lead.status === 'new').length}</span>` : ''}</button>`).join('') + '<div class="nav-divider"></div>';
  if (session.role === 'admin') {
    nav.innerHTML += '<div class="workspace-label">HELP &amp; INFO</div><button class="nav-item" data-view="faq"><span class="nav-icon">?</span>FAQs</button><button class="nav-item" data-view="pricing"><span class="nav-icon">◇</span>Membership pricing</button><button class="nav-item" data-view="privacy"><span class="nav-icon">◈</span>Privacy policy</button>';
  }
  document.querySelector('#workspace-label').textContent = session.role === 'admin' ? 'ADMIN CONSOLE' : session.role === 'ngo' ? 'COMMUNITY WORKSPACE' : 'BUSINESS WORKSPACE';
  const shortName = session.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  document.querySelector('#profile-name').textContent = session.name;
  document.querySelector('#profile-role').textContent = `${session.role === 'admin' ? 'Refound administrator' : session.role === 'ngo' ? 'Community partner' : 'Business partner'}${liveMode ? '' : ' · demo'}`;
  document.querySelector('#profile-avatar').textContent = shortName;
  document.querySelector('#topbar-avatar').textContent = shortName;
  document.querySelector('#topbar-account').textContent = session.name;
  document.querySelector('#page-breadcrumb').textContent = names[activeView] ?? activeView;
  document.querySelector('.live-status').innerHTML = liveMode ? '<i></i> Odoo-backed · secured' : '<i></i> Demo · Not connected to Odoo';
  const [surplus, needs, transfers, metrics] = await getData();
  const verified = session.role === 'admin' || await isVerified();
  const renderers = {
    overview: () => session.role === 'admin'
      ? renderAdminOverview(applications, transfers, metrics)
      : session.role === 'ngo'
        ? renderNgoOverview(surplus, needs, transfers, metrics, verified)
        : renderOverview(surplus, needs, transfers, metrics, verified),
    surplus: () => renderSurplus(surplus),
    needs: () => renderNeeds(needs),
    'my-needs': () => renderMyNeeds(needs, verified),
    matches: () => renderMatches(surplus, needs),
    cart: () => renderCart(surplus, needs),
    messages: () => renderMessages(surplus, needs, transfers),
    transfers: () => renderTransfers(surplus, needs, transfers),
    reports: () => renderReports(surplus, needs, transfers),
    impact: () => renderImpact(metrics, transfers),
    'admin-verifications': () => renderPublicPage('admin-verifications', { applications, liveMode }),
    'admin-organizations': () => renderPublicPage('admin-organizations', { applications, liveMode }),
    'admin-sales-leads': () => liveMode ? pageHeading('SALES CRM NOT CONNECTED', 'Sales enquiry inbox', 'Connect your CRM or Odoo lead model before collecting live sales enquiries.') : renderPublicPage('admin-sales-leads', { leads }),
    pricing: () => renderPublicPage('pricing', { session }),
    sales: () => renderPublicPage('sales', { session }),
    assistant: () => renderPublicPage('assistant', { applications, session, assistantMessages }),
    faq: () => renderPublicPage('faq'),
    privacy: () => renderPublicPage('privacy'),
  };
  root.innerHTML = await (renderers[activeView] ?? renderers.overview)();
  document.querySelectorAll('#workspace-nav .nav-item[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === activeView));
  const surplusCount = document.querySelector('#surplus-count');
  if (surplusCount) surplusCount.textContent = String(surplus.filter((item) => item.status === 'available' && (session.role === 'admin' || item.donor === session.name)).length);
  const needCount = document.querySelector('#my-needs-count');
  if (needCount) needCount.textContent = String(needs.filter((item) => item.organization === session.name && item.quantity > 0).length);
  const visibleSurplus = session.role === 'company' ? surplus.filter((item) => item.donor === session.name) : surplus;
  const visibleNeeds = session.role === 'ngo' ? needs.filter((item) => item.organization === session.name) : needs;
  document.querySelectorAll('.match-count').forEach((node) => node.textContent = String(buildMatches(visibleSurplus, visibleNeeds).length));
  document.querySelectorAll('.transfer-count').forEach((node) => node.textContent = String(transfersForCurrentPortal(surplus, needs, transfers).filter((item) => item.status === 'pending').length));
}

async function configureBackend() {
  try {
    const healthResponse = await fetch('/api/health', { credentials: 'same-origin', cache: 'no-store' });
    if (healthResponse.status === 404) {
      await render();
      return;
    }
    const health = await healthResponse.json();
    if (!healthResponse.ok) throw new Error(health.error || `Refound service returned ${healthResponse.status}.`);
    if (health.mode === 'misconfigured') throw new Error(`Odoo is only partially configured. Add: ${(health.missingSettings ?? []).join(', ')}.`);
    if (health.mode !== 'odoo') {
      await render();
      return;
    }
    liveMode = true;
    liveLoginPath = typeof health.loginPath === 'string' ? health.loginPath : '/api/session';
    service = new OdooApiResourceService();
    verificationService = new OdooApiVerificationService();
    const sessionResponse = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
    if (sessionResponse.ok) {
      session = await sessionResponse.json();
      if (!session || !['company', 'ngo', 'admin'].includes(session.role)) throw new Error('The identity provider returned an unsupported Refound role.');
      activeView = 'overview';
    } else {
      session = null;
      activeView = 'login';
    }
    await render();
  } catch (error) {
    console.error('Unable to initialize the configured Refound service.', error);
    root.innerHTML = `<section class="service-error"><span class="section-label">REF0UND SERVICE CONNECTION</span><h1>We couldn’t connect.</h1><p>${escapeHtml(error instanceof Error ? error.message : 'The configured service is unavailable.')}</p><p>Check that the Refound backend, identity proxy, and Odoo connection are available before trying again.</p><button class="button button-outline" data-action="retry-service">Try again</button></section>`;
  }
}

function toast(message) {
  const element = document.createElement('div');
  element.className = 'toast';
  element.innerHTML = `<span>✓</span>${escapeHtml(message)}`;
  toastRegion?.append(element);
  window.setTimeout(() => element.remove(), 3400);
}

function openModal(content) {
  if (!modalRoot) return;
  modalRoot.innerHTML = `<section class="modal" role="dialog" aria-modal="true">${content}</section>`;
  modalRoot.hidden = false;
  document.body.classList.add('modal-open');
  modalRoot.querySelector('[autofocus]')?.focus();
}

function closeModal() {
  if (modalRoot) { modalRoot.hidden = true; modalRoot.innerHTML = ''; }
  document.body.classList.remove('modal-open');
}

async function openListingModal() {
  if (session?.role !== 'company') return toast('Only verified business partners can list surplus resources.');
  if (!await isVerified()) {
    activeView = 'verification';
    await render();
    toast('Organization approval is required before listing surplus.');
    return;
  }
  openModal(`<button class="modal-close" data-action="close-modal" aria-label="Close">×</button><div class="eyebrow">COMPANY LISTING · DETAILED RESOURCE RECORD</div><h2>List surplus resources</h2><p class="modal-intro">NGOs need enough detail to check suitability. Describe the item, its condition, restrictions, availability, price, and any date that affects safe use.</p>
    <label class="field-label" for="description-input">Describe your resource</label><textarea id="description-input" class="text-area" placeholder="e.g. 18 sealed first-aid kits, manufacturer expiry in 45 days, kept dry at ambient temperature" autofocus></textarea>
    <div class="ai-hint"><span>✳</span><span><strong>AI-style draft extraction</strong> suggests resource type, category, quantity, and expiry from your description. Check the source label and correct every field.</span></div>
    <button class="button button-primary modal-main-action" data-action="extract-details">✳ &nbsp; Organize details</button><div class="modal-or"><span>OR ADD DETAILS MANUALLY</span></div>
    <form id="listing-form" class="listing-form">
      <div class="form-grid"><label><span>Resource type</span><select name="resourceType">${RESOURCE_TYPES.map((type) => `<option>${escapeHtml(type)}</option>`).join('')}</select></label><label><span>Specific category</span><select name="category">${RESOURCE_CATEGORIES.Food.map((category) => `<option>${escapeHtml(category)}</option>`).join('')}</select></label>
      <label class="form-wide"><span>Listing title</span><input name="title" required maxlength="120" placeholder="Brand/model, product, size, edition, or pack details" /></label>
      <label><span>Usable quantity</span><input name="quantity" required type="number" min="1" max="9999" value="10" /></label>
      <label><span>Unit</span><input name="unit" required maxlength="24" list="resource-units" value="boxes" placeholder="e.g. boxes, devices, kg" /><datalist id="resource-units"><option>boxes</option><option>loaves</option><option>meals</option><option>crates</option><option>kg</option><option>kits</option><option>sets</option><option>books</option><option>coats</option><option>items</option><option>pairs</option><option>devices</option></datalist></label>
      <label><span>Price per unit (AED)</span><input name="priceAED" type="number" min="0" max="100000" step="0.01" value="0" required /><small class="form-help">Enter 0 for a donation. Any purchase payment is simulated in this demo.</small></label>
      <label><span>Order-by window</span><select name="expiryHours"><option value="8">Company can fulfil today</option><option value="24">Within 24 hours</option><option value="48">Within 2 days</option><option value="72">Within 3 days</option><option value="168">Within 7 days</option></select></label>
      <label class="form-wide"><span>Use-by / manufacturer expiry <small class="item-expiry-hint">(required for food and medical equipment)</small></span><input name="expiresAt" type="date" /><small class="form-help">Use the actual package/device label. The company must not dispatch after this date; the NGO can set its own minimum remaining shelf life.</small></label>
      <label class="form-wide"><span>Condition</span><input name="condition" required maxlength="160" placeholder="New, sealed; tested; grade; wear; defects; recalls checked…" /></label>
      <label class="form-wide"><span>Specifications &amp; restrictions</span><textarea name="specifications" maxlength="700" rows="2" placeholder="Brand/model, dimensions, grade/edition, sizes, ingredients/allergens, sealed status, age…"></textarea></label>
      <label class="form-wide"><span>Storage &amp; handling instructions</span><textarea name="storageInstructions" maxlength="500" rows="2" placeholder="Temperature, cold-chain, fragile handling, battery/storage guidance…"></textarea></label>
      <label class="form-wide"><span>Company collection address / area</span><input name="location" required maxlength="140" value="North Market · 0.8 mi" placeholder="Full handoff area for the partner" /></label>
      <label class="form-wide"><span>Additional notes</span><textarea name="notes" maxlength="700" rows="2" placeholder="Packing, access hours, loading requirements, donor contact method…"></textarea></label>
      <div class="form-wide logistics-notice"><strong>The company is responsible for fulfilment logistics.</strong> After checkout, you will agree and record the carrier, delivery method, ETA, tracking, and delivery fee with the NGO. Refound does not dispatch or book a courier in this demo.</div></div>
      <div class="form-error" id="form-error" role="alert"></div><button class="button button-primary modal-main-action" type="submit">Publish detailed listing <span>→</span></button>
    </form>`);
  updateListingTypeControls('Food');
}

function fillListingForm(draft) {
  const form = modalRoot.querySelector('#listing-form');
  if (!form) return;
  updateListingTypeControls(draft.resourceType ?? 'Food', draft.category);
  for (const [name, value] of Object.entries(draft)) {
    const input = form.elements.namedItem(name);
    if (input && value !== undefined) input.value = String(name === 'expiresAt' ? value.slice(0, 10) : value);
  }
  const description = modalRoot.querySelector('#description-input');
  if (description) description.value = draft.notes;
  toast('Details organized. Review them and publish when ready.');
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateListingTypeControls(resourceType, selectedCategory) {
  const form = modalRoot.querySelector('#listing-form');
  if (!form) return;
  const categories = RESOURCE_CATEGORIES[resourceType] ?? RESOURCE_CATEGORIES.Food;
  const category = form.elements.namedItem('category');
  category.innerHTML = categories.map((item) => `<option>${escapeHtml(item)}</option>`).join('');
  category.value = categories.includes(selectedCategory) ? selectedCategory : categories[0];
  const expiresAt = form.elements.namedItem('expiresAt');
  expiresAt.required = resourceType === 'Medical equipment' || resourceType === 'Food';
  const hint = form.querySelector('.item-expiry-hint');
  hint.textContent = expiresAt.required ? `(required for ${resourceType.toLowerCase()})` : '(when shown on the label)';
}

async function openDeliveryModal(transferId) {
  if (session?.role !== 'company' && session?.role !== 'admin') return toast('Only the selling company can arrange delivery.');
  const [surplus, needs, transfers] = await Promise.all([service.getSurplus(), service.getNeeds(), service.getTransfers()]);
  const transfer = transfers.find((item) => item.id === transferId);
  const item = surplus.find((record) => record.id === transfer?.surplusId);
  const need = needs.find((record) => record.id === transfer?.needId);
  if (!transfer || !item || (session.role !== 'admin' && item.donor !== session.name)) return toast('This is not your company’s order to fulfil.');
  if (transfer.status !== 'approved') return toast('Confirm this order before arranging delivery.');
  const arrival = new Date(Date.now() + 24 * 3_600_000);
  arrival.setMinutes(0, 0, 0);
  const localArrival = new Date(arrival.getTime() - arrival.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  openModal(`<button class="modal-close" data-action="close-modal" aria-label="Close">×</button><div class="eyebrow">COMPANY-OWNED DELIVERY LOGISTICS</div><h2>Arrange this delivery</h2><p class="modal-intro">Choose the carrier/method, estimate the arrival, and add tracking. Agree any delivery fee directly with the NGO before dispatch. Refound is not booking or providing transport.</p><div class="allocation-route"><div><span class="allocation-label">RESOURCE</span><strong>${escapeHtml(item.title)}</strong><small>${transfer.quantity} ${escapeHtml(item.unit)} · ${escapeHtml(item.location)}</small></div><span class="route-arrow">→</span><div><span class="allocation-label">NGO RECEIVING POINT</span><strong>${escapeHtml(need?.organization ?? 'Community organization')}</strong><small>${escapeHtml(need?.location ?? 'Confirm the delivery point in your partner conversation.')}</small></div></div><form id="logistics-form"><label class="field-label" for="delivery-method">Delivery method / carrier</label><input class="delivery-input" name="method" id="delivery-method" maxlength="100" required placeholder="e.g. Company van, local courier, agreed collection" /><label class="field-label" for="delivery-fee">Delivery cost (AED), agreed separately</label><input class="delivery-input" id="delivery-fee" type="number" name="deliveryFeeAED" min="0" max="100000" step="0.01" value="0" required /><label class="field-label" for="tracking-reference">Tracking / handoff reference</label><input class="delivery-input" id="tracking-reference" name="trackingReference" maxlength="120" placeholder="Courier tracking number or handoff reference" /><label class="field-label" for="delivery-eta">Estimated arrival</label><input class="delivery-input" id="delivery-eta" name="expectedDeliveryAt" type="datetime-local" value="${localArrival}" required /><label class="field-label" for="logistics-notes">Delivery notes for the NGO</label><textarea class="delivery-input" name="logisticsNotes" id="logistics-notes" maxlength="500" rows="2" placeholder="Driver contact plan, cold-chain, access or receiving details…"></textarea><div class="logistics-notice"><strong>Company responsibility:</strong> you select and pay the courier/transport provider. Delivery fees are not included in the product checkout and are not collected by Refound.</div><div class="form-error" id="logistics-error" role="alert"></div><button type="submit" class="button button-primary modal-main-action">Save logistics &amp; mark dispatched <span>→</span></button></form>`);
  modalRoot.querySelector('#logistics-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await service.updateLogistics(transferId, {
        method: String(data.get('method')),
        deliveryFeeAED: Number(data.get('deliveryFeeAED')),
        trackingReference: String(data.get('trackingReference') ?? ''),
        expectedDeliveryAt: new Date(String(data.get('expectedDeliveryAt'))).toISOString(),
        logisticsNotes: String(data.get('logisticsNotes') ?? ''),
      }, { role: session.role, organization: session.name });
      closeModal();
      await render();
      toast('Company delivery details saved. The NGO can now track and confirm receipt.');
    } catch (error) {
      const message = modalRoot.querySelector('#logistics-error');
      message.textContent = error instanceof Error ? error.message : 'Unable to save delivery details.';
    }
  });
}

async function checkoutBasket() {
  if (session?.role !== 'ngo' || !await isVerified()) {
    activeView = 'verification';
    await render();
    toast('Only verified NGOs can place an order.');
    return;
  }
  const lines = service.getCart().filter((line) => line.buyerOrganization === session.name);
  if (!lines.length) return toast('Your basket is empty.');
  const [surplus] = await Promise.all([service.getSurplus()]);
  const total = Math.round(lines.reduce((sum, line) => {
    const item = surplus.find((record) => record.id === line.surplusId);
    return sum + Number(item?.priceAED ?? 0) * line.quantity;
  }, 0) * 100) / 100;
  if (liveMode && total > 0) {
    toast('A live Odoo payment provider is not configured yet. No paid order was created.');
    return;
  }
  const method = document.querySelector('#cart-payment-method')?.value ?? 'demo-card';
  const liveMessage = liveMode
    ? 'Free resources only. The order is written to Odoo and the seller arranges delivery; no payment is due.'
    : 'Test/simulated payment only. No card details requested, no money moves, and no payment gateway is connected. Delivery fees are separate and arranged by the seller.';
  openModal(`<button class="modal-close" data-action="close-modal" aria-label="Close">×</button><div class="eyebrow">${liveMode ? 'FREE RESOURCE ORDER · ODOO' : 'SIMULATED CHECKOUT · NO REAL CHARGE'}</div><h2>Confirm your resource order</h2><p class="modal-intro">Your organization: <strong>${escapeHtml(session.name)}</strong>. Review the product amount. After checkout, the company accepts the order and arranges delivery directly with you.</p><div class="cart-checkout-summary"><div><span>${lines.length} resource line${lines.length === 1 ? '' : 's'}</span><strong>${total ? `AED ${total.toFixed(2)}` : 'Free donation'}</strong></div><div><span>Delivery</span><strong>Agreed directly with company</strong></div><div class="cart-summary-total"><span>Product amount</span><strong>AED ${total.toFixed(2)}</strong></div></div><div class="payment-disclaimer">${liveMessage}</div><button class="button button-primary button-large modal-main-action" data-action="place-demo-order" data-method="${escapeHtml(method)}">${liveMode ? 'Record free Odoo order' : 'Confirm demo payment &amp; order'} <span>→</span></button>`);
}

document.addEventListener('click', async (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-view], [data-action]') : null;
  if (!target) return;
  if (target.dataset.view) {
    const requestedView = target.dataset.view;
    if (!session && !publicViews.has(requestedView)) {
      activeView = 'login';
      await render();
      return;
    }
    activeView = requestedView;
    filter = 'All'; query = '';
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
    document.querySelector('#sidebar')?.classList.remove('open');
    await render(); return;
  }
  const action = target.dataset.action;
  if (action === 'open-listing') await openListingModal();
  if (action === 'open-need') await openNeedModal();
  if (action === 'add-to-cart') await openAddToCartModal(target.dataset.surplus, target.dataset.need);
  if (action === 'checkout') await checkoutBasket();
  if (action === 'remove-cart-line') {
    await service.removeFromCart(target.dataset.key);
    await render();
    toast('Removed the resource from your basket.');
  }
  if (action === 'place-demo-order') {
    if (session?.role !== 'ngo') return toast('Only an NGO can place a resource order.');
    try {
      const order = await service.createOrder(session.name, target.dataset.method);
      closeModal();
      activeView = 'transfers';
      await render();
      if (liveMode) toast(`Order saved in Odoo (${order.id}). Payment needs the configured Odoo provider; delivery is arranged by the company.`);
      else toast(`Order recorded: ${order.totalAED > 0 ? 'simulated AED ' + order.totalAED.toFixed(2) + ' payment' : 'free donation'}. Company delivery is now required.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to place the order.');
    }
  }
  if (action === 'confirm-order') {
    const [surplusItems, transferItems] = await Promise.all([service.getSurplus(), service.getTransfers()]);
    const selectedTransfer = transferItems.find((item) => item.id === target.dataset.id);
    const item = surplusItems.find((record) => record.id === selectedTransfer?.surplusId);
    if (session?.role !== 'admin' && (session?.role !== 'company' || item?.donor !== session.name)) return toast('Only the selling company can accept this order.');
    if (session?.role !== 'admin' && !await isVerified()) return toast('Company verification is required before accepting an order.');
    try {
      await service.advanceTransfer(target.dataset.id);
      await render();
      toast('Order accepted. Agree delivery logistics with the NGO before dispatch.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to accept this order.');
    }
  }
  if (action === 'arrange-delivery') await openDeliveryModal(target.dataset.id);
  if (action === 'confirm-receipt') {
    if (session?.role !== 'ngo' || !await isVerified()) return toast('Only the verified requesting NGO can confirm receipt.');
    try {
      await service.confirmReceipt(target.dataset.id, session.name);
      await render();
      toast('Receipt confirmed. The order is complete.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to confirm receipt.');
    }
  }
  if (action === 'open-order-messages' || action === 'select-conversation') {
    selectedConversation = target.dataset.id;
    activeView = 'messages';
    await render();
  }
  if (action === 'start-verification') {
    if (liveMode && !session) {
      activeView = 'login';
      await render();
      toast('Sign in with your organization account before submitting verification documents.');
      return;
    }
    verificationRole = target.dataset.role === 'ngo' ? 'ngo' : 'company';
    activeView = 'verification';
    await render();
  }
  if (action === 'sign-out') {
    sessionStorage.removeItem('refound-demo-session');
    session = null;
    assistantMessages = [];
    activeView = 'home';
    await render();
  }
  if (action === 'live-login') {
    window.location.assign(target.dataset.url || liveLoginPath);
    return;
  }
  if (action === 'retry-service') {
    await configureBackend();
    return;
  }
  if (action === 'close-modal') closeModal();
  if (action === 'extract-details') {
    try {
      const details = extractor.extract(modalRoot.querySelector('#description-input').value);
      fillListingForm({ ...details, location: 'North Market · 0.8 mi' });
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not organize the details.'); }
  }
  if (action === 'filter') { filter = target.dataset.filter; await render(); }
  if (action === 'reset-demo') {
    if (session?.role !== 'admin' || liveMode) return toast('Reset is available only in the local demo workspace.');
    await service.resetDemo();
    await verificationService.reset();
    await salesService.reset();
    sessionStorage.removeItem('refound-demo-session');
    session = null;
    activeView = 'home';
    toast('The local Refound demo has been reset.');
    await render();
  }
  if (action === 'export-report') exportReportCsv();
  if (action === 'toggle-sales-lead') {
    if (session?.role !== 'admin') return toast('Administrator access is required to update a sales enquiry.');
    try {
      const lead = await salesService.markContacted(target.dataset.id);
      await render();
      toast(`Enquiry marked ${lead.status === 'contacted' ? 'followed up' : 'new'} in the demo inbox.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to update this enquiry.');
    }
    if (action === 'view-verification-document') {
      if (!liveMode || session?.role !== 'admin') return toast('Private document preview is available only to authenticated reviewers.');
      const preview = window.open('about:blank', '_blank');
      if (!preview) return toast('Allow the browser to open private verification previews.');
      preview.opener = null;
      try {
        const blob = await verificationService.viewDocument(target.dataset.application, target.dataset.document);
        const url = URL.createObjectURL(blob);
        preview.location.replace(url);
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (error) {
        preview.close();
        toast(error instanceof Error ? error.message : 'Unable to open the private verification document.');
      }
    }
  }
  if (action === 'ask-suggestion') await submitAssistantQuestion(target.dataset.question);
  if (action === 'toast') toast(target.dataset.message ?? 'Coming soon.');
  if (action === 'surplus-detail') {
    const [surplus] = await Promise.all([service.getSurplus()]);
    const item = surplus.find((record) => record.id === target.dataset.id);
    if (item) {
      const [needs] = await Promise.all([service.getNeeds()]);
      const eligible = session?.role === 'ngo' ? needs.filter((need) => need.organization === session.name && scoreMatch(item, need)) : [];
      const cartAction = eligible.length && await isVerified()
        ? `<button class="button button-primary modal-main-action" data-action="add-to-cart" data-surplus="${item.id}" data-need="${eligible[0].id}">Add to basket · ${item.priceAED > 0 ? `AED ${Number(item.priceAED).toFixed(2)} / ${escapeHtml(item.unit)}` : 'Free'} <span>→</span></button>`
        : session?.role === 'ngo' ? '<button class="button button-outline modal-main-action" data-view="verification">Verify your NGO to order this resource</button>' : '';
      openModal(`<button class="modal-close" data-action="close-modal" aria-label="Close">×</button><div class="eyebrow">COMPANY SURPLUS DETAIL</div><h2>${escapeHtml(item.title)}</h2><p class="modal-intro">${escapeHtml(item.donor ?? 'Refound partner')} · ${escapeHtml(item.location)}</p><div class="detail-grid"><div><small>Resource type / category</small><strong>${escapeHtml(resourceTypeOf(item))} · ${escapeHtml(item.category)}</strong></div><div><small>Available stock</small><strong>${item.quantity} ${escapeHtml(item.unit)}</strong></div><div><small>Price per unit</small><strong>${item.priceAED > 0 ? `AED ${Number(item.priceAED).toFixed(2)}` : 'Free donation'}</strong></div><div><small>Order-by deadline</small><strong>${shortDate(item.availableUntil)}</strong></div><div><small>Use-by / item expiry</small><strong>${item.expiresAt ? shortDate(item.expiresAt) : 'No item expiry date declared'}</strong></div><div><small>Condition</small><strong>${escapeHtml(item.condition || 'Ask the company')}</strong></div><div><small>Specifications</small><strong>${escapeHtml(item.specifications || 'Contact company')}</strong></div><div><small>Storage &amp; handling</small><strong>${escapeHtml(item.storageInstructions || 'Confirm with company')}</strong></div><div><small>Company handoff area</small><strong>${escapeHtml(item.location)}</strong></div></div><p class="detail-notes">${escapeHtml(item.notes || 'No additional notes.')}</p>${cartAction}<button class="button button-outline modal-main-action" data-action="close-modal">Close</button>`);
    }
  }
});

document.addEventListener('submit', async (event) => {
  if (!(event.target instanceof HTMLFormElement)) return;
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  if (form.id === 'login-form') {
    const role = String(data.get('role'));
    const email = String(data.get('email')).trim().toLowerCase();
    if (!['company', 'ngo', 'admin'].includes(role) || !email) return toast('Choose a portal and enter your demo email.');
    const presets = {
      company: { name: 'Meadow & Fig', email: 'morgan@meadowfig.demo', contactName: 'Morgan Fields' },
      ngo: { name: 'Northside Food Collective', email: 'jamie@northside.demo', contactName: 'Jamie River' },
      admin: { name: 'Refound Admin', email: 'admin@refound.demo', contactName: 'Refound Admin' },
    };
    session = { role, name: presets[role].name, email, contactName: presets[role].contactName };
    sessionStorage.setItem('refound-demo-session', JSON.stringify(session));
    activeView = 'overview';
    await render();
    toast(`${role === 'admin' ? 'Administrator' : 'Partner'} demo workspace opened. This is not a real login.`);
    return;
  }
  if (form.id === 'verification-form') {
    const error = document.querySelector('#verification-error');
    const selectedRole = String(data.get('organizationType'));
    const selectedFiles = form.elements.namedItem('documents').files;
    if (selectedFiles.length > 5) { error.textContent = 'Select up to five document filenames for this demo.'; return; }
    const files = [...selectedFiles];
    if (files.some((file) => !/\.(pdf|jpe?g|png)$/i.test(file.name))) { error.textContent = 'Choose a PDF, JPG, or PNG file.'; return; }
    if (liveMode && files.some((file) => file.size > 3 * 1024 * 1024)) { error.textContent = 'Each live verification document must be smaller than 3 MB.'; return; }
    if (liveMode && !session) { error.textContent = 'Sign in with your organization account before submitting a live application.'; return; }
    try {
      const application = await verificationService.submitApplication({
        organizationType: selectedRole,
        organizationName: String(data.get('organizationName')),
        contactName: String(data.get('contactName')),
        email: String(data.get('email')),
        location: String(data.get('location')),
        registrationId: String(data.get('registrationId') ?? ''),
        documents: files.map((file) => file.name),
        notes: String(data.get('notes') ?? ''),
      });
      if (liveMode) {
        for (const file of files) await verificationService.uploadDocument(application.id, file);
      }
      session = { role: application.organizationType, name: application.organizationName, email: application.email, contactName: application.contactName };
      sessionStorage.setItem('refound-demo-session', JSON.stringify(session));
      verificationRole = application.organizationType;
      activeView = 'verification';
      await render();
      toast(liveMode
        ? 'Organization application and private verification documents were sent to Odoo for human review.'
        : 'Application saved in this browser for demo administrator review.');
    } catch (errorValue) {
      error.textContent = errorValue instanceof Error ? errorValue.message : 'Unable to submit the organization application.';
    }
    return;
  }
  if (form.id === 'review-form') {
    if (session?.role !== 'admin') return toast('Administrator sign-in is required to review organizations.');
    const button = event.submitter;
    const decision = button instanceof HTMLButtonElement ? button.dataset.decision : '';
    const checklist = {
      registrationChecked: data.get('registrationChecked') === 'on',
      authorityChecked: data.get('authorityChecked') === 'on',
      evidenceChecked: data.get('evidenceChecked') === 'on',
    };
    const note = String(data.get('decisionNote') ?? '').trim();
    const error = form.querySelector('.review-error');
    if (decision === 'approved' && (!checklist.registrationChecked || !checklist.authorityChecked || !checklist.evidenceChecked)) {
      error.textContent = 'Complete all three evidence checks before approving.';
      return;
    }
    if (decision === 'rejected' && !note) {
      error.textContent = 'Add a clear reason or follow-up request before declining.';
      return;
    }
    try {
      const reviewed = await verificationService.reviewApplication(form.dataset.application, decision, note, checklist);
      await render();
      toast(`${reviewed.organizationName}: ${decision}.`);
    } catch (errorValue) {
      toast(errorValue instanceof Error ? errorValue.message : 'Unable to review application.');
    }
    return;
  }
  if (form.id === 'contact-form') {
    toast('Preview only: this message has not been sent or saved.');
    return;
  }
  if (form.id === 'sales-form') {
    const error = document.querySelector('#sales-error');
    const consent = data.get('consent') === 'on';
    if (!consent) {
      error.textContent = 'Confirm that you understand this is a local demo enquiry.';
      return;
    }
    if (form.id === 'order-message-form') {
      const message = String(data.get('message') ?? '').trim();
      try {
        await service.sendMessage(
          form.dataset.order,
          session.name,
          session.role,
          message,
        );
        await render();
        document.querySelector('#order-message-form [name="message"]')?.focus();
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Unable to send this order message.');
      }
      return;
    }
    try {
      const lead = await salesService.submitLead({
        name: String(data.get('name')),
        email: String(data.get('email')),
        organization: String(data.get('organization')),
        organizationType: String(data.get('organizationType')),
        teamSize: String(data.get('teamSize')),
        message: String(data.get('message')),
      });
      form.reset();
      openModal(`<button class="modal-close" data-action="close-modal" aria-label="Close">×</button><div class="eyebrow">DEMO ENQUIRY SAVED</div><h2>Thanks, ${escapeHtml(lead.name)}.</h2><p class="modal-intro">Your membership enquiry is saved in this browser’s demo sales inbox. No one has been emailed, no subscription has started, and no payment has been taken.</p><div class="trial-callout"><span>✳</span><span><strong>Refound Membership</strong><small>1 month free, then AED 29/month · demo interest only</small></span></div><button class="button button-primary modal-main-action" data-action="close-modal">Back to Refound</button>`);
    } catch (errorValue) {
      error.textContent = errorValue instanceof Error ? errorValue.message : 'Unable to save this local demo enquiry.';
    }
    return;
  }
  if (form.id === 'assistant-form') {
    await submitAssistantQuestion(String(data.get('question') ?? ''));
    return;
  }
  if (form.id === 'need-form') {
    const error = document.querySelector('#need-error');
    if (session?.role !== 'ngo' || !await isVerified()) {
      error.textContent = 'An approved community organization account is required to publish a request.';
      return;
    }
    const quantity = Number(data.get('quantity'));
    const neededByLocal = String(data.get('neededBy'));
    const neededBy = new Date(neededByLocal);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999 || Number.isNaN(neededBy.getTime())) {
      error.textContent = 'Enter a valid quantity and needed-by date.';
      return;
    }
    try {
      await service.createNeed({
        organization: session.name,
        contact: session.contactName ?? session.name,
        resourceType: String(data.get('resourceType')),
        category: String(data.get('category')),
        quantity,
        unit: String(data.get('unit')),
        location: String(data.get('location')).trim(),
        urgency: String(data.get('urgency')),
        neededBy: neededBy.toISOString(),
        maxPriceAED: Number(data.get('maxPriceAED')),
        expiresAt: String(data.get('expiresAt') ?? ''),
        preferredCondition: String(data.get('preferredCondition') ?? '').trim(),
        specifications: String(data.get('specifications') ?? '').trim(),
        storageInstructions: String(data.get('storageInstructions') ?? '').trim(),
        note: String(data.get('note')).trim(),
      });
      closeModal();
      activeView = 'my-needs';
      await render();
      toast('Your request is now visible to verified partners.');
    } catch (errorValue) {
      error.textContent = errorValue instanceof Error ? errorValue.message : 'Unable to publish the community request.';
    }
    return;
  }
  if (form.id !== 'listing-form') return;
  const quantity = Number(data.get('quantity'));
  const expiryHours = Number(data.get('expiryHours'));
  const error = modalRoot.querySelector('#form-error');
  if (session?.role !== 'company' || !await isVerified()) {
    error.textContent = 'An approved business partner account is required to list surplus.';
    return;
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
    error.textContent = 'Quantity must be a whole number between 1 and 9,999.'; return;
  }
  const expiryDate = new Date(Date.now() + expiryHours * 3_600_000);
  if (Number.isNaN(expiryDate.getTime()) || expiryDate.getTime() <= Date.now()) {
    error.textContent = 'Choose a valid pickup window.'; return;
  }
  try {
    const expirationDate = String(data.get('expiresAt') ?? '');
    const expiresAt = expirationDate ? new Date(`${expirationDate}T23:59:59`).toISOString() : '';
    await service.createSurplus({
      title: String(data.get('title')).trim(),
      resourceType: String(data.get('resourceType')),
      category: String(data.get('category')),
      quantity,
      unit: String(data.get('unit')),
      location: String(data.get('location')).trim(),
      availableUntil: expiryDate.toISOString(),
      expiresAt,
      priceAED: Number(data.get('priceAED')),
      condition: String(data.get('condition')).trim(),
      specifications: String(data.get('specifications')).trim(),
      storageInstructions: String(data.get('storageInstructions')).trim(),
      notes: String(data.get('notes')).trim(),
    }, session.name);
    closeModal(); toast('Your surplus is live and ready to be matched.');
    activeView = 'surplus'; await render();
  } catch (errorValue) { error.textContent = errorValue instanceof Error ? errorValue.message : 'Could not publish listing.'; }
});

document.addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.id === 'search-listings') {
    query = event.target.value;
    const cursor = event.target.selectionStart;
    render().then(() => {
      const search = document.querySelector('#search-listings');
      search?.focus(); search?.setSelectionRange(cursor, cursor);
    });
  }
});

async function submitAssistantQuestion(question) {
  try {
    const [surplus, needs] = await Promise.all([service.getSurplus(), service.getNeeds()]);
    const answer = await assistant.answer(question, buildMatches(surplus, needs));
    assistantMessages.push({ question: question.trim(), answer });
    activeView = 'assistant';
    await render();
    document.querySelector('#assistant-question')?.focus();
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Unable to answer that question.');
  }
}

async function exportReportCsv() {
  try {
    const [surplus, needs, transfers] = await Promise.all([service.getSurplus(), service.getNeeds(), service.getTransfers()]);
    const report = buildTransferReport(transfersForCurrentPortal(surplus, needs, transfers), surplus, reportRange);
    const csv = buildTransferCsv(report.records, surplus, needs, statusLabels);
    const downloadUrl = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `refound-report-${reportRange}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    toast(`${records.length} demo handoff${records.length === 1 ? '' : 's'} exported to CSV.`);
  } catch (error) {
    console.error('Unable to export the report.', error);
    toast('Unable to export this report.');
  }
}

document.addEventListener('change', async (event) => {
  if (event.target instanceof HTMLInputElement && event.target.dataset.cartQuantity) {
    try {
      await service.setCartQuantity(event.target.dataset.cartQuantity, Number(event.target.value));
      await render();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Unable to update basket quantity.');
      await render();
    }
  }
  if (event.target instanceof HTMLSelectElement && event.target.name === 'resourceType') {
    if (event.target.closest('#listing-form')) updateListingTypeControls(event.target.value);
    if (event.target.closest('#need-form')) updateNeedTypeControls(event.target.value);
  }
  if (event.target instanceof HTMLSelectElement && event.target.id === 'report-range') {
    reportRange = event.target.value;
    await render();
  }
  if (event.target instanceof HTMLSelectElement && event.target.id === 'login-role') {
    const email = document.querySelector('#login-form [name="email"]');
    if (email instanceof HTMLInputElement) {
      const defaults = { company: 'morgan@meadowfig.demo', ngo: 'jamie@northside.demo', admin: 'admin@refound.demo' };
      email.value = defaults[event.target.value] ?? '';
    }
  }
});

modalRoot?.addEventListener('click', (event) => { if (event.target === modalRoot) closeModal(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && modalRoot && !modalRoot.hidden) closeModal(); });
document.querySelector('#menu-toggle')?.addEventListener('click', () => document.querySelector('#sidebar')?.classList.toggle('open'));
configureBackend();
