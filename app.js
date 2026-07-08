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
     - tags:     the OpenStreetMap tags that identify this kind of
                 shop on the map (see wiki.openstreetmap.org/wiki/Key:shop)
     - keywords: Dutch AND English words that should match this category

   Feel free to add more keywords later — that's the easiest way to
   teach the app new words without touching any other code.
   ------------------------------------------------------------------ */

const CATEGORIES = [
  {
    key: "groceries",
    label: "Grocery store",
    // "shop=grocery" was removed on purpose: it's a vague, inconsistently
    // used OpenStreetMap tag (unlike "supermarket"/"convenience"/
    // "greengrocer", which have clear, specific meanings), and it was
    // the main source of odd, clearly-wrong results for searches like
    // "melk". We also never query broad catch-all tags like "shop=yes"
    // (mappers use that when they're not sure what kind of shop it is) —
    // vague tags in, vague results out.
    requireName: true, // skip entries with no name — usually unfinished/placeholder map data
    tags: [
      { key: "shop", value: "supermarket" },
      { key: "shop", value: "convenience" },
      { key: "shop", value: "greengrocer" },
      { key: "shop", value: "bakery" },
      { key: "shop", value: "butcher" },
    ],
    keywords: [
      "melk", "milk", "brood", "bread", "kaas", "cheese", "eieren", "eggs",
      "boodschappen", "groceries", "grocery", "supermarkt", "supermarket",
      "eten", "food", "groente", "vegetables", "fruit", "bakker", "bakery",
      "slager", "butcher", "yoghurt", "yogurt", "drinken", "drinks",
    ],
  },
  {
    key: "tools",
    label: "Hardware / DIY store",
    tags: [
      { key: "shop", value: "hardware" },
      { key: "shop", value: "doityourself" },
      { key: "shop", value: "trade" },
      { key: "shop", value: "paint" },
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
    tags: [
      { key: "shop", value: "clothes" },
      { key: "shop", value: "boutique" },
    ],
    keywords: [
      "kleding", "kleren", "clothes", "clothing", "shirt", "t-shirt",
      "broek", "pants", "trousers", "jurk", "dress", "jas", "jacket",
      "coat", "trui", "sweater",
    ],
  },
  {
    key: "shoes",
    label: "Shoe store",
    tags: [{ key: "shop", value: "shoes" }],
    keywords: [
      "schoenen", "shoes", "laarzen", "boots", "sneakers", "sandalen",
      "sandals",
    ],
  },
  {
    key: "electronics",
    label: "Electronics store",
    tags: [
      { key: "shop", value: "electronics" },
      { key: "shop", value: "computer" },
    ],
    keywords: [
      "electronica", "elektronica", "electronics", "tv", "televisie",
      "television", "laptop", "computer", "koptelefoon", "headphones",
      "oplader", "charger", "kabel", "cable",
    ],
  },
  {
    key: "phones",
    label: "Phone store",
    tags: [{ key: "shop", value: "mobile_phone" }],
    keywords: [
      "telefoon", "phone", "mobiel", "mobile", "smartphone", "gsm",
      "telefoonhoesje", "phone case",
    ],
  },
  {
    key: "books",
    label: "Book store",
    tags: [{ key: "shop", value: "books" }],
    keywords: [
      "boek", "boeken", "book", "books", "roman", "novel", "tijdschrift",
      "magazine",
    ],
  },
  {
    key: "stationery",
    label: "Stationery store",
    tags: [{ key: "shop", value: "stationery" }],
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
    tags: [{ key: "shop", value: "toys" }],
    keywords: [
      "speelgoed", "toys", "toy", "pop", "doll", "lego", "spel", "game",
      "bordspel", "board game",
    ],
  },
  {
    key: "flowers",
    label: "Florist",
    tags: [{ key: "shop", value: "florist" }],
    keywords: [
      "bloemen", "flowers", "bloem", "flower", "boeket", "bouquet",
      "plant", "planten", "plants",
    ],
  },
  {
    key: "pharmacy",
    label: "Pharmacy / drugstore",
    tags: [
      { key: "amenity", value: "pharmacy" },
      { key: "shop", value: "chemist" },
      { key: "shop", value: "cosmetics" },
    ],
    keywords: [
      "apotheek", "pharmacy", "drogist", "drogisterij", "drugstore",
      "medicijnen", "medicine", "pijnstiller", "painkiller", "paracetamol",
      "shampoo", "zeep", "soap", "tandpasta", "toothpaste", "luiers",
      "diapers",
    ],
  },
  {
    key: "pets",
    label: "Pet store",
    tags: [{ key: "shop", value: "pet" }],
    keywords: [
      "dierenwinkel", "pet store", "hondenvoer", "dog food", "kattenvoer",
      "cat food", "dieren", "pets", "hond", "dog", "kat", "cat",
    ],
  },
  {
    key: "sports",
    label: "Sports store",
    tags: [{ key: "shop", value: "sports" }],
    keywords: [
      "sport", "sports", "sportschoenen", "sports shoes", "bal", "ball",
      "fitness", "yoga", "tennisracket", "voetbal", "football",
    ],
  },
  {
    key: "home",
    label: "Home goods / kitchen store",
    tags: [
      { key: "shop", value: "houseware" },
      { key: "shop", value: "department_store" },
      { key: "shop", value: "interior_decoration" },
      { key: "shop", value: "kitchen" },
    ],
    keywords: [
      "huishoudartikelen", "home goods", "keukenspullen", "kitchenware",
      "pan", "pot", "bestek", "cutlery", "servies", "dishes",
      "woonaccessoires", "home decor", "meubels", "furniture",
    ],
  },
  {
    key: "bikes",
    label: "Bike shop",
    tags: [{ key: "shop", value: "bicycle" }],
    keywords: [
      "fiets", "bike", "bicycle", "fietsband", "bike tire", "fietsslot",
      "bike lock", "fietsverlichting", "bike lights",
    ],
  },
  {
    key: "gifts",
    label: "Gift shop",
    tags: [
      { key: "shop", value: "gift" },
      { key: "shop", value: "variety_store" },
    ],
    keywords: ["cadeau", "gift", "present", "souvenir", "geschenk"],
  },
];

// If nothing above matches, we fall back to these tags (requirement 8).
const FALLBACK_CATEGORY = {
  key: "fallback",
  label: "Supermarket / department store",
  tags: [
    { key: "shop", value: "supermarket" },
    { key: "shop", value: "department_store" },
  ],
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
// Returns the matching category object, or null if nothing matched.
function findCategory(query) {
  const q = normalizeText(query);
  if (!q) return null;

  // Pass 1: look for an exact match first (most reliable).
  for (const category of CATEGORIES) {
    for (const keyword of category.keywords) {
      if (normalizeText(keyword) === q) return category;
    }
  }

  // Pass 2: fall back to "contains" matching, so typing "screwdrivers"
  // still matches "screwdriver", and "birthday" alone can still hit
  // "birthday card".
  for (const category of CATEGORIES) {
    for (const keyword of category.keywords) {
      const k = normalizeText(keyword);
      if (q.includes(k) || k.includes(q)) return category;
    }
  }

  return null;
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
   4. A SIMPLIFIED "IS IT OPEN RIGHT NOW?" CHECKER
   ------------------------------------------------------------------
   OpenStreetMap's opening_hours format (see wiki.openstreetmap.org/
   wiki/Key:opening_hours) can get very complex (holidays, seasons,
   "PH off", etc). Fully supporting all of that is a project on its
   own, so this checker only understands the common, everyday patterns,
   e.g. "Mo-Fr 09:00-18:00; Sa 09:00-17:00" or "24/7".

   If a shop's opening_hours text doesn't match a pattern we understand,
   we simply don't show an open/closed badge for it — we still show the
   raw text so the user can read it themselves.
   ------------------------------------------------------------------ */

const DAY_ABBREVIATIONS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

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
    const firstSpace = rule.indexOf(" ");
    let daysPart;
    let timesPart;

    if (firstSpace === -1) {
      // No space at all — can't separate days from times, skip this rule.
      continue;
    }

    const possibleDaysToken = rule.slice(0, firstSpace);
    if (DAYS_TOKEN_PATTERN.test(possibleDaysToken)) {
      daysPart = possibleDaysToken;
      timesPart = rule.slice(firstSpace + 1).trim();
    } else {
      // No day given means "every day" in the opening_hours spec.
      daysPart = "Mo-Su";
      timesPart = rule;
    }

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
// "give me every node/way tagged shop=X (or Y, or Z...) within
// SEARCH_RADIUS_METERS of this point".
// When requireName is true, we also demand a "name" tag exists, which
// filters out unnamed/placeholder map entries at the source instead of
// showing them to the user as "Unnamed grocery store".
function buildOverpassQuery(tagList, lat, lon, { requireName = false } = {}) {
  const nameFilter = requireName ? `["name"]` : "";

  const clauses = tagList
    .map(({ key, value }) => {
      const filter = `["${key}"="${value}"]${nameFilter}`;
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

  return {
    name: tags.name || `Unnamed ${categoryLabel.toLowerCase()}`,
    typeLabel: categoryLabel,
    lat,
    lon,
    distance: distanceInMeters(userLocation.lat, userLocation.lon, lat, lon),
    address: formatAddress(tags),
    openingHours: tags.opening_hours || null,
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

function showLoading() {
  loadingMessageEl.classList.remove("hidden");
  errorBoxEl.classList.add("hidden");
  noteMessageEl.classList.add("hidden");
  resultsListEl.innerHTML = "";
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

    // Only show an hours line if OpenStreetMap actually has that data.
    if (store.openingHours) {
      const hours = document.createElement("p");
      hours.className = "store-hours";

      const openNow = isOpenNow(store.openingHours);
      if (openNow === true) {
        const badge = document.createElement("span");
        badge.className = "badge badge-open";
        badge.textContent = "Open now";
        hours.append(badge);
      } else if (openNow === false) {
        const badge = document.createElement("span");
        badge.className = "badge badge-closed";
        badge.textContent = "Closed now";
        hours.append(badge);
      }
      hours.append(document.createTextNode(store.openingHours));
      li.append(hours);
    }

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


/* ------------------------------------------------------------------
   8. WIRING IT ALL TOGETHER
   ------------------------------------------------------------------ */

const itemInput = document.getElementById("itemInput");
const searchBtn = document.getElementById("searchBtn");

// Remembers the last thing searched, so the "Try again" button can
// repeat the exact same search without the user retyping anything.
let lastQuery = "";

async function runSearch(query) {
  lastQuery = query;
  showLoading();

  const category = findCategory(query);
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

    renderStores(stores);
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
  if (lastQuery) runSearch(lastQuery);
});

// Kick everything off: as soon as the page's JavaScript runs, try to
// find out where the user is.
requestGeolocation();
