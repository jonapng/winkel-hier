/* ==================================================================
   WINKEL HIER — app.js
   ------------------------------------------------------------------
   This is the "brain" of the app. It is plain JavaScript, no
   frameworks and no build step — the browser reads this file exactly
   as it's written.

   The file is organised top-to-bottom like this:
     1. Settings you might want to tweak
     2. The keyword dictionary (word you type -> kind of shop)
     3. Small helper functions (distance, text cleanup, formatting)
     4. A simplified "is it open right now?" checker
     5. Getting the user's location (GPS, or typed address)
     6. Talking to the Overpass API (the store search itself)
     7. Drawing the results on the page
     8. Wiring buttons/forms to all of the above
   ================================================================== */


/* ------------------------------------------------------------------
   1. SETTINGS
   ------------------------------------------------------------------ */

// How far around the user we search, in metres.
const SEARCH_RADIUS_METERS = 1500;

// The free Overpass API endpoint (public OpenStreetMap query service).
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// The free Nominatim API endpoint (public OpenStreetMap geocoder),
// used only when we type an address instead of using GPS.
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// If Overpass hasn't answered within this many milliseconds, we give
// up and show a friendly "try again" message instead of hanging forever.
const OVERPASS_TIMEOUT_MS = 15000;


/* ------------------------------------------------------------------
   2. THE KEYWORD DICTIONARY
   ------------------------------------------------------------------
   Each entry below is one "kind of shop". It has:
     - key:      an internal id (not shown to the user)
     - label:    a friendly name shown in results
     - tags:     which OpenStreetMap shops count as this category (see
                 wiki.openstreetmap.org/wiki/Key:shop). This is a list
                 of "OR" groups — a place matches if it satisfies ANY
                 one group. Each group is itself a list of {key,value}
                 conditions that must ALL be true together ("AND").
                 Example: women's clothing needs shop=clothes AND
                 clothes=women at the same time, so its one group has
                 two conditions in it.
     - keywords: Dutch AND English words that should match this category

   Categories are kept narrow on purpose: the more specific the tags,
   the less likely a search returns something unrelated. If a category
   turns up nothing nearby, the app automatically broadens to nearby
   supermarkets/department stores instead (see runSearch below) — so
   there's no need to make any single category overly broad "just in
   case".

   Feel free to add more keywords later — that's the easiest way to
   teach the app new words without touching any other code.
   ------------------------------------------------------------------ */

const CATEGORIES = [
  {
    key: "groceries",
    label: "Grocery store",
    // "shop=grocery" is deliberately left out: it's a vague,
    // inconsistently used OpenStreetMap tag. We also never query broad
    // catch-all tags like "shop=yes" — vague tags in, vague results out.
    requireName: true,
    tags: [[{ key: "shop", value: "supermarket" }], [{ key: "shop", value: "convenience" }]],
    keywords: [
      "melk", "milk", "kaas", "cheese", "eieren", "eggs",
      "boodschappen", "groceries", "grocery", "supermarkt", "supermarket",
      "eten", "food", "yoghurt", "yogurt", "drinken", "drinks",
    ],
  },
  {
    key: "bakery",
    label: "Bakery",
    requireName: true,
    tags: [[{ key: "shop", value: "bakery" }]],
    keywords: ["brood", "bread", "bakker", "bakkerij", "bakery"],
  },
  {
    key: "butcher",
    label: "Butcher",
    requireName: true,
    tags: [[{ key: "shop", value: "butcher" }]],
    keywords: ["slager", "slagerij", "butcher", "vlees", "meat"],
  },
  {
    key: "greengrocer",
    label: "Greengrocer",
    requireName: true,
    tags: [[{ key: "shop", value: "greengrocer" }]],
    keywords: ["groente", "vegetables", "fruit", "groenteboer", "groentewinkel"],
  },
  {
    key: "wine_liquor",
    label: "Wine & liquor store",
    requireName: true,
    tags: [[{ key: "shop", value: "alcohol" }]],
    keywords: ["wijn", "wine", "drank", "sterke drank", "slijterij", "liquor", "alcohol", "bier", "beer"],
  },
  {
    key: "tools",
    label: "Hardware / DIY store",
    requireName: true,
    tags: [
      [{ key: "shop", value: "hardware" }],
      [{ key: "shop", value: "doityourself" }],
      [{ key: "shop", value: "trade" }],
      [{ key: "shop", value: "paint" }],
    ],
    keywords: [
      "schroevendraaier", "screwdriver", "hamer", "hammer", "gereedschap",
      "tools", "klussen", "diy", "verf", "paint", "schroeven", "screws",
      "spijkers", "nails", "boor", "boormachine", "drill", "zaag", "saw",
      "ijzerwaren", "hardware", "bouwmarkt",
    ],
  },
  {
    key: "clothing",
    label: "Clothing store",
    // A general clothing search (no gender/age implied). Women's/men's/
    // kids' clothing are their own categories below, so those searches
    // don't just return any random clothes shop.
    requireName: true,
    tags: [[{ key: "shop", value: "clothes" }]],
    keywords: [
      "kleding", "kleren", "clothes", "clothing", "kledingwinkel",
      "shirt", "t-shirt", "broek", "pants", "trousers", "jurk", "dress",
      "jas", "jacket", "coat", "trui", "sweater",
    ],
  },
  {
    key: "womens_clothing",
    label: "Women's clothing store",
    requireName: true,
    tags: [[{ key: "shop", value: "clothes" }, { key: "clothes", value: "women" }]],
    keywords: ["dameskleding", "women's clothing", "womenswear", "damesmode"],
  },
  {
    key: "mens_clothing",
    label: "Men's clothing store",
    requireName: true,
    tags: [[{ key: "shop", value: "clothes" }, { key: "clothes", value: "men" }]],
    keywords: ["herenkleding", "men's clothing", "menswear", "herenmode"],
  },
  {
    key: "kids_clothing",
    label: "Kids' clothing store",
    requireName: true,
    tags: [
      [{ key: "shop", value: "clothes" }, { key: "clothes", value: "children" }],
      [{ key: "shop", value: "baby_goods" }],
    ],
    keywords: ["kinderkleding", "kids clothing", "children's clothing", "babykleding", "baby clothing"],
  },
  {
    key: "shoes",
    label: "Shoe store",
    requireName: true,
    tags: [[{ key: "shop", value: "shoes" }]],
    keywords: ["schoenen", "shoes", "laarzen", "boots", "sneakers", "sandalen", "sandals"],
  },
  {
    key: "sports",
    label: "Sports store",
    requireName: true,
    tags: [[{ key: "shop", value: "sports" }]],
    keywords: [
      "sport", "sports", "sportschoenen", "sports shoes", "bal", "ball",
      "fitness", "yoga", "tennisracket", "voetbal", "football",
      "sportkleding", "sportswear", "activewear",
    ],
  },
  {
    key: "electronics",
    label: "Electronics store",
    requireName: true,
    tags: [[{ key: "shop", value: "electronics" }]],
    keywords: [
      "electronica", "elektronica", "electronics", "tv", "televisie",
      "television", "koptelefoon", "headphones", "oplader", "charger",
      "kabel", "cable", "speaker", "luidspreker",
    ],
  },
  {
    key: "computers",
    label: "Computer store",
    requireName: true,
    tags: [[{ key: "shop", value: "computer" }]],
    keywords: ["computer", "computerwinkel", "laptop", "pc"],
  },
  {
    key: "phones",
    label: "Phone store",
    requireName: true,
    tags: [[{ key: "shop", value: "mobile_phone" }]],
    keywords: ["telefoon", "phone", "mobiel", "mobile", "smartphone", "gsm", "telefoonhoesje", "phone case"],
  },
  {
    key: "appliances",
    label: "Appliance store",
    requireName: true,
    tags: [[{ key: "shop", value: "appliance" }]],
    keywords: [
      "wasmachine", "washing machine", "koelkast", "fridge", "refrigerator",
      "huishoudelijke apparaten", "appliances", "stofzuiger", "vacuum cleaner",
    ],
  },
  {
    key: "books",
    label: "Book store",
    requireName: true,
    tags: [[{ key: "shop", value: "books" }]],
    keywords: ["boek", "boeken", "book", "books", "roman", "novel", "tijdschrift", "magazine"],
  },
  {
    key: "stationery",
    label: "Stationery store",
    requireName: true,
    tags: [[{ key: "shop", value: "stationery" }]],
    keywords: [
      "pen", "pennen", "potlood", "pencil", "papier", "paper", "schrift",
      "notebook", "wenskaart", "greeting card", "verjaardagskaart",
      "birthday card", "kaart", "card", "envelop", "envelope", "stationery",
      "kantoorartikelen",
    ],
  },
  {
    key: "toys",
    label: "Toy store",
    requireName: true,
    tags: [[{ key: "shop", value: "toys" }]],
    keywords: ["speelgoed", "toys", "toy", "pop", "doll", "lego", "spel", "game", "bordspel", "board game"],
  },
  {
    key: "flowers",
    label: "Florist",
    requireName: true,
    tags: [[{ key: "shop", value: "florist" }]],
    // Note: "plant"/"planten"/"plants" also appear under "garden" below
    // on purpose — a houseplant/bouquet (florist) and an outdoor garden
    // plant (garden centre) are genuinely different shops, so this word
    // is a deliberately ambiguous case the app will ask you to clarify.
    keywords: ["bloemen", "flowers", "bloem", "flower", "boeket", "bouquet", "plant", "planten", "plants"],
  },
  {
    key: "garden",
    label: "Garden centre",
    requireName: true,
    tags: [[{ key: "shop", value: "garden_centre" }]],
    keywords: ["tuin", "garden", "tuincentrum", "garden centre", "plant", "planten", "plants"],
  },
  {
    key: "pharmacy",
    label: "Pharmacy / drugstore",
    requireName: true,
    tags: [
      [{ key: "amenity", value: "pharmacy" }],
      [{ key: "shop", value: "chemist" }],
      [{ key: "shop", value: "cosmetics" }],
    ],
    keywords: [
      "apotheek", "pharmacy", "drogist", "drogisterij", "drugstore",
      "medicijnen", "medicine", "pijnstiller", "painkiller", "paracetamol",
      "shampoo", "zeep", "soap", "tandpasta", "toothpaste", "luiers", "diapers",
    ],
  },
  {
    key: "pets",
    label: "Pet store",
    requireName: true,
    tags: [[{ key: "shop", value: "pet" }]],
    keywords: [
      "dierenwinkel", "pet store", "hondenvoer", "dog food", "kattenvoer",
      "cat food", "dieren", "pets", "hond", "dog", "kat", "cat",
    ],
  },
  {
    key: "kitchenware",
    label: "Kitchenware store",
    requireName: true,
    tags: [[{ key: "shop", value: "houseware" }]],
    keywords: [
      "keukenspullen", "kitchenware", "pannen", "pans", "bestek", "cutlery",
      "servies", "dishes", "huishoudartikelen", "household items",
    ],
  },
  {
    key: "furniture",
    label: "Furniture store",
    requireName: true,
    tags: [[{ key: "shop", value: "furniture" }]],
    keywords: ["meubels", "furniture", "bank", "sofa", "tafel", "table", "stoel", "chair", "kast", "wardrobe"],
  },
  {
    key: "home_decor",
    label: "Home decor store",
    requireName: true,
    tags: [[{ key: "shop", value: "interior_decoration" }]],
    keywords: ["woonaccessoires", "home decor", "interieur", "decoratie", "decoration", "wooninrichting"],
  },
  {
    key: "bikes",
    label: "Bike shop",
    requireName: true,
    tags: [[{ key: "shop", value: "bicycle" }]],
    keywords: [
      "fiets", "bike", "bicycle", "fietsband", "bike tire", "fietsslot",
      "bike lock", "fietsverlichting", "bike lights", "fietsenmaker",
      "bike repair", "fiets repareren", "bicycle repair",
    ],
  },
  {
    key: "gifts",
    label: "Gift shop",
    requireName: true,
    tags: [[{ key: "shop", value: "gift" }], [{ key: "shop", value: "variety_store" }]],
    keywords: ["cadeau", "gift", "present", "souvenir", "geschenk"],
  },
  {
    key: "jewelry",
    label: "Jeweller",
    requireName: true,
    tags: [[{ key: "shop", value: "jewelry" }], [{ key: "shop", value: "watches" }]],
    keywords: ["sieraden", "jewelry", "jewellery", "ring", "ketting", "necklace", "horloge", "horloges", "watch", "watches"],
  },
  {
    key: "opticians",
    label: "Optician",
    requireName: true,
    tags: [[{ key: "shop", value: "optician" }]],
    keywords: ["opticien", "optician", "bril", "glasses", "contactlenzen", "contact lenses", "zonnebril", "sunglasses"],
  },
  {
    key: "hairdresser",
    label: "Hairdresser",
    requireName: true,
    tags: [[{ key: "shop", value: "hairdresser" }]],
    keywords: ["kapper", "hairdresser", "kapsalon", "haar", "hair", "knippen", "haircut"],
  },
  {
    key: "dry_cleaning",
    label: "Dry cleaner",
    requireName: true,
    tags: [[{ key: "shop", value: "dry_cleaning" }]],
    keywords: ["stomerij", "dry cleaner", "dry cleaning", "chemisch reinigen"],
  },
];

// If nothing above matches — or a specific category has nothing nearby —
// we fall back to these broad tags instead.
const FALLBACK_CATEGORY = {
  key: "fallback",
  label: "Supermarket / department store",
  requireName: true,
  tags: [[{ key: "shop", value: "supermarket" }], [{ key: "shop", value: "department_store" }]],
};


/* ------------------------------------------------------------------
   3. SMALL HELPER FUNCTIONS
   ------------------------------------------------------------------ */

// Makes text easier to compare: lowercase, trimmed, and with accents
// removed (so "café" and "cafe" match, "één" and "een" match, etc).
function normalizeText(str) {
  return str
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strips accent marks (combining marks left after normalize)
}

// Looks through CATEGORIES for a keyword matching what the user typed.
// Returns one of:
//   { type: "none" }                      — nothing matched at all
//   { type: "single", category }          — one clear match
//   { type: "ambiguous", categories: [] }  — the exact word means more
//                                            than one thing (e.g. "planten"
//                                            could be a florist's
//                                            houseplants or a garden
//                                            centre's outdoor plants) —
//                                            the caller should ask the
//                                            user which one they meant.
function findCategory(query) {
  const q = normalizeText(query);
  if (!q) return { type: "none" };

  // Pass 1: exact keyword matches. If the exact word the user typed is
  // listed under more than one category, that's genuine ambiguity —
  // we'd rather ask than silently guess.
  const exactMatches = CATEGORIES.filter((category) =>
    category.keywords.some((keyword) => normalizeText(keyword) === q)
  );

  if (exactMatches.length === 1) return { type: "single", category: exactMatches[0] };
  if (exactMatches.length > 1) return { type: "ambiguous", categories: exactMatches };

  // Pass 2: "contains" matching is already a best-effort fallback (so
  // typing "screwdrivers" still matches "screwdriver", and "birthday"
  // alone can still hit "birthday card") — loose overlaps here aren't
  // treated as ambiguous, we just take the first reasonable hit.
  for (const category of CATEGORIES) {
    for (const keyword of category.keywords) {
      const k = normalizeText(keyword);
      if (q.includes(k) || k.includes(q)) return { type: "single", category };
    }
  }

  return { type: "none" };
}

// The "haversine formula" — standard maths for distance between two
// points on a sphere, given as latitude/longitude. Returns metres.
function distanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's average radius in metres
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Turns "823" into "823 m" and "1830" into "1.8 km".
function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// Builds a readable address out of whatever addr:* tags a shop has.
function formatAddress(tags) {
  const street = tags["addr:street"];
  const houseNumber = tags["addr:housenumber"];
  const city = tags["addr:city"];

  const streetLine = [street, houseNumber].filter(Boolean).join(" ");
  const parts = [streetLine, city].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "Address not listed";
}


/* ------------------------------------------------------------------
   4. OPENING HOURS: "IS IT OPEN RIGHT NOW?" AND A READABLE SCHEDULE
   ------------------------------------------------------------------
   OpenStreetMap's opening_hours format (see wiki.openstreetmap.org/
   wiki/Key:opening_hours) can get very complex (holidays, seasons,
   "PH off", etc). Fully supporting all of that is a project on its
   own, so this only understands the common, everyday patterns, e.g.
   "Mo-Fr 09:00-18:00; Sa 09:00-17:00" or "24/7".

   If a shop's opening_hours text doesn't match a pattern we understand,
   we say so honestly instead of showing OpenStreetMap's raw syntax or
   guessing — see formatOpeningHours() below.
   ------------------------------------------------------------------ */

const DAY_ABBREVIATIONS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

// Friendly English names for each day abbreviation, used when turning
// raw opening_hours text into something readable.
const DAY_LABELS = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun" };

// Turns something like "Mo-We" or "Sa" into a list of day numbers
// (0 = Monday ... 6 = Sunday). Returns null if we don't recognise it.
function parseDayToken(token) {
  if (token.includes("-")) {
    const [startAbbr, endAbbr] = token.split("-");
    const startIdx = DAY_ABBREVIATIONS.indexOf(startAbbr);
    const endIdx = DAY_ABBREVIATIONS.indexOf(endAbbr);
    if (startIdx === -1 || endIdx === -1) return null;

    const days = [];
    let i = startIdx;
    while (true) {
      days.push(i);
      if (i === endIdx) break;
      i = (i + 1) % 7;
    }
    return days;
  }

  const idx = DAY_ABBREVIATIONS.indexOf(token);
  return idx === -1 ? null : [idx];
}

// Turns "Mo-We,Fr" into a combined list of day numbers.
function parseDaysPart(daysPart) {
  const tokens = daysPart.split(",");
  let allDays = [];
  for (const token of tokens) {
    const days = parseDayToken(token);
    if (!days) return null; // unrecognised token -> give up on this rule
    allDays = allDays.concat(days);
  }
  return allDays;
}

// Turns "09:00-18:00,19:00-21:00" into [[540,1080],[1140,1260]] (minutes
// since midnight). Returns null if the text isn't in that shape.
function parseTimeRanges(timesPart) {
  const ranges = [];
  for (const range of timesPart.split(",")) {
    const match = range
      .trim()
      .match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!match) return null;
    const start = Number(match[1]) * 60 + Number(match[2]);
    const end = Number(match[3]) * 60 + Number(match[4]);
    ranges.push([start, end]);
  }
  return ranges;
}

// Regex that recognises a "days" token made only of day abbreviations.
const DAYS_TOKEN_PATTERN = /^(Mo|Tu|We|Th|Fr|Sa|Su)([,-](Mo|Tu|We|Th|Fr|Sa|Su))*$/;

// Splits one opening_hours "rule" (the bit between each ;) into its
// days part and times part, e.g. "Mo-Fr 09:00-18:00" becomes
// { daysPart: "Mo-Fr", timesPart: "09:00-18:00" }. If no days are
// written at all, the rule applies every day — that's what leaving
// days out means in the opening_hours spec — so we fill in "Mo-Su".
// Returns null if we can't even find where the days part ends.
// (Shared by isOpenNow and formatOpeningHours so both agree on how a
// rule is read.)
function splitRule(rule) {
  const firstSpace = rule.indexOf(" ");
  if (firstSpace === -1) return null;

  const possibleDaysToken = rule.slice(0, firstSpace);
  if (DAYS_TOKEN_PATTERN.test(possibleDaysToken)) {
    return { daysPart: possibleDaysToken, timesPart: rule.slice(firstSpace + 1).trim() };
  }
  return { daysPart: "Mo-Su", timesPart: rule };
}

// Returns true / false if we could work it out, or null if the format
// was too complex for this simplified checker.
function isOpenNow(openingHoursText, now = new Date()) {
  if (!openingHoursText) return null;
  const text = openingHoursText.trim();

  if (text === "24/7") return true;

  // JavaScript's getDay() is 0=Sunday..6=Saturday. We convert that to
  // our own 0=Monday..6=Sunday scheme to match the Mo/Tu/We/... system.
  const todayIndex = (now.getDay() + 6) % 7;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  let result = null; // unknown until a rule tells us otherwise

  const rules = text.split(";").map((r) => r.trim()).filter(Boolean);

  for (const rule of rules) {
    const split = splitRule(rule);
    if (!split) continue; // couldn't even separate days from times, skip
    const { daysPart, timesPart } = split;

    const days = parseDaysPart(daysPart);
    if (!days || !days.includes(todayIndex)) continue; // rule doesn't apply today

    if (timesPart === "off" || timesPart === "closed") {
      result = false;
      continue;
    }

    const ranges = parseTimeRanges(timesPart);
    if (!ranges) continue; // couldn't parse the time part, skip

    const isWithinAnyRange = ranges.some(([start, end]) => {
      if (end > start) return nowMinutes >= start && nowMinutes < end;
      // Handles ranges crossing midnight, e.g. 20:00-02:00.
      return nowMinutes >= start || nowMinutes < end;
    });

    result = isWithinAnyRange;
  }

  return result;
}

// Turns a day-range token like "Mo-Fr" or "Mo,We,Fr" into something
// readable, e.g. "Mon-Fri" or "Mon, Wed, Fri". "Mo-Su" (meaning "every
// day", used when the original text had no day at all) becomes "Daily".
function formatDaysPart(daysPart) {
  if (daysPart === "Mo-Su") return "Daily";
  return daysPart
    .split(",")
    .map((token) => {
      if (token.includes("-")) {
        const [start, end] = token.split("-");
        return `${DAY_LABELS[start]}-${DAY_LABELS[end]}`;
      }
      return DAY_LABELS[token];
    })
    .join(", ");
}

// Turns raw opening_hours text into a clean, human-readable schedule
// instead of showing OpenStreetMap's compact syntax directly, e.g.
// "Mo-Fr 09:00-18:00; Sa 09:00-17:00" becomes "Mon-Fri 09:00-18:00 ·
// Sat 09:00-17:00". Returns null if the format is too unusual for us
// to confidently reformat — we'd rather say nothing than show a
// summary that might be wrong.
function formatOpeningHours(openingHoursText) {
  if (!openingHoursText) return null;
  const text = openingHoursText.trim();
  if (text === "24/7") return "Open 24 hours, every day";

  const rules = text.split(";").map((r) => r.trim()).filter(Boolean);
  const parts = [];

  for (const rule of rules) {
    const split = splitRule(rule);
    if (!split) return null;
    const { daysPart, timesPart } = split;

    const days = parseDaysPart(daysPart);
    if (!days) return null;

    if (timesPart === "off" || timesPart === "closed") {
      parts.push(`${formatDaysPart(daysPart)}: closed`);
      continue;
    }

    const ranges = parseTimeRanges(timesPart);
    if (!ranges) return null;

    const timesText = timesPart.split(",").map((r) => r.trim()).join(", ");
    parts.push(`${formatDaysPart(daysPart)} ${timesText}`);
  }

  return parts.join(" · ");
}


/* ------------------------------------------------------------------
   5. GETTING THE USER'S LOCATION
   ------------------------------------------------------------------ */

// Holds the location we'll search around, once we know it.
// Shape: { lat, lon, label }
let userLocation = null;

const locationStatusEl = document.getElementById("locationStatus");
const manualLocationForm = document.getElementById("manualLocationForm");
const manualLocationInput = document.getElementById("manualLocationInput");
const manualLocationError = document.getElementById("manualLocationError");
const changeLocationLink = document.getElementById("changeLocationLink");
const searchSection = document.getElementById("searchSection");

function requestGeolocation() {
  // Show the "type your address" option straight away, at the same time
  // as we try GPS in the background — not only after GPS reports an
  // error. Some phone browsers never call the error callback at all
  // when there's no internet/GPS signal (they just hang), which used to
  // leave people with no way to type a location in. This way, typing an
  // address always works immediately, no matter what GPS does.
  showManualLocationForm();

  if (!("geolocation" in navigator)) {
    locationStatusEl.textContent =
      "Your browser doesn't support automatic location.";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      setUserLocation(
        position.coords.latitude,
        position.coords.longitude,
        "your current location"
      );
    },
    (error) => {
      // error.code: 1 = permission denied, 2 = unavailable, 3 = timeout.
      // We always explain what went wrong here — we never guess a
      // location on the user's behalf if this fails.
      let message = "We couldn't get your location automatically.";
      if (error.code === 1) {
        message = "Location access was denied.";
      } else if (error.code === 2) {
        message = "Your device couldn't figure out your location right now.";
      } else if (error.code === 3) {
        message = "Getting your location took too long.";
      }
      locationStatusEl.textContent = `${message} Please type it in instead.`;
      showManualLocationForm();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

function showManualLocationForm() {
  manualLocationForm.classList.remove("hidden");
}

function hideManualLocationForm() {
  manualLocationForm.classList.add("hidden");
  manualLocationError.classList.add("hidden");
  manualLocationInput.value = "";
}

function setUserLocation(lat, lon, label) {
  userLocation = { lat, lon, label };
  locationStatusEl.textContent = `📍 Using ${label}`;
  hideManualLocationForm();
  changeLocationLink.classList.remove("hidden");
  searchSection.classList.remove("hidden");
}

// Turns a typed town/address into coordinates using Nominatim.
async function geocodeAddress(query) {
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&q=${encodeURIComponent(
    query
  )}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error("Nominatim request failed");

  const results = await response.json();
  if (results.length === 0) return null;

  return {
    lat: Number(results[0].lat),
    lon: Number(results[0].lon),
    label: results[0].display_name,
  };
}

manualLocationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = manualLocationInput.value.trim();
  if (!query) return;

  manualLocationError.classList.add("hidden");
  const submitBtn = document.getElementById("manualLocationSubmit");
  submitBtn.disabled = true;
  submitBtn.textContent = "Looking…";

  try {
    const place = await geocodeAddress(query);
    if (!place) {
      manualLocationError.textContent =
        "We couldn't find that place. Try adding a country, e.g. \"Utrecht, Netherlands\".";
      manualLocationError.classList.remove("hidden");
      return;
    }
    setUserLocation(place.lat, place.lon, place.label);
  } catch (err) {
    // Browsers throw a TypeError specifically when fetch() can't reach
    // the network at all (no connection, DNS failure, etc) — that's a
    // reliable way to tell "no internet" apart from other problems.
    if (err instanceof TypeError) {
      manualLocationError.textContent =
        "Can't look up this address — no internet connection. Please reconnect and try again.";
    } else {
      manualLocationError.textContent =
        "Something went wrong looking that up. Please try again.";
    }
    manualLocationError.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Use this";
  }
});

changeLocationLink.addEventListener("click", () => {
  showManualLocationForm();
});


/* ------------------------------------------------------------------
   6. TALKING TO THE OVERPASS API
   ------------------------------------------------------------------ */

// Builds the little query language ("Overpass QL") that asks:
// "give me every node/way that matches ANY of these tag groups, within
// SEARCH_RADIUS_METERS of this point". tagGroups looks like:
//   [ [{key,value}], [{key,value},{key,value}], ... ]
// — each inner array's conditions must ALL be true together (AND), and
// a place matches the whole category if it satisfies ANY one group (OR).
// When requireName is true, we also demand a "name" tag exists, which
// filters out unnamed/placeholder map entries at the source instead of
// showing them to the user as "Unnamed grocery store".
function buildOverpassQuery(tagGroups, lat, lon, { requireName = false } = {}) {
  const nameFilter = requireName ? `["name"]` : "";

  const clauses = tagGroups
    .map((conditions) => {
      const filter = conditions.map(({ key, value }) => `["${key}"="${value}"]`).join("") + nameFilter;
      return (
        `node${filter}(around:${SEARCH_RADIUS_METERS},${lat},${lon});` +
        `way${filter}(around:${SEARCH_RADIUS_METERS},${lat},${lon});`
      );
    })
    .join("");

  // "out center tags" gives us the tags for every result, plus a
  // center point (lat/lon) for the ways, so every result — nodes and
  // ways alike — ends up with usable coordinates.
  return `[out:json][timeout:20];(${clauses});out center tags;`;
}

// Sends the query to Overpass and returns the raw list of elements.
// Throws an Error("TIMEOUT") if it takes too long.
async function fetchOverpassResults(query) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      signal: controller.signal,
    });

    // Overpass is a shared free service, so it can turn away requests
    // when it's busy (status 429 or 504) instead of just being slow.
    // We flag that as its own case so the user gets an accurate message.
    if (response.status === 429 || response.status === 504) {
      throw new Error("BUSY");
    }
    if (!response.ok) throw new Error("Overpass returned an error.");

    const data = await response.json();
    return data.elements || [];
  } catch (err) {
    if (err.name === "AbortError") throw new Error("TIMEOUT");
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Turns a raw Overpass element into a simple object our rendering
// code can work with, including the distance from the user.
function elementToStore(element, categoryLabel) {
  const tags = element.tags || {};
  // Nodes have lat/lon directly; ways/relations have a "center" instead.
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (lat == null || lon == null) return null;

  const rawOpeningHours = tags.opening_hours || null;

  return {
    name: tags.name || `Unnamed ${categoryLabel.toLowerCase()}`,
    typeLabel: categoryLabel,
    lat,
    lon,
    distance: distanceInMeters(userLocation.lat, userLocation.lon, lat, lon),
    address: formatAddress(tags),
    // openNow is true/false/null (null = "we can't tell"). hoursDisplay
    // is a clean readable schedule, or null if it's too complex to
    // reformat safely — renderStores() decides what to show for each.
    openNow: isOpenNow(rawOpeningHours),
    hoursDisplay: formatOpeningHours(rawOpeningHours),
    hasHoursData: Boolean(rawOpeningHours),
  };
}

// Runs a full search for one category and returns sorted store objects.
async function searchCategory(category) {
  const query = buildOverpassQuery(category.tags, userLocation.lat, userLocation.lon, {
    requireName: category.requireName,
  });
  const elements = await fetchOverpassResults(query);

  // Debug aid: dump every raw OpenStreetMap tag set to the browser
  // console (F12 -> Console tab) so odd/wrong results can be diagnosed
  // by looking at the real data, instead of guessing. Doesn't affect
  // what's shown on the page.
  console.log(`Overpass raw results for "${category.label}" (${elements.length}):`);
  console.table(elements.map((el) => ({ osm_type: el.type, osm_id: el.id, ...el.tags })));

  const stores = elements
    .map((el) => elementToStore(el, category.label))
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);

  return stores;
}


/* ------------------------------------------------------------------
   7. DRAWING RESULTS ON THE PAGE
   ------------------------------------------------------------------ */

const loadingMessageEl = document.getElementById("loadingMessage");
const errorBoxEl = document.getElementById("errorBox");
const errorTextEl = document.getElementById("errorText");
const retryBtn = document.getElementById("retryBtn");
const noteMessageEl = document.getElementById("noteMessage");
const resultsListEl = document.getElementById("resultsList");
const openNowFilterEl = document.getElementById("openNowFilter");
const openNowEmptyMessageEl = document.getElementById("openNowEmptyMessage");

// Holds the full, unfiltered result list from the most recent search,
// so toggling the "open now" filter can re-show a shorter or longer
// list instantly without asking Overpass again.
let lastStores = [];

function showLoading() {
  loadingMessageEl.classList.remove("hidden");
  errorBoxEl.classList.add("hidden");
  noteMessageEl.classList.add("hidden");
  openNowEmptyMessageEl.classList.add("hidden");
  hideDisambiguation();
  resultsListEl.innerHTML = "";
  lastStores = [];
}

function hideLoading() {
  loadingMessageEl.classList.add("hidden");
}

function showError(message, { allowRetry = false } = {}) {
  errorTextEl.textContent = message;
  errorBoxEl.classList.remove("hidden");
  retryBtn.classList.toggle("hidden", !allowRetry);
}

function showNote(message) {
  noteMessageEl.textContent = message;
  noteMessageEl.classList.remove("hidden");
}

// Builds the Google Maps walking-directions link for one store.
function buildDirectionsUrl(store) {
  return `https://www.google.com/maps/dir/?api=1&destination=${store.lat},${store.lon}&travelmode=walking`;
}

// Draws the list of stores. If `stores` is empty, runSearch() has
// already shown a note or error explaining why — there's nothing
// extra to say here.
function renderStores(stores) {
  resultsListEl.innerHTML = "";

  for (const store of stores) {
    const li = document.createElement("li");
    li.className = "store-card";

    const nameRow = document.createElement("div");
    nameRow.className = "store-name-row";

    const name = document.createElement("p");
    name.className = "store-name";
    name.textContent = store.name;

    const distance = document.createElement("span");
    distance.className = "store-distance";
    distance.textContent = formatDistance(store.distance);

    nameRow.append(name, distance);

    const type = document.createElement("p");
    type.className = "store-type";
    type.textContent = store.typeLabel;

    const address = document.createElement("p");
    address.className = "store-address";
    address.textContent = store.address;

    li.append(nameRow, type, address);

    // Always show an hours line — never leave it blank or guess. There
    // are three honest possibilities: a clean readable schedule, a
    // known open/closed status without a summarised schedule (rare —
    // only when the format is too unusual to safely reformat), or no
    // data at all ("Hours unknown").
    const hours = document.createElement("p");
    hours.className = "store-hours";

    if (store.openNow === true) {
      const badge = document.createElement("span");
      badge.className = "badge badge-open";
      badge.textContent = "Open now";
      hours.append(badge);
    } else if (store.openNow === false) {
      const badge = document.createElement("span");
      badge.className = "badge badge-closed";
      badge.textContent = "Closed now";
      hours.append(badge);
    }

    let hoursText;
    if (!store.hasHoursData) {
      hoursText = "Hours unknown";
    } else if (store.hoursDisplay) {
      hoursText = store.hoursDisplay;
    } else {
      hoursText = "Hours available, but too complex to summarize here";
    }
    hours.append(document.createTextNode(hoursText));
    li.append(hours);

    const directionsBtn = document.createElement("a");
    directionsBtn.className = "directions-btn";
    directionsBtn.href = buildDirectionsUrl(store);
    directionsBtn.target = "_blank";
    directionsBtn.rel = "noopener";
    directionsBtn.textContent = "Walking directions";
    // Style it like the other buttons even though it's a link.
    directionsBtn.style.display = "inline-block";
    directionsBtn.style.padding = "12px 18px";
    directionsBtn.style.minHeight = "48px";
    directionsBtn.style.borderRadius = "10px";
    directionsBtn.style.background = "#1f7a4d";
    directionsBtn.style.color = "white";
    directionsBtn.style.fontWeight = "600";
    directionsBtn.style.textDecoration = "none";
    directionsBtn.style.boxSizing = "border-box";

    li.append(directionsBtn);
    resultsListEl.append(li);
  }
}

// Re-renders whatever the last search found, applying the "show only
// open now" checkbox if it's ticked. Called both right after a search
// finishes and whenever the checkbox is toggled — no new Overpass
// request needed either way, since we already have the full list.
function applyOpenNowFilterAndRender() {
  const filtered = openNowFilterEl.checked
    ? lastStores.filter((store) => store.openNow === true)
    : lastStores;

  const nothingLeftAfterFilter =
    openNowFilterEl.checked && lastStores.length > 0 && filtered.length === 0;
  openNowEmptyMessageEl.classList.toggle("hidden", !nothingLeftAfterFilter);

  renderStores(filtered);
}

openNowFilterEl.addEventListener("change", applyOpenNowFilterAndRender);

// -------- "Did you mean...?" prompt for ambiguous search words --------

const disambiguationBox = document.getElementById("disambiguationBox");
const disambiguationText = document.getElementById("disambiguationText");
const disambiguationButtons = document.getElementById("disambiguationButtons");

function showDisambiguation(query, categories) {
  disambiguationText.textContent = `"${query}" could mean a few different things — which one did you mean?`;
  disambiguationButtons.innerHTML = "";
  for (const category of categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = category.label;
    button.addEventListener("click", () => runSearch(query, category));
    disambiguationButtons.append(button);
  }
  disambiguationBox.classList.remove("hidden");
}

function hideDisambiguation() {
  disambiguationBox.classList.add("hidden");
  disambiguationButtons.innerHTML = "";
}


/* ------------------------------------------------------------------
   8. WIRING IT ALL TOGETHER
   ------------------------------------------------------------------ */

const itemInput = document.getElementById("itemInput");
const searchBtn = document.getElementById("searchBtn");

// Remembers the last search, so the "Try again" button can repeat it
// exactly — including which category was picked, if the word was
// ambiguous and the user already chose one — without starting over.
let lastQuery = "";
let lastForcedCategory = null;

// `forcedCategory` is set when the user has already answered a "did
// you mean...?" prompt — it skips dictionary lookup and searches that
// exact category directly.
async function runSearch(query, forcedCategory = null) {
  lastQuery = query;
  lastForcedCategory = forcedCategory;
  showLoading();

  let category = forcedCategory;
  if (!category) {
    const match = findCategory(query);
    if (match.type === "ambiguous") {
      hideLoading();
      showDisambiguation(query, match.categories);
      return;
    }
    category = match.type === "single" ? match.category : null;
  }

  const matchedDictionary = Boolean(category);
  const activeCategory = category || FALLBACK_CATEGORY;

  try {
    let stores = await searchCategory(activeCategory);

    // usedFallback tracks whether the RESULTS being shown are the
    // generic "supermarkets and department stores" search, whether
    // that's because the word wasn't recognised at all, or because a
    // recognised category had nothing nearby.
    let usedFallback = !matchedDictionary;

    // If we DID match a specific category but found nothing close by,
    // it's more helpful to broaden to supermarkets/department stores
    // than to just say "no results".
    if (stores.length === 0 && matchedDictionary) {
      stores = await searchCategory(FALLBACK_CATEGORY);
      usedFallback = true;
    }

    hideLoading();

    // Explain to the user, in one single message, why they're seeing
    // fallback stores (never fall back silently).
    if (usedFallback) {
      const reason = matchedDictionary
        ? `No "${activeCategory.label.toLowerCase()}" found within 1.5 km, so here are nearby supermarkets and department stores instead.`
        : `We don't recognize "${query}" yet, but here are general stores nearby that might have it.`;

      if (stores.length === 0) {
        // Even the broad fallback search came up empty — say so plainly
        // instead of showing an empty list under a note that implies
        // results are coming.
        showError(`${reason} Unfortunately, none were found within 1.5 km either.`);
      } else {
        showNote(reason);
      }
    }

    lastStores = stores;
    applyOpenNowFilterAndRender();
  } catch (err) {
    hideLoading();
    // Hide any "showing fallback stores instead" note — it would be
    // confusing to show alongside an error saying the search failed.
    noteMessageEl.classList.add("hidden");

    if (err.message === "TIMEOUT") {
      showError(
        "The store search is taking too long — the free map service might be busy right now.",
        { allowRetry: true }
      );
    } else if (err.message === "BUSY") {
      showError(
        "The free map service is busy right now. Please wait a few seconds and try again.",
        { allowRetry: true }
      );
    } else {
      showError(
        "Couldn't reach the store search service. Check your internet connection and try again.",
        { allowRetry: true }
      );
    }
  }
}

function handleSearchSubmit() {
  const query = itemInput.value.trim();
  if (!query) {
    showError("Please type something you want to buy first.");
    return;
  }
  runSearch(query);
}

searchBtn.addEventListener("click", handleSearchSubmit);

// Also let people press Enter in the search box instead of tapping the button.
itemInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleSearchSubmit();
});

retryBtn.addEventListener("click", () => {
  if (lastQuery) runSearch(lastQuery, lastForcedCategory);
});

// Kick everything off: as soon as the page's JavaScript runs, try to
// find out where the user is.
requestGeolocation();
