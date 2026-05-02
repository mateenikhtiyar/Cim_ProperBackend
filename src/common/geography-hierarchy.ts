// backend/src/common/geography-hierarchy.ts
export const geographyHierarchy = {
    "Africa": [
      "Algeria", "Angola", "Benin", "Botswana", "Burkina Faso", "Burundi", "Cabo Verde", "Cameroon", "Central African Republic",
      "Chad", "Comoros", "Congo (Congo-Brazzaville)", "Democratic Republic of the Congo", "Djibouti", "Egypt", "Equatorial Guinea",
      "Eritrea", "Eswatini (fmr. 'Swaziland')", "Ethiopia", "Gabon", "Gambia", "Ghana", "Guinea", "Guinea-Bissau", "Ivory Coast",
      "Kenya", "Lesotho", "Liberia", "Libya", "Madagascar", "Malawi", "Mali", "Mauritania", "Mauritius", "Morocco", "Mozambique",
      "Namibia", "Niger", "Nigeria", "Rwanda", "Sao Tome and Principe", "Senegal", "Seychelles", "Sierra Leone", "Somalia",
      "South Africa", "South Sudan", "Sudan", "Tanzania", "Togo", "Tunisia", "Uganda", "Zambia", "Zimbabwe"
    ],
    "Asia": [
      "Afghanistan", "Armenia", "Azerbaijan", "Bahrain", "Bangladesh", "Bhutan", "Brunei", "Cambodia", "China", "Cyprus",
      "Georgia", "India", "Indonesia", "Iran", "Iraq", "Israel", "Japan", "Jordan", "Kazakhstan", "Kuwait", "Kyrgyzstan",
      "Laos", "Lebanon", "Malaysia", "Maldives", "Mongolia", "Myanmar (Burma)", "Nepal", "North Korea", "Oman", "Pakistan",
      "Palestine", "Philippines", "Qatar", "Russia", "Saudi Arabia", "Singapore", "South Korea", "Sri Lanka", "Syria",
      "Taiwan", "Tajikistan", "Thailand", "Timor-Leste", "Turkey", "Turkmenistan", "United Arab Emirates", "Uzbekistan",
      "Vietnam", "Yemen"
    ],
    "Europe": [
      "Albania", "Andorra", "Austria", "Belarus", "Belgium", "Bosnia and Herzegovina", "Bulgaria", "Croatia", "Czechia",
      "Denmark", "Estonia", "Finland", "France", "Germany", "Greece", "Hungary", "Iceland", "Ireland", "Italy", "Kosovo",
      "Latvia", "Liechtenstein", "Lithuania", "Luxembourg", "Malta", "Moldova", "Monaco", "Montenegro", "Netherlands",
      "North Macedonia", "Norway", "Poland", "Portugal", "Romania", "Russia", "San Marino", "Serbia", "Slovakia", "Slovenia",
      "Spain", "Sweden", "Switzerland", "Ukraine", "United Kingdom", "Vatican City"
    ],
    "North America": [
      "Antigua and Barbuda", "Bahamas", "Barbados", "Belize", "Canada", "Costa Rica", "Cuba", "Dominica", "Dominican Republic",
      "El Salvador", "Grenada", "Guatemala", "Haiti", "Honduras", "Jamaica", "Mexico", "Nicaragua", "Panama", "Saint Kitts and Nevis",
      "Saint Lucia", "Saint Vincent and the Grenadines", "Trinidad and Tobago", "United States"
    ],
    "Oceania": [
      "Australia", "Fiji", "Kiribati", "Marshall Islands", "Micronesia", "Nauru", "New Zealand", "Palau", "Papua New Guinea",
      "Samoa", "Solomon Islands", "Tonga", "Tuvalu", "Vanuatu"
    ],
    "South America": [
      "Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Ecuador", "Guyana", "Paraguay", "Peru", "Suriname", "Uruguay", "Venezuela"
    ],
    // Individual country mapping for direct lookup (204 countries)
    "Afghanistan": ["Afghanistan"],
    "Albania": ["Albania"],
    "Algeria": ["Algeria"],
    "Andorra": ["Andorra"],
    "Angola": ["Angola"],
    "Antigua and Barbuda": ["Antigua and Barbuda"],
    "Argentina": ["Argentina"],
    "Armenia": ["Armenia"],
    "Australia": ["Australia"],
    "Austria": ["Austria"],
    "Azerbaijan": ["Azerbaijan"],
    "Bahamas": ["Bahamas"],
    "Bahrain": ["Bahrain"],
    "Bangladesh": ["Bangladesh"],
    "Barbados": ["Barbados"],
    "Belarus": ["Belarus"],
    "Belgium": ["Belgium"],
    "Belize": ["Belize"],
    "Benin": ["Benin"],
    "Bhutan": ["Bhutan"],
    "Bolivia": ["Bolivia"],
    "Bosnia and Herzegovina": ["Bosnia and Herzegovina"],
    "Botswana": ["Botswana"],
    "Brazil": ["Brazil"],
    "Brunei": ["Brunei"],
    "Bulgaria": ["Bulgaria"],
    "Burkina Faso": ["Burkina Faso"],
    "Burundi": ["Burundi"],
    "Cabo Verde": ["Cabo Verde"],
    "Cambodia": ["Cambodia"],
    "Cameroon": ["Cameroon"],
    "Canada": ["Canada"],
    "Central African Republic": ["Central African Republic"],
    "Chad": ["Chad"],
    "Chile": ["Chile"],
    "China": ["China"],
    "Colombia": ["Colombia"],
    "Comoros": ["Comoros"],
    "Congo (Congo-Brazzaville)": ["Congo (Congo-Brazzaville)"],
    "Democratic Republic of the Congo": ["Democratic Republic of the Congo"],
    "Costa Rica": ["Costa Rica"],
    "Croatia": ["Croatia"],
    "Cuba": ["Cuba"],
    "Cyprus": ["Cyprus"],
    "Czechia": ["Czechia"],
    "Denmark": ["Denmark"],
    "Djibouti": ["Djibouti"],
    "Dominica": ["Dominica"],
    "Dominican Republic": ["Dominican Republic"],
    "Ecuador": ["Ecuador"],
    "Egypt": ["Egypt"],
    "El Salvador": ["El Salvador"],
    "Equatorial Guinea": ["Equatorial Guinea"],
    "Eritrea": ["Eritrea"],
    "Estonia": ["Estonia"],
    "Eswatini (fmr. 'Swaziland')": ["Eswatini (fmr. 'Swaziland')"],
    "Ethiopia": ["Ethiopia"],
    "Fiji": ["Fiji"],
    "Finland": ["Finland"],
    "France": ["France"],
    "Gabon": ["Gabon"],
    "Gambia": ["Gambia"],
    "Georgia": ["Georgia"],
    "Germany": ["Germany"],
    "Ghana": ["Ghana"],
    "Greece": ["Greece"],
    "Grenada": ["Grenada"],
    "Guatemala": ["Guatemala"],
    "Guinea": ["Guinea"],
    "Guinea-Bissau": ["Guinea-Bissau"],
    "Guyana": ["Guyana"],
    "Haiti": ["Haiti"],
    "Honduras": ["Honduras"],
    "Hungary": ["Hungary"],
    "Iceland": ["Iceland"],
    "India": ["India"],
    "Indonesia": ["Indonesia"],
    "Iran": ["Iran"],
    "Iraq": ["Iraq"],
    "Ireland": ["Ireland"],
    "Israel": ["Israel"],
    "Italy": ["Italy"],
    "Ivory Coast": ["Ivory Coast"],
    "Jamaica": ["Jamaica"],
    "Japan": ["Japan"],
    "Jordan": ["Jordan"],
    "Kazakhstan": ["Kazakhstan"],
    "Kenya": ["Kenya"],
    "Kiribati": ["Kiribati"],
    "Kosovo": ["Kosovo"],
    "Kuwait": ["Kuwait"],
    "Kyrgyzstan": ["Kyrgyzstan"],
    "Laos": ["Laos"],
    "Latvia": ["Latvia"],
    "Lebanon": ["Lebanon"],
    "Lesotho": ["Lesotho"],
    "Liberia": ["Liberia"],
    "Libya": ["Libya"],
    "Liechtenstein": ["Liechtenstein"],
    "Lithuania": ["Lithuania"],
    "Luxembourg": ["Luxembourg"],
    "Madagascar": ["Madagascar"],
    "Malawi": ["Malawi"],
    "Malaysia": ["Malaysia"],
    "Maldives": ["Maldives"],
    "Mali": ["Mali"],
    "Malta": ["Malta"],
    "Marshall Islands": ["Marshall Islands"],
    "Mauritania": ["Mauritania"],
    "Mauritius": ["Mauritius"],
    "Mexico": ["Mexico"],
    "Micronesia": ["Micronesia"],
    "Moldova": ["Moldova"],
    "Monaco": ["Monaco"],
    "Mongolia": ["Mongolia"],
    "Montenegro": ["Montenegro"],
    "Morocco": ["Morocco"],
    "Mozambique": ["Mozambique"],
    "Myanmar (Burma)": ["Myanmar (Burma)"],
    "Namibia": ["Namibia"],
    "Nauru": ["Nauru"],
    "Nepal": ["Nepal"],
    "Netherlands": ["Netherlands"],
    "New Zealand": ["New Zealand"],
    "Nicaragua": ["Nicaragua"],
    "Niger": ["Niger"],
    "Nigeria": ["Nigeria"],
    "North Korea": ["North Korea"],
    "North Macedonia": ["North Macedonia"],
    "Norway": ["Norway"],
    "Oman": ["Oman"],
    "Pakistan": ["Pakistan"],
    "Palau": ["Palau"],
    "Palestine": ["Palestine"],
    "Panama": ["Panama"],
    "Papua New Guinea": ["Papua New Guinea"],
    "Paraguay": ["Paraguay"],
    "Peru": ["Peru"],
    "Philippines": ["Philippines"],
    "Poland": ["Poland"],
    "Portugal": ["Portugal"],
    "Qatar": ["Qatar"],
    "Romania": ["Romania"],
    "Russia": ["Russia"],
    "Rwanda": ["Rwanda"],
    "Saint Kitts and Nevis": ["Saint Kitts and Nevis"],
    "Saint Lucia": ["Saint Lucia"],
    "Saint Vincent and the Grenadines": ["Saint Vincent and the Grenadines"],
    "Samoa": ["Samoa"],
    "San Marino": ["San Marino"],
    "Sao Tome and Principe": ["Sao Tome and Principe"],
    "Saudi Arabia": ["Saudi Arabia"],
    "Senegal": ["Senegal"],
    "Serbia": ["Serbia"],
    "Seychelles": ["Seychelles"],
    "Sierra Leone": ["Sierra Leone"],
    "Singapore": ["Singapore"],
    "Slovakia": ["Slovakia"],
    "Slovenia": ["Slovenia"],
    "Solomon Islands": ["Solomon Islands"],
    "Somalia": ["Somalia"],
    "South Africa": ["South Africa"],
    "South Korea": ["South Korea"],
    "South Sudan": ["South Sudan"],
    "Spain": ["Spain"],
    "Sri Lanka": ["Sri Lanka"],
    "Sudan": ["Sudan"],
    "Suriname": ["Suriname"],
    "Sweden": ["Sweden"],
    "Switzerland": ["Switzerland"],
    "Syria": ["Syria"],
    "Taiwan": ["Taiwan"],
    "Tajikistan": ["Tajikistan"],
    "Tanzania": ["Tanzania"],
    "Thailand": ["Thailand"],
    "Timor-Leste": ["Timor-Leste"],
    "Togo": ["Togo"],
    "Tonga": ["Tonga"],
    "Trinidad and Tobago": ["Trinidad and Tobago"],
    "Tunisia": ["Tunisia"],
    "Turkey": ["Turkey"],
    "Turkmenistan": ["Turkmenistan"],
    "Tuvalu": ["Tuvalu"],
    "Uganda": ["Uganda"],
    "Ukraine": ["Ukraine"],
    "United Arab Emirates": ["United Arab Emirates"],
    "United Kingdom": ["United Kingdom"],
    "United States": ["United States"],
    "Uruguay": ["Uruguay"],
    "Uzbekistan": ["Uzbekistan"],
    "Vanuatu": ["Vanuatu"],
    "Vatican City": ["Vatican City"],
    "Venezuela": ["Venezuela"],
    "Vietnam": ["Vietnam"],
    "Yemen": ["Yemen"],
    "Zambia": ["Zambia"],
    "Zimbabwe": ["Zimbabwe"]
  };

export const US_KEY_REGIONS: Record<string, string[]> = {
  Northeast: ["Connecticut", "Maine", "Massachusetts", "New Hampshire", "Rhode Island", "Vermont", "New Jersey", "New York", "Pennsylvania"],
  Midwest: ["Illinois", "Indiana", "Michigan", "Ohio", "Wisconsin", "Iowa", "Kansas", "Minnesota", "Missouri", "Nebraska", "North Dakota", "South Dakota"],
  South: ["Delaware", "Florida", "Georgia", "Maryland", "North Carolina", "South Carolina", "Virginia", "West Virginia", "District of Columbia", "Alabama", "Kentucky", "Mississippi", "Tennessee", "Arkansas", "Louisiana", "Oklahoma", "Texas"],
  West: ["Arizona", "Colorado", "Idaho", "Montana", "Nevada", "New Mexico", "Utah", "Wyoming", "Alaska", "California", "Hawaii", "Oregon", "Washington"],
};

const US_REGION_PREFIX = "United States > ";
const ALL_US_REGION_LABELS = Object.keys(US_KEY_REGIONS).map((region) => `${US_REGION_PREFIX}${region}`);
const ALL_US_STATE_LABELS = Object.values(US_KEY_REGIONS).flat().map((state) => `${US_REGION_PREFIX}${state}`);
const US_STATE_TO_REGION = Object.entries(US_KEY_REGIONS).reduce((acc, [region, states]) => {
  states.forEach((state) => {
    acc[state] = region;
  });
  return acc;
}, {} as Record<string, string>);

export function expandCountryOrRegion(selected: string): string[] {
  const expanded = new Set<string>();
  expanded.add(selected);

  // If it's a top-level region (continent), return all subregions
  const hierarchy = geographyHierarchy as Record<string, string[]>;
  if (hierarchy[selected]) {
    hierarchy[selected].forEach((value: string) => expanded.add(value));
  }

  if (selected === "United States") {
    ALL_US_REGION_LABELS.forEach((value) => expanded.add(value));
    ALL_US_STATE_LABELS.forEach((value) => expanded.add(value));
  }

  if (selected.startsWith(US_REGION_PREFIX)) {
    const usSelection = selected.slice(US_REGION_PREFIX.length).trim();
    expanded.add("United States");

    if (US_KEY_REGIONS[usSelection]) {
      US_KEY_REGIONS[usSelection].forEach((state) => expanded.add(`${US_REGION_PREFIX}${state}`));
    } else if (US_STATE_TO_REGION[usSelection]) {
      expanded.add(`${US_REGION_PREFIX}${US_STATE_TO_REGION[usSelection]}`);
    }
  }

  // Handle non-US "Country > State" format (e.g. "Mexico > Chiapas", "Canada > Ontario")
  // Include the parent country so it matches buyers who selected the whole country
  if (selected.includes(" > ") && !selected.startsWith(US_REGION_PREFIX)) {
    const country = selected.split(" > ")[0].trim();
    expanded.add(country);
  }

  return Array.from(expanded);
}

/**
 * Reverse lookup: given a search term (e.g. "Connecticut" or "Northeast"),
 * return all possible geographySelection values that would encompass it.
 * Used for marketplace search so searching a state also finds region-level deals.
 */
export function findMatchingGeographies(searchTerm: string): string[] {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return [];

  const matches = new Set<string>();

  // Check if the term matches a US state name
  for (const [region, states] of Object.entries(US_KEY_REGIONS)) {
    for (const state of states) {
      if (state.toLowerCase().includes(term)) {
        matches.add(`${US_REGION_PREFIX}${state}`);
        matches.add(`${US_REGION_PREFIX}${region}`);
        matches.add("United States");
      }
    }
    // Check if the term matches a US region name
    if (region.toLowerCase().includes(term)) {
      matches.add(`${US_REGION_PREFIX}${region}`);
      matches.add("United States");
    }
  }

  // Check if the term matches a country name
  for (const key of Object.keys(geographyHierarchy)) {
    if (key.toLowerCase().includes(term)) {
      matches.add(key);
    }
  }

  // Check if the term matches any country within a continent
  for (const [continent, countries] of Object.entries(geographyHierarchy)) {
    for (const country of countries) {
      if (country.toLowerCase().includes(term)) {
        matches.add(country);
        matches.add(continent);
      }
    }
  }

  return Array.from(matches);
}
