// ============================================================================
// RS ZEVAR ERP — Courier Recommendation (city-based)
// ----------------------------------------------------------------------------
// Order ID page ke booking dropdown mein staff ko "⭐ Recommended" badge
// dikhane ke liye. Customer ki city dekh kar best courier suggest karta hai.
//
// RULE (Abdul, Jun 2026):
//   • Karachi                 → Kangaroo
//   • Listed major cities     → Trax
//   • Baaki sab (default)     → Leopards
//
// Spelling-safe: chhoti-badi spelling, small letters, extra spaces, aur common
// galtiyaan (sargodah, peshawer, karach, rawalpinid, etc.) sab handle hoti hain.
// LEKIN milti-julti ALAG cities GALTI se match na ho — isliye andha fuzzy match
// NAHI hai. Sirf: (1) exact match, (2) curated misspelling list, (3) whole-word
// token match. Isi wajah se "Pindi Gheb" / "Pindi Bhattian" / "Bahawalnagar" /
// "Rawalakot" sahi se Leopards (default) pe rehti hain — Rawalpindi/Bahawalpur
// se confuse nahi hotin.
//
// EDIT KARNA HO TO: bas TRAX_CITIES set ya MISSPELLINGS map mein line add/remove
// kar do — poora system automatically update ho jayega. Koi aur file chherne ki
// zaroorat nahi.
// ============================================================================

// ─── Normalizer ─────────────────────────────────────────────────────────────
// lowercase + accents hatao + punctuation ko space + extra spaces collapse.
function normalizeCity(raw) {
  if (!raw) return '';
  let s = String(raw).trim().toLowerCase();
  // strip accents/diacritics
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  // anything not a-z 0-9 space → space
  s = s.replace(/[^a-z0-9 ]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// ─── Karachi (→ Kangaroo) ───────────────────────────────────────────────────
const KANGAROO_CITIES = new Set(['karachi']);

// ─── Major cities (→ Trax) — canonical normalized names ─────────────────────
const TRAX_CITIES = new Set([
  'lahore', 'rawalpindi', 'islamabad', 'multan', 'faisalabad', 'peshawar',
  'quetta', 'gujranwala', 'sialkot', 'bahawalpur', 'sargodha', 'gujrat',
  'sahiwal', 'rahim yar khan', 'sheikhupura', 'layyah', 'dera ghazi khan',
  'abbottabad', 'sukkur', 'nawabshah', 'sadiqabad', 'shikarpur', 'wah cantt',
  'larkana', 'thatta', 'jamshoro', 'lahore cantt',
  // Added Jun 2026 (Abdul) — 28 more major cities
  'hyderabad', 'jhang', 'mardan', 'kasur', 'okara', 'mingora', 'swat',
  'chiniot', 'kamoke', 'burewala', 'jacobabad', 'muzaffarabad', 'khanewal',
  'hafizabad', 'kohat', 'dera ismail khan', 'bahawalnagar', 'pakpattan',
  'khuzdar', 'vehari', 'gojra', 'mandi bahauddin', 'tando adam', 'jhelum',
  'chaman', 'mirpur khas', 'attock', 'nowshera', 'swabi',
  'shaheed benazirabad',
]);

// ─── Curated misspellings / abbreviations → canonical (EXACT match only) ─────
// Ye sirf poore string pe exact match hoti hain, isliye safe hain.
const MISSPELLINGS = {
  // Karachi
  'khi': 'karachi', 'karach': 'karachi', 'karchi': 'karachi', 'karahi': 'karachi',
  'karaachi': 'karachi', 'karchii': 'karachi',
  // Lahore
  'lhr': 'lahore', 'lhe': 'lahore', 'lahor': 'lahore', 'lahoer': 'lahore', 'lahore ': 'lahore',
  'shahdara lahore': 'lahore', 'lol lahore': 'lahore',
  'lahore cant': 'lahore cantt', 'lahore cantonment': 'lahore cantt',
  // Rawalpindi
  'rwp': 'rawalpindi', 'pindi': 'rawalpindi', 'rawal pindi': 'rawalpindi',
  'rawalpinid': 'rawalpindi', 'rawalpinfi': 'rawalpindi', 'rawalpandi': 'rawalpindi',
  'rawalpindi cantt': 'rawalpindi',
  // Islamabad
  'isb': 'islamabad', 'islambad': 'islamabad', 'islamabd': 'islamabad',
  'islmabad': 'islamabad', 'islamabad capital territory': 'islamabad',
  // Faisalabad
  'fsd': 'faisalabad', 'lyallpur': 'faisalabad', 'faislabad': 'faisalabad',
  'faisalbad': 'faisalabad',
  // Peshawar
  'peshawer': 'peshawar', 'peshwar': 'peshawar', 'pheshawar': 'peshawar',
  // Gujranwala
  'gujrawala': 'gujranwala', 'gujranwla': 'gujranwala', 'gujarawala': 'gujranwala',
  'gujranwalla': 'gujranwala',
  // Sialkot
  'sailkot': 'sialkot', 'sialkgot': 'sialkot',
  // Bahawalpur
  'bahawalpure': 'bahawalpur', 'bhawalpur': 'bahawalpur', 'bahawal pur': 'bahawalpur',
  // Sargodha
  'sargodah': 'sargodha', 'sarghoda': 'sargodha',
  // Rahim Yar Khan
  'ryk': 'rahim yar khan', 'rahimyar khan': 'rahim yar khan',
  'rahim yaar khan': 'rahim yar khan', 'rahimyarkhan': 'rahim yar khan',
  // Dera Ghazi Khan
  'dg khan': 'dera ghazi khan', 'd g khan': 'dera ghazi khan', 'dgkhan': 'dera ghazi khan',
  'dera ghazi': 'dera ghazi khan', 'd g k': 'dera ghazi khan', 'dera gazi khan': 'dera ghazi khan',
  // Abbottabad
  'abbotabad': 'abbottabad', 'abottabad': 'abbottabad', 'abbtabad': 'abbottabad',
  'abbotabaad': 'abbottabad',
  // Sheikhupura
  'sheikupura': 'sheikhupura', 'shekhupura': 'sheikhupura', 'shaikhupura': 'sheikhupura',
  'sheikh pura': 'sheikhupura',
  // Nawabshah
  'nawab shah': 'nawabshah',
  // Sadiqabad
  'sadiq abad': 'sadiqabad',
  // Wah Cantt
  'wah': 'wah cantt', 'wahcantt': 'wah cantt', 'wah cant': 'wah cantt',
  'wah cantonment': 'wah cantt',
  // Misc
  'mtn': 'multan', 'queta': 'quetta',
  // Added Jun 2026 — aliases for new cities
  'd i khan': 'dera ismail khan', 'di khan': 'dera ismail khan', 'dera ismael khan': 'dera ismail khan',
  'dikhan': 'dera ismail khan', 'd i k': 'dera ismail khan',
  'mandi baha uddin': 'mandi bahauddin', 'mandi bhauddin': 'mandi bahauddin', 'mb din': 'mandi bahauddin',
  'tandoadam': 'tando adam', 'tando adam khan': 'tando adam',
  'mirpurkhas': 'mirpur khas', 'mir pur khas': 'mirpur khas',
  'shaheed benazir abad': 'shaheed benazirabad', 'benazirabad': 'shaheed benazirabad',
  'sba': 'shaheed benazirabad',
  'muzafarabad': 'muzaffarabad', 'muzaffrabad': 'muzaffarabad',
  'mingora swat': 'mingora', 'swat mingora': 'mingora',
  'hydrabad': 'hyderabad', 'haiderabad': 'hyderabad', 'hyd': 'hyderabad',
  'd g khan ': 'dera ghazi khan',
};

// Single-word canonical cities — safe for whole-word token match
// (e.g. "gulshan karachi" → Kangaroo, "shahdara lahore" → Trax).
// Multi-word cities (wah cantt, dera ghazi khan...) token-match nahi karte —
// woh exact/misspelling se hi handle hote hain (taake galat match na ho).
const SINGLE_TOKEN_TRAX = new Set(
  [...TRAX_CITIES].filter(c => !c.includes(' '))
);

/**
 * City se recommended courier nikaalta hai.
 * @param {string} city — order.customer_city (raw, kaisi bhi spelling)
 * @returns {'Kangaroo'|'Trax'|'Leopards'} recommended courier (default Leopards)
 */
export function recommendCourier(city) {
  let n = normalizeCity(city);
  if (!n) return 'Leopards'; // blank → default

  // 1) curated misspelling → canonical
  if (MISSPELLINGS[n]) n = MISSPELLINGS[n];

  // 2) exact canonical match
  if (KANGAROO_CITIES.has(n)) return 'Kangaroo';
  if (TRAX_CITIES.has(n)) return 'Trax';

  // 3) whole-word token match (handles "<area> karachi" / "<area> lahore" etc.)
  const tokens = new Set(n.split(' '));
  if (tokens.has('karachi')) return 'Kangaroo';
  for (const t of tokens) {
    if (SINGLE_TOKEN_TRAX.has(t)) return 'Trax';
  }

  // 4) default
  return 'Leopards';
}

/**
 * Recommendation ko booking-menu ke key se map karta hai.
 * @returns {'kangaroo'|'trax'|'leopards'}
 */
export function recommendCourierKey(city) {
  return recommendCourier(city).toLowerCase();
}
