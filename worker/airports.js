// Airports, for reading flight bookings and for Wrapped's flights (Connor, 18 Nov 2026). Written by hand: only airports
// whose code and position are well known, the UK's and those UK flights commonly go to. Positions to about a kilometre.
// A code that isn't here is never guessed: the flight is kept by name only, with no place on the map.
// One airport a line: code;the name people use;the city or area it serves (for its sights);country;latitude;longitude;other names, separated by |
const AIRPORTS = `
LHR;London Heathrow;London;GB;51.470;-0.454;Heathrow|London Heathrow Airport|Heathrow Airport
LGW;London Gatwick;London;GB;51.153;-0.182;Gatwick|London Gatwick Airport|Gatwick Airport
STN;London Stansted;London;GB;51.885;0.235;Stansted|London Stansted Airport|Stansted Airport
LTN;London Luton;London;GB;51.875;-0.368;Luton|London Luton Airport|Luton Airport
LCY;London City;London;GB;51.505;0.055;London City Airport
SEN;London Southend;Southend;GB;51.571;0.696;Southend|Southend Airport|London Southend Airport
MAN;Manchester;Manchester;GB;53.354;-2.275;Manchester Airport
BHX;Birmingham;Birmingham;GB;52.454;-1.748;Birmingham Airport|Birmingham International Airport
EDI;Edinburgh;Edinburgh;GB;55.950;-3.373;Edinburgh Airport
GLA;Glasgow;Glasgow;GB;55.872;-4.433;Glasgow Airport|Glasgow International
PIK;Glasgow Prestwick;Prestwick;GB;55.509;-4.587;Prestwick|Glasgow Prestwick Airport
ABZ;Aberdeen;Aberdeen;GB;57.202;-2.198;Aberdeen Airport|Aberdeen Dyce
INV;Inverness;Inverness;GB;57.542;-4.048;Inverness Airport
DND;Dundee;Dundee;GB;56.453;-3.026;Dundee Airport
BRS;Bristol;Bristol;GB;51.383;-2.719;Bristol Airport
NCL;Newcastle;Newcastle;GB;55.038;-1.692;Newcastle Airport|Newcastle International
LBA;Leeds Bradford;Leeds;GB;53.866;-1.661;Leeds Bradford Airport|Leeds
LPL;Liverpool;Liverpool;GB;53.334;-2.850;Liverpool John Lennon|Liverpool John Lennon Airport|Liverpool Airport
EMA;East Midlands;East Midlands;GB;52.831;-1.328;East Midlands Airport|Nottingham East Midlands
BFS;Belfast International;Belfast;GB;54.658;-6.216;Belfast International Airport|Belfast
BHD;Belfast City;Belfast;GB;54.618;-5.873;George Best Belfast City|George Best Belfast City Airport|Belfast City Airport
LDY;City of Derry;Derry;GB;55.043;-7.161;Derry|City of Derry Airport
CWL;Cardiff;Cardiff;GB;51.397;-3.343;Cardiff Airport
SOU;Southampton;Southampton;GB;50.950;-1.357;Southampton Airport
EXT;Exeter;Exeter;GB;50.734;-3.414;Exeter Airport
NQY;Newquay;Newquay;GB;50.441;-4.995;Cornwall Airport Newquay|Newquay Airport
BOH;Bournemouth;Bournemouth;GB;50.780;-1.843;Bournemouth Airport
NWI;Norwich;Norwich;GB;52.676;1.283;Norwich Airport
MME;Teesside;Teesside;GB;54.509;-1.429;Teesside International|Teesside Airport
HUY;Humberside;Humberside;GB;53.574;-0.351;Humberside Airport
KOI;Kirkwall;Kirkwall;GB;58.958;-2.905;Kirkwall Airport
LSI;Sumburgh;Shetland;GB;59.879;-1.296;Sumburgh Airport|Shetland
SYY;Stornoway;Stornoway;GB;58.216;-6.331;Stornoway Airport
JER;Jersey;Jersey;JE;49.208;-2.196;Jersey Airport
GCI;Guernsey;Guernsey;GG;49.435;-2.602;Guernsey Airport
IOM;Isle of Man;Isle of Man;IM;54.083;-4.624;Isle of Man Airport|Ronaldsway
DUB;Dublin;Dublin;IE;53.421;-6.270;Dublin Airport
ORK;Cork;Cork;IE;51.841;-8.491;Cork Airport
SNN;Shannon;Shannon;IE;52.702;-8.925;Shannon Airport
NOC;Knock;Knock;IE;53.910;-8.818;Ireland West Airport Knock|Knock Airport
KIR;Kerry;Kerry;IE;52.181;-9.524;Kerry Airport
BCN;Barcelona;Barcelona;ES;41.297;2.078;Barcelona El Prat|Barcelona-El Prat|El Prat
GRO;Girona;Girona;ES;41.901;2.761;Barcelona Girona|Girona-Costa Brava
REU;Reus;Reus;ES;41.147;1.167;Barcelona Reus
MAD;Madrid;Madrid;ES;40.472;-3.561;Madrid Barajas|Madrid-Barajas|Adolfo Suarez Madrid-Barajas
AGP;Malaga;Malaga;ES;36.675;-4.499;Málaga|Malaga Costa del Sol|Málaga-Costa del Sol
ALC;Alicante;Alicante;ES;38.282;-0.558;Alicante-Elche|Alicante Elche
VLC;Valencia;Valencia;ES;39.489;-0.482;Valencia Airport
SVQ;Seville;Seville;ES;37.418;-5.893;Sevilla
PMI;Palma;Palma;ES;39.552;2.736;Palma de Mallorca|Mallorca|Majorca|Palma Mallorca
IBZ;Ibiza;Ibiza;ES;38.873;1.373;Ibiza Airport
MAH;Menorca;Menorca;ES;39.863;4.219;Mahon|Mahón|Minorca
RMU;Murcia;Murcia;ES;37.803;-1.125;Murcia International|Region de Murcia
LEI;Almeria;Almeria;ES;36.844;-2.370;Almería
BIO;Bilbao;Bilbao;ES;43.301;-2.911;Bilbao Airport
SCQ;Santiago de Compostela;Santiago de Compostela;ES;42.896;-8.415;Santiago
TFS;Tenerife South;Tenerife;ES;28.044;-16.572;Tenerife Sur|Tenerife South Reina Sofia|Tenerife
TFN;Tenerife North;Tenerife;ES;28.483;-16.342;Tenerife Norte|Tenerife North Los Rodeos
LPA;Gran Canaria;Gran Canaria;ES;27.932;-15.387;Las Palmas|Gran Canaria Airport
ACE;Lanzarote;Lanzarote;ES;28.946;-13.605;Arrecife|Lanzarote Airport
FUE;Fuerteventura;Fuerteventura;ES;28.453;-13.864;Fuerteventura Airport
FAO;Faro;Faro;PT;37.014;-7.966;Faro Airport|Algarve
LIS;Lisbon;Lisbon;PT;38.774;-9.134;Lisboa|Lisbon Humberto Delgado
OPO;Porto;Porto;PT;41.248;-8.681;Oporto
FNC;Madeira;Madeira;PT;32.698;-16.775;Funchal|Madeira Funchal
PDL;Ponta Delgada;Azores;PT;37.741;-25.698;Azores|Sao Miguel
CDG;Paris Charles de Gaulle;Paris;FR;49.010;2.548;Charles de Gaulle|Paris CDG|Paris-Charles de Gaulle|Roissy
ORY;Paris Orly;Paris;FR;48.723;2.379;Orly|Paris-Orly
BVA;Paris Beauvais;Beauvais;FR;49.454;2.113;Beauvais|Beauvais-Tille
NCE;Nice;Nice;FR;43.658;7.216;Nice Cote d'Azur|Nice Côte d'Azur
LYS;Lyon;Lyon;FR;45.726;5.081;Lyon Saint-Exupery|Lyon Saint-Exupéry
MRS;Marseille;Marseille;FR;43.437;5.215;Marseille Provence
BOD;Bordeaux;Bordeaux;FR;44.828;-0.716;Bordeaux Merignac|Bordeaux-Mérignac
TLS;Toulouse;Toulouse;FR;43.629;1.364;Toulouse Blagnac
NTE;Nantes;Nantes;FR;47.153;-1.611;Nantes Atlantique
GVA;Geneva;Geneva;CH;46.238;6.109;Genève|Geneva Airport
BSL;Basel;Basel;CH;47.590;7.529;Basel Mulhouse|EuroAirport
ZRH;Zurich;Zurich;CH;47.458;8.548;Zürich
FCO;Rome Fiumicino;Rome;IT;41.800;12.239;Fiumicino|Rome|Roma Fiumicino|Leonardo da Vinci
CIA;Rome Ciampino;Rome;IT;41.799;12.595;Ciampino|Roma Ciampino
MXP;Milan Malpensa;Milan;IT;45.630;8.723;Malpensa|Milano Malpensa
LIN;Milan Linate;Milan;IT;45.445;9.277;Linate|Milano Linate
BGY;Milan Bergamo;Bergamo;IT;45.674;9.704;Bergamo|Orio al Serio
VCE;Venice;Venice;IT;45.505;12.352;Venice Marco Polo|Venezia
TSF;Venice Treviso;Treviso;IT;45.648;12.194;Treviso
PSA;Pisa;Pisa;IT;43.684;10.393;Pisa Galileo Galilei
FLR;Florence;Florence;IT;43.810;11.205;Firenze|Florence Peretola
NAP;Naples;Naples;IT;40.886;14.291;Napoli
BLQ;Bologna;Bologna;IT;44.535;11.289;Bologna Guglielmo Marconi
VRN;Verona;Verona;IT;45.396;10.889;Verona Villafranca
TRN;Turin;Turin;IT;45.200;7.650;Torino
CTA;Catania;Catania;IT;37.467;15.066;Sicily Catania
PMO;Palermo;Palermo;IT;38.176;13.091;Palermo Falcone Borsellino
BRI;Bari;Bari;IT;41.139;16.761;Bari Karol Wojtyla
CAG;Cagliari;Cagliari;IT;39.251;9.054;Cagliari Elmas
OLB;Olbia;Olbia;IT;40.899;9.518;Olbia Costa Smeralda
AMS;Amsterdam;Amsterdam;NL;52.310;4.768;Amsterdam Schiphol|Schiphol
EIN;Eindhoven;Eindhoven;NL;51.450;5.375;Eindhoven Airport
BRU;Brussels;Brussels;BE;50.901;4.484;Brussels Airport|Bruxelles|Zaventem
CRL;Brussels Charleroi;Charleroi;BE;50.459;4.454;Charleroi
FRA;Frankfurt;Frankfurt;DE;50.037;8.562;Frankfurt am Main
MUC;Munich;Munich;DE;48.354;11.786;München
BER;Berlin;Berlin;DE;52.366;13.503;Berlin Brandenburg
HAM;Hamburg;Hamburg;DE;53.630;9.988;Hamburg Airport
DUS;Dusseldorf;Dusseldorf;DE;51.289;6.767;Düsseldorf
CGN;Cologne;Cologne;DE;50.866;7.143;Cologne Bonn|Köln Bonn|Koln
STR;Stuttgart;Stuttgart;DE;48.690;9.222;Stuttgart Airport
VIE;Vienna;Vienna;AT;48.110;16.570;Wien|Vienna International
SZG;Salzburg;Salzburg;AT;47.793;13.004;Salzburg Airport
INN;Innsbruck;Innsbruck;AT;47.260;11.344;Innsbruck Airport
PRG;Prague;Prague;CZ;50.101;14.260;Praha|Prague Vaclav Havel|Prague Václav Havel
BUD;Budapest;Budapest;HU;47.437;19.256;Budapest Ferenc Liszt
KRK;Krakow;Krakow;PL;50.078;19.785;Kraków|Krakow Balice
WAW;Warsaw;Warsaw;PL;52.166;20.967;Warsaw Chopin|Warszawa
GDN;Gdansk;Gdansk;PL;54.378;18.466;Gdańsk
CPH;Copenhagen;Copenhagen;DK;55.618;12.656;København|Copenhagen Kastrup
ARN;Stockholm Arlanda;Stockholm;SE;59.652;17.919;Arlanda|Stockholm
OSL;Oslo;Oslo;NO;60.194;11.100;Oslo Gardermoen|Gardermoen
HEL;Helsinki;Helsinki;FI;60.317;24.963;Helsinki-Vantaa
KEF;Reykjavik;Reykjavik;IS;63.985;-22.606;Keflavik|Keflavík|Reykjavík Keflavík
ATH;Athens;Athens;GR;37.936;23.947;Athens International
HER;Heraklion;Crete;GR;35.340;25.180;Crete Heraklion|Iraklion
CHQ;Chania;Crete;GR;35.532;24.150;Crete Chania
CFU;Corfu;Corfu;GR;39.602;19.912;Kerkyra
RHO;Rhodes;Rhodes;GR;36.405;28.086;Rodos
JTR;Santorini;Santorini;GR;36.399;25.479;Thira
JMK;Mykonos;Mykonos;GR;37.435;25.348;Mykonos Airport
ZTH;Zakynthos;Zakynthos;GR;37.751;20.884;Zante
KGS;Kos;Kos;GR;36.793;27.092;Kos Airport
DBV;Dubrovnik;Dubrovnik;HR;42.561;18.268;Dubrovnik Airport
SPU;Split;Split;HR;43.539;16.298;Split Airport
MLA;Malta;Malta;MT;35.857;14.477;Malta International|Valletta
PFO;Paphos;Paphos;CY;34.718;32.486;Pafos
LCA;Larnaca;Larnaca;CY;34.875;33.625;Larnaka
IST;Istanbul;Istanbul;TR;41.262;28.742;Istanbul Airport
AYT;Antalya;Antalya;TR;36.899;30.800;Antalya Airport
DLM;Dalaman;Dalaman;TR;36.713;28.793;Dalaman Airport
BJV;Bodrum;Bodrum;TR;37.250;27.664;Milas-Bodrum
RAK;Marrakech;Marrakech;MA;31.607;-8.036;Marrakesh|Marrakech Menara
HRG;Hurghada;Hurghada;EG;27.178;33.799;Hurghada International
SSH;Sharm el-Sheikh;Sharm el-Sheikh;EG;27.977;34.395;Sharm El Sheikh
DXB;Dubai;Dubai;AE;25.253;55.364;Dubai International
AUH;Abu Dhabi;Abu Dhabi;AE;24.433;54.651;Abu Dhabi International
DOH;Doha;Doha;QA;25.273;51.608;Hamad International|Doha Hamad
JFK;New York JFK;New York;US;40.641;-73.778;New York|John F Kennedy|John F. Kennedy|New York John F Kennedy|JFK
EWR;Newark;New York;US;40.690;-74.174;New York Newark|Newark Liberty
BOS;Boston;Boston;US;42.366;-71.010;Boston Logan|Logan
MCO;Orlando;Orlando;US;28.431;-81.308;Orlando International
MIA;Miami;Miami;US;25.795;-80.287;Miami International
LAX;Los Angeles;Los Angeles;US;33.942;-118.408;Los Angeles International
SFO;San Francisco;San Francisco;US;37.621;-122.379;San Francisco International
LAS;Las Vegas;Las Vegas;US;36.084;-115.154;Las Vegas Harry Reid|Harry Reid
ORD;Chicago O'Hare;Chicago;US;41.974;-87.907;Chicago|O'Hare
IAD;Washington Dulles;Washington;US;38.953;-77.456;Washington|Dulles
YYZ;Toronto;Toronto;CA;43.677;-79.630;Toronto Pearson|Pearson
YVR;Vancouver;Vancouver;CA;49.195;-123.184;Vancouver International
CUN;Cancun;Cancun;MX;21.037;-86.877;Cancún
BGI;Barbados;Barbados;BB;13.075;-59.493;Bridgetown|Grantley Adams
SIN;Singapore;Singapore;SG;1.364;103.991;Singapore Changi|Changi
BKK;Bangkok;Bangkok;TH;13.690;100.750;Bangkok Suvarnabhumi|Suvarnabhumi
HKG;Hong Kong;Hong Kong;HK;22.308;113.918;Hong Kong International
HND;Tokyo Haneda;Tokyo;JP;35.549;139.780;Haneda|Tokyo
NRT;Tokyo Narita;Tokyo;JP;35.772;140.393;Narita
DEL;Delhi;Delhi;IN;28.556;77.100;New Delhi|Indira Gandhi International
BOM;Mumbai;Mumbai;IN;19.089;72.868;Chhatrapati Shivaji Maharaj International
MLE;Male;Maldives;MV;4.192;73.529;Malé|Maldives|Velana International
SYD;Sydney;Sydney;AU;-33.940;151.175;Sydney Kingsford Smith
MEL;Melbourne;Melbourne;AU;-37.669;144.841;Melbourne Tullamarine
CPT;Cape Town;Cape Town;ZA;-33.965;18.602;Cape Town International
JNB;Johannesburg;Johannesburg;ZA;-26.134;28.242;OR Tambo|O.R. Tambo
WDH;Windhoek;Windhoek;NA;-22.480;17.471;Hosea Kutako|Windhoek Hosea Kutako|Windhoek Intl Apt|Windhoek International
`;

const key = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’'`]/g, "")
  .replace(/\b(international|intl|airport|apt)\b/g, " ").replace(/[.,()\/-]/g, " ").replace(/\s+/g, " ").trim();
let BY_CODE = null, BY_NAME = null;
function index() {
  if (BY_CODE) return;
  BY_CODE = new Map(); BY_NAME = new Map();
  for (const line of AIRPORTS.split("\n")) {
    if (!line.trim()) continue;
    const [code, name, city, country, lat, lon, others] = line.split(";");
    const a = { code, name, city, country, lat: Number(lat), lon: Number(lon) };
    BY_CODE.set(code, a);
    for (const n of [name].concat(others ? others.split("|") : [])) { const k = key(n); if (k && !BY_NAME.has(k)) BY_NAME.set(k, a); }
  }
}
// An airport by its three-letter code ("LHR"): { code, name, city, country, lat, lon } or null.
export function airportByCode(code) {
  index();
  const c = String(code || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? BY_CODE.get(c) || null : null;
}
// An airport by the name a booking gives it ("London Gatwick", "Malaga Costa del Sol", "Palma de Mallorca"), or its code.
// Only a name that is one of its names: never the nearest match.
export function airportByName(name) {
  index();
  const raw = String(name || "").trim();
  if (/^[A-Z]{3}$/.test(raw)) return airportByCode(raw);
  const k = key(raw);
  if (!k) return null;
  if (BY_NAME.has(k)) return BY_NAME.get(k);
  // "London Gatwick (North Terminal)", "Manchester Terminal 2": the airport's name with a terminal after it.
  const t = k.replace(/\b(north|south)? ?terminal ?\w*$/, "").trim();
  return t !== k && BY_NAME.has(t) ? BY_NAME.get(t) : null;
}
export function airportCount() { index(); return BY_CODE.size; }
export function allAirports() { index(); return [...BY_CODE.values()]; }
// Great-circle distance in kilometres.
export function distanceKm(a, b) {
  if (!a || !b) return null;
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
