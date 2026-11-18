// Where Great Britain's and Northern Ireland's railway stations, towns and airports are, for Wrapped's journeys. Written by
// hand (18 Nov 2026) because no open station dataset could be downloaded from where Relay is built: only places whose
// position is well known, to about a kilometre (latitude and longitude to two or three decimals). Not every station in
// Great Britain is here (about 2,580 exist); a place a ticket names that isn't here is named in words, never guessed.
// To swap in a complete list later (NaPTAN's RailReferences, for example), keep the same line format.
// One place a line: name;latitude;longitude;CRS code (only where certain);other names, separated by |
export const PLACES = `
London;51.507;-0.128;;London Terminals|London Any
London Euston;51.528;-0.134;EUS;Euston
London Kings Cross;51.531;-0.124;KGX;Kings Cross
London St Pancras International;51.532;-0.127;STP;London St Pancras|St Pancras|St Pancras International
London Paddington;51.516;-0.177;PAD;Paddington
London Victoria;51.495;-0.144;VIC;Victoria
London Waterloo;51.503;-0.113;WAT;Waterloo|London Waterloo East|Waterloo East
London Liverpool Street;51.518;-0.081;LST;Liverpool Street
London Bridge;51.505;-0.086;LBG;
London Marylebone;51.522;-0.163;MYB;Marylebone
London Charing Cross;51.508;-0.125;CHX;Charing Cross
London Cannon Street;51.511;-0.090;CST;Cannon Street
London Fenchurch Street;51.512;-0.079;FST;Fenchurch Street
London Blackfriars;51.512;-0.103;BFR;Blackfriars
City Thameslink;51.514;-0.104;CTK;
Farringdon;51.520;-0.105;ZFD;London Farringdon
Moorgate;51.518;-0.089;MOG;
Old Street;51.526;-0.088;;
Clapham Junction;51.464;-0.170;CLJ;
Stratford;51.542;-0.003;SRA;London Stratford|Stratford (London)
Stratford International;51.545;-0.009;SFA;
Wimbledon;51.421;-0.206;WIM;
Richmond;51.463;-0.301;RMD;Richmond (London)
East Croydon;51.375;-0.093;ECR;Croydon
West Croydon;51.378;-0.103;WCY;
Vauxhall;51.486;-0.123;VXH;
Kingston;51.413;-0.301;KNG;Kingston upon Thames
Surbiton;51.392;-0.304;SUR;
Ealing Broadway;51.515;-0.302;EAL;Ealing
Harrow and Wealdstone;51.592;-0.335;HRW;Harrow
Wembley Central;51.552;-0.296;WMB;Wembley
Wembley Stadium;51.554;-0.285;WCX;
Finsbury Park;51.565;-0.106;FPK;
Highbury and Islington;51.546;-0.104;HHY;
Greenwich;51.478;-0.013;GNW;
Lewisham;51.466;-0.014;LEW;
Woolwich Arsenal;51.490;0.069;WWA;Woolwich
Abbey Wood;51.491;0.121;ABW;
Tottenham Hale;51.588;-0.060;TOM;
Romford;51.575;0.183;RMF;
Ilford;51.559;0.069;IFD;
Barking;51.540;0.081;BKG;
Upminster;51.559;0.251;UPM;
Sutton;51.359;-0.191;SUO;Sutton (London)
Twickenham;51.450;-0.330;TWI;
Putney;51.461;-0.216;PUT;
Brixton;51.463;-0.114;BRX;
Peckham Rye;51.470;-0.069;PMR;Peckham
Denmark Hill;51.468;-0.089;DMK;
Crystal Palace;51.418;-0.073;CYP;
Canada Water;51.498;-0.050;;
Shoreditch High Street;51.523;-0.075;;Shoreditch
Hackney Central;51.547;-0.056;HKC;Hackney
West Hampstead Thameslink;51.548;-0.192;WHP;West Hampstead
Kentish Town;51.550;-0.140;KTN;
Enfield Town;51.652;-0.079;ENF;Enfield
Bromley South;51.400;0.017;BMS;Bromley
Orpington;51.373;0.089;ORP;
Hounslow;51.462;-0.362;HOU;
Uxbridge;51.546;-0.479;;
Heathrow Airport;51.471;-0.454;HXX;Heathrow|London Heathrow|Heathrow Terminals 2 and 3|Heathrow Terminal 5|Heathrow Terminal 4|Heathrow Central
Gatwick Airport;51.156;-0.161;GTW;Gatwick|London Gatwick|Gatwick Airport Station
Stansted Airport;51.889;0.261;SSD;Stansted|London Stansted
Luton Airport;51.875;-0.368;;London Luton|London Luton Airport
Luton Airport Parkway;51.872;-0.396;LTN;
London City Airport;51.504;0.049;;London City
Southend Airport;51.568;0.705;SIA;London Southend Airport
Manchester;53.481;-2.242;;Manchester Stations|Manchester Any
Manchester Piccadilly;53.477;-2.231;MAN;Piccadilly
Manchester Victoria;53.488;-2.242;MCV;
Manchester Oxford Road;53.474;-2.242;MCO;Oxford Road
Deansgate;53.474;-2.251;DGT;
Salford Central;53.483;-2.255;SFD;
Salford Crescent;53.486;-2.276;SLD;Salford
Manchester Airport;53.365;-2.273;MIA;
Stockport;53.405;-2.163;SPT;
Bolton;53.574;-2.426;BON;
Wigan;53.545;-2.632;;
Wigan North Western;53.544;-2.633;WGN;
Wigan Wallgate;53.545;-2.631;WGW;
Oldham;53.541;-2.118;;
Rochdale;53.610;-2.153;RCD;
Bury;53.593;-2.298;;
Altrincham;53.388;-2.347;ALT;
Sale;53.424;-2.322;;
Stalybridge;53.484;-2.063;SYB;
Ashton-under-Lyne;53.491;-2.095;AHN;
Hyde;53.451;-2.079;;
Glossop;53.444;-1.949;GLO;
Buxton;53.261;-1.913;BUX;
Wilmslow;53.327;-2.226;WML;
Macclesfield;53.259;-2.122;MAC;
Knutsford;53.302;-2.372;KNF;
Northwich;53.261;-2.497;NWI;
Liverpool;53.408;-2.983;;Liverpool Any
Liverpool Lime Street;53.407;-2.978;LIV;Lime Street
Liverpool Central;53.405;-2.979;LVC;
Liverpool James Street;53.405;-2.992;LVJ;James Street
Moorfields;53.409;-2.989;MRF;
Liverpool South Parkway;53.358;-2.889;LPY;
Liverpool John Lennon Airport;53.334;-2.850;;Liverpool Airport
Birkenhead;53.390;-3.020;;
Birkenhead Central;53.388;-3.021;BKC;
Hamilton Square;53.395;-3.014;BKQ;
West Kirby;53.373;-3.184;WKI;
Hoylake;53.390;-3.179;HYK;
New Brighton;53.437;-3.048;NBN;
Wallasey;53.423;-3.055;;
Ellesmere Port;53.282;-2.896;ELP;
Southport;53.646;-3.002;SOP;
Formby;53.553;-3.071;FBY;
Ormskirk;53.569;-2.881;OMS;
St Helens Central;53.453;-2.731;SNH;St Helens
Widnes;53.378;-2.733;WID;
Runcorn;53.339;-2.739;RUN;
Warrington;53.390;-2.597;;
Warrington Bank Quay;53.386;-2.603;WBQ;
Warrington Central;53.392;-2.592;WAC;
Newton-le-Willows;53.453;-2.613;NLW;
Chester;53.197;-2.880;CTR;
Crewe;53.089;-2.433;CRE;
Nantwich;53.063;-2.519;NAN;
Preston;53.756;-2.708;PRE;
Blackpool;53.817;-3.050;;
Blackpool North;53.822;-3.049;BPN;
Blackpool South;53.799;-3.049;BPS;
Blackpool Pleasure Beach;53.788;-3.054;BPB;
Lytham;53.739;-2.964;LTM;Lytham St Annes
St Annes-on-the-Sea;53.753;-3.029;SAS;St Annes
Fleetwood;53.924;-3.012;;
Poulton-le-Fylde;53.848;-2.991;PFY;
Kirkham and Wesham;53.787;-2.882;KKM;Kirkham
Leyland;53.698;-2.687;LEY;
Chorley;53.653;-2.627;CRL;
Blackburn;53.746;-2.479;BBN;
Accrington;53.753;-2.370;ACR;
Burnley;53.789;-2.248;;
Burnley Manchester Road;53.785;-2.249;BYM;
Burnley Central;53.794;-2.245;BNC;
Nelson;53.835;-2.214;NEL;
Colne;53.855;-2.181;CNE;
Clitheroe;53.873;-2.394;CLH;
Lancaster;54.049;-2.808;LAN;
Morecambe;54.070;-2.869;MCM;
Heysham Port;54.033;-2.913;HHB;Heysham
Carnforth;54.130;-2.771;CNF;
Oxenholme Lake District;54.305;-2.722;OXN;Oxenholme
Kendal;54.329;-2.745;KEN;
Windermere;54.379;-2.903;WDM;
Ambleside;54.430;-2.962;;
Keswick;54.601;-3.134;;
Penrith North Lakes;54.662;-2.758;PNR;Penrith
Carlisle;54.891;-2.934;CAR;
Workington;54.644;-3.558;WKG;
Whitehaven;54.553;-3.588;WTH;
Maryport;54.711;-3.494;MRY;
Barrow-in-Furness;54.119;-3.226;BIF;Barrow
Ulverston;54.192;-3.098;ULV;
Grange-over-Sands;54.195;-2.903;GOS;
Appleby;54.580;-2.487;APP;
Kirkby Stephen;54.455;-2.368;KSW;
Leeds;53.795;-1.548;LDS;
Bradford;53.795;-1.752;;
Bradford Interchange;53.791;-1.750;BDI;
Bradford Forster Square;53.797;-1.753;BDQ;
Huddersfield;53.648;-1.785;HUD;
Halifax;53.721;-1.854;HFX;
Brighouse;53.704;-1.785;BGH;
Elland;53.686;-1.840;;
Dewsbury;53.692;-1.633;DEW;
Batley;53.709;-1.623;BTL;
Mirfield;53.672;-1.693;MIR;
Wakefield;53.683;-1.499;;
Wakefield Westgate;53.683;-1.506;WKF;
Wakefield Kirkgate;53.678;-1.488;WKK;
Castleford;53.724;-1.355;CFD;
Pontefract;53.691;-1.310;;
Pontefract Monkhill;53.699;-1.303;PFM;
Normanton;53.700;-1.423;NOR;
Ossett;53.680;-1.580;;
Morley;53.740;-1.600;MLY;
Pudsey;53.795;-1.663;;
New Pudsey;53.804;-1.681;NPD;
Horsforth;53.848;-1.630;HRS;
Headingley;53.818;-1.594;HDY;
Garforth;53.796;-1.382;GRF;
Shipley;53.833;-1.774;SHY;
Saltaire;53.838;-1.790;SAE;
Bingley;53.848;-1.837;BIY;
Keighley;53.868;-1.901;KEI;
Haworth;53.830;-1.955;;
Skipton;53.960;-2.017;SKI;
Ilkley;53.925;-1.822;ILK;
Otley;53.905;-1.692;;
Wetherby;53.928;-1.386;;
Sowerby Bridge;53.707;-1.907;SOW;
Hebden Bridge;53.738;-2.009;HBD;
Todmorden;53.714;-2.099;TOD;
Holmfirth;53.570;-1.787;;
Leeds Bradford Airport;53.866;-1.661;;
Sheffield;53.378;-1.462;SHF;
Meadowhall;53.417;-1.413;MHS;
Rotherham;53.430;-1.357;;
Rotherham Central;53.432;-1.360;RMC;
Barnsley;53.554;-1.477;BNY;
Penistone;53.525;-1.623;PNS;
Doncaster;53.522;-1.140;DON;
Mexborough;53.491;-1.288;MEX;
Wombwell;53.517;-1.418;WOM;
Thorne;53.612;-0.962;;
Goole;53.705;-0.874;GOO;
York;53.958;-1.093;YRK;
Harrogate;53.993;-1.538;HGT;
Knaresborough;54.009;-1.470;KNA;
Ripon;54.137;-1.524;;
Thirsk;54.228;-1.372;THI;
Northallerton;54.333;-1.441;NTR;
Richmond (North Yorkshire);54.403;-1.737;;
Malton;54.132;-0.797;MLT;
Scarborough;54.280;-0.405;SCA;
Filey;54.210;-0.293;FIL;
Whitby;54.485;-0.615;WTB;
Pickering;54.247;-0.775;;
Selby;53.783;-1.063;SBY;
Tadcaster;53.884;-1.262;;
Settle;54.067;-2.281;SET;
Hull;53.744;-0.346;HUL;Hull Paragon|Kingston upon Hull
Beverley;53.842;-0.424;BEV;
Bridlington;54.084;-0.198;BDT;
Driffield;54.002;-0.434;DRF;
Brough;53.727;-0.578;BUH;
Hessle;53.717;-0.442;HES;
Lincoln;53.226;-0.540;LCN;Lincoln Central
Grimsby;53.564;-0.087;;
Grimsby Town;53.564;-0.087;GMB;
Cleethorpes;53.562;-0.029;CLE;
Scunthorpe;53.586;-0.651;SCU;
Barton-on-Humber;53.689;-0.443;BAU;
Brigg;53.549;-0.486;;
Gainsborough Lea Road;53.386;-0.769;GBL;Gainsborough
Market Rasen;53.388;-0.336;MKR;
Louth;53.366;-0.006;;
Skegness;53.143;0.334;SKG;
Boston;52.978;-0.031;BSN;
Spalding;52.789;-0.157;SPA;
Sleaford;52.995;-0.410;SLR;
Grantham;52.906;-0.642;GRA;
Stamford;52.648;-0.480;SMD;
Newcastle;54.968;-1.617;NCL;Newcastle upon Tyne|Newcastle Central
Gateshead;54.962;-1.602;;
MetroCentre;54.958;-1.666;MCE;
Newcastle Airport;55.037;-1.692;;
Sunderland;54.905;-1.382;SUN;
South Shields;54.999;-1.433;;
Tynemouth;55.017;-1.428;;
Whitley Bay;55.040;-1.442;;
Washington;54.900;-1.519;;
Cramlington;55.087;-1.598;CRM;
Blyth;55.127;-1.509;;
Ashington;55.181;-1.568;;
Morpeth;55.162;-1.683;MPT;
Alnmouth;55.393;-1.637;ALM;Alnmouth for Alnwick
Alnwick;55.413;-1.706;;
Berwick-upon-Tweed;55.774;-2.011;BWK;Berwick
Hexham;54.973;-2.095;HEX;
Haltwhistle;54.968;-2.463;HWH;
Durham;54.779;-1.581;DHM;
Chester-le-Street;54.855;-1.578;CLS;
Seaham;54.839;-1.346;SEA;
Peterlee;54.760;-1.336;;
Darlington;54.520;-1.547;DAR;
Bishop Auckland;54.657;-1.677;BIA;
Newton Aycliffe;54.613;-1.580;NAY;
Middlesbrough;54.579;-1.235;MBR;
Stockton;54.570;-1.318;STK;Stockton-on-Tees
Thornaby;54.560;-1.301;TBY;
Yarm;54.494;-1.352;YRM;
Billingham;54.606;-1.280;BIL;
Hartlepool;54.687;-1.207;HPL;
Redcar Central;54.616;-1.071;RCC;Redcar
Saltburn;54.583;-0.974;SLB;
Teesside Airport;54.509;-1.429;;Teesside International Airport
Birmingham;52.480;-1.902;;Birmingham Any
Birmingham New Street;52.478;-1.899;BHM;New Street
Birmingham Moor Street;52.479;-1.892;BMO;Moor Street
Birmingham Snow Hill;52.483;-1.899;BSW;Snow Hill
Birmingham International;52.451;-1.726;BHI;
Birmingham Airport;52.452;-1.733;;
University (Birmingham);52.451;-1.937;UNI;
Solihull;52.414;-1.788;SOL;
Coventry;52.401;-1.514;COV;
Wolverhampton;52.588;-2.120;WVH;
Walsall;52.585;-1.985;WSL;
West Bromwich;52.519;-1.995;;
Dudley;52.512;-2.081;;
Sandwell and Dudley;52.508;-2.012;SAD;
Smethwick Galton Bridge;52.502;-1.980;SGB;
Stourbridge Junction;52.448;-2.133;SBJ;Stourbridge
Kidderminster;52.384;-2.238;KID;
Redditch;52.306;-1.945;RDC;
Bromsgrove;52.322;-2.048;BMV;
Worcester;52.192;-2.220;;
Worcester Foregate Street;52.195;-2.222;WOF;
Worcester Shrub Hill;52.195;-2.209;WOS;
Worcestershire Parkway;52.155;-2.163;WOP;
Droitwich Spa;52.268;-2.158;DTW;Droitwich
Evesham;52.098;-1.947;EVE;
Great Malvern;52.109;-2.318;GMV;Malvern
Hereford;52.061;-2.708;HFD;
Leominster;52.225;-2.730;LEO;
Ludlow;52.371;-2.716;LUD;
Shrewsbury;52.712;-2.749;SHR;
Telford Central;52.681;-2.441;TFC;Telford
Wellington (Shropshire);52.701;-2.517;WLN;
Oswestry;52.860;-3.054;;
Leamington Spa;52.284;-1.536;LMS;Royal Leamington Spa
Warwick;52.286;-1.582;WRW;
Warwick Parkway;52.286;-1.612;WRP;
Kenilworth;52.343;-1.573;KNW;
Stratford-upon-Avon;52.194;-1.716;SAV;Stratford upon Avon
Banbury;52.060;-1.328;BAN;
Rugby;52.379;-1.250;RUG;
Nuneaton;52.526;-1.464;NUN;
Hinckley;52.535;-1.372;HNK;
Tamworth;52.637;-1.687;TAM;
Lichfield;52.682;-1.826;;
Lichfield Trent Valley;52.687;-1.800;LTV;
Lichfield City;52.680;-1.826;LIC;
Cannock;52.686;-2.022;CAO;
Rugeley Trent Valley;52.770;-1.930;RGL;Rugeley
Stafford;52.804;-2.122;STA;
Stone;52.908;-2.155;SNE;
Stoke-on-Trent;53.008;-2.181;SOT;Stoke
Uttoxeter;52.897;-1.857;UTT;
Burton-on-Trent;52.806;-1.642;BUT;Burton upon Trent
Derby;52.917;-1.463;DBY;
Belper;53.024;-1.482;BLP;
Matlock;53.138;-1.559;MAT;
Chesterfield;53.238;-1.420;CHD;
Nottingham;52.947;-1.146;NOT;
Beeston;52.921;-1.208;BEE;
Long Eaton;52.885;-1.287;LGE;
East Midlands Parkway;52.862;-1.263;EMD;
East Midlands Airport;52.831;-1.328;;
Ilkeston;52.980;-1.309;ILN;
Mansfield;53.142;-1.198;MFT;
Worksop;53.311;-1.123;WRK;
Newark;53.076;-0.809;;
Newark North Gate;53.081;-0.800;NNG;
Newark Castle;53.080;-0.813;NCT;
Retford;53.315;-0.948;RET;
Leicester;52.632;-1.125;LEI;
Loughborough;52.779;-1.196;LBO;
Market Harborough;52.479;-0.910;MHR;
Melton Mowbray;52.761;-0.886;MMO;
Oakham;52.672;-0.734;OKM;
Kettering;52.393;-0.731;KET;
Wellingborough;52.304;-0.676;WEL;
Corby;52.489;-0.688;COR;
Northampton;52.238;-0.906;NMP;
Milton Keynes Central;52.034;-0.774;MKC;Milton Keynes
Bletchley;51.995;-0.736;BLY;
Wolverton;52.066;-0.804;WOL;
Leighton Buzzard;51.916;-0.677;LBZ;
Bedford;52.136;-0.479;BDM;Bedford Midland
Luton;51.882;-0.414;LUT;
Harpenden;51.815;-0.352;HPD;
St Albans City;51.750;-0.328;SAC;St Albans
Watford Junction;51.663;-0.396;WFJ;Watford
Hemel Hempstead;51.742;-0.491;HML;
Berkhamsted;51.763;-0.562;BKM;
Tring;51.801;-0.659;TRI;
Stevenage;51.902;-0.207;SVG;
Hitchin;51.953;-0.263;HIT;
Letchworth Garden City;51.980;-0.229;LET;Letchworth
Baldock;51.993;-0.188;BDK;
Royston;52.053;-0.027;RYS;
Welwyn Garden City;51.801;-0.204;WGC;
Hatfield;51.764;-0.215;HAT;
Potters Bar;51.697;-0.193;PBR;
Hertford North;51.799;-0.092;HFN;Hertford
Hertford East;51.799;-0.073;HFE;
Cheshunt;51.703;-0.024;CHN;
Broxbourne;51.747;-0.011;BXB;
Harlow Town;51.781;0.095;HWN;Harlow
Bishops Stortford;51.867;0.165;BIS;
Audley End;52.004;0.207;AUD;Saffron Walden
Biggleswade;52.085;-0.261;BIW;
Sandy;52.125;-0.281;SDY;
St Neots;52.231;-0.247;SNO;
Huntingdon;52.329;-0.192;HUN;
Peterborough;52.575;-0.250;PBO;
Cambridge;52.194;0.137;CBG;
Cambridge North;52.224;0.158;CMB;
Ely;52.391;0.267;ELY;
March;52.560;0.091;MCH;
Downham Market;52.604;0.366;DOW;
Kings Lynn;52.754;0.403;KLN;
Newmarket;52.238;0.406;NMK;
Bury St Edmunds;52.254;0.713;BSE;
Thetford;52.419;0.745;TTF;
Diss;52.374;1.124;DIS;
Stowmarket;52.190;1.000;SMK;
Norwich;52.627;1.307;NRW;
Norwich Airport;52.676;1.283;;
Great Yarmouth;52.612;1.721;GYM;
Lowestoft;52.474;1.750;LWT;
Cromer;52.930;1.293;CMR;
Sheringham;52.941;1.210;SHM;
Ipswich;52.051;1.144;IPS;
Felixstowe;51.967;1.350;FLX;
Woodbridge;52.091;1.318;WDB;
Colchester;51.901;0.893;COL;
Colchester Town;51.886;0.904;CET;
Manningtree;51.949;1.045;MNG;
Harwich International;51.947;1.255;HPQ;Harwich
Clacton-on-Sea;51.794;1.154;CLT;Clacton
Frinton-on-Sea;51.838;1.244;FRI;Frinton
Walton-on-the-Naze;51.846;1.267;WON;
Witham;51.806;0.639;WTM;
Braintree;51.875;0.557;BTR;
Chelmsford;51.736;0.469;CHM;
Shenfield;51.631;0.330;SNF;
Brentwood;51.614;0.300;BRE;
Billericay;51.629;0.419;BIC;
Basildon;51.568;0.457;BSO;
Southend;51.538;0.711;;Southend-on-Sea
Southend Central;51.537;0.712;SOC;
Southend Victoria;51.541;0.711;SOV;
Leigh-on-Sea;51.541;0.640;LES;
Grays;51.476;0.322;GRY;
Tilbury Town;51.462;0.354;TIL;
Lakeside;51.488;0.283;;
Brighton;50.829;-0.141;BTN;
Hove;50.835;-0.171;HOV;
Preston Park;50.846;-0.155;PRP;
Shoreham-by-Sea;50.834;-0.272;SSE;Shoreham
Worthing;50.818;-0.376;WRH;
Littlehampton;50.810;-0.546;LIT;
Arundel;50.848;-0.546;ARU;
Bognor Regis;50.787;-0.676;BOG;
Chichester;50.832;-0.782;CCH;
Lewes;50.870;0.011;LWS;
Seaford;50.773;0.100;SEF;
Newhaven Town;50.795;0.055;NVN;Newhaven
Eastbourne;50.769;0.281;EBN;
Bexhill;50.841;0.477;BEX;
Hastings;50.858;0.576;HGS;
St Leonards Warrior Square;50.856;0.560;SLQ;St Leonards
Rye;50.952;0.731;RYE;
Battle;50.913;0.487;BAT;
Haywards Heath;51.005;-0.105;HHE;
Burgess Hill;50.954;-0.127;BUG;
Crawley;51.112;-0.187;CRW;
Three Bridges;51.117;-0.161;TBD;
Horsham;51.066;-0.320;HRH;
East Grinstead;51.126;-0.018;EGR;
Redhill;51.240;-0.166;RDH;
Reigate;51.242;-0.204;REI;
Dorking;51.241;-0.324;DKG;
Epsom;51.334;-0.269;EPS;
Leatherhead;51.299;-0.333;LHD;
Guildford;51.237;-0.580;GLD;
Woking;51.318;-0.557;WOK;
Godalming;51.187;-0.619;GOD;
Haslemere;51.089;-0.719;HSL;
Farnham;51.212;-0.792;FNH;
Aldershot;51.246;-0.760;AHT;
Farnborough Main;51.296;-0.756;FNB;Farnborough
Camberley;51.337;-0.744;CAM;
Staines;51.432;-0.503;SNS;
Weybridge;51.362;-0.458;WYB;
Walton-on-Thames;51.373;-0.415;WAL;
Esher;51.380;-0.353;ESH;
Basingstoke;51.268;-1.087;BSK;
Fleet;51.291;-0.831;FLE;
Andover;51.212;-1.492;ADV;
Winchester;51.067;-1.320;WIN;
Eastleigh;50.969;-1.350;ESL;
Southampton Central;50.908;-1.414;SOU;Southampton
Southampton Airport Parkway;50.951;-1.363;SOA;Southampton Airport
Romsey;50.993;-1.493;ROM;
Fareham;50.853;-1.192;FRM;
Gosport;50.795;-1.125;;
Portsmouth;50.800;-1.090;;
Portsmouth Harbour;50.797;-1.108;PMH;
Portsmouth and Southsea;50.798;-1.091;PMS;Southsea
Havant;50.854;-0.981;HAV;
Petersfield;51.007;-0.941;PTR;
Brockenhurst;50.817;-1.573;BCU;
Lymington Town;50.758;-1.537;LYT;Lymington
New Milton;50.756;-1.658;NWM;
Christchurch;50.738;-1.785;CHR;
Bournemouth;50.727;-1.864;BMH;
Bournemouth Airport;50.780;-1.843;;
Poole;50.719;-1.984;POO;
Wareham;50.693;-2.115;WRM;
Swanage;50.608;-1.958;;
Dorchester South;50.709;-2.437;DCH;Dorchester
Dorchester West;50.711;-2.442;DCW;
Weymouth;50.615;-2.454;WEY;
Salisbury;51.070;-1.806;SAL;
Ryde Pier Head;50.739;-1.160;RYP;Ryde
Shanklin;50.634;-1.180;SHN;
Newport (Isle of Wight);50.701;-1.292;;
Cowes;50.762;-1.298;;
Reading;51.459;-0.972;RDG;
Twyford;51.476;-0.863;TWY;
Wokingham;51.411;-0.843;WKM;
Bracknell;51.413;-0.752;BCE;
Newbury;51.398;-1.323;NBY;
Thatcham;51.394;-1.243;THA;
Hungerford;51.415;-1.512;HGD;
Didcot Parkway;51.611;-1.243;DID;Didcot
Oxford;51.753;-1.270;OXF;
Oxford Parkway;51.804;-1.274;OXP;
Bicester Village;51.894;-1.149;BIT;
Bicester North;51.903;-1.150;BCS;Bicester
Henley-on-Thames;51.534;-0.900;HOT;Henley
Slough;51.512;-0.592;SLO;
Maidenhead;51.519;-0.723;MAI;
Windsor and Eton Central;51.483;-0.610;WNC;Windsor
Windsor and Eton Riverside;51.486;-0.606;WNR;
Marlow;51.570;-0.766;MLW;
High Wycombe;51.630;-0.745;HWY;
Beaconsfield;51.611;-0.644;BCF;
Amersham;51.674;-0.607;AMR;
Aylesbury;51.814;-0.815;AYS;
Aylesbury Vale Parkway;51.832;-0.861;AVP;
Canterbury;51.280;1.079;;
Canterbury West;51.284;1.075;CBW;
Canterbury East;51.274;1.077;CBE;
Dover Priory;51.126;1.305;DVP;Dover
Folkestone Central;51.083;1.169;FKC;Folkestone
Folkestone West;51.085;1.154;FKW;
Ashford International;51.143;0.876;AFK;Ashford (Kent)|Ashford
Maidstone;51.272;0.522;;
Maidstone East;51.278;0.521;MDE;
Maidstone West;51.271;0.515;MDW;
Tonbridge;51.191;0.271;TON;
Tunbridge Wells;51.130;0.263;TBW;Royal Tunbridge Wells
Sevenoaks;51.277;0.182;SEV;
Paddock Wood;51.182;0.389;PDW;
Swanley;51.393;0.169;SAY;
Dartford;51.447;0.219;DFD;
Gravesend;51.441;0.367;GRV;
Ebbsfleet International;51.443;0.321;EBD;Ebbsfleet
Strood;51.397;0.500;SOO;
Rochester;51.386;0.510;RTR;
Chatham;51.380;0.521;CTM;
Gillingham (Kent);51.387;0.550;GLM;Gillingham
Sittingbourne;51.342;0.735;SIT;
Faversham;51.312;0.891;FAV;
Whitstable;51.358;1.034;WHI;
Herne Bay;51.365;1.118;HNB;
Margate;51.385;1.372;MAR;
Broadstairs;51.360;1.433;BSR;
Ramsgate;51.341;1.406;RAM;
Sandwich;51.270;1.343;SDW;
Deal;51.223;1.399;DEA;
Bristol;51.454;-2.588;;
Bristol Temple Meads;51.449;-2.581;BRI;Temple Meads
Bristol Parkway;51.514;-2.542;BPW;
Bristol Airport;51.383;-2.719;;
Severn Beach;51.560;-2.665;SVB;
Weston-super-Mare;51.344;-2.972;WSM;
Bath Spa;51.378;-2.357;BTH;Bath
Bradford-on-Avon;51.345;-2.252;BOA;
Trowbridge;51.320;-2.214;TRO;
Westbury;51.267;-2.199;WSB;
Frome;51.227;-2.310;FRO;
Chippenham;51.462;-2.116;CPM;
Swindon;51.565;-1.785;SWI;
Kemble;51.676;-2.023;KEM;
Stroud;51.745;-2.219;STD;
Cheltenham Spa;51.897;-2.099;CNM;Cheltenham
Gloucester;51.865;-2.239;GCR;
Cirencester;51.718;-1.968;;
Taunton;51.023;-3.103;TAU;
Bridgwater;51.128;-2.990;BWT;
Castle Cary;51.100;-2.523;CLC;
Yeovil Junction;50.925;-2.613;YVJ;Yeovil
Yeovil Pen Mill;50.944;-2.613;YVP;
Sherborne;50.944;-2.513;SHE;
Gillingham (Dorset);51.034;-2.273;GIL;
Crewkerne;50.874;-2.778;CKN;
Axminster;50.779;-3.005;AXM;
Honiton;50.797;-3.187;HON;
Tiverton Parkway;50.917;-3.360;TVP;Tiverton
Exeter;50.721;-3.531;;
Exeter St Davids;50.729;-3.543;EXD;
Exeter Central;50.726;-3.533;EXC;
Exeter Airport;50.734;-3.414;;
Exmouth;50.622;-3.415;EXM;
Dawlish;50.581;-3.465;DWL;
Teignmouth;50.548;-3.494;TGM;
Newton Abbot;50.529;-3.599;NTA;
Torquay;50.461;-3.543;TQY;
Paignton;50.435;-3.565;PGN;
Totnes;50.436;-3.689;TOT;
Okehampton;50.733;-4.004;OKE;
Barnstaple;51.074;-4.063;BNS;
Plymouth;50.378;-4.143;PLY;
Liskeard;50.447;-4.469;LSK;
Looe;50.359;-4.456;LOO;
Bodmin Parkway;50.446;-4.663;BOD;Bodmin
Par;50.355;-4.705;PAR;
St Austell;50.339;-4.790;SAU;
Newquay;50.415;-5.076;NQY;
Newquay Airport;50.440;-4.995;;Cornwall Airport Newquay
Truro;50.264;-5.065;TRU;
Falmouth Town;50.148;-5.065;FMT;Falmouth
Redruth;50.233;-5.226;RED;
Camborne;50.211;-5.297;CBN;
Hayle;50.186;-5.420;HYL;
St Erth;50.170;-5.444;SER;
St Ives;50.209;-5.478;SIV;St Ives (Cornwall)
Penzance;50.122;-5.532;PNZ;
Cardiff;51.481;-3.179;;
Cardiff Central;51.476;-3.179;CDF;
Cardiff Queen Street;51.482;-3.170;CDQ;
Cardiff Bay;51.467;-3.167;CDB;
Cardiff Airport;51.397;-3.343;;
Penarth;51.436;-3.174;;
Barry;51.401;-3.267;BRY;
Barry Island;51.392;-3.273;BYI;
Newport;51.589;-3.000;NWP;Newport (South Wales)|Newport (Wales)
Cwmbran;51.656;-3.016;CWM;
Abergavenny;51.817;-3.010;AGV;
Chepstow;51.640;-2.672;CPW;
Caerphilly;51.571;-3.218;CPH;
Pontypridd;51.599;-3.342;PPD;
Merthyr Tydfil;51.744;-3.377;MER;
Aberdare;51.715;-3.443;ABA;
Bridgend;51.507;-3.575;BGN;
Port Talbot Parkway;51.592;-3.781;PTA;Port Talbot
Neath;51.662;-3.807;NTH;
Swansea;51.625;-3.942;SWA;
Llanelli;51.674;-4.162;LLE;
Carmarthen;51.853;-4.306;CMN;
Tenby;51.673;-4.706;TEN;
Pembroke Dock;51.694;-4.938;PMD;
Pembroke;51.676;-4.916;PMB;
Haverfordwest;51.802;-4.962;HVF;
Milford Haven;51.715;-5.041;MFH;
Fishguard Harbour;52.012;-4.986;FGH;Fishguard
St Davids;51.882;-5.269;;
Aberystwyth;52.414;-4.082;AYW;
Machynlleth;52.595;-3.855;MCN;
Tywyn;52.586;-4.093;TYW;
Barmouth;52.723;-4.057;BRM;
Porthmadog;52.931;-4.134;PTM;
Pwllheli;52.888;-4.417;PWL;
Blaenau Ffestiniog;52.995;-3.938;BFF;
Betws-y-Coed;53.092;-3.801;BYC;
Newtown (Powys);52.512;-3.311;NWT;
Welshpool;52.657;-3.140;WLP;
Llandrindod;52.242;-3.379;LLO;Llandrindod Wells
Brecon;51.946;-3.389;;
Wrexham General;53.050;-3.003;WRX;Wrexham
Flint;53.249;-3.133;FLN;
Prestatyn;53.337;-3.407;PRT;
Rhyl;53.318;-3.489;RHL;
Colwyn Bay;53.296;-3.725;CWB;
Llandudno Junction;53.284;-3.809;LLJ;
Llandudno;53.323;-3.827;LLD;
Conwy;53.280;-3.832;CNW;
Bangor (Gwynedd);53.222;-4.136;BNG;Bangor
Caernarfon;53.140;-4.276;;
Holyhead;53.308;-4.631;HHD;
Edinburgh;55.952;-3.189;EDB;Edinburgh Waverley|Waverley
Haymarket;55.946;-3.218;HYM;Edinburgh Haymarket
Edinburgh Park;55.927;-3.308;EDP;
Edinburgh Gateway;55.941;-3.320;EGY;
Edinburgh Airport;55.950;-3.373;;
Musselburgh;55.934;-3.073;MUB;
North Berwick;56.057;-2.731;NBW;
Dunbar;55.998;-2.513;DUN;
Linlithgow;55.977;-3.596;LIN;
Livingston North;55.901;-3.544;LSN;Livingston
Bathgate;55.894;-3.640;BHG;
Falkirk;56.001;-3.784;;
Falkirk High;55.992;-3.792;FKK;
Falkirk Grahamston;56.003;-3.785;FKG;
Stirling;56.120;-3.936;STG;
Dunblane;56.186;-3.965;DBL;
Bridge of Allan;56.157;-3.957;BEA;
Gleneagles;56.275;-3.731;GLE;
Perth;56.392;-3.439;PTH;
Dunkeld and Birnam;56.557;-3.578;DKD;Dunkeld
Pitlochry;56.702;-3.735;PIT;
Blair Atholl;56.765;-3.850;BLA;
Kingussie;57.078;-4.052;KIN;
Aviemore;57.189;-3.829;AVM;
Inverness;57.480;-4.223;INV;
Inverness Airport;57.539;-4.063;;
Nairn;57.580;-3.872;NRN;
Forres;57.610;-3.618;FOR;
Elgin;57.643;-3.312;ELG;
Keith;57.551;-2.954;KEH;
Huntly;57.444;-2.776;HNT;
Inverurie;57.286;-2.374;INR;
Dyce;57.206;-2.193;DYC;
Aberdeen;57.144;-2.098;ABD;
Aberdeen Airport;57.202;-2.198;;
Stonehaven;56.967;-2.225;STN;
Montrose;56.713;-2.472;MTS;
Arbroath;56.560;-2.589;ARB;
Dundee;56.457;-2.971;DEE;
Leuchars;56.375;-2.894;LEU;Leuchars for St Andrews
St Andrews;56.340;-2.796;;
Cupar;56.317;-3.009;CUP;
Markinch;56.201;-3.131;MNC;Glenrothes
Kirkcaldy;56.112;-3.167;KDY;
Inverkeithing;56.035;-3.396;INK;
Dunfermline City;56.072;-3.452;DFE;Dunfermline|Dunfermline Town
North Queensferry;56.012;-3.394;NQU;
Glasgow;55.861;-4.252;;Glasgow Any
Glasgow Central;55.859;-4.258;GLC;
Glasgow Queen Street;55.862;-4.251;GLQ;Queen Street (Glasgow)
Partick;55.870;-4.309;PTK;
Paisley Gilmour Street;55.847;-4.424;PYG;Paisley
Glasgow Airport;55.870;-4.433;;
Glasgow Prestwick Airport;55.509;-4.614;PRA;Prestwick Airport|Prestwick
Motherwell;55.791;-3.994;MTH;
Hamilton Central;55.773;-4.039;HNC;Hamilton
East Kilbride;55.766;-4.180;EKL;
Coatbridge Central;55.863;-4.032;CBC;Coatbridge
Airdrie;55.864;-3.983;ADR;
Cumbernauld;55.942;-3.980;CUB;
Croy;55.956;-4.036;CRO;
Greenock Central;55.945;-4.752;GKC;Greenock
Gourock;55.962;-4.817;GRK;
Helensburgh Central;56.004;-4.733;HLC;Helensburgh
Dumbarton Central;55.947;-4.567;DBC;Dumbarton
Balloch;56.003;-4.584;BHC;
Largs;55.793;-4.867;LAR;
Ardrossan Harbour;55.640;-4.822;ADS;Ardrossan
Irvine;55.611;-4.675;IRV;
Troon;55.543;-4.655;TRN;
Ayr;55.458;-4.626;AYR;
Kilmarnock;55.612;-4.499;KMK;
Stranraer;54.910;-5.026;STR;
Dumfries;55.073;-3.604;DMF;
Lockerbie;55.123;-3.354;LOC;
Carstairs;55.691;-3.668;CRS;
Galashiels;55.618;-2.807;GAL;
Tweedbank;55.606;-2.763;TWB;
Melrose;55.598;-2.719;;
Peebles;55.652;-3.188;;
Crianlarich;56.390;-4.618;CNR;
Tyndrum Lower;56.433;-4.715;TYL;Tyndrum
Oban;56.412;-5.474;OBN;
Fort William;56.820;-5.106;FTW;
Glenfinnan;56.872;-5.449;GLF;
Arisaig;56.912;-5.839;ARG;
Mallaig;57.006;-5.828;MLG;
Kyle of Lochalsh;57.280;-5.714;KYL;Kyle
Portree;57.413;-6.196;;
Dingwall;57.594;-4.422;DIN;
Thurso;58.590;-3.528;THS;
Wick;58.442;-3.097;WCK;
Kirkwall;58.981;-2.960;;
Lerwick;60.155;-1.145;;
Stornoway;58.209;-6.388;;
Belfast;54.597;-5.930;;
Belfast Grand Central;54.594;-5.939;;Belfast Great Victoria Street|Great Victoria Street|Grand Central
Lanyon Place;54.596;-5.918;;Belfast Lanyon Place|Belfast Central
Belfast City Airport;54.618;-5.873;;George Best Belfast City Airport
Belfast International Airport;54.658;-6.216;;Belfast International
Lisburn;54.514;-6.044;;
Portadown;54.424;-6.442;;
Lurgan;54.464;-6.334;;
Newry;54.192;-6.358;;
Bangor (Northern Ireland);54.660;-5.669;;Bangor (County Down)|Bangor (Co Down)
Holywood;54.639;-5.835;;
Carrickfergus;54.716;-5.806;;
Whitehead;54.754;-5.708;;
Larne Harbour;54.855;-5.799;;Larne
Antrim;54.712;-6.217;;
Ballymena;54.866;-6.278;;
Coleraine;55.133;-6.664;;
Portrush;55.204;-6.652;;
Derry;54.995;-7.316;;Londonderry|Derry~Londonderry|Derry Londonderry
Armagh;54.350;-6.653;;
Enniskillen;54.344;-7.632;;
Omagh;54.600;-7.300;;
Downpatrick;54.328;-5.716;;
Newtownards;54.592;-5.693;;
`;
