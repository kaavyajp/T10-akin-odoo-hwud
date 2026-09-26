import { RESOURCE_CATEGORIES, RESOURCE_TYPES, seedMetrics, seedNeeds, seedSurplus, seedTransfers } from './data.js';

const STORAGE_KEY = 'resource-demo-state-v1';
const VERIFICATION_KEY = 'refound-demo-verifications-v1';
const SALES_LEADS_KEY = 'refound-demo-sales-leads-v1';
const CART_KEY = 'refound-demo-cart-v1';
const clone = (value) => JSON.parse(JSON.stringify(value));
/** @typedef {{surplus: typeof seedSurplus, needs: typeof seedNeeds, transfers: typeof seedTransfers, metrics: typeof seedMetrics, orders: object[], messages: object[]}} DemoState */

const seedVerifications = [
  { id: 'v-101', organizationName: 'Meadow & Fig', organizationType: 'company', contactName: 'Morgan Fields', email: 'morgan@meadowfig.demo', location: 'Downtown · 0.8 mi', registrationId: 'DEMO-C-001', documents: ['business-registration-demo.pdf'], notes: 'Seeded approved business for exploring the company workspace.', status: 'approved', submittedAt: '2026-09-18T12:00:00.000Z', reviewedAt: '2026-09-19T12:00:00.000Z', decisionNote: 'Seeded demo verification.' },
  { id: 'v-102', organizationName: 'Northside Food Collective', organizationType: 'ngo', contactName: 'Jamie River', email: 'jamie@northside.demo', location: 'Northside', registrationId: 'DEMO-N-102', documents: ['charity-letter-demo.pdf'], notes: 'Demo organization awaiting admin review.', status: 'pending', submittedAt: '2026-09-24T12:00:00.000Z' },
  { id: 'v-103', organizationName: 'Cedar Street Community Kitchen', organizationType: 'ngo', contactName: 'Robin Lee', email: 'robin@cedarstreet.demo', location: 'Eastside', registrationId: 'DEMO-N-103', documents: ['nonprofit-registration-demo.pdf'], notes: 'Demo community kitchen awaiting admin review.', status: 'pending', submittedAt: '2026-09-25T12:00:00.000Z' },
];

/** Local-only identity demo; production authentication must run through a trusted backend. */
export class DemoVerificationService {
  constructor() {
    try {
      this.applications = JSON.parse(localStorage.getItem(VERIFICATION_KEY) ?? 'null') ?? clone(seedVerifications);
    } catch (error) {
      console.error('Unable to read demo organization verifications from browser storage.', error);
      this.applications = clone(seedVerifications);
    }
    if (!Array.isArray(this.applications)) throw new Error('Stored verification data is invalid. Reset the demo workspace to continue.');
  }

  persist() {
    localStorage.setItem(VERIFICATION_KEY, JSON.stringify(this.applications));
  }

  async getApplications() {
    return clone(this.applications).sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  }

  async submitApplication(application) {
    const organizationName = application.organizationName.trim();
    const contactName = application.contactName.trim();
    const email = application.email.trim().toLowerCase();
    const location = application.location.trim();
    if (!organizationName || !contactName || !email || !location) throw new Error('Complete the organization, contact, email, and location fields.');
    if (!['company', 'ngo'].includes(application.organizationType)) throw new Error('Choose a business or NGO organization type.');
    if (this.applications.some((item) => item.email === email && item.status !== 'rejected')) {
      throw new Error('This email already has a pending or approved application. Sign in or contact support.');
    }
    const record = {
      id: `v-${Date.now()}`,
      organizationName,
      organizationType: application.organizationType,
      contactName,
      email,
      location,
      registrationId: application.registrationId.trim(),
      documents: [...application.documents],
      notes: application.notes.trim(),
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };
    this.applications.unshift(record);
    this.persist();
    return clone(record);
  }

  async reviewApplication(applicationId, decision, decisionNote = '', checklist = {}) {
    if (!['approved', 'rejected'].includes(decision)) throw new Error('Choose an approval or rejection decision.');
    const application = this.applications.find((item) => item.id === applicationId);
    if (!application) throw new Error('Organization application not found.');
    if (application.status !== 'pending') throw new Error('This organization application has already been reviewed.');
    if (decision === 'approved' && (!application.registrationId?.trim() || !application.documents?.length
      || !checklist.registrationChecked || !checklist.authorityChecked || !checklist.evidenceChecked)) {
      throw new Error('Approval requires a registration number, supporting evidence, and all three reviewer checks.');
    }
    if (decision === 'rejected' && !decisionNote.trim()) throw new Error('Record a reason before declining an organization.');
    application.status = decision;
    application.reviewedAt = new Date().toISOString();
    application.decisionNote = decisionNote.trim();
    application.reviewChecklist = {
      registrationChecked: Boolean(checklist.registrationChecked),
      authorityChecked: Boolean(checklist.authorityChecked),
      evidenceChecked: Boolean(checklist.evidenceChecked),
    };
    this.persist();
    return clone(application);
  }

  async reset() {
    this.applications = clone(seedVerifications);
    this.persist();
  }
}

/** Local-only pricing interest and sales enquiry inbox; no checkout or email is configured. */
export class DemoSalesService {
  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(SALES_LEADS_KEY) ?? '[]');
      if (!Array.isArray(saved)) throw new Error('Saved sales enquiries are not in a valid list format.');
      this.leads = saved;
    } catch (error) {
      console.error('Unable to read the demo sales enquiry inbox.', error);
      this.leads = [];
    }
  }

  persist() {
    localStorage.setItem(SALES_LEADS_KEY, JSON.stringify(this.leads));
  }

  async getLeads() {
    return clone(this.leads).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async submitLead(input) {
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    const organization = input.organization.trim();
    const message = input.message.trim();
    if (!name || !organization || !message) throw new Error('Name, organization, and message are required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid work email address.');
    const record = {
      id: `lead-${Date.now()}`,
      name,
      email,
      organization,
      organizationType: ['company', 'ngo'].includes(input.organizationType) ? input.organizationType : 'company',
      teamSize: input.teamSize.trim(),
      plan: 'Refound Membership',
      message,
      status: 'new',
      createdAt: new Date().toISOString(),
    };
    this.leads.unshift(record);
    this.persist();
    return clone(record);
  }

  async markContacted(leadId) {
    const lead = this.leads.find((item) => item.id === leadId);
    if (!lead) throw new Error('Sales enquiry not found.');
    lead.status = lead.status === 'contacted' ? 'new' : 'contacted';
    this.persist();
    return clone(lead);
  }

  async reset() {
    this.leads = [];
    this.persist();
  }
}

/** @typedef {{surplusId:string,needId:string,quantity:number,buyerOrganization:string,key:string}} CartLine */

/** Never contacts a payment gateway; keeps this demonstration explicitly non-billable. */
export class DemoPaymentAdapter {
  async checkout(amountAED, paymentMethod) {
    if (!Number.isFinite(amountAED) || amountAED < 0) throw new Error('Order total is invalid.');
    if (!['demo-card', 'demo-bank-transfer'].includes(paymentMethod)) throw new Error('Select a supported demo payment method.');
    return {
      status: amountAED === 0 ? 'no_charge' : 'simulated_paid',
      method: amountAED === 0 ? 'no-charge' : paymentMethod,
      reference: amountAED === 0 ? '' : `DEMO-${Date.now()}`,
    };
  }
}

/** Same-origin authenticated API facade. Its token and Odoo credentials never enter browser code. */
export class OdooApiResourceService {
  constructor() {
    this.state = { surplus: [], needs: [], transfers: [], metrics: clone(seedMetrics), orders: [], messages: [] };
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers ?? {});
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Refound API request failed (${response.status}).`);
    return payload;
  }

  async getSurplus() {
    const records = await this.request('/surplus');
    this.state.surplus = records;
    return clone(records);
  }
  async getNeeds() {
    const records = await this.request('/needs');
    this.state.needs = records;
    return clone(records);
  }
  async getTransfers() { return this.request('/transfers'); }
  async getMetrics() { return this.request('/metrics'); }
  async getOrdersForOrganization() { return this.request('/orders'); }
  getCart() {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) ?? '[]');
    if (!Array.isArray(saved)) throw new Error('Saved basket is invalid. Clear this site’s basket to continue.');
    return saved;
  }
  persistCart(cart) { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
  async addToCart(surplusId, needId, quantity, buyerOrganization) {
    const [surplus, needs] = await Promise.all([this.getSurplus(), this.getNeeds()]);
    const item = surplus.find((record) => record.id === surplusId);
    const need = needs.find((record) => record.id === needId);
    const match = item && need ? scoreMatch(item, need) : null;
    if (!match || !buyerOrganization) throw new Error('This item no longer meets the order requirements.');
    const cart = this.getCart();
    const key = `${surplusId}:${needId}:${buyerOrganization}`;
    const existing = cart.find((line) => line.key === key);
    if ((existing?.quantity ?? 0) + quantity > match.quantity) throw new Error('Your basket exceeds the available supply or request.');
    if (existing) existing.quantity += quantity;
    else cart.push({ key, surplusId, needId, quantity, buyerOrganization });
    this.persistCart(cart);
    return clone(cart);
  }
  async removeFromCart(key) { const cart = this.getCart().filter((line) => line.key !== key); this.persistCart(cart); return cart; }
  async setCartQuantity(key, quantity) {
    const cart = this.getCart();
    const line = cart.find((entry) => entry.key === key);
    if (!line) throw new Error('Basket item not found.');
    const [surplus, needs] = await Promise.all([this.getSurplus(), this.getNeeds()]);
    const match = scoreMatch(surplus.find((item) => item.id === line.surplusId), needs.find((need) => need.id === line.needId));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > (match?.quantity ?? 0)) throw new Error('Quantity exceeds the available supply or request.');
    line.quantity = quantity;
    this.persistCart(cart);
    return cart;
  }
  async clearCart() { localStorage.removeItem(CART_KEY); }
  async createNeed(item) { return this.request('/needs', { method: 'POST', body: JSON.stringify(item) }); }
  async createSurplus(item) { return this.request('/surplus', { method: 'POST', body: JSON.stringify(item) }); }
  async createOrder(_buyerOrganization, _paymentMethod, cart = this.getCart()) {
    const order = await this.request('/orders', { method: 'POST', body: JSON.stringify({ lines: cart.map(({ surplusId, needId, quantity }) => ({ surplusId, needId, quantity })) }) });
    await this.clearCart();
    return order;
  }
  async advanceTransfer(transferId) { return this.request(`/transfers/${encodeURIComponent(transferId)}/accept`, { method: 'POST', body: '{}' }); }
  async updateLogistics(transferId, input) { return this.request(`/transfers/${encodeURIComponent(transferId)}/dispatch`, { method: 'POST', body: JSON.stringify(input) }); }
  async confirmReceipt(transferId) { return this.request(`/transfers/${encodeURIComponent(transferId)}/receipt`, { method: 'POST', body: '{}' }); }
  async sendMessage(orderId, _senderName, _senderRole, text) { return this.request(`/orders/${encodeURIComponent(orderId)}/messages`, { method: 'POST', body: JSON.stringify({ body: text }) }); }
  async getMessages(orderId) { return this.request(`/orders/${encodeURIComponent(orderId)}/messages`); }
  async resetDemo() { return this.request('/admin/demo-reset', { method: 'POST', body: '{}' }); }
}

export class OdooApiVerificationService {
  async request(path, options = {}) {
    const headers = new Headers(options.headers ?? {});
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Verification API request failed (${response.status}).`);
    return payload;
  }
  async getApplications() { return this.request('/verifications'); }
  async submitApplication(application) { return this.request('/verifications', { method: 'POST', body: JSON.stringify(application) }); }
  async uploadDocument(applicationId, file) {
    if (file.size > 3 * 1024 * 1024) throw new Error('Verification documents must be smaller than 3 MB.');
    const encoded = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
      reader.onload = () => {
        if (typeof reader.result !== 'string') return reject(new Error(`Unable to encode ${file.name}.`));
        resolve(reader.result.split(',')[1] ?? '');
      };
      reader.readAsDataURL(file);
    });
    return this.request(`/verifications/${encodeURIComponent(applicationId)}/documents`, {
      method: 'POST',
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, contentBase64: encoded }),
    });
  }
  async viewDocument(applicationId, documentId) {
    const response = await fetch(`/api/verifications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(documentId)}`, { credentials: 'same-origin' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Unable to retrieve document (${response.status}).`);
    }
    return response.blob();
  }
  async reviewApplication(applicationId, decision, decisionNote, checklist) {
    return this.request(`/verifications/${encodeURIComponent(applicationId)}/review`, { method: 'POST', body: JSON.stringify({ decision, decisionNote, ...checklist }) });
  }
  async reset() { return this.request('/admin/demo-reset', { method: 'POST', body: '{}' }); }
}

/** Local deterministic adapter. Replace this implementation with OdooServiceAdapter for live records. */
export class DemoResourceService {
  constructor() {
    const saved = localStorage.getItem(STORAGE_KEY);
    /** @type {DemoState} */
    this.state = saved ? JSON.parse(saved) : {
      surplus: clone(seedSurplus),
      needs: clone(seedNeeds),
      transfers: clone(seedTransfers),
      metrics: clone(seedMetrics),
    };
    this.state.needs ??= clone(seedNeeds);
    this.state.surplus ??= clone(seedSurplus);
    this.state.transfers ??= clone(seedTransfers);
    this.state.metrics ??= clone(seedMetrics);
    this.state.orders ??= [];
    this.state.messages ??= [];
    for (const item of this.state.surplus) {
      const seed = seedSurplus.find((candidate) => candidate.id === item.id);
      item.resourceType ??= 'Food';
      item.priceAED ??= seed?.priceAED ?? 0;
      item.condition ??= seed?.condition ?? '';
      item.specifications ??= seed?.specifications ?? '';
      item.storageInstructions ??= seed?.storageInstructions ?? '';
      item.expiresAt ??= seed?.expiresAt ?? '';
    }
    for (const need of this.state.needs) {
      const seed = seedNeeds.find((candidate) => candidate.id === need.id);
      need.resourceType ??= 'Food';
      need.maxPriceAED ??= seed?.maxPriceAED ?? 0;
      need.preferredCondition ??= seed?.preferredCondition ?? '';
      need.specifications ??= seed?.specifications ?? '';
      need.storageInstructions ??= seed?.storageInstructions ?? '';
      need.expiresAt ??= seed?.expiresAt ?? '';
    }
    for (const transfer of this.state.transfers) transfer.orderId ??= transfer.id;
    for (const additionalNeed of seedNeeds.filter((item) => Number(item.id.slice(2)) >= 206)) {
      if (!this.state.needs.some((item) => item.id === additionalNeed.id)) this.state.needs.push(clone(additionalNeed));
    }
    for (const additionalSurplus of seedSurplus.filter((item) => Number(item.id.slice(2)) >= 107)) {
      if (!this.state.surplus.some((item) => item.id === additionalSurplus.id)) this.state.surplus.push(clone(additionalSurplus));
    }
  }

  persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  /** @returns {typeof seedSurplus} */
  async getSurplus() {
    let changed = false;
    for (const item of this.state.surplus) {
      const isPastPickup = new Date(item.availableUntil).getTime() <= Date.now();
      const isPastItemExpiry = item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now();
      if (item.status === 'available' && (isPastPickup || isPastItemExpiry)) {
        item.status = 'expired';
        changed = true;
      }
    }
    if (changed) this.persist();
    return clone(this.state.surplus);
  }
  /** @returns {typeof seedNeeds} */
  async getNeeds() { return clone(this.state.needs); }
  /** @returns {typeof seedTransfers} */
  async getTransfers() { return clone(this.state.transfers); }
  async getOrders() { return clone(this.state.orders); }
  async getMessages(orderId) {
    const messages = this.state.messages.filter((message) => message.orderId === orderId);
    return clone(messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
  }
  /** @returns {typeof seedMetrics} */
  async getMetrics() { return clone(this.state.metrics); }

  /** @param {Omit<(typeof seedNeeds)[number], 'id'|'neededBy'> & {neededBy:string}} item */
  async createNeed(item) {
    if (!item.organization.trim() || !item.contact.trim() || !item.location.trim()) throw new Error('Organization, contact, and location are required.');
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999) throw new Error('Need quantity must be a whole number between 1 and 9,999.');
    if (!item.note.trim()) throw new Error('Explain who will use the resource and what specifications matter.');
    if (new Date(item.neededBy).getTime() <= Date.now()) throw new Error('The needed-by date must be in the future.');
    if (!Number.isFinite(item.maxPriceAED ?? 0) || (item.maxPriceAED ?? 0) < 0) throw new Error('Enter a valid maximum unit budget in AED.');
    if (!['critical', 'high', 'standard'].includes(item.urgency)) throw new Error('Choose a valid request urgency.');
    if (!RESOURCE_TYPES.includes(item.resourceType ?? 'Food') || !RESOURCE_CATEGORIES[item.resourceType ?? 'Food'].includes(item.category)) {
      throw new Error('Choose a valid resource type and category.');
    }
    if (item.expiresAt && (Number.isNaN(new Date(item.expiresAt).getTime()) || new Date(item.expiresAt).getTime() <= Date.now())) {
      throw new Error('Minimum item expiry date must be in the future.');
    }
    if (String(item.specifications ?? '').length > 700 || String(item.storageInstructions ?? '').length > 500) {
      throw new Error('Requirement specifications or receiving instructions exceed the field limits.');
    }
    const record = { ...item, id: `n-${Date.now()}` };
    this.state.needs.unshift(record);
    this.persist();
    return clone(record);
  }

  /** @param {Omit<(typeof seedSurplus)[number], 'id'|'listedAt'|'status'>} item @param {string} donor */
  async createSurplus(item, donor = 'Meadow & Fig') {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999) {
      throw new Error('Quantity must be a whole number between 1 and 9,999.');
    }
    if (!item.title.trim() || !item.location.trim() || !item.condition?.trim()) throw new Error('A listing title, condition, and company handoff location are required.');
    if (new Date(item.availableUntil).getTime() <= Date.now()) throw new Error('The company delivery window must be in the future.');
    const resourceType = item.resourceType ?? 'Food';
    if (!RESOURCE_TYPES.includes(resourceType) || !RESOURCE_CATEGORIES[resourceType].includes(item.category)) {
      throw new Error('Choose a valid resource type and category.');
    }
    if (resourceType === 'Medical equipment' && /\b(medicines?|prescriptions?|pharmaceuticals?|expired|recalled|sharps?)\b/i.test(`${item.title} ${item.notes}`)) {
      throw new Error('Medicines, recalled or expired items, and sharps are not accepted in this demo.');
    }
    const expiresAt = item.expiresAt?.trim() ?? '';
    const categoryExpires = resourceType === 'Food' || resourceType === 'Medical equipment';
    if (categoryExpires && !expiresAt) throw new Error(`Add the item's use-by or manufacturer expiry date for ${resourceType.toLowerCase()}.`);
    if (categoryExpires && !item.storageInstructions?.trim()) throw new Error('Add food storage/cold-chain or medical equipment handling instructions.');
    if (expiresAt && (Number.isNaN(new Date(expiresAt).getTime()) || new Date(expiresAt).getTime() <= Date.now())) {
      throw new Error('The item expiry date must be in the future.');
    }
    if (expiresAt && new Date(expiresAt).getTime() < new Date(item.availableUntil).getTime()) {
      throw new Error('Set the pickup window to end before the item expires.');
    }
    if (String(item.specifications ?? '').length > 700 || String(item.storageInstructions ?? '').length > 500 || String(item.notes ?? '').length > 700) {
      throw new Error('Listing specifications, handling instructions, or notes exceed the field limits.');
    }
    const priceAED = item.priceAED ?? 0;
    if (!Number.isFinite(priceAED) || priceAED < 0 || priceAED > 100_000) throw new Error('Enter a valid per-unit price between AED 0 and AED 100,000.');
    if (priceAED && priceAED > 0 && /\b(free|donat(?:e|ed|ion))\b/i.test(`${item.title} ${item.notes}`)) {
      throw new Error('This reads like a free donation. Set the price to AED 0, or clarify the paid offer details.');
    }
    const record = { ...item, resourceType, priceAED: Math.round(priceAED * 100) / 100, expiresAt: expiresAt || '', id: `s-${Date.now()}`, listedAt: new Date().toISOString(), status: 'available', donor: donor.trim() || 'Meadow & Fig' };
    this.state.surplus.unshift(record);
    this.persist();
    return clone(record);
  }

  getCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY) ?? '[]');
      if (!Array.isArray(saved)) throw new Error('Saved cart must be a list.');
      return saved;
    } catch (error) {
      console.error('Unable to load the demo basket.', error);
      throw new Error('Your saved basket cannot be read. Clear this site’s demo storage to continue.');
    }
  }

  async getOrdersForOrganization(organization) {
    return clone(this.state.orders.filter((order) => order.buyerOrganization === organization
      || order.transferIds.some((id) => {
        const transfer = this.state.transfers.find((item) => item.id === id);
        const surplus = this.state.surplus.find((item) => item.id === transfer?.surplusId);
        return surplus?.donor === organization;
      })));
  }

  persistCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }

  async addToCart(surplusId, needId, quantity, buyerOrganization) {
    const item = this.state.surplus.find((record) => record.id === surplusId);
    const need = this.state.needs.find((record) => record.id === needId);
    if (!item || !need || !scoreMatch(item, need)) throw new Error('This item no longer matches that open request.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > Math.min(item.quantity, need.quantity)) throw new Error('Choose a whole quantity available for this request.');
    if (!buyerOrganization?.trim()) throw new Error('Sign in to an organization before adding resources to your basket.');
    const cart = this.getCart();
    const key = `${item.id}:${need.id}:${buyerOrganization}`;
    const existing = cart.find((line) => line.key === key);
    const totalQuantity = (existing?.quantity ?? 0) + quantity;
    if (totalQuantity > Math.min(item.quantity, need.quantity)) throw new Error('Your basket quantity would exceed the available supply or request.');
    if (existing) existing.quantity = totalQuantity;
    else cart.push({ key, surplusId, needId, quantity, buyerOrganization, addedAt: new Date().toISOString() });
    this.persistCart(cart);
    return clone(cart);
  }

  async removeFromCart(cartKey) {
    const updated = this.getCart().filter((line) => line.key !== cartKey);
    this.persistCart(updated);
    return clone(updated);
  }

  async setCartQuantity(cartKey, quantity) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) throw new Error('Basket quantity must be a positive whole number.');
    const cart = this.getCart();
    const line = cart.find((item) => item.key === cartKey);
    if (!line) throw new Error('Basket item not found.');
    const surplus = this.state.surplus.find((item) => item.id === line.surplusId);
    const need = this.state.needs.find((item) => item.id === line.needId);
    if (!surplus || !need || quantity > Math.min(surplus.quantity, need.quantity) || !scoreMatch(surplus, need)) {
      throw new Error('Quantity exceeds current supply, request, budget, or expiry requirements.');
    }
    line.quantity = quantity;
    this.persistCart(cart);
    return clone(cart);
  }

  async clearCart() {
    this.persistCart([]);
  }

  async createOrder(buyerOrganization, paymentMethod = 'demo-card') {
    const cart = this.getCart().filter((line) => line.buyerOrganization === buyerOrganization);
    if (!cart.length) throw new Error('Your basket is empty.');
    const requestedByListing = new Map();
    const requestedByNeed = new Map();
    let totalAED = 0;
    const validated = [];
    for (const line of cart) {
      const surplus = this.state.surplus.find((item) => item.id === line.surplusId);
      const need = this.state.needs.find((item) => item.id === line.needId);
      if (need?.organization !== buyerOrganization) throw new Error('This basket contains a request for a different organization.');
      if (!surplus || !need || !scoreMatch(surplus, need)) throw new Error('A basket item is no longer eligible. Review your basket and try again.');
      const itemQuantity = (requestedByListing.get(surplus.id) ?? 0) + line.quantity;
      const needQuantity = (requestedByNeed.get(need.id) ?? 0) + line.quantity;
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || itemQuantity > surplus.quantity || needQuantity > need.quantity) {
        throw new Error('The available supply or request quantity changed. Review your basket and try again.');
      }
      requestedByListing.set(surplus.id, itemQuantity);
      requestedByNeed.set(need.id, needQuantity);
      totalAED += surplus.priceAED * line.quantity;
      validated.push({ line, surplus, need, match: scoreMatch(surplus, need) });
    }
    totalAED = Math.round(totalAED * 100) / 100;
    const payment = await new DemoPaymentAdapter().checkout(totalAED, paymentMethod);
    const orderId = `o-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const order = {
      id: orderId,
      buyerOrganization,
      totalAED,
      paymentMethod: payment.method,
      paymentStatus: payment.status,
      paymentReference: payment.reference,
      logisticsResponsibility: 'company',
      createdAt,
      status: 'pending',
      transferIds: [],
    };
    for (const { line, surplus, need, match } of validated) {
      const transfer = {
        id: `t-${Date.now()}-${order.transferIds.length + 1}`,
        orderId,
        surplusId: surplus.id,
        needId: need.id,
        quantity: line.quantity,
        unitPriceAED: surplus.priceAED,
        paymentAmountAED: Math.round(surplus.priceAED * line.quantity * 100) / 100,
        paymentStatus: order.paymentStatus,
        status: 'pending',
        logisticsMethod: '',
        deliveryFeeAED: 0,
        trackingReference: '',
        expectedDeliveryAt: '',
        logisticsNotes: '',
        createdAt,
        score: match.score,
        reasons: match.reasons,
      };
      surplus.quantity -= line.quantity;
      if (surplus.quantity === 0) surplus.status = 'reserved';
      need.quantity -= line.quantity;
      this.state.transfers.unshift(transfer);
      order.transferIds.push(transfer.id);
    }
    this.state.orders.unshift(order);
    this.persist();
    this.persistCart(this.getCart().filter((line) => line.buyerOrganization !== buyerOrganization));
    return clone(order);
  }

  async updateOrderPayment(orderId, payment) {
    const order = this.state.orders.find((item) => item.id === orderId);
    if (!order) throw new Error('Order not found.');
    if (order.paymentStatus !== 'awaiting_payment') throw new Error('This order does not need payment.');
    order.paymentStatus = payment.status;
    order.paymentMethod = payment.method;
    order.paymentReference = payment.reference;
    for (const transferId of order.transferIds) {
      const transfer = this.state.transfers.find((item) => item.id === transferId);
      if (transfer) transfer.paymentStatus = payment.status;
    }
    this.persist();
    return clone(order);
  }

  async updateLogistics(transferId, input, actor) {
    const transfer = this.state.transfers.find((item) => item.id === transferId);
    const item = this.state.surplus.find((surplus) => surplus.id === transfer?.surplusId);
    if (!transfer || !item) throw new Error('Order delivery record not found.');
    if (actor.role !== 'admin' && (actor.role !== 'company' || item.donor !== actor.organization)) {
      throw new Error('Only the selling company can arrange and update delivery.');
    }
    if (transfer.status !== 'approved') throw new Error('The company must confirm this order before arranging delivery.');
    const method = input.method.trim();
    const trackingReference = input.trackingReference.trim();
    const expectedDeliveryAt = input.expectedDeliveryAt.trim();
    const logisticsNotes = input.logisticsNotes.trim();
    const deliveryFeeAED = Number(input.deliveryFeeAED);
    if (!method || !expectedDeliveryAt) throw new Error('Specify the delivery method and estimated arrival time.');
    if (Number.isNaN(new Date(expectedDeliveryAt).getTime()) || new Date(expectedDeliveryAt).getTime() <= Date.now()) {
      throw new Error('Choose an estimated arrival time in the future.');
    }
    if (!Number.isFinite(deliveryFeeAED) || deliveryFeeAED < 0 || deliveryFeeAED > 100_000) throw new Error('Enter a valid logistics cost in AED.');
    transfer.logisticsMethod = method;
    transfer.deliveryFeeAED = Math.round(deliveryFeeAED * 100) / 100;
    transfer.trackingReference = trackingReference;
    transfer.expectedDeliveryAt = new Date(expectedDeliveryAt).toISOString();
    transfer.logisticsNotes = logisticsNotes;
    transfer.status = 'in_transit';
    this.updateOrderStatus(transfer.orderId);
    this.persist();
    return clone(transfer);
  }

  async sendMessage(orderId, senderOrganization, senderRole, text) {
    const content = text.trim();
    if (!content || content.length > 1500) throw new Error('Message must contain 1–1,500 characters.');
    const transfer = this.state.transfers.find((item) => (item.orderId ?? item.id) === orderId);
    if (!transfer) throw new Error('Order conversation not found.');
    const need = this.state.needs.find((item) => item.id === transfer.needId);
    const surplus = this.state.surplus.find((item) => item.id === transfer.surplusId);
    if (![need?.organization, surplus?.donor].includes(senderOrganization) && senderRole !== 'admin') {
      throw new Error('Only the buyer, company, or Refound administrator can message this order.');
    }
    const message = { id: `msg-${Date.now()}`, orderId, senderOrganization, senderRole, body: content, createdAt: new Date().toISOString() };
    this.state.messages.push(message);
    this.persist();
    return clone(message);
  }

  async getMessages(orderId) {
    return clone(this.state.messages.filter((message) => message.orderId === orderId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
  }

  async confirmReceipt(transferId, buyerOrganization) {
    const transfer = this.state.transfers.find((item) => item.id === transferId);
    const need = this.state.needs.find((item) => item.id === transfer?.needId);
    if (!transfer || !need) throw new Error('Delivery confirmation not found.');
    if (need.organization !== buyerOrganization) throw new Error('Only the requesting organization can confirm receipt.');
    if (transfer.status !== 'in_transit') throw new Error('The company must mark the order delivered before you confirm receipt.');
    transfer.status = 'delivered';
    const surplus = this.state.surplus.find((item) => item.id === transfer.surplusId);
    if ((surplus?.resourceType ?? 'Food') === 'Food') {
      this.state.metrics.mealsRescued += transfer.quantity * (surplus?.unit === 'meals' ? 1 : 4);
      this.state.metrics.kgDiverted += Math.round(transfer.quantity * (surplus?.unit === 'kg' ? 1 : 2.2));
      this.state.metrics.peopleReached += transfer.quantity * 2;
    }
    need.quantity = Math.max(0, need.quantity);
    this.updateOrderStatus(transfer.orderId);
    this.persist();
    return clone(transfer);
  }

  updateOrderStatus(orderId) {
    const order = this.state.orders.find((item) => item.id === orderId);
    if (!order) return;
    const statuses = order.transferIds.map((id) => this.state.transfers.find((item) => item.id === id)?.status);
    order.status = statuses.every((status) => status === 'delivered') ? 'delivered'
      : statuses.every((status) => status === 'cancelled') ? 'cancelled'
        : statuses.every((status) => ['in_transit', 'delivered'].includes(status)) ? 'in_transit'
          : statuses.every((status) => ['approved', 'in_transit', 'delivered'].includes(status)) ? 'approved' : 'pending';
  }

  /** @param {string} transferId */
  async advanceTransfer(transferId) {
    const transfer = this.state.transfers.find((item) => item.id === transferId);
    if (!transfer) throw new Error('Transfer not found.');
    if (transfer.status !== 'pending') throw new Error('Use the company delivery or NGO receipt actions to move this order to its next step.');
    transfer.status = 'approved';
    this.updateOrderStatus(transfer.orderId);
    this.persist();
    return clone(transfer);
  }

  async resetDemo() {
    this.state = { surplus: clone(seedSurplus), needs: clone(seedNeeds), transfers: clone(seedTransfers), metrics: clone(seedMetrics) };
    this.state.orders = [];
    this.state.messages = [];
    this.persist();
    localStorage.removeItem(VERIFICATION_KEY);
    localStorage.removeItem(CART_KEY);
  }
}

/** @typedef {{title:string,resourceType:string,category:string,quantity:number,unit:string,expiryHours:number,expiresAt:string,notes:string}} ExtractedSurplus */

/** Deterministic local extraction seam; production can call an LLM and normalize to this same shape. */
export class DemoExtractionAdapter {
  /** @param {string} text @returns {ExtractedSurplus} */
  extract(text) {
    const clean = text.trim();
    if (!clean) throw new Error('Add a short description so we can extract the details.');
    if (/\bexpired\b/i.test(clean)) throw new Error('Do not list expired items. Check the labeled expiry date and share usable items only.');
    if (/\b(medicines?|prescriptions?|pharmaceuticals?|sharps?)\b/i.test(clean)) throw new Error('Medicines and sharps are not accepted in this demo. Only list eligible, sealed equipment after checking local rules.');
    const quantityText = clean.replace(/\b(?:expir(?:es|y|ing)|use by)\s+(?:in\s+)?\d{1,3}\s*(?:days?|weeks?|months?)\b/ig, ' ');
    const quantityMatch = quantityText.match(/\b(\d{1,4})\s+(?:[\w-]+\s+){0,3}?(boxes?|loaves?|meals?|crates?|kilograms?|kg|items?|portions?|kits?|sets?|workbooks?|books?|coats?|pairs?|devices?|pieces?|units?)\b/i);
    const quantity = quantityMatch ? Number(quantityMatch[1]) : 10;
    const unitText = quantityMatch?.[2]?.toLowerCase() ?? '';
    const unitMap = { box: 'boxes', loaf: 'loaves', meal: 'meals', crate: 'crates', kilograms: 'kg', portions: 'meals', portion: 'meals', item: 'items', kit: 'kits', set: 'sets', book: 'books', workbook: 'books', workbooks: 'books', coat: 'coats', pair: 'pairs', device: 'devices', devices: 'devices', piece: 'pieces', pieces: 'pieces', unit: 'units', units: 'units' };
    const unit = unitMap[unitText] ?? (unitText || 'items');
    const resourceType = /\b(medical|clinical|first[- ]?aid|wound[- ]?care|mobility|wheelchair|crutches?|ppe|sterile kit)\b/i.test(clean)
      ? 'Medical equipment'
      : /\b(study|school|textbooks?|workbooks?|notebooks?|calculators?|computers?|laptops?|pencils?|pens?|paper|markers?|stationery|classroom|learning)\b/i.test(clean)
        ? 'Study resources'
        : /\b(coats?|clothing|jackets?|hygiene|furniture|household|electronics|blankets?|chairs?|desks?)\b/i.test(clean)
          ? 'Other essentials' : 'Food';
    const category = resourceType === 'Medical equipment'
      ? /\b(ppe|gloves?|masks?)\b/i.test(clean) ? 'PPE'
        : /\b(wheelchair|crutches?|mobility)\b/i.test(clean) ? 'Mobility aids'
          : /\b(first[- ]?aid|wound[- ]?care|sterile kit)\b/i.test(clean) ? 'First-aid kits'
            : /\b(clinical)\b/i.test(clean) ? 'Clinical equipment' : 'Other medical equipment'
      : resourceType === 'Study resources'
        ? /\b(textbooks?|workbooks?|books?)\b/i.test(clean) ? 'Textbooks'
          : /\b(calculator|computer|laptop|device)\b/i.test(clean) ? 'Computers & calculators'
            : /\b(art|craft|drawing)\b/i.test(clean) ? 'Art materials' : 'School supplies'
        : resourceType === 'Other essentials'
          ? /\b(coats?|clothing|jackets?|blankets?)\b/i.test(clean) ? 'Clothing'
            : /\b(hygiene|soap|toiletries)\b/i.test(clean) ? 'Hygiene'
              : /\b(furniture|chair|desk)\b/i.test(clean) ? 'Furniture'
                : /\b(electronics|television|monitor)\b/i.test(clean) ? 'Electronics' : 'Household goods'
      : /bread|loaf|loaves|bakery/i.test(clean) ? 'Bakery'
      : /meal|soup|prepared|portion/i.test(clean) ? 'Prepared meals'
        : /milk|dairy|yogurt|cheese/i.test(clean) ? 'Dairy'
          : /produce|fruit|vegetable|apple|greens|tomato/i.test(clean) ? 'Produce'
            : /pantry|rice|beans|pasta|canned|dry goods/i.test(clean) ? 'Pantry' : 'Produce';
    const title = clean.length > 54 ? `${clean.slice(0, 51).trim()}…` : clean;
    const expiryText = clean.match(/\b(?:expir(?:es|y|ing)|use by)\s+(?:in\s+)?(\d{1,3})\s*(days?|weeks?|months?)\b/i);
    const expiryCount = expiryText ? Number(expiryText[1]) : 0;
    const expiryMultiplier = expiryText?.[2].startsWith('week') ? 7 : expiryText?.[2].startsWith('month') ? 30 : 1;
    const expiresAt = expiryCount ? new Date(Date.now() + expiryCount * expiryMultiplier * 86_400_000).toISOString().slice(0, 10) : '';
    return { title, resourceType, category, quantity, unit, expiryHours: /today|tonight|close|urgent/i.test(clean) ? 8 : 24, expiresAt, notes: clean };
  }
}

/** Replace with a server-side LLM adapter without changing the assistant UI contract. */
export class DemoAssistantAdapter {
  async answer(prompt, matches = []) {
    const question = prompt.trim().toLowerCase();
    if (!question) throw new Error('Ask a question to get started.');
    if (question.includes('match') || question.includes('surplus') || question.includes('share food')) {
      const best = matches[0];
      if (best) return `A strong next step is ${best.surplus.quantity} ${best.surplus.unit} of ${best.surplus.category.toLowerCase()} for ${best.need.organization}. Why: ${best.reasons.join('; ')}. This is a local demo recommendation, so confirm the pickup and food-safety details with your partner.`;
      return 'There are no current compatible matches. Add an in-date surplus listing or a community need with matching category and quantity units.';
    }
    if (question.includes('verif') || question.includes('approval')) {
      return 'Organizations submit their details for review. A Refound administrator checks identity, registration, and contact information before approving access. Demo uploads keep filenames only in this browser and are not sent for verification.';
    }
    if (question.includes('odoo') || question.includes('database')) {
      return 'This workspace uses demo data, not a live Odoo database. A secure production connection needs a server-side API, your Odoo version and hosting details, relevant model/field mappings, and a staging database. Keep API credentials on the server.';
    }
    if (question.includes('privacy') || question.includes('data') || question.includes('ai')) {
      return 'This local assistant uses deterministic demo rules: prompts stay in your browser and are not sent to a model. Live AI should run behind a secure backend, minimize personal data, and let people verify suggestions before acting.';
    }
    return 'I can explain community matching, surplus listings, organization verification, privacy, and the planned Odoo connection. Tell me which part you would like help with.';
  }
}

/**
 * @param {typeof seedSurplus[number]} surplus
 * @param {typeof seedNeeds[number]} need
 * @returns {{score:number,reasons:string[],quantity:number}|null}
 */
export function scoreMatch(surplus, need) {
  if (surplus.status !== 'available' || surplus.quantity <= 0 || need.quantity <= 0
    || new Date(need.neededBy).getTime() <= Date.now()
    || surplus.unit.toLowerCase() !== need.unit.toLowerCase()
    || (surplus.resourceType ?? 'Food') !== (need.resourceType ?? 'Food')) return null;
  const exactCategory = surplus.category.toLowerCase() === need.category.toLowerCase();
  if (!exactCategory && surplus.category !== 'Other') return null;
  const pickupHoursLeft = (new Date(surplus.availableUntil).getTime() - Date.now()) / 3_600_000;
  const itemExpiry = surplus.expiresAt ? new Date(surplus.expiresAt).getTime() : Infinity;
  const hoursLeft = Math.min(pickupHoursLeft, (itemExpiry - Date.now()) / 3_600_000);
  if (hoursLeft <= 0 || !Number.isFinite(hoursLeft)) return null;
  if ((surplus.priceAED ?? 0) > (need.maxPriceAED ?? 0)) return null;
  const requestedExpiry = need.expiresAt ? new Date(need.expiresAt).getTime() : 0;
  if (requestedExpiry && itemExpiry < requestedExpiry) return null;
  const urgencyPoints = { critical: 42, high: 30, standard: 18 }[need.urgency];
  const categoryPoints = exactCategory ? 30 : 12;
  const freshnessPoints = hoursLeft <= 12 ? 20 : hoursLeft <= 36 ? 14 : 8;
  const originDistance = surplus.location.match(/([\d.]+)\s*mi/i);
  const destinationDistance = need.location.match(/([\d.]+)\s*mi/i);
  const distance = originDistance && destinationDistance
    ? Math.abs(Number(originDistance[1]) - Number(destinationDistance[1]))
    : destinationDistance ? Number(destinationDistance[1]) : 4;
  const proximityPoints = Math.max(0, 12 - Math.round(distance * 3));
  const score = Math.min(99, urgencyPoints + categoryPoints + freshnessPoints + proximityPoints);
  const reasons = [
    `${need.urgency[0].toUpperCase()}${need.urgency.slice(1)} community need`,
    exactCategory ? `Exact ${need.category.toLowerCase()} match` : 'Flexible category match',
    itemExpiry < Date.now() + 7 * 86_400_000 ? 'Prioritized before the item expiry date' : 'Enough time to arrange the handoff',
    `${distance.toFixed(1)} mi between partners`,
    'Quantity units align',
    (surplus.priceAED ?? 0) <= 0 ? 'No charge for the resource' : `AED ${(surplus.priceAED ?? 0).toFixed(2)} per unit within request budget`,
  ];
  return { score, reasons, quantity: Math.min(surplus.quantity, need.quantity) };
}

/** @param {typeof seedSurplus[number][]} surplus @param {typeof seedNeeds[number][]} needs */
export function buildMatches(surplus, needs) {
  return surplus.flatMap((item) => needs.map((need) => {
    const match = scoreMatch(item, need);
    return match ? { surplus: item, need, ...match } : null;
  })).filter(Boolean).sort((a, b) => b.score - a.score);
}

export function formatExpiry(dateString) {
  const hours = Math.ceil((new Date(dateString).getTime() - Date.now()) / 3_600_000);
  if (hours <= 0) return 'Expired';
  if (hours < 24) return `Expires in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Expires in ${days}d`;
}
