/** @typedef {'available'|'reserved'|'collected'|'expired'} SurplusStatus */
/** @typedef {'pending'|'approved'|'in_transit'|'delivered'|'cancelled'} TransferStatus */
export const RESOURCE_TYPES = ['Food', 'Medical equipment', 'Study resources', 'Other essentials'];
export const RESOURCE_CATEGORIES = {
  Food: ['Produce', 'Bakery', 'Prepared meals', 'Dairy', 'Pantry'],
  'Medical equipment': ['Mobility aids', 'Clinical equipment', 'PPE', 'First-aid kits', 'Other medical equipment'],
  'Study resources': ['Textbooks', 'School supplies', 'Computers & calculators', 'Art materials', 'Other study resources'],
  'Other essentials': ['Clothing', 'Hygiene', 'Household goods', 'Furniture', 'Electronics', 'Other essentials'],
};
/**
 * @typedef {Object} Surplus
 * @property {string} id
 * @property {string} title
 * @property {string} [resourceType]
 * @property {string} category
 * @property {number} quantity
 * @property {string} unit
 * @property {string} location
 * @property {string} availableUntil ISO date-time string
 * @property {string} [expiresAt] Manufacturer/item expiry date (when applicable).
 * @property {number} [priceAED] Price per unit in AED; zero indicates a free donation.
 * @property {string} [condition] Item condition details.
 * @property {string} [specifications] Resource-specific details, such as size, model, or edition.
 * @property {string} [storageInstructions] Storage and handling requirements.
 * @property {string} listedAt ISO date-time string
 * @property {string} notes
 * @property {SurplusStatus} status
 * @property {string} [donor]
 */
/**
 * @typedef {Object} Need
 * @property {string} id
 * @property {string} organization
 * @property {string} contact
 * @property {string} category
 * @property {string} [resourceType]
 * @property {number} [maxPriceAED] Maximum acceptable price per unit; zero means donated resources only.
 * @property {string} [preferredCondition] Minimum condition acceptable for this request.
 * @property {string} [specifications] Detailed requirements, such as a school year or device model.
 * @property {string} [storageInstructions] Receiving/storage arrangements.
 * @property {number} quantity
 * @property {string} unit
 * @property {string} location
 * @property {'critical'|'high'|'standard'} urgency
 * @property {string} neededBy ISO date-time string
 * @property {string} note
 */
/**
 * @typedef {Object} Transfer
 * @property {string} id
 * @property {string} surplusId
 * @property {string} needId
 * @property {number} quantity
 * @property {TransferStatus} status
 * @property {string} createdAt ISO date-time string
 * @property {number} score
 * @property {string[]} reasons
 */

const dateFromNow = (days, hour = 18) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

/** @type {Surplus[]} */
export const seedSurplus = [
  { id: 's-101', title: 'Seasonal produce boxes', category: 'Produce', quantity: 28, unit: 'boxes', location: 'North Market · 0.8 mi', availableUntil: dateFromNow(0, 16), expiresAt: dateFromNow(1, 16), priceAED: 0, condition: 'Fresh, grade A', specifications: 'Mixed leafy greens, tomatoes, and zucchini', storageInstructions: 'Keep chilled; collect in an insulated vehicle.', listedAt: dateFromNow(-0.15, 10), notes: 'Mixed seasonal produce. Confirm collection window and inspect at handoff.', status: 'available', donor: 'Meadow & Fig' },
  { id: 's-102', title: 'Fresh sourdough loaves', category: 'Bakery', quantity: 42, unit: 'loaves', location: 'North Market · 0.8 mi', availableUntil: dateFromNow(1, 11), expiresAt: dateFromNow(2, 11), priceAED: 0, condition: 'Baked this morning', specifications: 'Contains wheat and sesame', storageInstructions: 'Store in a clean, dry food-safe crate.', listedAt: dateFromNow(-0.4, 8), notes: 'Contains wheat and sesame. Please confirm allergen information with the donor.', status: 'available', donor: 'Meadow & Fig' },
  { id: 's-103', title: 'Prepared lunch bowls', category: 'Prepared meals', quantity: 16, unit: 'meals', location: 'Riverside Kitchen · 1.6 mi', availableUntil: dateFromNow(0, 14), expiresAt: dateFromNow(0, 16), priceAED: 0, condition: 'Prepared today, sealed', specifications: 'Vegetarian grain bowls', storageInstructions: 'Keep chilled at 5°C or below; transport in a cold box.', listedAt: dateFromNow(-0.08, 11), notes: 'Vegetarian grain bowls, chilled and labelled.', status: 'available', donor: 'Riverside Kitchen' },
  { id: 's-104', title: 'Dairy & pantry bundle', category: 'Dairy', quantity: 6, unit: 'crates', location: 'Eastside Co-op · 2.4 mi', availableUntil: dateFromNow(2, 17), expiresAt: dateFromNow(3, 17), priceAED: 0, condition: 'Sealed retail packaging', specifications: 'Milk, yogurt, and shelf-stable oats', storageInstructions: 'Keep dairy chilled; separate oats from chilled products.', listedAt: dateFromNow(-1, 9), notes: 'Milk, yogurt, and shelf-stable oats. Keep chilled.', status: 'available', donor: 'Eastside Co-op' },
  { id: 's-105', title: 'Apples & pears', category: 'Produce', quantity: 15, unit: 'kg', location: 'North Market · 0.8 mi', availableUntil: dateFromNow(3, 17), expiresAt: dateFromNow(7, 17), priceAED: 0, condition: 'Ripe; use this week', specifications: 'Mixed apples and pears', storageInstructions: 'Store cool and dry; inspect before distribution.', listedAt: dateFromNow(-0.7, 9), notes: 'A little ripe; best shared this week.', status: 'available', donor: 'Meadow & Fig' },
  { id: 's-106', title: 'Soup & stew portions', category: 'Prepared meals', quantity: 8, unit: 'meals', location: 'Riverside Kitchen · 1.6 mi', availableUntil: dateFromNow(1, 15), expiresAt: dateFromNow(2, 15), priceAED: 0, condition: 'Sealed and chilled', specifications: 'Vegetable soup; vegan and gluten-free', storageInstructions: 'Keep chilled at 5°C or below; cold-box transport required.', listedAt: dateFromNow(-0.2, 12), notes: 'Vegetable soup, sealed portions. Vegan and gluten-free.', status: 'available', donor: 'Riverside Kitchen' },
  { id: 's-107', title: 'Sealed first-aid kits', resourceType: 'Medical equipment', category: 'First-aid kits', quantity: 18, unit: 'kits', location: 'Northside Health Supply · 1.1 mi', availableUntil: dateFromNow(1, 17), expiresAt: dateFromNow(45, 17), priceAED: 0, condition: 'Manufacturer-sealed', specifications: 'Non-prescription, labelled first-aid kits; no medicines or sharps.', storageInstructions: 'Keep sealed, dry, and within the labeled storage temperature.', listedAt: dateFromNow(-0.3, 10), notes: 'Check item labels and local donation rules before transfer.', status: 'available', donor: 'Northside Health Supply' },
  { id: 's-108', title: 'Pocket calculators & geometry sets', resourceType: 'Study resources', category: 'Computers & calculators', quantity: 16, unit: 'sets', location: 'Campus Book Co. · 1.7 mi', availableUntil: dateFromNow(3, 17), expiresAt: '', priceAED: 15, condition: 'Tested, good working order', specifications: 'Scientific calculators; geometry kit in original case', storageInstructions: 'Keep dry; batteries included and tested.', listedAt: dateFromNow(-0.4, 10), notes: 'Clean, working calculators and geometry kits in original cases.', status: 'available', donor: 'Campus Book Co.' },
  { id: 's-109', title: 'Algebra workbooks', resourceType: 'Study resources', category: 'Textbooks', quantity: 35, unit: 'books', location: 'Campus Book Co. · 1.7 mi', availableUntil: dateFromNow(5, 17), expiresAt: '', priceAED: 10, condition: 'New, unused', specifications: 'Current edition; confirm grade and edition with the recipient', storageInstructions: 'Keep dry and protected from rain.', listedAt: dateFromNow(-0.8, 10), notes: 'Current edition, unused workbooks. Check edition match with the receiving teacher.', status: 'available', donor: 'Campus Book Co.' },
  { id: 's-110', title: 'Warm winter coats', resourceType: 'Other essentials', category: 'Clothing', quantity: 24, unit: 'coats', location: 'Harbor Street Outfitters · 2.0 mi', availableUntil: dateFromNow(7, 17), expiresAt: '', priceAED: 0, condition: 'New, with tags', specifications: 'Adult and youth sizes; mixed labelled bundles', storageInstructions: 'Keep clean, dry, and sealed before collection.', listedAt: dateFromNow(-0.2, 11), notes: 'New adult and youth coats, varied sizes. Sealed, labelled bundles.', status: 'available', donor: 'Harbor Street Outfitters' },
];

/** @type {Need[]} */
export const seedNeeds = [
  { id: 'n-201', organization: 'Harbor House Pantry', contact: 'Maya Chen', category: 'Produce', quantity: 32, unit: 'boxes', location: 'Downtown · 1.2 mi', urgency: 'critical', neededBy: dateFromNow(0, 17), note: 'Fresh produce needed for tonight’s community supper.' },
  { id: 'n-202', organization: 'Sunrise Youth Center', contact: 'Luis Romero', category: 'Bakery', quantity: 36, unit: 'loaves', location: 'Eastside · 2.1 mi', urgency: 'high', neededBy: dateFromNow(1, 12), note: 'Breakfast program serves 70 young people tomorrow.' },
  { id: 'n-203', organization: 'The Welcome Table', contact: 'Amina Yusuf', category: 'Prepared meals', quantity: 4, unit: 'meals', location: 'Riverside · 1.8 mi', urgency: 'critical', neededBy: dateFromNow(0, 15), note: 'Dinner service starts at 5pm. Vegetarian meals especially welcome.' },
  { id: 'n-204', organization: 'Oak Street Community Fridge', contact: 'Noah Brooks', category: 'Dairy', quantity: 3, unit: 'crates', location: 'Eastside · 2.6 mi', urgency: 'standard', neededBy: dateFromNow(2, 16), note: 'Restocking the neighborhood fridge for the weekend.' },
  { id: 'n-205', organization: 'Harbor House Pantry', contact: 'Maya Chen', category: 'Produce', quantity: 0, unit: 'kg', location: 'Downtown · 1.2 mi', urgency: 'high', neededBy: dateFromNow(1, 16), note: 'Fruit for take-home family bags.' },
  { id: 'n-206', organization: 'Northside Food Collective', contact: 'Jamie River', category: 'Produce', quantity: 12, unit: 'boxes', location: 'Northside · 1.4 mi', urgency: 'high', neededBy: dateFromNow(1, 17), note: 'Produce boxes for the neighborhood pantry this week.' },
  { id: 'n-207', organization: 'Northside Community Clinic', contact: 'Alex Morgan', resourceType: 'Medical equipment', category: 'First-aid kits', quantity: 12, unit: 'kits', location: 'Northside · 1.3 mi', urgency: 'high', neededBy: dateFromNow(2, 17), expiresAt: dateFromNow(14, 17), maxPriceAED: 0, preferredCondition: 'New and manufacturer-sealed', specifications: 'Non-prescription first-aid kits; no medicines, sharps, recalled, or opened sterile supplies.', storageInstructions: 'Keep sealed and dry; clinic can receive weekday deliveries.', note: 'Factory-sealed first-aid kits for our community outreach team; no medicines, sharps, or opened supplies.' },
  { id: 'n-208', organization: 'Eastbank Learning Hub', contact: 'Sam Patel', resourceType: 'Study resources', category: 'Computers & calculators', quantity: 10, unit: 'sets', location: 'Eastbank · 1.9 mi', urgency: 'high', neededBy: dateFromNow(3, 17), maxPriceAED: 20, preferredCondition: 'Tested and working', specifications: 'Scientific calculators and complete geometry sets for after-school classes.', storageInstructions: 'Can receive Monday–Friday, 9am–4pm.', note: 'Working calculators and geometry sets for our after-school classes.' },
  { id: 'n-209', organization: 'Northside Learning Circle', contact: 'Rae Quinn', resourceType: 'Study resources', category: 'Textbooks', quantity: 20, unit: 'books', location: 'Northside · 1.5 mi', urgency: 'standard', neededBy: dateFromNow(5, 17), maxPriceAED: 12, preferredCondition: 'New or very good', specifications: 'Current-edition algebra workbooks; send edition/grade details before confirmation.', storageInstructions: 'Keep dry; delivery to the school office.', note: 'Current-edition algebra workbooks for local students.' },
  { id: 'n-210', organization: 'Harbor House Pantry', contact: 'Maya Chen', resourceType: 'Other essentials', category: 'Clothing', quantity: 16, unit: 'coats', location: 'Downtown · 1.4 mi', urgency: 'high', neededBy: dateFromNow(4, 17), maxPriceAED: 0, preferredCondition: 'New or clean and gently used', specifications: 'Children’s and adult sizes; please confirm size breakdown and bundle quantities.', storageInstructions: 'Drop at the pantry loading entrance between 10am and 2pm.', note: 'Warm, clean coats in children’s and adult sizes for families.' },
];

/** @type {Transfer[]} */
export const seedTransfers = [
  { id: 't-301', surplusId: 's-106', needId: 'n-203', quantity: 16, status: 'approved', createdAt: dateFromNow(-0.1, 10), score: 96, reasons: ['Critical dinner need', 'Nearby pickup', 'Exact category match'] },
  { id: 't-302', surplusId: 's-105', needId: 'n-205', quantity: 20, status: 'delivered', createdAt: dateFromNow(-2, 10), score: 88, reasons: ['High-priority pantry need', 'Produce requested'] },
  { id: 't-303', surplusId: 's-104', needId: 'n-204', quantity: 12, status: 'delivered', createdAt: dateFromNow(-4, 11), score: 82, reasons: ['Community fridge restock', 'Category match'] },
];

export const seedMetrics = { mealsRescued: 1284, kgDiverted: 642, peopleReached: 386, partnerOrgs: 12, mealsThisMonth: 284 };
