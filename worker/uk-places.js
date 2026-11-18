// Where UK stations, cities and airports are, so Wrapped can put a shopper's journeys on a map. Only places whose position
// is well known are listed (latitude, longitude, to two decimals, which is close enough for a map of the whole country).
// A place a receipt names that isn't here is listed in words, never guessed onto the map.
const P = {
  // London and its main stations.
  "london": [51.51, -0.13], "london euston": [51.53, -0.13], "london kings cross": [51.53, -0.12], "london st pancras": [51.53, -0.13],
  "london st pancras international": [51.53, -0.13], "london paddington": [51.52, -0.18], "london victoria": [51.50, -0.14],
  "london waterloo": [51.50, -0.11], "london liverpool street": [51.52, -0.08], "london bridge": [51.50, -0.09], "london marylebone": [51.52, -0.16],
  "london charing cross": [51.51, -0.12], "london cannon street": [51.51, -0.09], "london fenchurch street": [51.51, -0.08],
  "heathrow": [51.47, -0.45], "london heathrow": [51.47, -0.45], "heathrow airport": [51.47, -0.45], "gatwick": [51.15, -0.18], "gatwick airport": [51.15, -0.18],
  "london gatwick": [51.15, -0.18], "stansted": [51.89, 0.24], "stansted airport": [51.89, 0.24], "london stansted": [51.89, 0.24],
  "luton airport": [51.87, -0.37], "london luton": [51.87, -0.37], "london city airport": [51.50, 0.05],
  // England.
  "manchester": [53.48, -2.24], "manchester piccadilly": [53.48, -2.23], "manchester victoria": [53.49, -2.24], "manchester oxford road": [53.47, -2.24],
  "manchester airport": [53.36, -2.27], "birmingham": [52.48, -1.89], "birmingham new street": [52.48, -1.90], "birmingham international": [52.45, -1.73],
  "birmingham airport": [52.45, -1.73], "birmingham moor street": [52.48, -1.89], "leeds": [53.80, -1.55], "liverpool": [53.41, -2.98],
  "liverpool lime street": [53.41, -2.98], "liverpool south parkway": [53.36, -2.89], "sheffield": [53.38, -1.46], "newcastle": [54.97, -1.62],
  "newcastle upon tyne": [54.97, -1.62], "york": [53.96, -1.09], "bristol": [51.45, -2.59], "bristol temple meads": [51.45, -2.58],
  "bristol parkway": [51.51, -2.54], "bristol airport": [51.38, -2.72], "nottingham": [52.95, -1.15], "leicester": [52.64, -1.13],
  "derby": [52.92, -1.48], "coventry": [52.41, -1.51], "wolverhampton": [52.59, -2.12], "stoke-on-trent": [53.00, -2.18], "stoke on trent": [53.00, -2.18],
  "crewe": [53.09, -2.43], "chester": [53.19, -2.89], "preston": [53.76, -2.71], "lancaster": [54.05, -2.80], "blackpool": [53.82, -3.05],
  "blackpool north": [53.82, -3.05], "carlisle": [54.89, -2.93], "penrith": [54.66, -2.75], "oxenholme": [54.31, -2.72], "durham": [54.78, -1.58],
  "darlington": [54.52, -1.55], "middlesbrough": [54.58, -1.23], "sunderland": [54.91, -1.38], "hull": [53.74, -0.34], "doncaster": [53.52, -1.14],
  "wakefield": [53.68, -1.50], "wakefield westgate": [53.68, -1.51], "bradford": [53.79, -1.75], "huddersfield": [53.65, -1.78], "harrogate": [53.99, -1.54],
  "peterborough": [52.57, -0.25], "stevenage": [51.90, -0.21], "milton keynes": [52.04, -0.76], "milton keynes central": [52.03, -0.77],
  "northampton": [52.24, -0.90], "rugby": [52.38, -1.25], "watford": [51.66, -0.40], "watford junction": [51.66, -0.40], "reading": [51.46, -0.97],
  "oxford": [51.75, -1.26], "cambridge": [52.21, 0.12], "norwich": [52.63, 1.30], "ipswich": [52.06, 1.16], "colchester": [51.89, 0.90],
  "chelmsford": [51.74, 0.47], "southend": [51.54, 0.71], "brighton": [50.83, -0.14], "gatwick airport station": [51.16, -0.16],
  "guildford": [51.24, -0.58], "woking": [51.32, -0.56], "southampton": [50.91, -1.40], "southampton central": [50.91, -1.41],
  "southampton airport": [50.95, -1.36], "portsmouth": [50.80, -1.09], "bournemouth": [50.72, -1.88], "exeter": [50.72, -3.53],
  "exeter st davids": [50.73, -3.54], "plymouth": [50.38, -4.14], "penzance": [50.12, -5.53], "truro": [50.26, -5.05], "newquay": [50.42, -5.08],
  "bath": [51.38, -2.36], "bath spa": [51.38, -2.36], "swindon": [51.56, -1.79], "cheltenham": [51.90, -2.08], "cheltenham spa": [51.90, -2.10],
  "gloucester": [51.86, -2.24], "worcester": [52.19, -2.22], "hereford": [52.06, -2.71], "lincoln": [53.23, -0.54], "canterbury": [51.28, 1.08],
  "dover": [51.13, 1.31], "ashford": [51.15, 0.87], "ashford international": [51.14, 0.88], "orpington": [51.37, 0.09], "sevenoaks": [51.27, 0.19],
  "tunbridge wells": [51.13, 0.26], "maidstone": [51.27, 0.52], "luton": [51.88, -0.42], "bedford": [52.14, -0.47], "st albans": [51.75, -0.34],
  "warrington": [53.39, -2.60], "warrington bank quay": [53.39, -2.60], "wigan": [53.55, -2.63], "wigan north western": [53.54, -2.63],
  "bolton": [53.58, -2.43], "stockport": [53.41, -2.16], "macclesfield": [53.26, -2.12], "stafford": [52.80, -2.12], "tamworth": [52.63, -1.69],
  "nuneaton": [52.53, -1.46], "grantham": [52.91, -0.64], "newark": [53.08, -0.81], "newark north gate": [53.08, -0.80], "retford": [53.32, -0.95],
  "scarborough": [54.28, -0.40], "whitby": [54.49, -0.61], "leeds bradford airport": [53.87, -1.66], "east midlands airport": [52.83, -1.33],
  "newcastle airport": [55.04, -1.69], "liverpool john lennon airport": [53.33, -2.85],
  "salisbury": [51.07, -1.81], "winchester": [51.07, -1.32], "windsor": [51.48, -0.61], "windsor and eton central": [51.48, -0.61],
  "stratford-upon-avon": [52.19, -1.71], "stratford upon avon": [52.19, -1.71], "windermere": [54.38, -2.91], "ely": [52.39, 0.27],
  "margate": [51.39, 1.38], "conwy": [53.28, -3.83],
  // Scotland.
  "edinburgh": [55.95, -3.19], "edinburgh waverley": [55.95, -3.19], "edinburgh haymarket": [55.95, -3.22], "edinburgh airport": [55.95, -3.37],
  "glasgow": [55.86, -4.25], "glasgow central": [55.86, -4.26], "glasgow queen street": [55.86, -4.25], "glasgow airport": [55.87, -4.43],
  "aberdeen": [57.15, -2.10], "aberdeen airport": [57.20, -2.20], "dundee": [56.46, -2.97], "inverness": [57.48, -4.22], "perth": [56.40, -3.44],
  "stirling": [56.12, -3.94], "fort william": [56.82, -5.11], "oban": [56.41, -5.47], "kirkcaldy": [56.11, -3.16], "st andrews": [56.34, -2.80],
  // Wales.
  "cardiff": [51.48, -3.18], "cardiff central": [51.48, -3.18], "cardiff airport": [51.40, -3.34], "swansea": [51.62, -3.94], "newport": [51.59, -3.00],
  "bangor": [53.23, -4.13], "holyhead": [53.31, -4.63], "aberystwyth": [52.41, -4.08], "llandudno": [53.32, -3.83], "wrexham": [53.05, -2.99],
  // Northern Ireland.
  "belfast": [54.60, -5.93], "belfast city airport": [54.62, -5.87], "belfast international airport": [54.66, -6.22], "derry": [55.00, -7.32],
  "londonderry": [55.00, -7.32], "lisburn": [54.51, -6.04], "newry": [54.18, -6.34], "bangor (northern ireland)": [54.66, -5.67],
};
const key = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/\bstation\b|\bstn\b|\(all stations\)|\(any\)/g, "").replace(/\s+/g, " ").replace(/[.,]/g, "").trim();
// Where a place is: { lat, lon } for one listed by its own name; else the town or city a station name starts with
// ("Manchester Oxford Road" is in Manchester); else null.
export function placeAt(name) {
  const k = key(name);
  if (!k) return null;
  if (P[k]) return { lat: P[k][0], lon: P[k][1] };
  const w = k.split(" ");
  // Not when the rest makes it a street's name ("London Road" is a station in Brighton, not London).
  for (let n = w.length - 1; n >= 1; n--) {
    const c = w.slice(0, n).join(" ");
    if (P[c] && !/^(road|rd|street|st|lane|way|avenue|park|square|fields|hill|green|cross)$/.test(w[n])) return { lat: P[c][0], lon: P[c][1] };
  }
  return null;
}
