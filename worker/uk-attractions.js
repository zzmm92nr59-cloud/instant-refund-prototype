// Wrapped's "Did you visit?": for a town or city a shopper's journeys went to, two or three of its best-known sights, asked
// as a question, never as a claim that they went. Only places that have stood for years and that everyone would recognise:
// no opening times, prices, events or anything else that goes out of date. London isn't listed: most London journeys are
// people going home or to work, and a list of London sights would say nothing about them.
const A = {
  york: ["York Minster", "The Shambles", "the National Railway Museum"],
  edinburgh: ["Edinburgh Castle", "Arthur's Seat", "the Royal Mile"],
  glasgow: ["Kelvingrove Art Gallery and Museum", "Glasgow Cathedral", "the Riverside Museum"],
  manchester: ["the Science and Industry Museum", "Manchester Cathedral", "the John Rylands Library"],
  liverpool: ["the Royal Albert Dock", "Liverpool Cathedral", "The Beatles Story"],
  birmingham: ["the Bullring", "Birmingham Museum and Art Gallery", "Cadbury World"],
  leeds: ["the Royal Armouries Museum", "Kirkstall Abbey", "Roundhay Park"],
  bristol: ["the Clifton Suspension Bridge", "SS Great Britain", "Bristol Cathedral"],
  bath: ["the Roman Baths", "Bath Abbey", "the Royal Crescent"],
  oxford: ["the Bodleian Library", "the Ashmolean Museum", "the Radcliffe Camera"],
  cambridge: ["King's College Chapel", "the Fitzwilliam Museum", "the Backs"],
  brighton: ["Brighton Palace Pier", "the Royal Pavilion", "The Lanes"],
  newcastle: ["the Tyne Bridge", "the Angel of the North", "Newcastle Castle"],
  durham: ["Durham Cathedral", "Durham Castle"],
  cardiff: ["Cardiff Castle", "Cardiff Bay", "the Principality Stadium"],
  belfast: ["Titanic Belfast", "Belfast City Hall", "the Ulster Museum"],
  aberdeen: ["Aberdeen Art Gallery", "the Aberdeen Maritime Museum"],
  inverness: ["Loch Ness", "Culloden Battlefield"],
  stirling: ["Stirling Castle", "the National Wallace Monument"],
  dundee: ["V&A Dundee", "RRS Discovery"],
  "st andrews": ["St Andrews Cathedral", "the Old Course"],
  "fort william": ["Ben Nevis", "the Glenfinnan Viaduct"],
  chester: ["Chester Cathedral", "the Rows", "Chester Zoo"],
  sheffield: ["the Winter Garden", "Kelham Island Museum", "Sheffield Botanical Gardens"],
  nottingham: ["Nottingham Castle", "the City of Caves", "Wollaton Hall"],
  leicester: ["the King Richard III Visitor Centre", "the National Space Centre"],
  coventry: ["Coventry Cathedral", "the Coventry Transport Museum"],
  norwich: ["Norwich Cathedral", "Norwich Castle"],
  canterbury: ["Canterbury Cathedral", "St Augustine's Abbey"],
  exeter: ["Exeter Cathedral", "the Royal Albert Memorial Museum"],
  plymouth: ["Plymouth Hoe", "the National Marine Aquarium", "the Barbican"],
  penzance: ["St Michael's Mount", "the Minack Theatre"],
  salisbury: ["Salisbury Cathedral", "Stonehenge"],
  winchester: ["Winchester Cathedral", "the Great Hall"],
  portsmouth: ["HMS Victory", "the Spinnaker Tower", "the Mary Rose Museum"],
  windsor: ["Windsor Castle", "the Long Walk"],
  "stratford-upon-avon": ["Shakespeare's Birthplace", "the Royal Shakespeare Theatre", "Anne Hathaway's Cottage"],
  lincoln: ["Lincoln Cathedral", "Lincoln Castle"],
  whitby: ["Whitby Abbey", "the 199 Steps"],
  scarborough: ["Scarborough Castle", "Peasholm Park"],
  harrogate: ["RHS Garden Harlow Carr", "the Valley Gardens"],
  blackpool: ["Blackpool Tower", "Blackpool Pleasure Beach"],
  windermere: ["Lake Windermere", "the World of Beatrix Potter"],
  hull: ["The Deep", "the Humber Bridge"],
  cheltenham: ["Cheltenham Racecourse", "the Pittville Pump Room"],
  gloucester: ["Gloucester Cathedral", "Gloucester Docks"],
  ely: ["Ely Cathedral", "Oliver Cromwell's House"],
  peterborough: ["Peterborough Cathedral"],
  llandudno: ["the Great Orme", "Llandudno Pier"],
  conwy: ["Conwy Castle"],
  bournemouth: ["Bournemouth Pier", "the Russell-Cotes Art Gallery and Museum"],
  dover: ["Dover Castle", "the White Cliffs of Dover"],
  margate: ["Turner Contemporary", "Dreamland"],
  carlisle: ["Carlisle Castle", "Carlisle Cathedral"],
};
// Other spellings of the same place.
const SAME = { "newcastle upon tyne": "newcastle", "stratford upon avon": "stratford-upon-avon", "kingston upon hull": "hull", "bath spa": "bath",
  "cheltenham spa": "cheltenham", "exeter st davids": "exeter", "windsor and eton central": "windsor", "blackpool north": "blackpool" };
const key = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/\bstation\b|\(all stations\)|\(any\)/g, "").replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
// The town or city a place name is in, when it is one listed here: "Edinburgh Waverley" is Edinburgh, "York" is York,
// "London Road (Brighton)" isn't anywhere. Returns { place, attractions } or null.
export function attractionsFor(name) {
  const k = key(name);
  if (!k) return null;
  const found = (t) => { const c = SAME[t] || t; return A[c] ? { place: c, attractions: A[c].slice(0, 3) } : null; };
  if (found(k)) return found(k);
  const w = k.split(" ");
  for (let n = w.length - 1; n >= 1; n--) {
    const c = w.slice(0, n).join(" ");
    if (found(c) && !/^(road|rd|street|st|lane|way|avenue|park|square|fields|hill|green|cross)$/.test(w[n])) return found(c);
  }
  return null;
}
// The name to show for a place listed here ("st andrews" is "St Andrews").
export function placeTitle(place) {
  return String(place || "").split(/([ -])/).map((w) => (/^(upon|on|of|the)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("");
}
export const ATTRACTION_PLACES = Object.keys(A);
