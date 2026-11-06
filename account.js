/* Relay shopper sign-in: emailed one-time link, session kept in this browser only.
   All server data is written with textContent (never innerHTML). */
(function () {
  var API = "https://relay-square-api2.9pts72cy5j.workers.dev";
  var KEY = "relay.session.v1";
  // The shopper's name and photo, kept on this device so the avatar shows straight away (the server copy is the real one).
  var PROFILE_KEY = "relay.profile";
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  // Orders the shops confirmed. Orders from Relay's own test shops come only with the testing tools on (worker/auth.js).
  function purchasesPath() { return "/relay/my/purchases" + (testingOn() ? "?test=1" : ""); }
  // The shared account for app reviewers (worker/review-account.js): no inbox or sign-in settings can be added to it, so
  // the app leaves those out and explains what to do instead.
  function isReview() { var s = load(); return Boolean(s && s.token && s.review); }
  // Ask the browser not to clear Relay's saved sign-in when it tidies up storage.
  function keepStorage() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {} }
  // Keeps what the app has already loaded so moving between tabs is instant. It lives in memory only and is wiped on sign-out.
  var memo = { blobs: {}, consent: null, gmail: null, receipts: null, openCat: null, openIds: {} };
  // The link in the admins' morning email (#open=health) opens Relay health: straight away when the Profile tab already
  // knows it's an admin's, or as soon as it does.
  var openHealthPage = null, wantHealth = false;
  window.relayOpenHealth = function () {
    wantHealth = true;
    // Opening the tab may draw it afresh (then the new drawing opens the page once it knows); otherwise open it here.
    setTimeout(function () { if (wantHealth && openHealthPage && openHealthPage()) wantHealth = false; }, 0);
  };
  // The app followed the link before this file had loaded.
  if (window.__relayWantHealth) { window.__relayWantHealth = false; wantHealth = true; }
  // Logos Relay keeps for well-known UK shops (logos/<domain>.<type>; see scripts/fetch-logos.mjs). Anything else falls back to a live lookup.
  var STORE_LOGOS = {"1password.com":"svg","abelandcole.co.uk":"png","abercrombie.com":"png","accessorize.com":"png","accor.com":"svg","addisonlee.com":"png","adidas.co.uk":"png","adobe.com":"png","aerlingus.com":"png","aesop.com":"png","airbnb.co.uk":"svg","airfrance.co.uk":"png","aldi.co.uk":"svg","aliexpress.com":"png","allbarone.co.uk":"png","allsaints.com":"svg","altontowers.com":"png","amazon.co.uk":"png","anthropic.com":"svg","ao.com":"png","apple.com":"png","appliancesdirect.co.uk":"png","argos.co.uk":"png","arket.com":"png","asda.com":"png","asics.com":"png","asos.com":"png","astridandmiyu.com":"png","atgtickets.com":"png","audible.co.uk":"png","avantiwestcoast.co.uk":"png","avis.co.uk":"png","axs.com":"png","backmarket.co.uk":"png","barbour.com":"png","beautybay.com":"png","beaverbrooks.co.uk":"png","beerhawk.co.uk":"png","bellaitalia.co.uk":"png","benefitcosmetics.com":"png","bensonsforbeds.co.uk":"png","berghaus.com":"png","bershka.com":"png","better.org.uk":"png","bettys.co.uk":"png","birkenstock.com":"svg","blacks.co.uk":"svg","blackwells.co.uk":"png","bloomandwild.com":"png","bmstores.co.uk":"png","boden.com":"png","bolt.eu":"png","bonmarche.co.uk":"png","boohoo.com":"svg","boohooman.com":"png","booking.com":"png","booths.co.uk":"png","boots.com":"png","bose.co.uk":"png","bowsandwhistles.co.uk":"png","box.co.uk":"png","brewdog.com":"svg","britishairways.com":"svg","brittany-ferries.co.uk":"png","bt.com":"svg","bulk.com":"png","bumble.com":"svg","burberry.com":"png","burgerking.co.uk":"png","burton.co.uk":"png","butternutbox.com":"png","buyagift.co.uk":"svg","cadburygiftsdirect.co.uk":"png","caferouge.com":"png","caffenero.com":"png","calm.com":"png","calvinklein.co.uk":"png","canva.com":"png","cardfactory.co.uk":"svg","carpetright.co.uk":"svg","castore.com":"png","chainreactioncycles.com":"png","charlottetilbury.com":"svg","chemist4u.com":"png","chipotle.co.uk":"png","cineworld.co.uk":"png","clarechampion.ie":"png","clarins.co.uk":"png","clarks.co.uk":"png","classpass.com":"png","clinique.co.uk":"png","coastfashion.com":"png","converse.com":"png","coop.co.uk":"png","cos.com":"png","costa.co.uk":"png","costco.co.uk":"png","cote.co.uk":"png","cotswoldco.com":"png","cotswoldoutdoor.com":"png","coxandcox.co.uk":"png","craghoppers.com":"png","crocs.co.uk":"png","crocus.co.uk":"svg","crosscountrytrains.co.uk":"png","ctshirts.com":"svg","cultbeauty.co.uk":"svg","cultfurniture.com":"png","currys.co.uk":"png","danielwellington.com":"png","davidlloyd.co.uk":"svg","dazn.com":"png","debenhams.com":"png","decathlon.co.uk":"png","deezer.com":"png","deliveroo.co.uk":"png","depop.com":"png","detalecph.com":"png","dfds.com":"png","dfs.co.uk":"png","dice.fm":"svg","discord.com":"png","dishoom.com":"svg","disneyplus.com":"svg","diy.com":"png","dobbies.com":"png","dominos.co.uk":"png","dorothyperkins.com":"png","dreams.co.uk":"png","drmartens.com":"svg","dropbox.com":"png","dulux.co.uk":"png","dunelm.com":"png","dunelondon.com":"svg","duolingo.com":"png","dyson.co.uk":"png","easyjet.com":"png","ebay.co.uk":"png","ebuyer.com":"png","economist.com":"png","ee.co.uk":"png","eflorist.co.uk":"png","elemis.com":"png","elevenlabs.io":"svg","emirates.com":"png","emma-sleep.co.uk":"png","endclothing.com":"png","english-heritage.org.uk":"png","enterprise.co.uk":"png","epicgames.com":"png","ernestjones.co.uk":"png","esteelauder.co.uk":"png","etsy.com":"png","europcar.co.uk":"png","eurostar.com":"png","evans.co.uk":"png","evanscycles.com":"png","eventbrite.co.uk":"png","eventim.co.uk":"png","everymancinema.com":"png","expedia.co.uk":"png","expressvpn.com":"png","farfetch.com":"png","farmfoods.co.uk":"png","farrow-ball.com":"png","fatface.com":"png","fenwick.co.uk":"png","firebox.com":"png","fiveguys.co.uk":"svg","flannels.com":"png","footlocker.co.uk":"png","fortnumandmason.com":"png","foyles.co.uk":"png","fragrancedirect.co.uk":"png","francomanca.co.uk":"png","frankieandbennys.com":"png","fredperry.com":"png","freemans.com":"png","freenow.com":"png","frugi.com":"png","fruugo.co.uk":"png","ft.com":"png","funkypigeon.com":"png","furniturevillage.co.uk":"png","gailsbread.co.uk":"svg","game.co.uk":"png","garmin.com":"svg","gbk.co.uk":"png","giffgaff.com":"png","gigantic.com":"png","github.com":"svg","glassesdirect.co.uk":"png","glossier.com":"png","goldsmiths.co.uk":"svg","google.com":"png","gordonramsayrestaurants.com":"png","gousto.co.uk":"png","graze.com":"png","greatbeanbags.com":"png","greeneking.co.uk":"png","greggs.co.uk":"svg","groupon.co.uk":"png","gruum.com":"png","gucci.com":"png","gumtree.com":"png","gwr.com":"png","gymshark.com":"png","habitat.co.uk":"png","halfords.com":"png","hamleys.com":"png","harrods.com":"png","harvester.co.uk":"png","headspace.com":"png","heals.com":"png","hellofresh.co.uk":"png","hertz.co.uk":"png","hilton.com":"png","hinge.co":"png","hm.com":"png","hmv.com":"png","hobbs.com":"png","hobbycraft.co.uk":"png","holidayextras.co.uk":"png","hollandandbarrett.com":"png","hollisterco.com":"png","hollywoodbowl.co.uk":"png","homary.com":"png","homebargains.co.uk":"svg","homebase.co.uk":"png","homesense.com":"svg","honestburgers.co.uk":"png","hotelchocolat.com":"png","hotels.com":"png","houseoffraser.co.uk":"png","howdens.com":"svg","hsamuel.co.uk":"png","hughes.co.uk":"png","hugoboss.com":"png","hunterboots.com":"png","iceland.co.uk":"png","idmobile.co.uk":"png","iguanas.co.uk":"png","ihg.com":"png","ikea.com":"png","interflora.co.uk":"png","inthestyle.com":"png","itsu.com":"png","itv.com":"png","jackjones.com":"png","jbl.com":"png","jdsports.co.uk":"png","jdwetherspoon.com":"png","jdwilliams.co.uk":"png","jessops.com":"png","jet2.com":"svg","jet2holidays.com":"svg","jigsaw-online.com":"png","johnlewis.com":"svg","jojomamanbebe.co.uk":"png","jollyes.co.uk":"png","jomalone.co.uk":"png","josephjoseph.com":"png","joules.com":"png","just-eat.co.uk":"png","justpark.com":"svg","karaca.co.uk":"png","karenmillen.com":"png","kayak.co.uk":"svg","kfc.co.uk":"png","kikocosmetics.com":"svg","klarna.com":"png","klm.com":"png","kobo.com":"png","krispykreme.co.uk":"png","kurtgeiger.com":"png","kwik-fit.com":"png","lacoste.com":"png","laithwaites.co.uk":"png","lakeland.co.uk":"png","laptopsdirect.co.uk":"png","laredoute.co.uk":"png","lastminute.com":"png","lebara.co.uk":"png","lego.com":"png","legoland.co.uk":"png","leon.co":"png","leshuttle.com":"svg","levi.com":"png","li.me":"png","libertylondon.com":"png","lidl.co.uk":"svg","lights4fun.co.uk":"svg","lilyskitchen.co.uk":"png","lindt.co.uk":"png","linkedin.com":"png","littlewoods.com":"png","lner.co.uk":"png","loaf.com":"png","loganair.co.uk":"png","londontheatredirect.com":"png","lookfantastic.com":"png","louisvuitton.com":"png","loveholidays.com":"png","lufthansa.com":"png","lululemon.com":"png","lush.com":"png","lwtheatres.co.uk":"svg","lycamobile.co.uk":"png","lyleandscott.com":"png","maccosmetics.co.uk":"png","made.com":"png","magnet.co.uk":"svg","majestic.co.uk":"png","mamasandpapas.com":"png","mandmdirect.com":"png","mango.com":"png","marksandspencer.com":"png","marriott.com":"png","massimodutti.com":"png","matalan.co.uk":"png","mcdonalds.com":"png","megabus.com":"png","menkind.co.uk":"png","meta.com":"png","microsoft.com":"png","millets.co.uk":"svg","mindfulchef.com":"png","mintvelvet.co.uk":"png","missguided.co.uk":"png","missoma.com":"png","mobiles.co.uk":"png","moltonbrown.co.uk":"svg","monicavinader.com":"png","monsoon.co.uk":"png","montane.com":"png","moonpig.com":"png","morrisons.com":"svg","moss.co.uk":"png","mothercare.com":"png","mountainwarehouse.com":"png","mrporter.com":"png","mulberry.com":"png","musicmagpie.co.uk":"png","myfitnesspal.com":"svg","myprotein.com":"png","mytheresa.com":"png","mytoggle.io":"png","myvue.com":"png","nakedwines.co.uk":"svg","nandos.co.uk":"png","nastygal.com":"png","nationalexpress.com":"svg","nationalrail.co.uk":"svg","nationaltrust.org.uk":"svg","nealsyardremedies.com":"png","neomwellbeing.com":"png","nespresso.com":"png","net-a-porter.com":"png","netflix.com":"png","newbalance.co.uk":"png","newlook.com":"png","next.co.uk":"png","nike.com":"png","ninjakitchen.co.uk":"png","nintendo.com":"png","nkuku.com":"png","nordvpn.com":"png","northernrailway.co.uk":"png","notcutts.co.uk":"png","notion.so":"png","notonthehighstreet.com":"png","nowtv.com":"png","nuffieldhealth.com":"png","o2.co.uk":"png","oakfurnitureland.co.uk":"png","oasis-stores.com":"png","ocado.com":"png","odeon.co.uk":"png","office.co.uk":"png","ohpolly.com":"png","oliverbonas.com":"png","onbuy.com":"png","onepeloton.co.uk":"png","onthebeach.co.uk":"png","openai.com":"svg","overclockers.co.uk":"svg","pactcoffee.com":"png","pandora.net":"png","papajohns.co.uk":"png","paramountplus.com":"png","patagonia.com":"png","patreon.com":"png","paybyphone.co.uk":"png","peacocks.co.uk":"svg","personalisedgiftsshop.co.uk":"png","petplanet.co.uk":"png","pets-corner.co.uk":"png","petsathome.com":"png","pharmacy2u.co.uk":"png","phase-eight.com":"png","picturehouses.com":"png","pizzaexpress.com":"svg","pizzahut.co.uk":"png","pizzapilgrims.co.uk":"png","playstation.com":"png","plusnet.com":"png","poferries.com":"png","poundland.co.uk":"png","premierinn.com":"png","prestigeflowers.co.uk":"png","pret.co.uk":"svg","prettylittlething.com":"png","prezzo.co.uk":"png","primark.com":"png","primevideo.com":"png","primrose.co.uk":"png","pullandbear.com":"png","puma.com":"png","puregym.com":"png","qatarairways.com":"png","qvcuk.com":"png","rains.com":"png","ralphlauren.co.uk":"png","reddragondarts.com":"png","redletterdays.co.uk":"svg","reebok.co.uk":"png","regatta.com":"png","reiss.com":"png","revolutionbeauty.com":"png","richersounds.com":"png","ring.com":"png","ringgo.co.uk":"png","riverford.co.uk":"png","riverisland.com":"png","robertdyas.co.uk":"png","roblox.com":"png","rohan.co.uk":"png","royalmail.com":"png","ryanair.com":"png","ryman.co.uk":"png","sainsburys.co.uk":"png","samsung.com":"png","scan.co.uk":"png","scotrail.co.uk":"png","screwfix.com":"svg","seasaltcornwall.com":"png","seetickets.com":"png","selfridges.com":"png","sephora.co.uk":"png","serenataflowers.com":"png","sevenoakssoundandvision.co.uk":"png","sharkclean.co.uk":"png","shein.com":"png","showcasecinemas.co.uk":"png","silentnight.co.uk":"png","simbasleep.com":"png","simplybe.co.uk":"png","simplycook.com":"png","sixt.co.uk":"png","size.co.uk":"png","skechers.co.uk":"png","skiddle.com":"png","sky.com":"png","skyscanner.net":"png","slugandlettuce.co.uk":"png","smarty.co.uk":"png","smythstoys.com":"png","sofology.co.uk":"png","sonos.com":"png","southernrailway.com":"png","southwesternrailway.com":"png","spacenk.com":"svg","spar.co.uk":"png","specsavers.co.uk":"png","sportsdirect.com":"png","spotify.com":"png","ssense.com":"png","starbucks.co.uk":"svg","steampowered.com":"png","stenaline.co.uk":"png","stonegatepubs.com":"png","stoneisland.com":"png","stories.com":"png","stradivarius.com":"png","strava.com":"png","stubhub.co.uk":"png","studio.co.uk":"png","superdrug.com":"png","superdry.com":"png","surfshark.com":"png","swarovski.com":"png","sweatybetty.com":"png","swooneditions.com":"png","tacobell.co.uk":"png","talktalk.co.uk":"png","tedbaker.com":"png","telegraph.co.uk":"svg","tempur.com":"svg","temu.com":"png","tesco.com":"png","tescomobile.com":"png","tfl.gov.uk":"png","tgifridays.co.uk":"png","thamesclippers.com":"svg","thameslinkrailway.com":"png","thebodyshop.com":"png","theguardian.com":"svg","thegymgroup.com":"png","theinkeylist.com":"png","thenorthface.co.uk":"png","theordinary.com":"png","theperfumeshop.com":"png","thepihut.com":"png","theproteinworks.com":"png","therange.co.uk":"png","thescentreserve.com":"png","thetimes.co.uk":"png","thetoyshop.com":"png","thewhitecompany.com":"png","theworks.co.uk":"png","thompson-morgan.com":"png","thorntons.co.uk":"png","thorpepark.com":"png","thortful.com":"png","three.co.uk":"png","ticketmaster.co.uk":"png","tidal.com":"png","timberland.co.uk":"png","tinder.com":"png","tkmaxx.com":"png","tmlewin.com":"svg","tobycarvery.co.uk":"png","todaytix.com":"png","tommy.com":"png","toolstation.com":"png","topshop.com":"svg","tortilla.co.uk":"png","trainline.com":"png","travelodge.co.uk":"png","trespass.com":"png","tui.co.uk":"png","turtlebay.co.uk":"png","twitch.tv":"png","uber.com":"png","ubereats.com":"png","ugg.com":"png","underarmour.co.uk":"png","uniqlo.com":"png","vans.co.uk":"png","vapeandgo.co.uk":"png","very.co.uk":"png","victorianplumbing.co.uk":"png","viking-direct.co.uk":"png","vinted.co.uk":"png","virginactive.co.uk":"png","virginatlantic.com":"svg","virginexperiencedays.co.uk":"png","virginmedia.com":"png","virginwines.co.uk":"png","visiondirect.co.uk":"png","vodafone.co.uk":"png","voxi.co.uk":"png","wagamama.com":"png","waitrose.com":"png","wallis.co.uk":"png","warehousefashion.com":"png","waterstones.com":"png","wayfair.co.uk":"png","webuy.com":"png","weekday.com":"png","weirdfish.co.uk":"svg","well.co.uk":"png","wexphotovideo.com":"png","whistles.com":"png","whitestuff.com":"png","whsmith.co.uk":"png","wickes.co.uk":"png","wilko.com":"png","wingstop.co.uk":"png","wizzair.com":"png","wordery.com":"png","worldofbooks.com":"svg","xbox.com":"png","yankeecandle.co.uk":"png","yosushi.com":"png","youtube.com":"png","zalando.co.uk":"svg","zara.com":"png","zavvi.com":"png","zipcar.co.uk":"png","zizzi.co.uk":"png","zooplus.co.uk":"png"};
  // Other addresses the same shops send email from (just-eat.com is Just Eat's just-eat.co.uk).
  var LOGO_ALIASES = {"adidas.com":"adidas.co.uk","airbnb.com":"airbnb.co.uk","amazon.com":"amazon.co.uk","argos.com":"argos.co.uk","asda.co.uk":"asda.com","asos.co.uk":"asos.com","ba.com":"britishairways.com","bandq.co.uk":"diy.com","bensons-for-beds.co.uk":"bensonsforbeds.co.uk","boohoo.co.uk":"boohoo.com","booking.co.uk":"booking.com","boots.co.uk":"boots.com","chatgpt.com":"openai.com","claude.ai":"anthropic.com","costa.com":"costa.co.uk","cultbeauty.com":"cultbeauty.co.uk","currys.com":"currys.co.uk","deliveroo.com":"deliveroo.co.uk","disneyplus.co.uk":"disneyplus.com","dominos.com":"dominos.co.uk","ebay.com":"ebay.co.uk","google.co.uk":"google.com","greggs.com":"greggs.co.uk","groupon.com":"groupon.co.uk","grouponmail.co.uk":"groupon.co.uk","hm.co.uk":"hm.com","holland-and-barrett.com":"hollandandbarrett.com","hollandandbarrett.co.uk":"hollandandbarrett.com","ikea.co.uk":"ikea.com","itunes.com":"apple.com","jdwetherspoon.co.uk":"jdwetherspoon.com","johnlewis.co.uk":"johnlewis.com","just-eat.com":"just-eat.co.uk","kfc.com":"kfc.co.uk","klarna.co.uk":"klarna.com","lego.co.uk":"lego.com","lululemon.co.uk":"lululemon.com","mcdonalds.co.uk":"mcdonalds.com","microsoft.co.uk":"microsoft.com","myeflorist.co.uk":"eflorist.co.uk","myvue.co.uk":"myvue.com","nakedwines.com":"nakedwines.co.uk","nandos.com":"nandos.co.uk","netflix.co.uk":"netflix.com","next.com":"next.co.uk","nike.co.uk":"nike.com","nordaccount.com":"nordvpn.com","oak-furniture-land.co.uk":"oakfurnitureland.co.uk","ocado.co.uk":"ocado.com","playstation.co.uk":"playstation.com","pret.com":"pret.co.uk","puma.co.uk":"puma.com","sainsburys.com":"sainsburys.co.uk","samsung.co.uk":"samsung.com","sharkninja.com":"ninjakitchen.co.uk","spotify.co.uk":"spotify.com","starbucks.com":"starbucks.co.uk","superdrug.co.uk":"superdrug.com","tempur.co.uk":"tempur.com","tesco.co.uk":"tesco.com","thetrainline.com":"trainline.com","ticketmaster.com":"ticketmaster.co.uk","tkmaxx.co.uk":"tkmaxx.com","trainline.co.uk":"trainline.com","uber.co.uk":"uber.com","uniqlo.co.uk":"uniqlo.com","waitrose.co.uk":"waitrose.com","zara.co.uk":"zara.com"};
  var MEMO_MS = 5 * 60 * 1000;
  function memoFresh(e) { return e && Date.now() - e.at < MEMO_MS; }
  function memoReset() { memo = { blobs: {}, consent: null, gmail: null, receipts: null, openCat: null, openIds: {} }; try { localStorage.removeItem("relay.cache.v1"); } catch (e) {} }
  // The last receipts and shop orders are also kept on this device (for the signed-in account only, removed on sign-out),
  // so opening Relay shows them at once instead of a loading screen, then updates them.
  var DISK_KEY = "relay.cache.v1";
  function diskRead() { try { var c = JSON.parse(localStorage.getItem(DISK_KEY) || "null"), s = load(); return c && s && c.email && c.email === s.email ? c : null; } catch (e) { return null; } }
  function diskWrite(kind, value) {
    try { var s = load(); if (!s || !s.email) return; var c = diskRead() || { email: s.email }; c[kind] = value; c.at = Date.now();
      var t = JSON.stringify(c); if (t.length < 2500000) localStorage.setItem(DISK_KEY, t); else localStorage.removeItem(DISK_KEY); } catch (e) {}
  }
  (function () {
    var c = diskRead(); if (!c) return;
    if (Array.isArray(c.receipts)) memo.receipts = { rows: c.receipts, sig: JSON.stringify(c.receipts), at: 0 };
    if (Array.isArray(c.purchases)) memo.walletPurchases = c.purchases;
  })();
  // Asks the server only when the answer isn't already remembered (and recent enough).
  function cachedGet(kind, path) {
    if (memoFresh(memo[kind])) return Promise.resolve(memo[kind].r);
    return api(path).then(function (r) { if (r.ok) { memo[kind] = { at: Date.now(), r: r }; if (kind === "gmail") rememberMailbox(r.body); } return r; });
  }
  // Which inbox Relay reads for this shopper (Gmail or Outlook), remembered on the device so every screen names the right one.
  var MAILBOX_KEY = "relay.mailbox";
  function rememberMailbox(g) {
    try { if (g && g.connected) localStorage.setItem(MAILBOX_KEY, g.provider === "microsoft" ? "outlook" : "gmail"); else if (g) localStorage.removeItem(MAILBOX_KEY); } catch (e) {}
  }
  function mailName() { try { return localStorage.getItem(MAILBOX_KEY) === "outlook" ? "Outlook" : "Gmail"; } catch (e) { return "Gmail"; } }
  function mailOwner() { return mailName() === "Outlook" ? "Microsoft" : "Google"; }
  // An email Relay can open again: its id in Gmail or in Outlook.
  function mailRef(x) { return x && (/^[A-Za-z0-9]{6,40}$/.test(x.gmailId || "") || /^[A-Za-z0-9_=+\/-]{16,512}$/.test(x.outlookId || "")); }
  function save(v) { reads = {}; var was = load(); if (!v || (was && was.email !== v.email)) { memoReset(); try { localStorage.removeItem("relay.cache.v1"); } catch (e) {} } if (!v) { try { localStorage.removeItem(MAILBOX_KEY); localStorage.removeItem(PROFILE_KEY); localStorage.removeItem("relay.drafts.v1"); localStorage.removeItem("relay.pending-watches.v1"); } catch (e) {} } try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) {} if (!v) paintAvatars();
    if (((was && was.token) || null) !== ((v && v.token) || null)) { try { window.dispatchEvent(new Event("relay:session")); } catch (e) {} } }
  // Reads are shared and briefly remembered: two parts of a screen asking for the same thing make one request, and going
  // back to a tab within a minute reuses what was just loaded instead of asking Relay again. Any change (a POST) forgets
  // them all, so nothing out of date shows after an edit. fresh: true asks Relay regardless.
  var READ_REUSE_MS = 60 * 1000, reads = {};
  // Relay answers from the nearest copy of its database and hands back a bookmark with each answer. Sending the newest one
  // back means no answer is ever older than one already seen, so a change just made always shows. It's only sent once
  // Relay has given one (a server that doesn't give them wouldn't expect it).
  // Kept on the device too, so reopening the app straight after signing in can't land on a copy that hasn't caught up.
  var BOOKMARK_KEY = "relay.bookmark.v1", bookmark = null;
  try { bookmark = localStorage.getItem(BOOKMARK_KEY) || null; if (bookmark && !/^[0-9A-Za-z._:-]{8,160}$/.test(bookmark)) bookmark = null; } catch (e) {}
  function api(path, opts) {
    opts = opts || {};
    var method = opts.method || "GET", s = load(), headers = {};
    // Reads carry no body, so they don't say it's JSON (one less reason for the browser to ask first).
    if (method !== "GET") { headers["Content-Type"] = "application/json"; reads = {}; }
    if (s && s.token) headers.Authorization = "Bearer " + s.token;
    if (bookmark) headers["X-D1-Bookmark"] = bookmark;
    var key = method === "GET" ? (s && s.token ? s.token.slice(-10) : "-") + " " + path : null, hit = key && reads[key];
    if (hit && !opts.fresh && (hit.waiting || Date.now() - hit.at < READ_REUSE_MS)) return hit.answer.then(copyAnswer);
    inflight++;
    var answer = fetch(API + path, { method: method, headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        var b = r.headers && r.headers.get && r.headers.get("x-d1-bookmark");
        if (b && /^[0-9A-Za-z._:-]{8,160}$/.test(b) && (!bookmark || b > bookmark)) { bookmark = b; try { localStorage.setItem(BOOKMARK_KEY, b); } catch (e) {} }
        return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t }; }, function () { return { ok: r.ok, status: r.status, text: "" }; });
      });
    answer.then(settled, settled);
    answer.then(function (r) { if (r.status === 403 && /"second_step_needed"/.test(r.text || "")) needSecondStep(); }, function () {});
    if (key) {
      var entry = { answer: answer, waiting: true, at: 0 };
      reads[key] = entry;
      answer.then(function (r) { entry.waiting = false; entry.at = Date.now(); if (!r.ok && reads[key] === entry) delete reads[key]; },
        function () { if (reads[key] === entry) delete reads[key]; });
    }
    return answer.then(copyAnswer);
  }
  // How many requests are on their way, so pull to refresh knows when the screen has its new copy.
  var inflight = 0, idleWaiters = [];
  function settled() { inflight = Math.max(0, inflight - 1); if (!inflight) setTimeout(function () { if (inflight) return; var w = idleWaiters; idleWaiters = []; w.forEach(function (f) { f(); }); }, 60); }
  // Resolves once nothing has been on its way for a moment (screens ask in a chain), or after max ms.
  function whenIdle(max) {
    return new Promise(function (done) {
      var finished = false, finish = function () { if (!finished) { finished = true; done(); } };
      setTimeout(finish, max || 8000);
      setTimeout(function () { if (!inflight) finish(); else idleWaiters.push(finish); }, 150);
    });
  }
  // Pull to refresh: everything is asked for again. What's on screen (and the copy kept on this device) stays until the
  // new answer arrives, so nothing goes blank.
  function forget() { reads = {}; Object.keys(memo).forEach(function (k) { var e = memo[k]; if (e && typeof e === "object" && typeof e.at === "number") e.at = 0; }); }
  // On Receipts, pulling down also checks the inbox now, as "Check now" does.
  function checkInbox() { if (window.__relayCheckNow && document.querySelector("#receiptsPage")) window.__relayCheckNow(); }
  // Each caller gets its own copy, so one screen changing what it was given can't change another's.
  function copyAnswer(r) { var j = {}; try { j = r.text ? JSON.parse(r.text) : {}; } catch (e) { j = {}; } return { ok: r.ok, status: r.status, body: j }; }
  // Fetches a signed-in image and returns a local address for it (or null).
  function apiBlob(path) {
    // Pictures and logos are fetched once per visit, not every time a list is redrawn.
    if (!memo.blobs[path]) memo.blobs[path] = apiBlobFetch(path).then(function (u) { if (!u) delete memo.blobs[path]; return u; });
    return memo.blobs[path];
  }
  function apiBlobFetch(path) {
    var s = load(), headers = {};
    if (s && s.token) headers.Authorization = "Bearer " + s.token;
    return fetch(API + path, { headers: headers }).then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (b) { return b && /^image\//.test(b.type) ? URL.createObjectURL(b) : null; }).catch(function () { return null; });
  }
  function deadlineOf(x) {
    // A food order can still hold something that goes back on its own (a kettle in the weekly shop): its date counts too.
    var open = x.returnable !== false || Boolean(x.returnableItems && x.returnableItems.length);
    var by = open && x.returnBy && x.returnBy.date;
    // A date Relay worked out itself (counted from the order date) says nothing for sure once it has passed.
    if (by && x.returnBy.estimate && by < new Date().toISOString().slice(0, 10)) by = null;
    return (x.returnPlan && x.returnPlan.deadline) || (x.kind === "return_instructions" && x.deadline) || (x.returns && x.returns.deadline) || by || null;
  }
  // A return date the shop itself gave: a date in its email, or its window counted from the day the parcel arrived. Only
  // these are shown as deadlines (a countdown, "10 days left", the strip above the tab bar, a card's bar). A date Relay
  // works out when the email says nothing (UK law's 14 days, or a window counted from the order date) is the least the
  // shopper can count on, not the shop's deadline, so it is never shown as one: deadlineOf() keeps using it only to know
  // what can still surely go back.
  function statedDeadline(x) {
    var dl = deadlineOf(x);
    var by = dl && x.returnBy && x.returnBy.date === dl ? x.returnBy : null;
    return by && (by.estimate || by.basis === "uk_law") ? null : dl;
  }
  // The shop's own logo in a picture box, when there's no photo of the item: one Relay keeps for well-known shops, or
  // the one Relay fetched once from the shop's website. The box keeps its initials until a logo has loaded.
  // onMiss runs when the shop has no logo Relay can show (no address, none found, or the picture won't load).
  function shopLogo(box, dom, px, onMiss) {
    var miss = function () { if (onMiss) onMiss(); };
    if (!box || !dom || !/^[A-Za-z0-9.-]{3,80}$/.test(dom)) return miss();
    var put = function (src) {
      var pic = el("img", { alt: "", className: "rl-logo-img", style: "width:" + px + "px;height:" + px + "px;object-fit:contain" });
      pic.onload = function () { box.textContent = ""; box.classList.add("rl-has-logo"); box.appendChild(pic); };
      pic.onerror = miss;
      pic.src = src;
    };
    var match = function (k) { return dom === k || dom.slice(-(k.length + 1)) === "." + k; };
    var alias = Object.keys(LOGO_ALIASES).filter(match)[0];
    var known = alias ? LOGO_ALIASES[alias] : Object.keys(STORE_LOGOS).filter(match)[0];
    if (known && STORE_LOGOS[known]) return put("logos/" + known + "." + STORE_LOGOS[known]);
    apiBlob("/relay/my/logo/" + encodeURIComponent(dom)).then(function (u) { if (u) put(u); else miss(); });
  }
  // ---- Drawings for receipts with no photo and no logo ----
  // A small line drawing of what was most likely bought, picked from the item's name, then the shop's name, then the kind of
  // shop. It draws itself in, does one small move (steam rises, a phone buzzes, a plane glides), then stays still.
  // Parts with class "m" make the move; "f" parts are softly filled.
  var ILL = {
    cup: '<path d="M5 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5Z"/><path d="M16 11.5h1.5a2.2 2.2 0 0 1 0 4.4H16"/><path class="m" d="M8.5 3.5c-.6.8-.6 1.7 0 2.5M12.5 3.5c-.6.8-.6 1.7 0 2.5"/>',
    pint: '<path class="f" d="M6.5 6.5h10l-1.2 14H7.7Z"/><path d="M16.5 9h1.7a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1.9"/><path d="M6.5 6.5c0-1.6 1.2-2.6 2.6-2.6.6-.8 1.5-1.2 2.4-1.2s1.8.4 2.4 1.2c1.4 0 2.6 1 2.6 2.6"/><path class="m" d="M10 15v.01M12.5 12.5v.01M11 10v.01"/>',
    wine: '<path class="f" d="M8 3h8l-.4 5a3.6 3.6 0 0 1-7.2 0Z"/><path d="M12 11.6V19"/><path d="M8.5 20.5h7"/><path class="m" d="M8.6 6.5h6.8"/>',
    pizza: '<path class="f" d="M12 21 3.6 6.2a15 15 0 0 1 16.8 0Z"/><path d="M5 8.8a12 12 0 0 1 14 0"/><circle class="m" cx="10" cy="11.5" r="1.2"/><circle class="m" cx="14" cy="11" r="1.1"/><circle class="m" cx="12" cy="15.2" r="1.1"/>',
    burger: '<path class="f" d="M4 11a8 6 0 0 1 16 0Z"/><path d="M3.5 14c1.4 1.2 2.6-1 4.1 0s2.7-1 4.4 0 2.7-1 4.3 0 2.5-1 4.2 0"/><path d="M5 17h14v.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 17.5Z"/><path class="m" d="M9 8v.01M12 7v.01M15 8v.01"/>',
    bowl: '<path class="f" d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z"/><path class="m" d="M14 3.2 10.4 10M18.4 4 13 10.4"/>',
    cake: '<path class="f" d="M6.2 12h11.6l-1.5 8.5H7.7Z"/><path d="M5.5 12a6.5 5 0 0 1 13 0"/><path d="M9.5 12.5l.6 7.5M14.5 12.5l-.6 7.5"/><circle class="m" cx="12" cy="5" r="1.2"/>',
    basket: '<path class="f" d="M3.5 9.5h17l-1.8 9.6a1.5 1.5 0 0 1-1.5 1.2H6.8a1.5 1.5 0 0 1-1.5-1.2Z"/><path d="M8 9.5 11 4M16 9.5 13 4"/><path d="M9 13v4M12 13v4M15 13v4"/><circle class="m" cx="12" cy="6.5" r="1.4"/>',
    delivery: '<path class="f" d="M7 8h12l-1 12H8Z"/><path d="M10 8V6.5a3 3 0 0 1 6 0V8"/><path class="m" d="M2.5 12h3M3 15.5h2.5M2 19h3"/>',
    shaker: '<path class="f" d="M8 8h8l-1 12.5H9Z"/><path d="M7.5 5h9v3h-9Z"/><path d="M10 3.5h4V5h-4Z"/><path class="m" d="M10 13h4M10.4 16h3.2"/>',
    shoe: '<path class="f" d="M3 17.5V11.6l4.4-1.9 2.6 3.1 6.2 1.5c2.5.6 4.3 1.8 4.8 3.2Z"/><path d="M3 17.5h18M3 20h18"/><path class="m" d="M10.6 12.6l1-1.5M13.1 13.3l1-1.4"/>',
    jacket: '<path class="f" d="M8 4 4.5 6.5 3 19h4.5l1-7.5M16 4l3.5 2.5L21 19h-4.5l-1-7.5"/><path d="M8 4l4 4 4-4M8.5 11.5V20h7v-8.5"/><path class="m" d="M12 8v12"/>',
    dress: '<path d="M9.5 3v3.5M14.5 3v3.5"/><path class="f" d="M9.5 6.5h5l-1 3.5h-3Z"/><path class="f m" d="M10.5 10h3l4 10.5h-11Z"/>',
    trousers: '<path class="f" d="M7 3h10l1.5 18H14l-2-10.5L10 21H5.5Z"/><path class="m" d="M7.2 6.2h9.6"/>',
    tshirt: '<path class="f" d="M9 3.5 4 5.8 2.5 10l3.2 1.3L7 10v10.5h10V10l1.3 1.3 3.2-1.3L20 5.8 15 3.5c-.4 1.5-1.6 2.5-3 2.5s-2.6-1-3-2.5Z"/><path class="m" d="M10 13h4"/>',
    gem: '<path class="f" d="M7 4h10l4 5-9 11L3 9Z"/><path d="M3 9h18M9.5 4 8 9l4 11 4-11-1.5-5"/><path class="m" d="M19.5 1.5v3M18 3h3"/>',
    bag: '<path class="f" d="M5 9h14l-1.2 11H6.2Z"/><path class="m" d="M9 9V7a3 3 0 0 1 6 0v2"/>',
    phone: '<rect class="f" x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 18.5h3"/><path class="m" d="M3.5 9.5a8 8 0 0 0 0 5M20.5 9.5a8 8 0 0 1 0 5"/>',
    laptop: '<rect class="f" x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 18.5h18"/><path class="m" d="M8.5 10h4"/>',
    headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect class="f" x="3" y="14" width="4" height="6.5" rx="1.5"/><rect class="f" x="17" y="14" width="4" height="6.5" rx="1.5"/><path class="m" d="M12 9.5v4.2a1.4 1.4 0 1 1-1.4-1.4H12"/>',
    gamepad: '<path class="f" d="M7 8h10a4 4 0 0 1 4 4.5l-.6 4a2.5 2.5 0 0 1-4.3 1.3L14.5 16h-5l-1.6 1.8A2.5 2.5 0 0 1 3.6 16.5l-.6-4A4 4 0 0 1 7 8Z"/><path d="M8 11v3M6.5 12.5h3"/><circle class="m" cx="15.5" cy="11.5" r=".8"/><circle class="m" cx="17" cy="13.5" r=".8"/>',
    plug: '<path d="M9 3v4M15 3v4"/><path class="f" d="M7 7h10v4a5 5 0 0 1-10 0Z"/><path class="m" d="M12 16v5"/>',
    sofa: '<path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path class="f" d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v4.5H3Z"/><path class="m" d="M5 17.5V20M19 17.5V20"/>',
    bed: '<path d="M3 19V6.5M3 13.5h18V19"/><path class="f" d="M3 13.5V11a2 2 0 0 1 2-2h4.5a2 2 0 0 1 2 2v2.5"/><path class="m" d="M15 5.5h3l-3 3h3"/>',
    lamp: '<path class="f" d="M8 3h8l2.5 7h-13Z"/><path d="M12 10v8.5M8.5 20.5h7"/><path class="m" d="M7 13.5 5 15.5M17 13.5l2 2"/>',
    candle: '<rect class="f" x="8.5" y="10" width="7" height="11" rx="1.2"/><path d="M12 8.5V10"/><path class="m" d="M12 2c2.2 2.4 2.2 4.8 0 6.6-2.2-1.8-2.2-4.2 0-6.6Z"/>',
    flower: '<path d="M12 14.2V21"/><path class="f" d="M12 18c-2.2-.2-3.8-1.4-4.4-3.3 2.2.1 3.8 1.3 4.4 3.3Z"/><circle cx="12" cy="4.4" r="2.6"/><circle cx="15.6" cy="8" r="2.6"/><circle cx="12" cy="11.6" r="2.6"/><circle cx="8.4" cy="8" r="2.6"/><circle class="f m" cx="12" cy="8" r="1.4"/>',
    pan: '<path class="f" d="M4 10.5h12v7A2.5 2.5 0 0 1 13.5 20h-7A2.5 2.5 0 0 1 4 17.5Z"/><path d="M16 12.5h4.5M3 10.5h14M10 8.5v2"/><path class="m" d="M7.5 3.5c-.6.8-.6 1.7 0 2.5M12.5 3.5c-.6.8-.6 1.7 0 2.5"/>',
    wrench: '<path class="f m" d="M15 3.5a4.5 4.5 0 0 0-4.2 6.1L4 16.4a1.9 1.9 0 0 0 2.7 2.7l6.8-6.8A4.5 4.5 0 0 0 19.6 8l-2.8 2.8-2.6-.6-.6-2.6L16.4 4.8A4.5 4.5 0 0 0 15 3.5Z"/>',
    perfume: '<path class="f" d="M7 10h10v9.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19.5Z"/><path d="M10 7h4v3h-4ZM10.5 4h3v3h-3Z"/><path class="m" d="M16 4.5h2.5M16.5 2.2l2-1.2M16.5 6.8l2 1.2"/>',
    lipstick: '<path class="f" d="M8.5 12h7v9h-7Z"/><path class="m" d="M9.5 12V7.5l5-3.2V12"/>',
    jar: '<path d="M6 5.5h12v3.5H6Z"/><path class="f" d="M5 9h14v9.5A2.5 2.5 0 0 1 16.5 21h-9A2.5 2.5 0 0 1 5 18.5Z"/><path class="m" d="M9 14.5h6"/>',
    pill: '<path class="f m" d="M10.5 4.5a4.95 4.95 0 0 1 7 7l-6 6a4.95 4.95 0 0 1-7-7Z"/><path d="M7.5 9.5l7 7"/>',
    train: '<rect class="f" x="6" y="3" width="12" height="14" rx="3"/><path d="M6 9.5h12"/><circle cx="9" cy="13.5" r=".9"/><circle cx="15" cy="13.5" r=".9"/><path class="m" d="M8.5 17 6.5 21M15.5 17l2 4"/>',
    plane: '<path class="f m" d="M21.5 3 2.5 10.5l7 3 3 7Z"/><path d="M9.5 13.5 21.5 3"/>',
    car: '<path class="f" d="M3.5 16v-3.5l2-5A2 2 0 0 1 7.4 6h9.2a2 2 0 0 1 1.9 1.5l2 5V16Z"/><path d="M3.5 12.5h17"/><circle class="m" cx="7.5" cy="16.5" r="1.8"/><circle class="m" cx="16.5" cy="16.5" r="1.8"/>',
    key: '<circle class="f" cx="8" cy="15" r="4"/><path class="m" d="M11 12l8.5-8.5M16 7l2 2M18.2 4.8l2 2"/>',
    suitcase: '<rect class="f" x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5v-2A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5v2"/><path class="m" d="M3.5 12.5h17"/>',
    app: '<rect class="f" x="3.5" y="3.5" width="17" height="17" rx="5"/><path class="m" d="M10 8.8l5.2 3.2-5.2 3.2Z"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle class="f" cx="6.5" cy="18" r="2.5"/><circle class="f m" cx="17.5" cy="16" r="2.5"/>',
    cloud: '<path class="f m" d="M7 18.5a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5 3.75 3.75 0 0 1 0 7.5Z"/>',
    newspaper: '<path class="f" d="M4 5h13v14.5A1.5 1.5 0 0 0 18.5 21H6a2 2 0 0 1-2-2Z"/><path d="M17 9h3v10.5a1.5 1.5 0 0 1-3 0"/><path class="m" d="M7 9h7M7 12.5h7M7 16h4"/>',
    ticket: '<path class="f m" d="M3.5 7.5h17V10a2 2 0 0 0 0 4v2.5h-17V14a2 2 0 0 0 0-4Z"/><path d="M15 7.5v9"/>',
    gift: '<path class="f" d="M4 10h16v10.5H4Z"/><path d="M3 7h18v3H3ZM12 7v13.5"/><path class="m" d="M12 7c-1.5-3-5-3-4.5-.5.4 1.5 4.5.5 4.5.5Zm0 0c1.5-3 5-3 4.5-.5-.4 1.5-4.5.5-4.5.5Z"/>',
    target: '<circle class="f" cx="11" cy="13" r="8"/><circle cx="11" cy="13" r="4.5"/><circle cx="11" cy="13" r="1.3"/><path class="m" d="M11 13l8-8M17 4.5h2.5V7"/>',
    book: '<path class="f" d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5Z"/><path class="m" d="M13 4h5.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H13Z"/>',
    paw: '<path class="f" d="M7.5 16.5c0-2.4 2-4.2 4.5-4.2s4.5 1.8 4.5 4.2c0 1.9-1.7 3-4.5 3s-4.5-1.1-4.5-3Z"/><circle class="m" cx="6.2" cy="11" r="1.6"/><circle class="m" cx="9.4" cy="7" r="1.6"/><circle class="m" cx="14.6" cy="7" r="1.6"/><circle class="m" cx="17.8" cy="11" r="1.6"/>',
    dice: '<rect class="f m" x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r=".9"/><circle cx="12" cy="12" r=".9"/><circle cx="15.5" cy="15.5" r=".9"/>',
    parcel: '<path class="f m" d="M3.5 8 12 4l8.5 4v8.5L12 20.5l-8.5-4Z"/><path d="M3.5 8 12 12l8.5-4M12 12v8.5"/>',
    shop: '<path class="f" d="M5 8h14l-1.2 12.5H6.2Z"/><path class="m" d="M9 10V7a3 3 0 0 1 6 0v3"/>'
  };
  // What a receipt's words most likely mean, in order: the first rule that matches the item names, else the shop's name.
  var ILL_RULES = [
    ["shoe", /\b(trainers?|sneakers?|runners?|shoes?|boots?|sandals?|loafers?|heels|sliders?|slippers?|cleats?)\b/i],
    ["jacket", /\b(jackets?|coats?|parkas?|puffer|gilets?|raincoats?|blazers?|anorak|fleece)\b/i],
    ["dress", /\b(dress(es)?|skirts?|jumpsuits?|playsuits?)\b/i],
    ["trousers", /\b(trousers|jeans|leggings|pants?|joggers|shorts|chinos|tights)\b/i],
    ["gem", /\b(rings?|necklaces?|bracelets?|earrings?|pendants?|jewell?ery|chains?|swarovski|goldsmiths|pandora|missoma|tiffany|beaverbrooks)\b/i],
    ["bag", /\b(handbags?|backpacks?|rucksacks?|totes?|purses?|wallets?|crossbody)\b/i],
    ["tshirt", /\b(t-?shirts?|tees?|tops?|shirts?|hoodies?|jumpers?|sweaters?|sweatshirts?|knitwear|cardigans?|vests?|polos?|bras?|socks|underwear|swimwear|bikini)\b/i],
    ["phone", /\b(iphone|smartphone|mobile phone|galaxy s\d|pixel \d|sim only|sim card|top-?up|airtime|lycamobile|giffgaff|voxi|vodafone)\b/i],
    ["headphones", /\b(headphones?|earbuds?|earphones?|airpods|speakers?|soundbar|jbl|bose|sonos|beats)\b/i],
    ["gamepad", /\b(playstation|ps5|xbox|nintendo|switch oled|controller|console|steam|coins|gems|diamonds|v-?bucks|robux|match masters|royal match|candy crush|game pass|in-app)\b/i],
    ["laptop", /\b(laptop|macbook|chromebook|computer|monitor|keyboard|mouse|ipad|tablet|kindle paperwhite)\b/i],
    ["plug", /\b(chargers?|cables?|adapters?|plugs?|batter(y|ies)|power bank|usb|hdmi|smart ?watch|apple watch|fitbit)\b/i],
    ["bed", /\b(beds?|mattress(es)?|duvets?|pillows?|bedding|sheets|tempur|bensons|dreams)\b/i],
    ["sofa", /\b(sofas?|armchairs?|chairs?|bean ?bags?|beanbags|stools?|tables?|furniture|dfs|sofology)\b/i],
    ["lamp", /\b(lamps?|lights?|lighting|bulbs?|lanterns?)\b/i],
    ["candle", /\b(candles?|diffusers?|wax melts?|reed diffuser|yankee|neom)\b/i],
    ["flower", /\b(flowers?|bouquets?|roses?|florist|plants?|seeds|garden|eflorist|interflora|bloom)\b/i],
    ["pan", /\b(pans?|pots?|cookware|kettles?|toasters?|air fryer|blenders?|ninja|knives|kitchen|mugs?|plates|bowls|cutlery|towels?|nespresso machine)\b/i],
    ["wrench", /\b(drills?|screws?|tools?|paint|wickes|screwfix|toolstation|b&q|bandq|diy)\b/i],
    ["cup", /\b(coffee|latte|cappuccino|espresso|americano|flat white|mocha|tea|chai|hot chocolate|nespresso|pods?|capsules?|costa|starbucks|caffe nero|pret)\b/i],
    ["pint", /\b(beers?|lagers?|pints?|ales?|ipa|stout|guinness|ciders?|pub|tavern|wetherspoons?|greene king|stonegate|brewdog|brewery)\b/i],
    ["wine", /\b(wines?|prosecco|champagne|gin|vodka|rum|whisk(e)?y|tequila|cocktails?|spirits|naked wines|majestic)\b/i],
    ["pizza", /\b(pizzas?|pizzeria|domino'?s|dominos|papa john'?s|pizza hut|franco manca|calzone|margherita|pepperoni)\b/i],
    ["burger", /\b(burgers?|mcdonald'?s|mcdonalds|five guys|burger king|kfc|chicken|nuggets?|fries|wings|wraps?|kebab|hot dog|grill|bbq|joint)\b/i],
    ["bowl", /\b(noodles?|ramen|sushi|curry|wok|thai|chinese|indian|biryani|dumplings?|rice|pho|poke|bowl|katsu|wagamama|itsu|wasabi|panda|tortilla|burrito|tacos?|salad|soup)\b/i],
    ["cake", /\b(cakes?|cupcakes?|doughnuts?|donuts?|muffins?|cookies?|brownies?|croissants?|pastr(y|ies)|bakery|greggs|sausage rolls?|bagels?|sandwich(es)?|baguettes?|sweets|krispy kreme)\b/i],
    ["basket", /\b(sainsbury'?s|sainsburys|tesco|asda|morrisons|waitrose|ocado|aldi|lidl|co-?op|iceland|supermarket|groceries|grocer|bananas?|milk|eggs|bread)\b/i],
    ["delivery", /\b(just eat|deliveroo|uber eats|takeaway|delivery fee)\b/i],
    ["shaker", /\b(protein|whey|creatine|myprotein|supplements?|vitamins?|shaker|bulk|pre-?workout)\b/i],
    ["perfume", /\b(perfume|fragrances?|eau de|parfum|cologne|aftershave|scent)\b/i],
    ["lipstick", /\b(lipsticks?|lip ?gloss|mascara|eyeliner|make-?up|foundation|concealer|blush|bronzer|nail polish)\b/i],
    ["jar", /\b(serums?|moisturi[sz]ers?|cleansers?|creams?|spf|sun ?screen|skin ?care|shampoo|conditioner|body wash|razors?|grooming|beard|lumin|gruum|grüum)\b/i],
    ["pill", /\b(pharmacy|chemist|paracetamol|ibuprofen|plasters|prescription|medicine|boots|superdrug)\b/i],
    ["train", /\b(train|rail|railcard|lner|trainline|avanti|gwr|southeastern|thameslink|scotrail|eurostar|tfl|oyster|return ticket)\b/i],
    ["plane", /\b(flights?|airlines?|airways|ryanair|easyjet|jet2|wizz|airport|boarding)\b/i],
    ["car", /\b(uber|bolt|taxi|cabs?|ride|car hire|parking|ringgo|justpark|petrol|fuel|addison lee|zipcar)\b/i],
    ["key", /\b(hotels?|premier inn|travelodge|airbnb|booking\.com|hostels?)\b/i],
    ["music", /\b(spotify|apple music|music|songs?|albums?|tidal|deezer|audible|audiobooks?)\b/i],
    ["app", /\b(netflix|disney|prime video|youtube|now tv|britbox|dazn|stream(ing)?|tv licen[cs]e|subscription|membership|apple)\b/i],
    ["cloud", /\b(icloud|cloud|storage|vpn|nordvpn|software|anthropic|openai|chatgpt|claude|eleven ?labs|elevenlabs|ai|google one|dropbox|microsoft 365)\b/i],
    ["newspaper", /\b(news|newspapers?|magazines?|edition|guardian|telegraph|economist|champion)\b/i],
    ["ticket", /\b(tickets?|theatre|concert|gigs?|events?|eventim|ticketmaster|todaytix|cinema|odeon|cineworld|vue|experiences?|buyagift|virgin experience|days? out)\b/i],
    ["gift", /\b(gifts?|presents?|personalised|hampers?|gift cards?|e-?gift)\b/i],
    ["target", /\b(darts?|golf|tennis|football|gym|fitness|yoga|bikes?|cycling|sports?)\b/i],
    ["book", /\b(books?|novels?|waterstones|kindle|paperback|hardback)\b/i],
    ["paw", /\b(pets?|dogs?|cats?|puppy|kitten|pets at home|zooplus|treats)\b/i],
    ["dice", /\b(casino|bet|betting|bingo|lottery|lotto|slots|poker)\b/i],
    ["parcel", /\b(royal mail|parcels?|postage|stamps|evri|dpd|inpost)\b/i]
  ];
  var KIND_ILL = { food: "bowl", fashion: "tshirt", electronics: "plug", home: "sofa", beauty: "jar", travel: "suitcase", digital: "app", experiences: "ticket", other: "shop" };
  function illKey(x) {
    var items = (x.items || []).map(function (i) { return i && i.name; }).filter(Boolean).join(" · ");
    var shop = [x.retailer && x.retailer.name, x.retailer && x.retailer.legalName].filter(Boolean).join(" · ");
    for (var t = 0, texts = [items, shop]; t < texts.length; t++) {
      if (!texts[t]) continue;
      for (var i = 0; i < ILL_RULES.length; i++) if (ILL_RULES[i][1].test(texts[t])) return ILL_RULES[i][0];
    }
    return KIND_ILL[x.category] || "shop";
  }
  // Draws the picture into a picture box (in the colours of the receipt's group).
  function illustrate(box, x, px, only) {
    var key = only && ILL[only] ? only : illKey(x), c = CAT_ICONS[x.category] || CAT_ICONS.other;
    box.textContent = ""; box.classList.add("rl-ill", "ill-" + key); box.setAttribute("data-ill", key);
    box.style.background = c[0]; box.style.color = c[1];
    box.innerHTML = '<svg viewBox="0 0 24 24" width="' + (px || 28) + '" height="' + (px || 28) + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      ILL[key].replace(/<(path|rect|circle)\b/g, '<$1 pathLength="1"') + "</svg>";
  }
  // The kind of shopping a thing belongs to, from its drawing: used by Discover to sort products into kinds.
  var ILL_KIND = { shoe: "fashion", jacket: "fashion", dress: "fashion", trousers: "fashion", tshirt: "fashion", gem: "fashion", bag: "fashion",
    phone: "electronics", headphones: "electronics", gamepad: "electronics", laptop: "electronics", plug: "electronics",
    bed: "home", sofa: "home", lamp: "home", candle: "home", flower: "home", pan: "home", wrench: "home", paw: "pets",
    perfume: "beauty", lipstick: "beauty", jar: "beauty", pill: "beauty", shaker: "beauty",
    cup: "food", pint: "food", wine: "food", pizza: "food", burger: "food", bowl: "food", cake: "food", basket: "food", delivery: "food" };
  // A drawing as markup, for pages built as text (Discover). Same drawings, colours and movement as on receipts.
  function drawingHtml(key, category, px) {
    var c = CAT_ICONS[category] || CAT_ICONS.other;
    if (!ILL[key]) key = "shop";
    return '<span class="rl-ill ill-' + key + '" data-ill="' + key + '" aria-hidden="true" style="background:' + c[0] + ";color:" + c[1] + '"><svg viewBox="0 0 24 24" width="' + (px || 48) + '" height="' + (px || 48) +
      '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false">' + ILL[key].replace(/<(path|rect|circle)\b/g, '<$1 pathLength="1"') + "</svg></span>";
  }
  // What the shopper spent this year by kind of shopping (the same figures as Wrapped), for Discover's picks.
  function spendProfile() {
    var s = load();
    if (!s || !s.token) return Promise.resolve(null);
    var year = new Date().getFullYear();
    return cachedGet("wrapped" + year, "/relay/my/wrapped?year=" + year).then(function (r) {
      if (!r.ok || !r.body || !r.body.receipts) return null;
      var w = r.body, total = (w.industries || []).reduce(function (n, k) { return n + (k.spentPence || 0); }, 0);
      return { year: year, total: total,
        kinds: (w.industries || []).filter(function (k) { return k.spentPence > 0; }).map(function (k) { return { category: k.category, label: k.label, spentPence: k.spentPence, share: total ? k.spentPence / total : 0 }; }),
        shops: (w.topShops || []).map(function (t) { return t.name; }) };
    }, function () { return null; });
  }
  // Where the shop's logo comes from (the server says; older saved lists only have the shop's address).
  function logoDom(x) { var r = (x && x.retailer) || {}; return r.logoDomain !== undefined ? r.logoDomain : r.domain; }
  // A receipt's picture: the item's own photo when Relay checked it's of the item, else the shop's logo, else a drawing.
  function receiptPic(box, x, px, logoPx) {
    var draw = function () { illustrate(box, x, px); };
    var logo = function () { shopLogo(box, logoDom(x), logoPx || 32, draw); };
    var named = (x.items || []).filter(function (i) { return i && i.name; });
    if (named.length <= 1 && x.hasImage && x.id) apiBlob("/relay/my/receipts/" + x.id + "/image").then(function (u) {
      if (!u) return logo();
      box.textContent = ""; box.classList.add("rl-has-photo"); box.appendChild(el("img", { src: u, alt: "" }));
    });
    else logo();
  }
  // Delivery companies send "on its way" emails of their own: they aren't the shop you bought from.
  var CARRIER_DOMAIN = /(^|\.)(royalmail\.(com|co\.uk)|parcelforce\.(com|co\.uk)|evri\.com|hermes(world|-europe)?\.(com|co\.uk)|myhermes\.co\.uk|dpd(local)?\.co\.uk|dpd\.com|yodel\.co\.uk|dhl\.(com|co\.uk)|ups\.com|fedex\.com|inpost\.co\.uk|tnt\.com|ukmail\.com|apc-overnight\.com)$/i;
  function isCarrier(x) { return CARRIER_DOMAIN.test(String((x && x.retailer && x.retailer.domain) || "")); }
  // "On its way" only while that's still likely: three weeks after the order (or the last delivery date). After that an
  // old "shipped" email says nothing about now, so it isn't shown and doesn't keep an order in the wallet.
  function freshDelivery(x) {
    var dv = x && x.delivery; if (!dv || !dv.status || dv.status === "delivered") return false;
    var ref = dv.at || x.orderDate; if (!ref || !/^\d{4}-\d{2}-\d{2}/.test(ref)) return false;
    return (Date.now() - Date.parse(ref.slice(0, 10) + "T00:00:00Z")) / 864e5 <= 21;
  }
  function daysLeft(dl) {
    if (!dl || !/^\d{4}-\d{2}-\d{2}$/.test(dl)) return null;
    return Math.round((Date.parse(dl) - Date.parse(new Date().toISOString().slice(0, 10))) / 864e5);
  }
  var css = document.createElement("style");
  css.textContent = ".rl-back{position:fixed;inset:0;background:rgba(15,27,51,.45);display:flex;align-items:flex-end;justify-content:center;z-index:9999}" +
    // Whatever is behind a sheet dims so the eye goes to the sheet; on a dark screen it has to dim further to show.
    "@media (prefers-color-scheme: dark){.rl-back{background:rgba(0,0,0,.62)}}" +
    "@media(min-width:640px){.rl-back{align-items:center}}" +
    ".rl-sheet{background:var(--rl-sheet);width:100%;max-width:420px;border-radius:28px 28px 0 0;padding:26px 22px calc(26px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.18);max-height:88vh;overflow:auto;font-family:inherit;color:var(--rl-text)}" +
    "@media(min-width:640px){.rl-sheet{border-radius:28px}}" +
    ".rl-sheet h2{font-family:var(--rl-sys);font-weight:700;font-size:24px;margin:0 0 6px;letter-spacing:-.01em}" +
    ".rl-sheet p{margin:0 0 14px;color:var(--rl-text2);font-size:15px;line-height:1.45}" +
    ".rl-sheet input{width:100%;box-sizing:border-box;padding:14px 16px;border:1px solid var(--rl-line);border-radius:16px;font-size:16px;background:var(--rl-card);margin-bottom:12px}" +
    ".rl-btn{display:block;width:100%;border:0;border-radius:999px;padding:14px 18px;font-size:16px;font-weight:600;background:#c7f567;color:#0f1b33;cursor:pointer}" +
    ".rl-btn.ghost{background:transparent;border:1px solid var(--rl-line);color:var(--rl-text);margin-top:10px}" +
    ".rl-btn:disabled{opacity:.6}.rl-msg{min-height:20px;font-size:14px;margin:8px 0 0;color:var(--rl-accent)}.rl-msg.err{color:var(--rl-danger)}" +
    ".rl-order{border:1px solid var(--rl-line);border-radius:18px;padding:12px 14px;margin:10px 0;background:var(--rl-card)}" +
    ".rl-po-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin:12px 0 8px}" +
    ".rl-po{background:var(--rl-card);border:1px solid transparent;border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:10px}" +
    ".rl-po-top{display:flex;gap:14px;align-items:center}.rl-po-info{flex:1;min-width:0}" +
    ".rl-po-img{width:96px;height:96px;border-radius:18px;background:var(--rl-fill);flex:none;overflow:hidden;display:grid;place-items:center;font-weight:800;font-size:20px;color:var(--rl-text2)}" +
    ".rl-po-img img{width:100%;height:100%;object-fit:cover}.rl-has-logo{background:var(--rl-card)!important;box-shadow:inset 0 0 0 1px #e7e1d2}.rl-po-img img.rl-logo-img{object-fit:contain}" +
    ".rl-po-shop{font-size:13px;font-weight:700;color:var(--rl-text2)}" +
    ".rl-po h3{font-size:17px;line-height:1.25;margin:3px 0 2px;color:var(--rl-text)}.rl-po-meta{font-size:14px;line-height:1.35;margin-top:3px;color:var(--rl-text2)}" +
    ".rl-po-price{font-weight:800;font-size:17px;white-space:nowrap;color:var(--rl-text)}" +
    // A wallet card: the shop's name and the price on one line, size and date under it, then the parcel's news.
    ".rl-po-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}" +
    ".rl-po h3.rl-po-brand{font-size:20px;line-height:1.2;font-weight:800;letter-spacing:-.01em;margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".rl-po-ship{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:14px;font-weight:600;line-height:1.3;color:var(--rl-text2)}.rl-po-ship.done{color:var(--rl-accent)}.rl-po-ship .rl-jic{margin:0;flex:none}" +
    ".rl-sheet>.rl-po-ship{margin:0 0 14px}.rl-dt-sub{margin:0 0 10px;color:var(--rl-text2);font-size:15px;line-height:1.4}" +
    ".rl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}" +
    "@media(max-width:360px){.rl-po-img{width:80px;height:80px}}" +
    // In dark mode cards are Relay's navy (the --rl-card token), so a wallet card's buttons and picture box are lighter on it.
    "@media(prefers-color-scheme:dark){.rl-po .rl-po-secondary{background:rgba(255,255,255,.12)}.rl-po .rl-po-img,.rl-po .rl-po-img.rl-has-logo{background:rgba(255,255,255,.1)!important}}" +
    ".rl-po-status{font-size:13px;line-height:1.4;padding:8px 11px;border-radius:12px;background:var(--rl-accent-bg);color:var(--rl-accent)}.rl-po-status.wait{background:var(--rl-fill);color:var(--rl-text2)}" +
    ".rl-po-actions{display:flex;gap:8px;flex-wrap:wrap}" +
    // Inside a card: tinted buttons rather than outlined ones, Details only as wide as its word beside another button.
    ".rl-po .rl-po-secondary{background:rgba(120,120,128,.16);border-color:transparent;color:var(--rl-text)}.rl-po .rl-po-primary{border-color:#101828}" +
    ".rl-po-actions>.rl-po-details:not(:only-child){flex:0 0 auto;padding:10px 18px}" +
    ".rl-po .rl-po-mark{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--rl-accent-bg);color:var(--rl-accent)}.rl-po-mark .rl-jic,.rl-po-marklink .rl-jic{color:inherit;margin:0}" +
    ".rl-po-marklink{all:unset;box-sizing:border-box;cursor:pointer;align-self:flex-start;display:inline-flex;align-items:center;gap:6px;min-height:44px;color:var(--rl-accent);font-weight:700;font-size:15px}" +
    ".rl-po-marklink:active{opacity:.6}.rl-po-marklink:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px;border-radius:8px}.rl-po-marklink:disabled{opacity:.6}" +
    ".rl-due{display:flex;flex-direction:column;gap:8px;padding:2px 2px 0}" +
    ".rl-due-t{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:2px 10px;font-size:14px;line-height:1.35;color:var(--rl-text)}.rl-due-t b{font-weight:800;white-space:nowrap}" +
    ".rl-due.ok .rl-due-t b{color:var(--rl-accent)}.rl-due.soon .rl-due-t b{color:var(--rl-warn)}.rl-due.urgent .rl-due-t b{color:var(--rl-danger)}" +
    ".rl-due-bar{height:6px;border-radius:99px;background:rgba(120,120,128,.2);overflow:hidden}.rl-due-bar i{display:block;height:100%;border-radius:99px;background:#2E9E5B}" +
    ".rl-due.soon .rl-due-bar i{background:#D47B1F}.rl-due.urgent .rl-due-bar i{background:#E0446E}" +
    ".rl-po-primary,.rl-po-secondary{flex:1 1 130px;min-height:44px;padding:10px 14px;border-radius:999px;font-weight:700;font-size:14px;border:1.5px solid var(--rl-text);text-align:center;text-decoration:none;cursor:pointer}" +
    ".rl-po-primary{background:#101828;color:#fff}.rl-po-secondary{background:var(--rl-card);color:var(--rl-text)}.rl-po-primary:disabled,.rl-po-secondary:disabled{opacity:.6}" +
    "button.rl-po-primary,button.rl-po-secondary{font:inherit;font-weight:700;font-size:14px}.rl-po-primary:active,.rl-po-secondary:active,.rl-rg-row:active{transform:scale(.97)}" +
    ".rl-rg-row{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:'l c' 'v c';align-items:center;column-gap:12px;row-gap:1px;width:100%;box-sizing:border-box;min-height:56px;padding:10px 14px;margin:0 0 8px;border:1px solid var(--rl-line);border-radius:14px;background:var(--rl-card);font:inherit;text-align:left;cursor:pointer;color:var(--rl-text)}" +
    ".rl-rg-l{grid-area:l;font-size:13px;color:var(--rl-text2)}.rl-rg-row b{grid-area:v;min-width:0;font-size:16px;overflow-wrap:anywhere}.rl-rg-c{grid-area:c;display:inline-flex;align-items:center;gap:4px;font-size:14px;font-weight:700;color:var(--rl-accent)}" +
    ".rl-rg-next{margin:14px 0 0;padding:12px 14px;border-radius:14px;background:var(--rl-accent-bg);color:var(--rl-accent);font-size:14px;line-height:1.45}" +
    ".rl-wr-years{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}.rl-wr-years button{all:unset;cursor:pointer;box-sizing:border-box;min-height:44px;display:inline-flex;align-items:center;padding:7px 18px;border-radius:999px;border:1px solid var(--rl-line);font-weight:800;font-size:14px;background:var(--rl-card);color:var(--rl-text)}.rl-wr-years button.on{background:#101828;color:#c7f567;border-color:#101828}.rl-wr-kinds{display:flex;gap:8px;overflow-x:auto;margin:-4px -2px 14px;padding:2px;scrollbar-width:none}.rl-wr-kinds::-webkit-scrollbar{display:none}.rl-wr-kinds button{all:unset;flex:none;cursor:pointer;box-sizing:border-box;min-height:44px;display:inline-flex;align-items:center;padding:8px 17px;border-radius:999px;background:var(--rl-fill);color:var(--rl-text);font-weight:750;font-size:14px}.rl-wr-kinds button.on{background:#c7f567;color:#16210a;box-shadow:inset 0 0 0 1.5px #16210a}" +
    ".rl-wr-cover{position:relative;overflow:hidden;border-radius:28px;padding:30px 28px;background:#101828;color:#fff;margin-bottom:16px}.rl-wr-cover h2{font-size:clamp(30px,4vw,44px);letter-spacing:-1.5px;line-height:1.05;margin:10px 0;color:#fff;max-width:560px}.rl-wr-cover p{color:#d4d4e5;margin:0 0 18px;font-size:15px}.rl-wr-kicker{color:#c7f567;font-size:12px;font-weight:900;letter-spacing:2px}@media(max-width:520px){.rl-wr-cover{padding:24px 22px}}" +
    ".rl-wr-play{all:unset;cursor:pointer;box-sizing:border-box;display:inline-flex;align-items:center;min-height:52px;background:#c7f567;color:#16210a;font-weight:900;padding:0 26px;border-radius:999px;font-size:16px;box-shadow:0 10px 30px rgba(199,245,103,.25)}.rl-wr-play:hover{transform:translateY(-1px)}" +
    ".rl-wr-glance{background:var(--rl-card);border:1px solid var(--rl-line);border-radius:24px;padding:20px;margin-bottom:16px}.rl-wr-glance h3{margin:0 0 12px;font-size:18px;color:var(--rl-text)}.rl-wr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.rl-wr-stats div{background:var(--rl-fill);border-radius:16px;padding:14px}.rl-wr-stats span{display:block;font-size:13px;color:var(--rl-text2);font-weight:700}.rl-wr-stats strong{display:block;font-size:20px;color:var(--rl-text);margin:4px 0;word-break:break-word}.rl-wr-stats small{font-size:13px;color:var(--rl-text2)}.rl-wr-note{font-size:12px;color:var(--rl-text2);margin:12px 0 0}" +
    ".rl-story{position:fixed;inset:0;z-index:10050;background:rgba(5,8,18,.92);display:flex;align-items:center;justify-content:center}.rl-story-frame{position:relative;width:min(440px,100vw);height:min(820px,100dvh);border-radius:26px;overflow:hidden;transition:background .5s,color .5s;cursor:pointer;user-select:none;-webkit-user-select:none}@media(max-width:500px){.rl-story-frame{border-radius:0}}" +
    ".rl-story-bars{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:4px;z-index:2}.rl-story-bars div{flex:1;height:3px;border-radius:3px;background:rgba(127,127,127,.35);overflow:hidden}.rl-story-bars i{display:block;height:100%;width:0;background:currentColor}.rl-story-bars .done i{width:100%}.rl-story-bars .now i{animation:rlbar linear forwards}.rl-story-frame.paused .rl-story-bars .now i{animation-play-state:paused}@keyframes rlbar{to{width:100%}}" +
    ".rl-story-x,.rl-story-snd{all:unset;position:absolute;top:18px;right:10px;z-index:3;width:44px;height:44px;display:grid;place-items:center;border-radius:999px;cursor:pointer;opacity:.85;transition:transform .12s}.rl-story-snd{right:56px}" +
    ".rl-story-x:active,.rl-story-snd:active{transform:scale(.88)}.rl-story-x:focus-visible,.rl-story-snd:focus-visible{outline:2px solid currentColor;outline-offset:2px}.rl-story-body{position:absolute;inset:0;display:flex;align-items:center;padding:70px 30px 40px}" +
    ".rl-story-slide{width:100%}.rl-story-slide>*{opacity:0;animation:rlup .6s cubic-bezier(.2,.8,.2,1) forwards}.rl-story-slide>*:nth-child(2){animation-delay:.15s}.rl-story-slide>*:nth-child(3){animation-delay:.35s}.rl-story-slide>*:nth-child(4){animation-delay:.55s}.rl-story-slide>*:nth-child(5){animation-delay:.75s}@keyframes rlup{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}" +
    ".rl-story-slide .k{font-size:12px;font-weight:900;letter-spacing:2px;color:var(--accent)}.rl-story-slide h1{font-size:42px;line-height:1.02;letter-spacing:-1.5px;margin:14px 0}.rl-story-slide p{font-size:18px;line-height:1.4;margin:10px 0;opacity:.9}.rl-story-slide .lead{font-size:20px;font-weight:800;opacity:1}.rl-story-slide .big{font-size:64px;font-weight:900;letter-spacing:-2.5px;line-height:1;margin:12px 0;color:var(--accent);word-break:break-word}.rl-story-slide .big.name{font-size:46px;letter-spacing:-1.5px}.rl-story-slide .fine{font-size:13px;opacity:.75}.rl-story-slide .pill{display:inline-block;border:2px solid currentColor;border-radius:999px;padding:6px 14px;font-weight:800;font-size:15px}" +
    ".rl-story-slide .rank{list-style:none;padding:0;margin:16px 0 0}.rl-story-slide .rank li{display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.15);opacity:0;animation:rlup .5s forwards;font-size:19px;font-weight:800}.rl-story-slide .rank b{font-size:28px;color:var(--accent);width:28px}.rl-story-slide .rank span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rl-story-slide .rank em{font-style:normal;font-size:14px;opacity:.75;font-weight:600}" +
    ".rl-story-slide .bars{margin-top:18px}.rl-story-slide .bar{display:grid;grid-template-columns:1fr 2fr auto;gap:10px;align-items:center;margin:8px 0;font-weight:700;font-size:14px}.rl-story-slide .bar i{display:block;height:14px;border-radius:7px;background:currentColor;width:0;animation:rlw .9s cubic-bezier(.2,.8,.2,1) forwards}@keyframes rlw{to{width:var(--w)}}.rl-story-slide .bar em{font-style:normal}" +
    ".rl-story-slide .months{display:flex;align-items:flex-end;gap:5px;height:150px;margin:20px 0 6px}.rl-story-slide .months div{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;gap:6px}.rl-story-slide .months i{display:block;width:100%;border-radius:6px 6px 2px 2px;background:currentColor;opacity:.35;height:0;animation:rlh .8s cubic-bezier(.2,.8,.2,1) forwards}.rl-story-slide .months i.hot{opacity:1;background:var(--accent)}.rl-story-slide .months span{font-size:11px;opacity:.7}@keyframes rlh{to{height:var(--h)}}" +
    ".rl-story-slide .ph{display:grid;gap:8px;margin:16px 0 8px}.rl-story-slide .ph.n1{grid-template-columns:1fr}.rl-story-slide .ph.n2,.rl-story-slide .ph.n4{grid-template-columns:1fr 1fr}.rl-story-slide .ph.n3,.rl-story-slide .ph.n5,.rl-story-slide .ph.n6,.rl-story-slide .ph.n7,.rl-story-slide .ph.n8,.rl-story-slide .ph.n9{grid-template-columns:1fr 1fr 1fr}" +
    ".rl-story-slide .ph figure{margin:0;background:var(--rl-card);border-radius:16px;overflow:hidden;aspect-ratio:1;position:relative;opacity:0;animation:rlpop .5s cubic-bezier(.2,.8,.2,1) forwards}.rl-story-slide .ph.n1 figure{aspect-ratio:4/5;max-height:46vh}.rl-story-slide .ph img{width:100%;height:100%;object-fit:contain;display:block}.rl-story-slide .ph figcaption{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(transparent,rgba(0,0,0,.65));color:#fff;font-size:11px;font-weight:700;padding:14px 8px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@keyframes rlpop{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}" +
    ".rl-story-slide .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.rl-story-slide .chips span{border:2px solid currentColor;border-radius:999px;padding:6px 12px;font-weight:800;font-size:14px;display:inline-flex;align-items:center;gap:6px}.rl-story-slide .chips i{width:12px;height:12px;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.25)}" +
    ".rl-story-slide .sprint{margin-top:18px;display:grid;gap:10px}.rl-story-slide .sprint .row{display:grid;grid-template-columns:96px repeat(12,1fr);gap:3px;align-items:center;font-size:12px;font-weight:800}.rl-story-slide .sprint .row span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:4px}.rl-story-slide .sprint i{display:block;aspect-ratio:1;border-radius:4px;background:var(--accent);opacity:0;animation:rlfade .4s forwards}.rl-story-slide .sprint .head i{background:none;opacity:1;animation:none;font-style:normal;text-align:center;font-size:10px;opacity:.7}@keyframes rlfade{to{opacity:var(--o)}}" +
    // Wrapped: the yearly card's colour strip, the split bar, chapter facts and each kind's animated scene.
    ".rl-wr-dots{display:flex;gap:3px;height:10px;border-radius:999px;overflow:hidden;margin:14px 0 4px}.rl-wr-dots i{display:block;min-width:4px}" +
    ".rl-story-slide .stack{display:flex;gap:3px;height:22px;border-radius:999px;overflow:hidden;margin:18px 0 6px}.rl-story-slide .stack i{display:block;flex:none;width:0;animation:rlgrow 1s cubic-bezier(.2,.8,.2,1) forwards}" +
    ".rl-story-slide .stack.small{height:10px;margin:16px 0 0}.rl-story-slide .stack.small i{width:var(--w);animation:none}@keyframes rlgrow{to{width:var(--w)}}" +
    ".rl-story-slide .kindlist{display:block;list-style:none;padding:0;margin:12px 0 0}.rl-story-slide .kindlist li{display:grid;grid-template-columns:14px 1fr auto;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.14);font-size:16px;font-weight:700;opacity:0;animation:rlup .5s forwards}" +
    ".rl-story-slide .kindlist li i{width:14px;height:14px;border-radius:4px}.rl-story-slide .kindlist li em{font-style:normal;font-size:15px;opacity:.85;text-align:right}" +
    ".rl-story-slide p.fact{display:inline-block;background:rgba(255,255,255,.14);border-radius:14px;padding:10px 14px;font-size:16px;font-weight:800;line-height:1.35;margin:6px 0 2px}" +
    ".rl-story-slide .facts{display:grid;gap:8px;margin-top:14px}.rl-story-slide .facts div{display:flex;justify-content:space-between;align-items:baseline;gap:12px;border-top:1px solid rgba(255,255,255,.2);padding-top:8px}.rl-story-slide .facts span{font-size:14px;opacity:.8;flex:none}.rl-story-slide .facts b{font-size:15px;text-align:right;min-width:0;overflow-wrap:anywhere}" +
    ".rl-story-slide .scene{width:min(260px,72%);margin:10px 0 2px;color:var(--accent)}.rl-story-slide .scene svg{display:block;width:100%;height:auto;overflow:visible}.rl-story-slide .scene .fill{fill:currentColor;fill-opacity:.28}" +
    ".rl-story-slide .scene *{transform-box:view-box}" +
    ".sc-food .st{opacity:0;animation:rlsteam 2.2s ease-in-out infinite}.sc-food .s2{animation-delay:.45s}.sc-food .s3{animation-delay:.9s}.sc-food .tilt{transform-origin:176px 102px;animation:rltilt 3s ease-in-out infinite}" +
    "@keyframes rlsteam{0%{opacity:0;transform:translateY(8px)}40%{opacity:1}100%{opacity:0;transform:translateY(-12px)}}@keyframes rltilt{50%{transform:rotate(-9deg)}}" +
    ".sc-fashion .sw{animation:rlswing 2.6s ease-in-out infinite}.sc-fashion .s1{transform-origin:52px 22px}.sc-fashion .s2{transform-origin:100px 22px;animation-delay:.35s}.sc-fashion .s3{transform-origin:148px 22px;animation-delay:.7s}@keyframes rlswing{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}" +
    ".sc-electronics .charge{fill:currentColor;fill-opacity:.4;stroke:none;transform-origin:100px 100px;animation:rlcharge 2.4s ease-in-out infinite}.sc-electronics .wave{animation:rlwave 1.6s ease-in-out infinite}.sc-electronics .w2{animation-delay:.35s}" +
    "@keyframes rlcharge{0%{transform:scaleY(.08)}70%,100%{transform:scaleY(1)}}@keyframes rlwave{0%,100%{opacity:.15}50%{opacity:1}}" +
    ".sc-home .win{fill:currentColor;fill-opacity:0;animation:rllight 3.2s ease-in-out infinite}.sc-home .w2{animation-delay:1.1s}.sc-home .smoke{animation:rlsteam 2.6s ease-in-out infinite}@keyframes rllight{0%,15%{fill-opacity:0}35%,75%{fill-opacity:.9}100%{fill-opacity:0}}" +
    ".sc-beauty .tw{fill:currentColor;fill-opacity:.3;transform-box:fill-box;transform-origin:center;animation:rltwinkle 2s ease-in-out infinite}.sc-beauty .t2{animation-delay:.55s}.sc-beauty .t3{animation-delay:1.1s}@keyframes rltwinkle{0%,100%{transform:scale(.7);opacity:.45}50%{transform:scale(1.12);opacity:1}}" +
    ".sc-travel .dash{stroke-dasharray:6 11;animation:rldash 1.4s linear infinite}.sc-travel .fly{stroke:none;animation:rlfly 3.4s ease-in-out infinite}@keyframes rldash{to{stroke-dashoffset:-34}}" +
    "@keyframes rlfly{0%{transform:translate(14px,100px) rotate(-62deg);opacity:0}10%{opacity:1}50%{transform:translate(92px,40px) rotate(-4deg)}90%{opacity:1}100%{transform:translate(170px,80px) rotate(40deg);opacity:0}}" +
    ".sc-digital .eq{fill:currentColor;stroke:none;transform-box:fill-box;transform-origin:bottom;animation:rleq .9s ease-in-out infinite alternate}.sc-digital .e2{animation-delay:.2s}.sc-digital .e3{animation-delay:.4s}.sc-digital .e4{animation-delay:.1s}.sc-digital .e5{animation-delay:.3s}@keyframes rleq{from{transform:scaleY(.25)}to{transform:scaleY(1)}}" +
    ".sc-experiences .tk{transform-box:fill-box;transform-origin:center;animation:rltk 3s ease-in-out infinite}.sc-experiences .k2{animation-delay:.5s}.sc-experiences .cut{stroke-dasharray:3 6}@keyframes rltk{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(4deg) translateY(-5px)}}" +
    // Gifts: a present whose lid keeps lifting, with a few sparkles.
    ".sc-gifts .lid{transform-origin:100px 62px;animation:rllid 3s ease-in-out infinite}.sc-gifts .tw{fill:currentColor;fill-opacity:.3;transform-box:fill-box;transform-origin:center;animation:rltwinkle 2s ease-in-out infinite}.sc-gifts .t2{animation-delay:.6s}.sc-gifts .t3{animation-delay:1.2s}" +
    "@keyframes rllid{0%,50%,100%{transform:translateY(0) rotate(0)}64%{transform:translateY(-12px) rotate(-6deg)}78%{transform:translateY(-5px) rotate(4deg)}90%{transform:translateY(-1px) rotate(-1deg)}}" +
    "@media(prefers-reduced-motion:reduce){.rl-story-slide .scene *{animation:none!important}.rl-story-slide .stack i{animation:none;width:var(--w)}}" +
    ".rl-inpage .rl-ahead{background:var(--rl-card);border:1px solid var(--rl-line);border-radius:18px;padding:14px 16px}.rl-inpage .rl-agroup:first-of-type{margin-top:18px}.rl-inpage .rl-wr-cover{margin-bottom:10px}" +
    ".rl-story-slide .badges{display:grid;gap:10px;margin-top:16px}.rl-story-slide .badges div{border:2px solid currentColor;border-radius:18px;padding:12px 14px;opacity:0;animation:rlup .5s forwards}.rl-story-slide .badges b{display:block;font-size:19px;color:var(--accent)}.rl-story-slide .badges small{font-size:13px;opacity:.85}" +
    ".rl-wr-strip{display:flex;gap:8px;overflow-x:auto;margin:4px 0 2px}.rl-wr-strip figure{margin:0;flex:none;width:96px}.rl-wr-strip .im{width:96px;height:96px;border-radius:14px;background:var(--rl-fill);overflow:hidden}.rl-wr-strip img{width:100%;height:100%;object-fit:contain}.rl-wr-strip figcaption{font-size:12px;color:var(--rl-text2);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".rl-story-slide .sum{background:#1f3d2b;border-radius:24px;padding:22px}.rl-story-slide .sumgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}.rl-story-slide .sumgrid span{display:block;font-size:12px;opacity:.75;font-weight:700}.rl-story-slide .sumgrid strong{display:block;font-size:20px;word-break:break-word}.rl-story-slide .acts{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}.rl-story-slide .acts button{all:unset;cursor:pointer;background:#c7f567;color:#16210a;font-weight:900;padding:12px 20px;border-radius:999px}.rl-story-slide .acts button.ghost{background:transparent;color:inherit;border:1px solid rgba(255,255,255,.4)}" +
    ".rl-po-status.urgent{background:#fde7e4;color:#a5281d}.rl-skel{min-height:132px;background:linear-gradient(90deg,var(--rl-card),var(--rl-fill),var(--rl-card));background-size:200% 100%;animation:rlsk 1.2s infinite}@keyframes rlsk{to{background-position:-200% 0}}" +
    ".rl-empty{background:var(--rl-card);border:1px dashed var(--rl-line);border-radius:22px;padding:22px}.rl-empty h3{margin:0 0 6px;font-size:18px;color:var(--rl-text)}.rl-empty p{margin:0 0 12px;color:var(--rl-text2);font-size:14px}" +
    ".rl-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));grid-auto-rows:1fr;gap:12px;margin-top:8px}" +
    // Receipts as a grid of colourful tiles, one per kind of shopping, each with a tinted photo of something bought there.
    ".rl-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:2px 0 0}@media(min-width:761px){.rl-tiles{grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}}" +
    ".rl-tile{all:unset;box-sizing:border-box;position:relative;display:block;overflow:hidden;isolation:isolate;aspect-ratio:16/10;min-height:100px;border-radius:14px;color:#fff;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .16s ease}" +
    ".rl-tile:active{transform:scale(.96);transition-duration:.06s}.rl-tile:focus-visible{outline:3px solid var(--rl-accent,#c7f567);outline-offset:3px}" +
    ".rl-tile b{position:absolute;left:13px;right:10px;bottom:11px;z-index:2;font-size:20px;line-height:1.12;font-weight:700;letter-spacing:-.2px;text-wrap:balance;overflow-wrap:anywhere}" +
    ".rl-tile .rl-tile-pic{position:absolute;z-index:1;top:-16%;right:-20%;height:140%;width:auto;aspect-ratio:1;object-fit:cover;mix-blend-mode:multiply;filter:grayscale(1) contrast(1.2) brightness(1.04)}" +
    ".rl-tile .rl-tile-art{position:absolute;z-index:1;top:-14%;right:-12%;width:68%;height:auto;color:rgba(0,0,0,.2)}" +
    ".rl-tile .rl-tile-badge{position:absolute;left:10px;top:10px;z-index:2;font-size:13px;line-height:1;font-weight:700;padding:7px 10px;border-radius:999px;background:rgba(0,0,0,.3);color:#fff}" +
    ".rl-tile.rl-gifts{color:#101828}.rl-tile.rl-gifts .rl-tile-art{color:rgba(16,24,40,.2)}.rl-tile.rl-gifts .rl-tile-badge{background:rgba(16,24,40,.14);color:#101828}" +
    ".rl-tile.rl-year{background:#c7f567;color:#101828}.rl-tile.rl-year .rl-year-n{position:absolute;left:11px;top:8px;z-index:1;font-size:clamp(44px,13.5vw,60px);line-height:1;font-weight:900;letter-spacing:-.06em;color:inherit}" +
    ".rl-search{display:flex;align-items:center;gap:8px;min-height:44px;margin:0 0 16px;padding:0 14px;border-radius:12px;background:var(--rl-fill);color:var(--rl-text2,rgba(60,60,67,.6))}" +
    ".rl-search input{all:unset;flex:1;min-width:0;min-height:44px;font-size:17px;color:var(--rl-text)}.rl-search input::placeholder{color:var(--rl-text2,rgba(60,60,67,.6))}" +
    ".rl-search input::-webkit-search-cancel-button{-webkit-appearance:none}" +
    // Add a receipt: search the inbox as you type, paste an email in one tap, or forward it.
    ".rl-ar-lead{margin:0 0 14px;font-size:15px;line-height:1.4;color:var(--rl-text2)}.rl-ar .rl-search{margin:0 0 10px}.rl-ar .rl-msg:empty{display:none}" +
    ".rl-ar-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 6px}" +
    ".rl-ar-chip{all:unset;box-sizing:border-box;cursor:pointer;min-height:44px;display:inline-flex;align-items:center;padding:0 16px;border-radius:999px;background:var(--rl-fill);color:var(--rl-text);font-size:15px;font-weight:600}" +
    ".rl-ar-chip:focus-visible,.rl-ar-add:focus-visible,.rl-ar-copy:focus-visible,.rl-find-link:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px}" +
    ".rl-ar-status{margin:8px 2px 4px;font-size:13px;line-height:1.4;color:var(--rl-text2)}.rl-ar-status:empty{display:none}" +
    ".rl-ar-row{display:flex;align-items:center;gap:12px;min-height:64px;padding:10px 0}.rl-ar-row+.rl-ar-row{border-top:1px solid var(--rl-line)}" +
    ".rl-ar-row.rl-skel{min-height:64px;margin:6px 0;border-radius:12px;border:0}" +
    ".rl-ar-ini{flex:none;width:40px;height:40px;border-radius:10px;display:grid;place-items:center;color:#fff;font-size:17px;font-weight:700}" +
    ".rl-ar-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}" +
    ".rl-ar-t b{font-size:15px;font-weight:600;line-height:1.3;color:var(--rl-text);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}" +
    ".rl-ar-t span{font-size:13px;line-height:1.35;color:var(--rl-text2);overflow-wrap:anywhere}.rl-ar-t .rl-ar-note{color:var(--rl-accent);font-weight:600}.rl-ar-note:empty{display:none}" +
    ".rl-ar-add{all:unset;box-sizing:border-box;cursor:pointer;flex:none;min-height:44px;min-width:72px;padding:0 16px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:#c7f567;color:#101828;font-size:15px;font-weight:700}" +
    ".rl-ar-add:disabled{cursor:default}.rl-ar-add.done{background:var(--rl-accent-bg);color:var(--rl-accent)}" +
    ".rl-ar-h{margin:28px 2px 4px;font-size:20px;font-weight:700;letter-spacing:-.01em;color:var(--rl-text)}" +
    ".rl-ar-help{margin:0 2px 12px;font-size:15px;line-height:1.4;color:var(--rl-text2)}" +
    ".rl-ar-box{display:block;box-sizing:border-box;width:100%;min-height:120px;margin:10px 0 0;padding:12px 14px;border:0;border-radius:12px;background:var(--rl-fill);color:var(--rl-text);font:inherit;font-size:16px;line-height:1.4;resize:vertical}.rl-ar-box[hidden]{display:none}" +
    ".rl-ar-done{display:flex;flex-direction:column;gap:4px;margin:12px 0 0;padding:16px 18px;border-radius:16px;background:var(--rl-accent-bg,rgba(61,107,0,.12));color:var(--rl-text)}" +
    ".rl-ar-done b{font-size:17px;font-weight:700;overflow-wrap:anywhere}.rl-ar-done span{font-size:15px;line-height:1.4;color:var(--rl-text);overflow-wrap:anywhere}" +
    ".rl-ar-fwd{display:flex;flex-direction:column;gap:4px;margin:28px 0 0;padding:16px 18px;border-radius:16px;background:var(--rl-fill);color:var(--rl-text)}" +
    ".rl-ar-fwd b{font-size:17px;font-weight:700}.rl-ar-fwd span{font-size:15px;line-height:1.4;color:var(--rl-text2);overflow-wrap:anywhere}" +
    ".rl-ar-copy{all:unset;box-sizing:border-box;cursor:pointer;align-self:flex-start;max-width:100%;min-height:44px;margin-top:8px;padding:10px 16px;border-radius:999px;background:var(--rl-bg);border:1px solid var(--rl-line);color:var(--rl-text);font-size:15px;font-weight:600;line-height:1.3;overflow-wrap:anywhere}" +
    ".rl-ar-adds{display:flex;flex-wrap:wrap;gap:8px}.rl-ar-addbtn{display:inline-flex;align-items:center;gap:6px}.rl-ar-addbtn .rl-jic{color:inherit;margin:0}.rl-ar-fwd .rl-ar-adds:not(:empty)+.rl-ar-copy{margin-top:8px}" +
    // The Email connection page: one row per inbox.
    ".rl-ibx{margin:4px 0 6px}.rl-ibx-row{display:flex;align-items:flex-start;gap:12px;padding:12px 0 2px}.rl-ibx-row+.rl-ibx-row{border-top:1px solid var(--rl-line)}" +
    ".rl-ibx-ic{flex:none;width:40px;height:40px;border-radius:10px;display:grid;place-items:center;color:#fff;margin:0}.rl-ibx-ic.g{background:#E0446E}.rl-ibx-ic.ms{background:#4F72E0}" +
    ".rl-ibx-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;padding-top:1px}.rl-ibx-t b{font-size:16px;font-weight:600;color:var(--rl-text);overflow-wrap:anywhere}.rl-ibx-t span{font-size:13px;line-height:1.35;color:var(--rl-text2)}" +
    ".rl-ibx-off{all:unset;box-sizing:border-box;cursor:pointer;align-self:flex-start;min-height:44px;padding:0;color:var(--rl-danger);font-size:15px;font-weight:700}.rl-ibx-off:active{opacity:.6}.rl-ibx-off:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px;border-radius:8px}" +
    ".rl-ibx-adds{display:grid;gap:10px;margin:8px 0 4px}.rl-ibx-addbtn{display:flex!important;align-items:center;justify-content:center;gap:8px;margin-top:0!important}.rl-ibx-addbtn .rl-jic{color:inherit;margin:0}" +
    ".rl-find-link{all:unset;box-sizing:border-box;cursor:pointer;display:block;min-height:44px;line-height:44px;margin:12px auto 0;font-size:15px;font-weight:700;color:var(--rl-accent);text-decoration:underline;text-underline-offset:3px;text-align:center}" +
    ".rl-recstat{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:18px 0 0;font-size:13px;color:var(--rl-text2)}" +
    ".rl-recstat .rl-po-secondary{background:var(--rl-fill);color:var(--rl-text);border-color:transparent}" +
    ".rl-recstat .rl-msg{color:var(--rl-text2)}" +
    // The next return, floating above the tab bar like the song that's playing.
    ".rl-next{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;width:100%;min-height:60px;padding:8px 10px 8px 8px;cursor:pointer;color:inherit}" +
    ".rl-next .rl-next-pic{flex:none;width:44px;height:44px;border-radius:10px;overflow:hidden;display:grid;place-items:center}.rl-next .rl-next-pic img{width:100%;height:100%;object-fit:cover;display:block}" +
    ".rl-next .rl-next-t{flex:1;min-width:0}.rl-next b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".rl-next .rl-next-s{display:block;font-size:13px;color:var(--rl-text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".rl-next .rl-next-d{flex:none;font-size:13px;font-weight:700;padding:8px 11px;border-radius:999px;background:var(--rl-accent-bg);color:var(--rl-accent)}.rl-next .rl-next-d.soon{background:#fde0dd;color:#b3261e}" +
    ".rl-next:active{transform:scale(.98)}" +
    ".rl-face{display:inline-grid;place-items:center;border-radius:50%;overflow:hidden;background:var(--rl-accent-bg);color:var(--rl-text);font-weight:900;line-height:1;flex:none;box-shadow:0 0 0 1px rgba(16,24,40,.06)}.rl-face img{width:100%;height:100%;object-fit:cover;display:block}" +
    ".avatar.rl-has-photo{width:44px;height:44px;padding:0;box-sizing:border-box;background-size:cover;background-position:center;background-repeat:no-repeat}" +
    ".rl-po-more{margin:6px 0 4px;padding:10px 16px;border-radius:999px;border:1.5px solid var(--rl-text);background:var(--rl-card);font-weight:700;cursor:pointer}" +
    ".rl-order b{display:block}.rl-order span{color:var(--rl-text2);font-size:14px}" +
    // The Account page: full height on a phone, grouped rows like a phone's Settings.
    ".rl-sheet.rl-full{max-width:560px;background:var(--rl-fill);padding:0 16px calc(28px + env(safe-area-inset-bottom));min-height:min(92dvh,880px);max-height:calc(94dvh - var(--rl-kb,0px))}" +
    "@media(max-width:639px){.rl-sheet.rl-full{border-radius:22px 22px 0 0}}" +
    ".rl-abar{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin:0 -16px;padding:6px 8px;background:var(--rl-glass);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}" +
    ".rl-abar-t{font-size:16px;color:var(--rl-text);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:56vw}" +
    ".rl-abtn{all:unset;box-sizing:border-box;cursor:pointer;min-height:44px;display:inline-flex;align-items:center;gap:2px;padding:0 10px;border-radius:12px;font-size:16px;font-weight:600;color:var(--rl-text);justify-self:start}" +
    ".rl-abtn.done{justify-self:end;font-weight:800}.rl-abtn:active{background:rgba(16,24,40,.08)}.rl-abtn:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px}.rl-ab-i{display:inline-flex}" +
    ".rl-sheet h2.rl-atitle{font-family:var(--rl-sys);font-weight:800;font-size:32px;margin:2px 2px 14px;letter-spacing:-.02em;color:var(--rl-text)}" +
    ".rl-ahead{all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;align-items:center;gap:14px;background:var(--rl-card);border:1px solid var(--rl-line);border-radius:20px;padding:16px;transition:background .15s}" +
    ".rl-ahead:active{background:var(--rl-fill)}.rl-ahead:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px}" +
    ".rl-ahead-t{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}.rl-ahead-t b{font-size:19px;color:var(--rl-text);overflow:hidden;text-overflow:ellipsis}" +
    ".rl-ahead-t span{font-size:14px;color:var(--rl-text2);word-break:break-all}.rl-ahead-t em{font-style:normal;font-size:14px;font-weight:700;color:var(--rl-accent);margin-top:2px}" +
    ".rl-agroup{margin-top:22px}.rl-agroup h3{margin:0 4px 8px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--rl-text2)}" +
    ".rl-acard{background:var(--rl-card);border:1px solid var(--rl-line);border-radius:18px;overflow:hidden}" +
    ".rl-arow{all:unset;box-sizing:border-box;cursor:pointer;width:100%;min-height:56px;display:flex;align-items:center;gap:12px;padding:10px 14px;transition:background .15s}" +
    ".rl-arow+.rl-arow{border-top:1px solid var(--rl-line)}.rl-arow:active{background:var(--rl-fill)}.rl-arow:focus-visible{outline:2px solid var(--rl-text);outline-offset:-2px}" +
    ".rl-ai{flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--rl-fill);color:var(--rl-text)}" +
    ".rl-arow-t{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}.rl-arow-t b{font-size:16px;font-weight:650;color:var(--rl-text)}.rl-arow-d{font-size:13.5px;color:var(--rl-text2)}" +
    ".rl-arow-c{flex:none;display:inline-flex;color:var(--rl-text2)}" +
    ".rl-arow.danger b{color:var(--rl-danger)}.rl-arow.danger .rl-ai{background:#fde8e6;color:#b3261e}" +
    ".rl-aout{all:unset;box-sizing:border-box;cursor:pointer;width:100%;min-height:52px;margin-top:22px;text-align:center;background:var(--rl-card);border:1px solid var(--rl-line);border-radius:18px;font-size:16px;font-weight:700;color:var(--rl-danger);transition:background .15s}" +
    ".rl-aout:active{background:var(--rl-fill)}.rl-aout:disabled{opacity:.6}.rl-aout:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px}" +
    ".rl-afoot{text-align:center;font-size:13px!important;color:var(--rl-text2);margin:14px 0 0!important;word-break:break-all}" +
    ".rl-asub{background:var(--rl-card);border:1px solid var(--rl-line);border-radius:18px;padding:18px 16px;margin-top:8px}" +
    ".rl-asub>div>h2:first-child,.rl-asub>h2:first-child{display:none}" +
    ".rl-anote{font-size:13.5px!important;margin:6px 2px 16px!important}.rl-aterm{color:var(--rl-text)!important}" +
    ".rl-rev-l{display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 14px;box-sizing:border-box}.rl-rev-l+.rl-rev-l{border-top:1px solid var(--rl-line)}" +
    // The help chat: the assistant's bubbles on the left, yours on the right, and the box to write in kept in view (above
    // the floating tab bar on a phone, and above the keyboard while typing, when the tab bar steps aside).
    ".rl-chat{display:flex;flex-direction:column;gap:12px;margin:6px 0 12px}.rl-chat-b{max-width:86%;display:flex;flex-direction:column;gap:4px}" +
    ".rl-chat-b p{margin:0;padding:11px 14px;border-radius:18px;font-size:16px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}" +
    ".rl-chat-b.bot{align-self:flex-start}.rl-chat-b.bot p{background:var(--rl-card);border:1px solid var(--rl-line);color:var(--rl-text);border-bottom-left-radius:6px}" +
    ".rl-chat-b.me{align-self:flex-end}.rl-chat-b.me p{background:var(--rl-accent);color:var(--rl-bg);border-bottom-right-radius:6px}" +
    ".rl-chat-b.note{align-self:stretch;max-width:none}.rl-chat-b.note p{background:var(--rl-accent-bg);color:var(--rl-text);font-size:15px;text-align:center}" +
    ".rl-chat-who{font-size:13px;font-weight:600;color:var(--rl-text2);margin:0 4px}" +
    ".rl-chat-typing{flex-direction:row;gap:6px;padding:6px 0}.rl-chat-typing .rl-skel{display:block;width:72px;height:16px;min-height:0;border-radius:999px}.rl-chat-typing .rl-skel+.rl-skel{width:44px}" +
    ".rl-chat-chips{display:flex;flex-wrap:wrap;gap:8px}.rl-chat-chips button{all:unset;box-sizing:border-box;cursor:pointer;min-height:44px;display:inline-flex;align-items:center;padding:0 16px;border-radius:999px;background:var(--rl-fill);color:var(--rl-text);font-size:15px;font-weight:600;transition:transform .12s}" +
    ".rl-chat-chips button:active{transform:scale(.96)}.rl-chat-chips button:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px}" +
    ".rl-chat-bar{position:sticky;bottom:12px;z-index:3;display:flex;align-items:flex-end;gap:8px;padding:8px;border-radius:26px;background:var(--rl-card);border:1px solid var(--rl-line);box-shadow:0 6px 20px rgba(0,0,0,.08)}" +
    "@media(max-width:760px){.rl-chat-bar{bottom:calc(env(safe-area-inset-bottom) + 84px)}body.typing .rl-chat-bar{bottom:calc(8px + var(--rl-kb,0px))}}" +
    ".rl-chat-in{flex:1;min-width:0;box-sizing:border-box;min-height:48px;max-height:140px;margin:0;padding:12px 14px;border:0;border-radius:20px;background:var(--rl-fill);color:var(--rl-text);font:inherit;font-size:16px;line-height:1.4;resize:none}" +
    ".rl-chat-in::placeholder{color:var(--rl-text2)}.rl-chat-in:focus-visible{outline:2px solid var(--rl-accent);outline-offset:1px}" +
    ".rl-chat-send{all:unset;box-sizing:border-box;flex:none;width:48px;height:48px;border-radius:999px;display:grid;place-items:center;background:var(--rl-accent);color:var(--rl-bg);cursor:pointer;transition:transform .12s,opacity .12s}" +
    ".rl-chat-send:active{transform:scale(.92)}.rl-chat-send:disabled{opacity:.5;cursor:default}.rl-chat-send:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px}.rl-chat-send .rl-jic{margin:0;color:inherit}" +
    ".rl-chat-person{margin-top:4px}" +
    // Relay health (admins only): headline numbers, a meter, a day-by-day chart, and rows of counts.
    ".rl-hp-lead{margin:0 2px 8px;font-size:15px;line-height:1.45;color:var(--rl-text2)}.rl-hp-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 2px 12px}" +
    ".rl-hp-mail{width:100%;min-height:48px;margin:2px 0 8px}.rl-hp-when{font-size:13px;color:var(--rl-text2)}.rl-hp-again{flex:none!important;min-height:44px;padding:0 16px!important;font-size:15px!important}" +
    ".rl-hp-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}@media(min-width:640px){.rl-hp-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}}" +
    ".rl-hp-kpi{background:var(--rl-card);border:1px solid var(--rl-line);border-radius:18px;padding:14px 16px;display:flex;flex-direction:column;gap:2px;min-width:0}" +
    ".rl-hp-kpi span{font-size:13px;font-weight:600;color:var(--rl-text2)}.rl-hp-kpi b{font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-.02em;color:var(--rl-text);overflow-wrap:anywhere}.rl-hp-kpi small{font-size:13px;line-height:1.35;color:var(--rl-text2)}" +
    ".rl-hp-card{padding:16px 16px 6px}.rl-hp-sub{margin:0 0 10px;font-size:14px;line-height:1.45;color:var(--rl-text2)}" +
    ".rl-hp-mhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:15px;color:var(--rl-text)}.rl-hp-mhead span{font-size:22px;font-weight:800}" +
    ".rl-hp-meter{height:10px;border-radius:999px;background:var(--rl-accent-bg);overflow:hidden;margin:8px 0}.rl-hp-meter i{display:block;height:100%;border-radius:999px;background:var(--rl-accent)}" +
    ".rl-hp-chartw{margin:16px 0 4px}.rl-hp-chead{display:flex;flex-direction:column;gap:2px;font-size:15px;color:var(--rl-text)}.rl-hp-chead span{font-size:13px;color:var(--rl-text2)}" +
    ".rl-hp-plot{position:relative;margin-top:28px}.rl-hp-chart{display:flex;align-items:flex-end;gap:2px;height:120px;border-bottom:1px solid var(--rl-line)}" +
    ".rl-hp-chart button{all:unset;box-sizing:border-box;flex:1;min-width:0;height:100%;display:flex;align-items:flex-end;cursor:pointer;-webkit-tap-highlight-color:transparent}" +
    ".rl-hp-chart i{display:block;width:100%;border-radius:4px 4px 0 0;background:var(--rl-accent)}.rl-hp-chart button:hover i,.rl-hp-chart button:focus-visible i{opacity:.75}" +
    ".rl-hp-chart button:active i{opacity:.6}.rl-hp-chart button:focus-visible{outline:2px solid var(--rl-text);outline-offset:1px;border-radius:4px}" +
    ".rl-hp-tip{position:absolute;top:-6px;transform:translate(-50%,-100%);display:flex;flex-direction:column;gap:1px;padding:6px 10px;border-radius:10px;background:var(--rl-text);color:var(--rl-bg);font-size:13px;line-height:1.3;white-space:nowrap;pointer-events:none;z-index:2}" +
    ".rl-hp-tip[hidden]{display:none}.rl-hp-axis{display:flex;justify-content:space-between;margin-top:6px;font-size:13px;color:var(--rl-text2)}" +
    ".rl-hp-more{margin:8px 0 2px}.rl-hp-more summary{list-style:none;min-height:44px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:15px;font-weight:700;color:var(--rl-accent)}" +
    ".rl-hp-more summary::-webkit-details-marker{display:none}.rl-hp-more summary .rl-jic{transition:transform .2s}.rl-hp-more[open] summary .rl-jic{transform:rotate(180deg)}.rl-hp-more summary:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px;border-radius:8px}" +
    ".rl-hp-table{width:100%;border-collapse:collapse;font-size:14px;color:var(--rl-text);margin:2px 0 10px}.rl-hp-table th,.rl-hp-table td{text-align:right;padding:7px 4px;border-top:1px solid var(--rl-line);font-variant-numeric:tabular-nums}" +
    ".rl-hp-table th:first-child,.rl-hp-table td:first-child{text-align:left}.rl-hp-table th{font-size:13px;font-weight:700;color:var(--rl-text2);border-top:0}" +
    ".rl-hp-rows{margin:6px 0 0}.rl-hp-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:11px 0;border-top:1px solid var(--rl-line);font-size:15px;line-height:1.35;color:var(--rl-text)}" +
    ".rl-hp-row>span{min-width:0}.rl-hp-row small{display:block;font-size:13px;color:var(--rl-text2);margin-top:2px}.rl-hp-row b{flex:none;font-weight:700;font-variant-numeric:tabular-nums}.rl-hp-card>.rl-hp-rows:first-child .rl-hp-row:first-child{border-top:0}" +
    ".rl-hp-shops{margin:0 0 6px}.rl-hp-shop{padding:11px 0;border-top:1px solid var(--rl-line)}.rl-hp-shop:first-child{border-top:0}.rl-hp-shop b{display:block;font-size:15px;color:var(--rl-text);overflow-wrap:anywhere}" +
    ".rl-hp-shop>span{display:block;font-size:13px;color:var(--rl-text2);margin-top:2px}.rl-hp-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}" +
    ".rl-hp-chips i{font-style:normal;font-size:13px;font-weight:700;padding:3px 9px;border-radius:999px;background:var(--rl-fill);color:var(--rl-text)}.rl-hp-chips i.ok{background:var(--rl-accent-bg);color:var(--rl-accent)}" +
    ".rl-rev-l .rl-arow-t b{font-size:13px;font-weight:700;color:var(--rl-text2)}.rl-rev-v{font-size:17px;font-weight:700;color:var(--rl-text);word-break:break-all}" +
    ".rl-rev-code{letter-spacing:.14em}.rl-rev-l .rl-po-secondary{flex:0 0 auto;min-width:84px}" +
    ".rl-full .rl-msg:empty{display:none}.rl-full>h2:first-child{margin-top:24px}" +
    ".rl-btn.rl-red{color:var(--rl-danger)}.rl-btn.rl-danger{background:#b3261e;color:#fff}" +
    ".rl-faq{border-top:1px solid var(--rl-line)}.rl-faq:first-child{border-top:0}.rl-faq summary{cursor:pointer;min-height:48px;display:flex;align-items:center;font-weight:700;font-size:16px;color:var(--rl-text);list-style:none;padding:6px 0}" +
    ".rl-faq summary::-webkit-details-marker{display:none}.rl-faq summary::after{content:'';margin-left:auto;width:8px;height:8px;border-right:2px solid #a39d90;border-bottom:2px solid #a39d90;transform:rotate(45deg);transition:transform .15s;flex:none}" +
    ".rl-faq[open] summary::after{transform:rotate(-135deg)}.rl-faq p{margin:0 0 14px!important}" +
    ".rl-sheet .rl-arow:active,.rl-sheet .rl-ahead:active,.rl-sheet .rl-aout:active{transform:scale(.985);filter:none}" +
    "@media(prefers-reduced-motion:reduce){.rl-arow,.rl-ahead,.rl-aout,.rl-faq summary::after{transition:none}.rl-sheet .rl-arow:active,.rl-sheet .rl-ahead:active,.rl-sheet .rl-aout:active{transform:none}}" +
    // Getting started: the journey from Welcome to "You're all set".
    ".rl-jr{padding-top:0}.rl-jtop{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;margin:0 -16px;padding:6px 8px;background:var(--rl-glass);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}" +
    ".rl-dots{display:flex;gap:6px}.rl-dots span{width:8px;height:8px;border-radius:99px;background:#d9d3c4;transition:width .2s,background .2s}.rl-dots span.on{width:22px;background:#101828}.rl-dots span.done{background:#7da23a}" +
    ".rl-jbody{padding:8px 2px 4px}.rl-jkick{font-size:12px;font-weight:800;letter-spacing:.1em;color:var(--rl-accent);margin:6px 0 6px}" +
    ".rl-sheet h2.rl-jh{font-family:var(--rl-sys);font-weight:800;font-size:30px;line-height:1.1;letter-spacing:-.02em;color:var(--rl-text);margin:6px 0 10px}" +
    ".rl-sheet p.rl-jsub{font-size:16px;color:var(--rl-text2);margin:0 0 20px}" +
    ".rl-jcard{background:var(--rl-card);border:1px solid var(--rl-line);border-radius:18px;padding:6px 16px;margin:0 0 16px}" +
    ".rl-jpt{display:flex;gap:12px;align-items:flex-start;padding:10px 0;font-size:15px;color:var(--rl-text);line-height:1.4}.rl-jpt+.rl-jpt{border-top:1px solid var(--rl-line)}" +
    ".rl-jic{flex:none;display:inline-grid;place-items:center;color:var(--rl-accent);margin-top:1px}" +
    ".rl-jwords{margin:0 0 16px;background:var(--rl-fill);border-radius:16px;padding:12px 12px 4px;max-height:32vh;overflow:auto}.rl-jwords>b{display:block;font-size:14px;color:var(--rl-text);margin:0 2px 8px}.rl-jwords:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px}" +
    ".rl-jwords p{font-size:14px!important;color:var(--rl-text2)!important;background:var(--rl-card);border-radius:12px;padding:10px 12px;margin:0 0 8px!important}" +
    ".rl-btn.rl-prov{background:var(--rl-card);color:var(--rl-text);border:1.5px solid var(--rl-text);margin-top:10px}.rl-btn.rl-prov:first-child{margin-top:0}" +
    ".rl-jr .rl-btn+.rl-btn{margin-top:10px}" +
    ".rl-sheet p.rl-jnote{font-size:13.5px;color:var(--rl-text2);margin:10px 2px 0}" +
    ".rl-sheet p.rl-jlegal{font-size:13px;color:var(--rl-text2);margin:22px 2px 0;text-align:center}.rl-jlegal a{color:var(--rl-accent);font-weight:700;display:inline-block;line-height:20px;padding:12px 0;margin:-12px 0}" +
    ".rl-jhint{margin-top:14px}.rl-jhint p{font-size:14px!important;color:var(--rl-text2)!important;margin:0 0 4px!important}" +
    ".rl-jlabel{display:block;font-weight:700;font-size:14px;margin:4px 0 6px;color:var(--rl-text)}" +
    // Codes: a big, even 6-digit box; two-step methods as small cards; recovery codes in a box that selects in one tap.
    "input.rl-field{display:block;width:100%;box-sizing:border-box;min-height:52px;padding:14px 16px;border:1px solid var(--rl-line);border-radius:16px;font:inherit;font-size:16px;background:var(--rl-card);color:var(--rl-text);margin:0 0 12px}" +
    ".rl-asub input.rl-field{background:var(--rl-sheet)}input.rl-field:focus-visible{outline:2px solid var(--rl-accent);outline-offset:1px}" +
    "input.rl-code{font-size:24px;letter-spacing:.3em;text-align:center;font-weight:700;font-variant-numeric:tabular-nums}input.rl-code::placeholder{letter-spacing:normal;font-weight:400;font-size:16px}" +
    ".rl-2s{border:1px solid var(--rl-line);border-radius:16px;padding:14px;margin:0 0 12px;background:var(--rl-sheet)}" +
    ".rl-2s-h{display:flex;align-items:center;gap:10px;margin:0 0 6px;color:var(--rl-text)}.rl-2s-h b{flex:1;min-width:0;font-size:16px}" +
    ".rl-2s-st{flex:none;font-size:13px;font-weight:700;padding:3px 10px;border-radius:999px;background:var(--rl-fill);color:var(--rl-text2)}.rl-2s-st.on{background:var(--rl-accent-bg);color:var(--rl-accent)}" +
    ".rl-sheet .rl-2s p{font-size:14px;margin:0 0 12px}.rl-2s .rl-btn.ghost{margin-top:0}" +
    ".rl-codes{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px;line-height:1.9;white-space:pre-line;word-break:break-all;-webkit-user-select:all;user-select:all;border:1px solid var(--rl-line);border-radius:14px;padding:10px 14px;margin:0 0 12px;background:var(--rl-sheet);color:var(--rl-text)}" +
    ".rl-jscan{background:#101828;color:#fff;border-radius:18px;padding:16px;margin:0 0 18px}.rl-jscan-t{display:flex;gap:12px;align-items:center}.rl-jscan .rl-jic{color:#c7f567;width:36px;height:36px;border-radius:10px;background:rgba(199,245,103,.12)}" +
    ".rl-jscan b{display:block;font-size:17px}.rl-jscan span{display:block;font-size:13.5px;color:#c9d0df}" +
    ".rl-jbar{height:6px;border-radius:99px;background:rgba(255,255,255,.14);margin-top:14px;overflow:hidden}.rl-jbar i{display:block;height:100%;width:6%;background:#c7f567;border-radius:99px;transition:width .6s ease}" +
    "@media(prefers-reduced-motion:reduce){.rl-jbar i,.rl-dots span{transition:none}}" +
    // Full pages: every step of signing in and getting started fills the screen, in a column, instead of a sheet over the app.
    ".rl-back:has(>.rl-jr){background:var(--rl-bg);align-items:stretch;justify-content:stretch}" +
    ".rl-back:has(>.rl-jr)>.rl-sheet{max-width:none;width:100%;height:100%;min-height:100%;max-height:none;border-radius:0;box-shadow:none;background:var(--rl-bg);padding:env(safe-area-inset-top) max(18px,calc((100% - 480px) / 2)) calc(28px + env(safe-area-inset-bottom) + var(--rl-kb,0px))}" +
    ".rl-back:has(>.rl-jr) .rl-jtop{margin:0 -8px;padding:6px 0;background:var(--rl-bg);-webkit-backdrop-filter:none;backdrop-filter:none}" +
    // The sign-in page: Relay's navy whatever the phone's setting (as the welcome story), the name, a little wallet of
    // receipts, white headline, three equal white buttons, Face ID in lime underneath, and the legal line.
    ".rl-choices{display:grid;gap:10px;margin:6px 0 4px}" +
    ".rl-choice,.rl-textbtn{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;font:inherit;cursor:pointer;text-align:center;transition:transform .12s,background-color .12s,opacity .12s}" +
    ".rl-choice{min-height:54px;padding:0 18px;border-radius:999px;background:#fff;color:#101828;font-size:17px;font-weight:700}.rl-choice:active{transform:scale(.97);background:#dfe5f0}" +
    ".rl-textbtn{min-height:48px;margin-top:8px;color:#c7f567;font-size:16px;font-weight:700}.rl-textbtn:active{opacity:.6}.rl-textbtn .rl-jic{color:inherit;margin:0}" +
    ".rl-choice:focus-visible,.rl-textbtn:focus-visible{outline:2px solid #fff;outline-offset:3px}" +
    ".rl-back:has(>.rl-signin),.rl-back>.rl-sheet.rl-signin{background:#101828;color:#fff}" +
    ".rl-back>.rl-sheet.rl-signin{display:flex;flex-direction:column}.rl-signin .rl-jbody{flex:1;display:flex;flex-direction:column;padding-top:0}" +
    ".rl-back:has(>.rl-signin) .rl-jtop{background:transparent}.rl-signin .rl-abtn{color:#fff}.rl-signin .rl-abtn .rl-jic{color:#fff}" +
    ".rl-signin .rl-abtn:active{background:rgba(255,255,255,.12)}.rl-signin .rl-abtn:focus-visible{outline-color:#fff}.rl-signin .rl-wbrand{margin:6px 0 0}" +
    ".rl-sheet.rl-signin h2.rl-jh{color:#fff;font-size:clamp(30px,9vw,36px);margin:0 0 8px}.rl-sheet.rl-signin p.rl-jsub{color:rgba(255,255,255,.8);font-size:17px;line-height:1.4;margin:0 0 22px}" +
    ".rl-sheet.rl-signin p.rl-jlegal{color:rgba(255,255,255,.72);margin-top:18px}.rl-signin .rl-jlegal a{color:#c7f567}" +
    ".rl-signin .rl-msg{color:#c7f567}.rl-signin .rl-msg.err{color:#ffb4ab}" +
    ".rl-sart{flex:1;min-height:170px;display:flex;align-items:flex-end;justify-content:center;padding:18px 0 30px}" +
    ".rl-sstack{position:relative;width:100%;max-width:340px;padding-top:30px}" +
    ".rl-sback{position:absolute;height:64px;border-radius:18px}.rl-sback.b1{top:0;left:30px;right:30px;background:#E0446E}.rl-sback.b2{top:15px;left:15px;right:15px;background:#4F72E0}" +
    ".rl-sfront{position:relative;box-shadow:0 16px 36px rgba(0,0,0,.35)}.rl-sfront .rl-wtrack{background:#e2f0e7}.rl-sfront .rl-wtrack i{width:22%;background:#2E9E5B}.rl-sfront .rl-wdue span{color:#1d6b3f}" +
    ".rl-signin .rl-rise{animation:rlup .6s cubic-bezier(.2,.8,.2,1) both;animation-delay:var(--d,0s)}" +
    ".rl-signin .rl-sback.b1{--d:.02s}.rl-signin .rl-sback.b2{--d:.07s}.rl-signin .rl-sfront{--d:.12s}" +
    "@media(max-height:720px){.rl-sart{min-height:0;padding:10px 0 18px}.rl-sfront .rl-wdue{display:none}}@media(max-height:620px){.rl-sart{display:none}.rl-signin .rl-wbrand{margin-bottom:18px}}" +
    "@media(prefers-reduced-motion:reduce){.rl-signin .rl-rise{animation:none}}" +
    // The welcome story: full-bleed colour, one slide at a time, the way in always at the bottom.
    ".rl-welcome{position:fixed;inset:0;z-index:9998;display:flex;justify-content:center;color:#fff;background:#101828;transition:background-color .5s ease;user-select:none;-webkit-user-select:none;cursor:pointer;overflow:hidden}.rl-welcome:focus{outline:none}" +
    "body.rl-welcoming{overflow:hidden}" +
    ".rl-wcol{width:100%;max-width:480px;box-sizing:border-box;display:flex;flex-direction:column;padding:calc(12px + env(safe-area-inset-top)) 18px calc(16px + env(safe-area-inset-bottom))}" +
    ".rl-wbars{display:flex;gap:4px}.rl-wbars div{flex:1;height:3px;border-radius:3px;background:rgba(255,255,255,.3);overflow:hidden}.rl-wbars i{display:block;height:100%;width:0;background:#fff}" +
    ".rl-wbars .done i{width:100%}.rl-wbars .now i{animation:rlbar linear forwards}.rl-welcome.held .rl-wbars .now i{animation-play-state:paused}.rl-welcome.last .rl-wbars .now i{animation:none;width:100%}" +
    ".rl-wbrand{display:flex;align-items:center;gap:10px;margin:18px 0 0}.rl-wbrand img{width:34px;height:34px;border-radius:10px;box-shadow:0 0 0 1px rgba(255,255,255,.18)}.rl-wbrand b{font-size:22px;font-weight:800;letter-spacing:-.01em}" +
    ".rl-wstage{flex:1;display:flex;align-items:center;min-height:0;padding:12px 0}.rl-wslide{width:100%}" +
    ".rl-wslide h1{font-family:var(--rl-sys);font-size:clamp(30px,10.3vw,40px);line-height:1.04;font-weight:800;letter-spacing:-.025em;margin:28px 0 10px;color:#fff}" +
    ".rl-wslide p{font-size:19px;line-height:1.35;font-weight:700;margin:0;color:#fff;max-width:30ch}" +
    ".rl-wact{display:grid;gap:10px;margin-top:8px}" +
    ".rl-wgo,.rl-whave{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:0 14px;text-align:center;font:inherit;cursor:pointer;transition:transform .12s,opacity .12s}" +
    ".rl-wgo{min-height:56px;border-radius:999px;background:#fff;color:#101828;font-size:18px;font-weight:700}.rl-wgo:active{transform:scale(.97)}" +
    ".rl-wgo.rl-nudge{animation:rlnudge .6s cubic-bezier(.2,.8,.2,1)}@keyframes rlnudge{0%,100%{transform:scale(1)}35%{transform:scale(1.06)}65%{transform:scale(.98)}}" +
    ".rl-whave{min-height:52px;border-radius:999px;border:1.5px solid rgba(255,255,255,.55);background:rgba(0,0,0,.14);color:#fff;font-size:clamp(15px,4.4vw,17px);font-weight:700}.rl-whave:active{transform:scale(.97);background:rgba(0,0,0,.24)}" +
    ".rl-wgo:focus-visible,.rl-whave:focus-visible{outline:2px solid #fff;outline-offset:3px}" +
    // Its pictures: cards drawn the way Relay shows your own, for made-up shops.
    ".rl-wart{display:grid;gap:10px;max-width:340px;min-height:300px;align-content:end}" +
    ".rl-wcard{display:grid;grid-template-columns:38px 1fr auto;align-items:center;gap:4px 12px;background:#fff;color:#101828;border-radius:18px;padding:12px 14px;box-shadow:0 12px 30px rgba(0,0,0,.2)}" +
    ".rl-wini{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:17px}" +
    ".rl-wcard-t{min-width:0}.rl-wcard-t b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rl-wcard-t span{display:block;font-size:13px;color:#4b5563}.rl-wprice{font-size:16px}" +
    ".rl-wart-receipts .rl-wcard:nth-child(1){rotate:-3deg}.rl-wart-receipts .rl-wcard:nth-child(2){rotate:2deg;translate:14px 0}.rl-wart-receipts .rl-wcard:nth-child(3){rotate:-1.5deg;translate:-4px 0}" +
    ".rl-wpill{justify-self:start;background:#c7f567;color:#16210a;border-radius:999px;padding:8px 14px;font-weight:800;font-size:14px;margin-top:4px}" +
    ".rl-wnote{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.92);border-radius:18px;padding:10px 14px 10px 10px;font-weight:700;font-size:15px;color:#101828;box-shadow:0 8px 24px rgba(0,0,0,.14);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}.rl-wnote img{width:26px;height:26px;border-radius:7px;flex:none}" +
    ".rl-wdue{grid-column:1/-1;margin-top:8px}.rl-wtrack{height:8px;border-radius:99px;background:#f3dde5;overflow:hidden}.rl-wtrack i{display:block;height:100%;width:78%;background:#E0446E;border-radius:99px}.rl-wdue span{display:block;margin-top:6px;font-size:13px;font-weight:700;color:#a61e47}" +
    ".rl-wdrop{grid-column:1/-1;display:flex;align-items:baseline;gap:10px;margin-top:4px}.rl-wdrop b{font-size:30px;letter-spacing:-.02em}.rl-wdrop s{color:#4b5563;font-size:16px}.rl-wdrop span{margin-left:auto;background:#c7f567;color:#16210a;border-radius:999px;padding:5px 10px;font-weight:800;font-size:13px}" +
    ".rl-wyear{font-size:15px;font-weight:800}.rl-wtiles{display:grid;grid-template-columns:1fr 1fr;gap:10px}" +
    ".rl-wtile{border-radius:18px;padding:14px;min-height:84px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18)}.rl-wtile span{font-size:14px;font-weight:700}.rl-wtile b{font-size:22px;letter-spacing:-.01em}" +
    // One reveal per slide.
    ".rl-wslide>*,.rl-wart>*{animation:rlup .55s cubic-bezier(.2,.8,.2,1) both}.rl-wslide>h1{animation-delay:.12s}.rl-wslide>p{animation-delay:.22s}" +
    ".rl-wart>*:nth-child(2){animation-delay:.08s}.rl-wart>*:nth-child(3){animation-delay:.16s}.rl-wart>*:nth-child(4){animation-delay:.24s}" +
    "@media(max-height:720px){.rl-wslide h1{font-size:clamp(28px,9vw,34px);margin-top:18px}.rl-wart{gap:8px;min-height:262px}.rl-wcard{padding:10px 12px}.rl-wbrand{margin-top:12px}}" +
    "@media(max-height:650px){.rl-wart{zoom:.8}}@media(max-height:590px){.rl-wart{display:none}.rl-wslide h1{margin-top:0}}" +
    "@media(prefers-reduced-motion:reduce){.rl-wslide>*,.rl-wart>*,.rl-wgo.rl-nudge{animation:none}.rl-welcome{transition:none}.rl-wbars .now i{animation:none;width:100%}}" +
    // A group's page: header, filters, receipts by month.
    ".rl-cat-back{all:unset;box-sizing:border-box;cursor:pointer;min-height:44px;display:inline-flex;align-items:center;gap:4px;padding:0 10px 0 0;border-radius:10px;font-weight:600;font-size:17px;color:var(--rl-accent)}.rl-cat-back-i{font-size:22px;line-height:1;margin-top:-2px}" +
    ".rl-cat-back:active{opacity:.6}.rl-cat-back:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px}" +
    ".rl-cat-hero{display:flex;gap:16px;align-items:center;border-radius:24px;padding:18px;margin:14px 0 14px}.rl-cat-hero h3{margin:0;font-family:var(--rl-sys);font-weight:800;font-size:28px;letter-spacing:-.02em;line-height:1.1}.rl-cat-hero-t span{display:block;font-size:14px;font-weight:600;opacity:.85;margin-top:4px}" +
    ".rl-cat-note{font-size:13.5px;color:var(--rl-text2);margin:-4px 2px 12px}" +
    ".rl-cat-chips{display:flex;gap:8px;overflow-x:auto;padding:2px;margin:0 -2px 12px;scrollbar-width:none}.rl-cat-chips::-webkit-scrollbar{display:none}" +
    ".rl-cat-chips button{all:unset;flex:none;box-sizing:border-box;cursor:pointer;min-height:44px;display:inline-flex;align-items:center;padding:0 16px;border-radius:999px;background:var(--rl-card);border:1px solid var(--rl-line);font-weight:700;font-size:14px;color:var(--rl-text)}" +
    ".rl-cat-chips button.on{background:var(--rl-text);color:var(--rl-bg);border-color:var(--rl-text)}.rl-cat-chips button:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px}" +
    ".rl-cat-search{width:100%;box-sizing:border-box;min-height:48px;padding:12px 16px;border:1px solid var(--rl-line);border-radius:14px;font-size:16px;background:var(--rl-card);font-family:inherit;margin:0 0 6px}" +
    ".rl-cat-month{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:18px 4px 8px}.rl-cat-month b{font-size:15px;color:var(--rl-text)}.rl-cat-month span{font-size:13px;color:var(--rl-text2)}" +
    ".rl-cat-list{background:var(--rl-card);border:1px solid var(--rl-line);border-radius:18px;overflow:hidden}" +
    ".rl-rr+.rl-rr{border-top:1px solid var(--rl-line)}.rl-rr.open{background:var(--rl-card)}" +
    ".rl-rr-main{all:unset;box-sizing:border-box;cursor:pointer;width:100%;min-height:68px;display:flex;align-items:center;gap:12px;padding:10px 14px;transition:background .15s}" +
    ".rl-rr-main:active{background:var(--rl-fill)}.rl-rr-main:focus-visible{outline:2px solid var(--rl-text);outline-offset:-2px}" +
    // Drawings for receipts with no photo or logo: the lines draw themselves in, then one part makes a small move, twice.
    ".rl-ill svg{overflow:visible}.rl-ill svg *{stroke-dasharray:1;stroke-dashoffset:1;animation:rlilldraw .8s cubic-bezier(.4,0,.2,1) forwards}.rl-ill svg .f{fill:currentColor;fill-opacity:.14}" +
    ".rl-ill svg :nth-child(2){animation-delay:.08s}.rl-ill svg :nth-child(3){animation-delay:.16s}.rl-ill svg :nth-child(n+4){animation-delay:.24s}@keyframes rlilldraw{to{stroke-dashoffset:0}}" +
    ".rl-ill svg .m{transform-box:fill-box;transform-origin:center;animation:rlilldraw .8s cubic-bezier(.4,0,.2,1) forwards,var(--mv,rlillhop) 1.1s ease-in-out .85s 2 alternate}" +
    ".ill-cup,.ill-pan,.ill-pint,.ill-candle{--mv:rlillrise}.ill-shoe,.ill-cake,.ill-gift,.ill-basket,.ill-paw,.ill-music,.ill-pizza,.ill-burger,.ill-shaker{--mv:rlillhop}" +
    ".ill-tshirt,.ill-jacket,.ill-dress,.ill-trousers,.ill-bag,.ill-flower,.ill-wine,.ill-bowl,.ill-ticket,.ill-lipstick{--mv:rlillsway}.ill-phone,.ill-lamp,.ill-headphones,.ill-laptop,.ill-plug{--mv:rlillblink}" +
    ".ill-wrench,.ill-dice,.ill-key,.ill-pill{--mv:rlilltwist}.ill-plane,.ill-delivery,.ill-car,.ill-train,.ill-suitcase{--mv:rlillglide}.ill-gem,.ill-perfume,.ill-jar,.ill-cloud,.ill-app,.ill-newspaper,.ill-book,.ill-target,.ill-gamepad,.ill-bed,.ill-sofa,.ill-parcel,.ill-shop{--mv:rlillpop}" +
    ".ill-sway .m,.ill-tshirt .m,.ill-jacket .m,.ill-dress .m,.ill-trousers .m,.ill-bag .m,.ill-flower .m{transform-origin:center top}" +
    "@keyframes rlillrise{from{transform:translateY(1px);opacity:.5}to{transform:translateY(-2px);opacity:1}}@keyframes rlillhop{from{transform:translateY(0)}to{transform:translateY(-2px)}}" +
    "@keyframes rlillsway{from{transform:rotate(-7deg)}to{transform:rotate(7deg)}}@keyframes rlillblink{from{opacity:.25}to{opacity:1}}@keyframes rlilltwist{from{transform:rotate(-12deg)}to{transform:rotate(12deg)}}" +
    "@keyframes rlillglide{from{transform:translate(-1.5px,1px)}to{transform:translate(1.5px,-1px)}}@keyframes rlillpop{from{transform:scale(.88)}to{transform:scale(1.06)}}" +
    "@media(prefers-reduced-motion:reduce){.rl-ill svg *{animation:none!important;stroke-dashoffset:0}}" +
    ".rl-rr-pic{flex:none;width:48px;height:48px;border-radius:14px;background:var(--rl-fill);display:grid;place-items:center;overflow:hidden;font-weight:800;font-size:15px;color:var(--rl-accent)}.rl-rr-pic.rl-has-photo img{width:100%;height:100%;object-fit:cover}" +
    ".rl-rr-mid{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.rl-rr-mid b{font-size:15.5px;color:var(--rl-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rl-rr-mid span{font-size:13.5px;color:var(--rl-text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".rl-rr-end{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px;text-align:right}.rl-rr-end b{font-size:15.5px;color:var(--rl-text)}" +
    ".rl-rr-chip{font-size:13px;font-weight:800;padding:3px 8px;border-radius:999px}.rl-rr-chip.green{background:var(--rl-accent-bg);color:var(--rl-accent)}.rl-rr-chip.amber{background:#ffefc9;color:#77520a}.rl-rr-chip.red{background:#fde0dd;color:#b3261e}" +
    // An opened receipt: when to return it and why, the shop's returns page, small buttons in a row, one question, its group.
    ".rl-ret{display:flex;flex-direction:column;gap:4px}.rl-ret+.rl-ret{margin-top:16px}" +
    ".rl-ret-top{display:flex;align-items:center;justify-content:space-between;gap:10px}.rl-ret-h{font-size:17px;font-weight:700;line-height:1.3;color:var(--rl-text)}" +
    ".rl-ret-why{display:block;font-size:14px;line-height:1.45;color:var(--rl-text2)}" +
    ".rl-ret-go span{color:inherit;font-size:inherit}.rl-order .rl-rr-chip{font-size:13px}.rl-po-ship .rl-jic{color:inherit}" +
    ".rl-ret-go{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;min-height:44px;font-size:15px;font-weight:700;color:var(--rl-accent);text-decoration:none;transition:opacity .12s}.rl-ret-go:active{opacity:.55}.rl-ret-go .rl-jic{margin:0}" +
    ".rl-ret-steps{display:flex;flex-direction:column;gap:4px;margin:4px 0}.rl-ret-steps>span{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--rl-text2)}.rl-ret-steps>span.done{color:var(--rl-accent);font-weight:600}.rl-ret-steps .rl-jic{margin:0;flex:none}" +
    ".rl-rc-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}" +
    ".rl-pill{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 18px;border-radius:999px;background:rgba(120,120,128,.16);color:var(--rl-text);font-size:15px;font-weight:700;text-align:center;text-decoration:none;transition:transform .12s,opacity .12s}" +
    ".rl-pill:active{transform:scale(.96)}.rl-pill:disabled{opacity:.5;cursor:default}.rl-pill:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px}.rl-pill.rl-pill-on{background:var(--lime,#c7f567);color:var(--navy,#101828)}" +
    ".rl-rc-ask{display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--rl-line)}.rl-rc-ask>span{flex:1;min-width:0;font-size:15px;font-weight:600;line-height:1.35;color:var(--rl-text)}.rl-rc-ask .rl-pill{padding:0 20px}" +
    ".rl-rc-group{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;margin-top:12px;border-top:1px solid var(--rl-line);font-size:15px;color:var(--rl-text2)}" +
    ".rl-rc-pickw{position:relative;display:inline-flex;align-items:center}.rl-rc-pickw .rl-jic{position:absolute;right:0;pointer-events:none;margin:0;color:var(--rl-text2)}" +
    ".rl-rc-pick{appearance:none;-webkit-appearance:none;border:0;background:transparent;color:var(--rl-text);font:inherit;font-size:15px;font-weight:700;text-align:right;min-height:44px;padding:0 24px 0 8px;cursor:pointer}.rl-rc-pick:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px;border-radius:8px}" +
    // A receipt that was a present: a switch (like the phone's own), then who it was for.
    ".rl-rc-gift{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;border-top:1px solid var(--rl-line);font-size:15px;color:var(--rl-text2)}" +
    ".rl-rc-gift-l{display:inline-flex;align-items:center;gap:8px;min-width:0}.rl-rc-gift-l .rl-jic{flex:none;margin:0;color:var(--rl-text2)}" +
    ".rl-sw{all:unset;box-sizing:border-box;flex:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:flex-end;min-width:60px;min-height:44px;-webkit-tap-highlight-color:transparent}" +
    ".rl-sw i{position:relative;display:block;width:51px;height:31px;border-radius:999px;background:rgba(120,120,128,.32);transition:background .2s}" +
    ".rl-sw i::after{content:'';position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:999px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.22);transition:transform .22s cubic-bezier(.2,.8,.2,1),width .15s}" +
    ".rl-sw[aria-checked=true] i{background:var(--rl-accent)}.rl-sw[aria-checked=true] i::after{transform:translateX(20px)}" +
    ".rl-sw:active i::after{width:32px}.rl-sw[aria-checked=true]:active i::after{transform:translateX(15px)}" +
    ".rl-sw:disabled{cursor:default;opacity:.55}.rl-sw:focus-visible i{outline:2px solid var(--rl-text);outline-offset:2px}" +
    ".rl-rc-giftfor{display:flex;align-items:center;gap:8px;margin:0 0 4px}" +
    ".rl-rc-giftfor input{flex:1;min-width:0;box-sizing:border-box;min-height:44px;margin:0;padding:0 14px;border:0;border-radius:12px;background:var(--rl-fill);color:var(--rl-text);font:inherit;font-size:16px}" +
    ".rl-rc-giftfor input::placeholder{color:var(--rl-text2)}.rl-rc-giftfor input:focus-visible{outline:2px solid var(--rl-accent);outline-offset:1px}" +
    ".rl-rc-gift-note{margin:2px 0 6px;font-size:13px;line-height:1.4;color:var(--rl-text2)}.rl-rc-gift-note:empty{display:none}" +
    // "Fix this receipt": the row under the gift switch, and the sheet itself.
    ".rl-rc-fix{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;margin-top:4px;border-top:1px solid var(--rl-line);font-size:15px;color:var(--rl-text2)}.rl-rc-fix .rl-pill{flex:none;padding:0 16px}" +
    ".rl-fix h2{margin:0 0 6px;font-size:22px;font-weight:800;letter-spacing:-.01em;color:var(--rl-text)}.rl-fix-lead{margin:0 0 14px;font-size:15px;line-height:1.45;color:var(--rl-text2)}" +
    ".rl-fix-f{display:flex;flex-direction:column;gap:6px;margin:0 0 12px;min-width:0}.rl-fix-f>span:first-child,.rl-fix-h{font-size:13px;font-weight:700;color:var(--rl-text2)}" +
    ".rl-fix input{box-sizing:border-box;width:100%;min-width:0;min-height:48px;margin:0;padding:0 14px;border:0;border-radius:12px;background:var(--rl-fill);color:var(--rl-text);font:inherit;font-size:16px}" +
    ".rl-fix input::placeholder{color:var(--rl-text2)}.rl-fix input:focus-visible{outline:2px solid var(--rl-accent);outline-offset:1px}" +
    ".rl-fix-2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}" +
    ".rl-fix-money{position:relative;display:block;min-width:0}.rl-fix-money i{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-style:normal;font-size:16px;color:var(--rl-text2);pointer-events:none}.rl-fix-money input{padding-left:30px}" +
    ".rl-fix-items{margin:2px 0 8px}.rl-fix-h{display:block;margin:0 0 8px}.rl-fix-item{display:grid;grid-template-columns:minmax(0,1fr) 96px 44px;gap:8px;align-items:center;margin:0 0 8px}" +
    ".rl-fix-x{all:unset;box-sizing:border-box;width:44px;height:44px;display:grid;place-items:center;border-radius:12px;color:var(--rl-text2);cursor:pointer}.rl-fix-x:active{background:var(--rl-fill)}.rl-fix-x:focus-visible{outline:2px solid var(--rl-text);outline-offset:1px}" +
    ".rl-fix-add{all:unset;box-sizing:border-box;min-height:44px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:15px;font-weight:700;color:var(--rl-accent)}.rl-fix-add:active{opacity:.6}.rl-fix-add:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px;border-radius:8px}" +
    ".rl-fix .rl-jic{margin:0}.rl-fix-x .rl-jic{color:inherit}" +
    // "Send this email to Relay": what will be sent, then an optional note.
    ".rl-fix textarea{box-sizing:border-box;width:100%;min-width:0;min-height:88px;margin:0;padding:12px 14px;border:0;border-radius:12px;background:var(--rl-fill);color:var(--rl-text);font:inherit;font-size:16px;line-height:1.4;resize:vertical}" +
    ".rl-fix textarea::placeholder{color:var(--rl-text2)}.rl-fix textarea:focus-visible{outline:2px solid var(--rl-accent);outline-offset:1px}" +
    ".rl-fix-more{margin:4px 0 10px;padding-top:10px;border-top:1px solid var(--rl-line)}.rl-fix-more p{margin:0;font-size:14px;line-height:1.4;color:var(--rl-text2)}" +
    ".rl-share-box{max-height:38vh;overflow:auto;margin:0 0 10px;padding:12px 14px;border-radius:12px;background:var(--rl-fill);color:var(--rl-text);font-size:14px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}" +
    ".rl-share-box.rl-skel{min-height:180px}.rl-share-box b{display:block;font-size:15px;margin:0 0 2px}.rl-share-box .rl-share-from{display:block;font-size:13px;color:var(--rl-text2);margin:0 0 10px}" +
    ".rl-share-box i{display:block;margin-top:10px;font-style:normal;color:var(--rl-text2)}.rl-share-box:focus-visible{outline:2px solid var(--rl-accent);outline-offset:1px}" +
    ".rl-share-check{margin:0 0 12px;font-size:14px;line-height:1.4;color:var(--rl-text2)}.rl-fix [hidden],.rl-se [hidden]{display:none!important}" +
    // AI help: a switch with what it means underneath, on the Email connection page.
    ".rl-aih{margin:22px 0 6px;padding:16px 18px;border-radius:18px;background:var(--rl-card);border:1px solid var(--rl-line)}" +
    ".rl-aih-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.rl-aih-top b{font-size:16px;line-height:1.3;color:var(--rl-text)}" +
    ".rl-aih p{margin:8px 0 0;font-size:14px;line-height:1.45;color:var(--rl-text2)}.rl-aih p.rl-msg{color:var(--rl-text)}.rl-aih p.rl-msg:empty{display:none}" +
    ".rl-rc-ai{margin:6px 0 2px;font-size:14px;line-height:1.4;color:var(--rl-text2)}" +
    // Swap & resell: a segmented switch between its three parts, and its cards and form.
    ".rl-mk-tabs{display:flex;gap:4px;margin:10px 0 6px;padding:4px;border-radius:14px;background:var(--rl-fill)}" +
    ".rl-mk-tabs button{all:unset;box-sizing:border-box;flex:1;min-height:44px;display:grid;place-items:center;border-radius:11px;font-size:15px;font-weight:700;color:var(--rl-text);cursor:pointer;-webkit-tap-highlight-color:transparent}" +
    ".rl-mk-tabs button[aria-pressed=true]{background:#c7f567;color:#101828}.rl-mk-tabs button:active{transform:scale(.97)}.rl-mk-tabs button:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px}" +
    ".rl-mk-lead{font-size:15px;line-height:1.45;color:var(--rl-text2)}.rl-mk-skel{min-height:110px;margin:10px 0;border-radius:18px}" +
    ".rl-mk-area{display:flex;gap:8px;align-items:center;margin:12px 0;color:var(--rl-text2)}.rl-mk-area .rl-jic{margin:0;flex:none}" +
    ".rl-mk-area input,.rl-mk-form input:not([type=checkbox]),.rl-mk-form select,.rl-mk-select{box-sizing:border-box;width:100%;min-width:0;min-height:44px;margin:0;padding:0 14px;border:1px solid var(--rl-line);border-radius:12px;font:inherit;font-size:16px;background:var(--rl-card);color:var(--rl-text)}" +
    ".rl-mk-select{margin-top:8px}.rl-mk-area input{flex:1}" +
    ".rl-mk-near{display:inline-flex;align-items:center;gap:4px;margin-top:6px;padding:3px 10px;border-radius:999px;background:var(--rl-accent-bg);color:var(--rl-accent);font-size:13px;font-weight:700}.rl-mk-near .rl-jic{margin:0}" +
    ".rl-mk-quote,.rl-mk-status{display:block;margin-top:6px;font-size:14px;line-height:1.4;color:var(--rl-text2)}.rl-mk-warn{display:block;margin-top:6px;font-size:14px;line-height:1.4;color:var(--rl-text)}" +
    ".rl-mk-req{margin-top:10px;padding:10px 12px;border-radius:12px;background:var(--rl-fill);font-size:14px;line-height:1.4;color:var(--rl-text)}.rl-mk-req b{display:block}.rl-mk-req>span{display:block;margin-top:2px}" +
    ".rl-mk-acts{display:flex;gap:8px;margin-top:8px}.rl-mk-acts .rl-btn{flex:1;margin:0}.rl-order .rl-btn{margin-top:10px}" +
    ".rl-mk-h{margin:18px 0 6px;font-size:17px;color:var(--rl-text)}" +
    ".rl-mk-form{margin-top:10px}.rl-mk-field{display:flex;flex-direction:column;gap:6px;margin:0 0 10px}.rl-mk-field>span{font-size:13px;font-weight:700;color:var(--rl-text2)}" +
    ".rl-mk-note{display:block;margin:-4px 0 10px;font-size:13px;line-height:1.4;color:var(--rl-text2)}" +
    ".rl-mk-check{display:flex;align-items:center;gap:12px;min-height:44px;margin:2px 0;font-size:15px;line-height:1.35;color:var(--rl-text);cursor:pointer}" +
    ".rl-mk-check input{width:22px;height:22px;flex:none;margin:0;accent-color:var(--rl-accent)}.rl-mk-check.small{font-size:14px;color:var(--rl-text2);padding:6px 0}" +
    ".rl-mk-form [hidden]{display:none!important}" +
    ".rl-btn.rl-mk-report{min-height:44px;margin-top:6px;font-size:14px;font-weight:600;color:var(--rl-text2)}" +
    // Search by photo (Discover).
    ".rl-ps-pic{display:block;width:100%;max-height:220px;object-fit:contain;border-radius:16px;background:var(--rl-fill);margin:0 0 10px}" +
    ".rl-ps-note{margin:0 0 12px;font-size:13px;line-height:1.45;color:var(--rl-text2)}.rl-ps-looks{margin:4px 0 10px;font-size:15px;line-height:1.4;color:var(--rl-text)}" +
    ".rl-ps-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 12px}.rl-ps-skel{min-height:200px;border-radius:16px}" +
    ".rl-ps-item{display:flex;flex-direction:column;gap:4px;min-height:44px;box-sizing:border-box;padding:8px 8px 10px;border:1px solid var(--rl-line);border-radius:16px;background:var(--rl-card);color:var(--rl-text);font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s}" +
    ".rl-ps-item:active{transform:scale(.97)}.rl-ps-item:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px}" +
    ".rl-ps-img{aspect-ratio:1/1;border-radius:12px;overflow:hidden;background:var(--rl-fill);display:grid;place-items:center;margin:0 0 4px}.rl-ps-img img{width:100%;height:100%;object-fit:cover}" +
    ".rl-ps-item b{font-size:14px;line-height:1.3;overflow-wrap:anywhere}.rl-ps-item span{font-size:13px;line-height:1.3;color:var(--rl-text2)}.rl-ps-item .rl-ps-price{font-weight:700;color:var(--rl-text)}" +
    // Swap with another shop.
    ".rl-xs-h{margin:6px 0 6px;font-size:24px;line-height:1.2;color:var(--rl-text)}.rl-xs-lead{margin:0 0 14px;font-size:15px;line-height:1.45;color:var(--rl-text2)}" +
    ".rl-xs-list{display:flex;flex-direction:column;gap:8px;margin:0 0 12px}.rl-xs-skel{min-height:68px;border-radius:16px}" +
    ".rl-xs-shop{margin:12px 0 2px;font-size:17px;color:var(--rl-text)}" +
    ".rl-xs-item{display:flex;align-items:center;gap:12px;width:100%;min-height:68px;box-sizing:border-box;padding:10px 12px;border:1px solid var(--rl-line);border-radius:16px;background:var(--rl-card);color:var(--rl-text);font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s,background .12s}" +
    ".rl-xs-item:active{transform:scale(.98);background:var(--rl-fill)}.rl-xs-item:focus-visible,.rl-xs-chip:focus-visible{outline:2px solid var(--rl-text);outline-offset:2px}" +
    ".rl-xs-pic{flex:none;width:48px;height:48px;border-radius:12px;overflow:hidden;background:var(--rl-fill);display:grid;place-items:center}.rl-xs-pic img{width:100%;height:100%;object-fit:cover}" +
    ".rl-xs-name{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.rl-xs-name b{font-size:15px;line-height:1.3;overflow-wrap:anywhere}.rl-xs-name span{font-size:13px;color:var(--rl-text2)}" +
    ".rl-xs-price{flex:none;font-size:15px;font-weight:700}" +
    ".rl-xs-leg{display:flex;flex-direction:column;gap:3px;margin:0 0 8px;padding:14px 16px;border-radius:16px;background:var(--rl-card);border:1px solid var(--rl-line)}" +
    ".rl-xs-leg>span:first-child{font-size:13px;font-weight:700;color:var(--rl-text2)}.rl-xs-leg b{font-size:16px;color:var(--rl-text);overflow-wrap:anywhere}.rl-xs-leg>span:last-child{font-size:14px;line-height:1.4;color:var(--rl-text2)}" +
    ".rl-xs-net{margin:12px 0 4px;font-size:15px;font-weight:700;line-height:1.4;color:var(--rl-text)}.rl-xs-q{margin:14px 0 8px;font-size:15px;font-weight:700;color:var(--rl-text)}" +
    ".rl-xs-reasons{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}" +
    ".rl-xs-chip{min-height:44px;padding:10px 14px;border-radius:999px;border:1.5px solid var(--rl-line);background:var(--rl-card);color:var(--rl-text);font:inherit;font-size:14px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s}" +
    ".rl-xs-chip:active{transform:scale(.96)}.rl-xs-chip[aria-checked=true]{background:var(--rl-text);border-color:var(--rl-text);color:var(--rl-bg)}" +
    ".rl-xs-small{margin:0 0 12px;font-size:13px;line-height:1.45;color:var(--rl-text2)}.rl-xs-p{margin:0 0 12px;font-size:15px;line-height:1.45;color:var(--rl-text)}" +
    ".rl-xs-ref{display:flex;flex-direction:column;gap:2px;margin:0 0 12px;padding:14px 16px;border-radius:16px;background:var(--rl-fill)}.rl-xs-ref span{font-size:13px;line-height:1.4;color:var(--rl-text2)}.rl-xs-ref b{font-size:18px;letter-spacing:1px;color:var(--rl-text)}" +
    ".rl-xs-qr{display:block;width:200px;height:200px;margin:0 auto 8px;image-rendering:pixelated;border-radius:12px;background:#fff}" +
    ".rl-xs-buy{display:flex;align-items:center;justify-content:center;gap:8px;box-sizing:border-box;text-decoration:none;margin:0 0 8px}.rl-xs-buy .rl-jic{margin:0}" +
    ".rl-se-card{margin:0 0 12px;padding:16px 18px}.rl-se-card>b{display:block;font-size:16px;color:var(--rl-text);overflow-wrap:anywhere}" +
    ".rl-se-card>span{display:block;margin-top:2px;font-size:13px;line-height:1.4;color:var(--rl-text2)}.rl-se-note{margin:8px 0 0;font-size:15px;line-height:1.4;color:var(--rl-text)}" +
    ".rl-se-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.rl-se-acts .rl-pill{padding:0 16px}.rl-se-body{margin-top:12px}.rl-se-body .rl-hp-rows{margin:0 0 10px}" +
    ".rl-se-body .rl-hp-row:first-child{border-top:0}" +
    ".rl-rr-picw{position:relative;flex:none;display:block}.rl-rr-gift{position:absolute;right:-5px;bottom:-5px;width:22px;height:22px;border-radius:999px;display:grid;place-items:center;background:#c7f567;color:#101828;box-shadow:0 0 0 2px var(--rl-card)}.rl-rr-gift.rl-jic{margin:0}" +
    ".rl-btn.ghost.rl-plain{border-color:transparent;margin-top:2px}" +
    ".rl-rr-detail{padding:0 14px 14px}.rl-rr-items{font-size:14px;color:var(--rl-text2);margin:0 0 8px}.rl-rr-acts{display:flex;gap:8px;margin:10px 0 0}.rl-rr-move{margin-top:10px;width:100%;min-height:44px}.rl-rr-note{display:block;font-size:13px;color:var(--rl-text2);margin-top:4px}" +
    ".rl-cat-more{display:block;margin:14px auto 0;width:auto;min-height:44px;padding:0 20px}" +
    "@media(max-width:420px){.rl-cat-hero h3{font-size:24px}.rl-rr-main{padding:10px 12px;gap:10px}.rl-rr-pic{width:44px;height:44px}}" +
    // The phone keyboard never covers what you're typing in a sheet: the sheet sits above it.
    ".rl-back{padding-bottom:var(--rl-kb,0px);transition:padding-bottom .15s}.rl-sheet{max-height:calc(88dvh - var(--rl-kb,0px))}" +
    // November 2026 polish: a wallet card is one tappable card with no buttons on it (its page, a sheet, has them): what it
    // is and the price, the shop under it, then the time left to send it back.
    ".rl-po.rl-tap{cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s;padding:14px 16px;gap:12px;border-radius:20px}" +
    ".rl-po.rl-tap:active{transform:scale(.985)}.rl-po.rl-tap:focus-visible{outline:3px solid var(--rl-accent);outline-offset:2px}" +
    ".rl-po.rl-tap .rl-po-top{gap:12px}.rl-po.rl-tap .rl-po-img{width:64px;height:64px;border-radius:14px}" +
    ".rl-po.rl-tap h3.rl-po-brand{font-size:17px;font-weight:600;letter-spacing:0}.rl-po.rl-tap .rl-po-price{font-size:17px;font-weight:600}" +
    ".rl-po.rl-tap .rl-po-meta{font-size:15px;margin-top:1px}.rl-po.rl-tap .rl-po-ship{margin-top:4px}" +
    ".rl-due{gap:7px;padding:0}.rl-due-t{font-size:15px}.rl-due-t b{font-weight:600}.rl-due-bar{height:4px}" +
    ".pill.rl-count{background:none;color:var(--rl-text2);padding:0;font-size:15px;font-weight:400}" +
    ".rl-dt-head{display:flex;gap:14px;align-items:center;margin:0 0 16px}.rl-dt-head h2{margin:0 0 2px}.rl-dt-head .rl-dt-sub{margin:0}.rl-dt-name{min-width:0}" +
    ".rl-po-img.rl-dt-pic{width:72px;height:72px;border-radius:16px}" +
    ".rl-dt-acts{display:flex;flex-direction:column;gap:10px;margin:0 0 16px}.rl-dt-acts>*{flex:none;width:100%;min-height:50px;font-size:16px;box-sizing:border-box}" +
    ".rl-dt-acts .rl-po-mark{display:inline-flex;align-items:center;justify-content:center;background:var(--rl-fill);color:var(--rl-text);border-color:transparent;gap:8px}" +
    // A shop's logo sits on white in light and dark, like an app icon, so dark logos stay readable.
    ".rl-po .rl-po-img.rl-has-logo,.rl-dt-head .rl-po-img.rl-has-logo{background:#fff!important;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.1)}" +
    ".rl-dt-facts{margin:16px 0 0;border-radius:16px;background:var(--rl-card);padding:0 16px}" +
    "@media (prefers-color-scheme: dark){.rl-dt-facts{background:rgba(255,255,255,.07)}}" +
    ".rl-dt-fact{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:12px 0;border-top:.5px solid var(--rl-line);font-size:15px;line-height:1.35}.rl-dt-fact:first-child{border-top:0}" +
    ".rl-dt-fact span{color:var(--rl-text2);flex:none}.rl-dt-fact b{font-weight:500;text-align:right;overflow-wrap:anywhere;color:var(--rl-text)}" +
    // Grouped lists like the phone's Settings: no outline, and the line between rows starts after the icon.
    ".rl-acard{border:0}.rl-arow{position:relative}.rl-arow+.rl-arow{border-top:0}" +
    ".rl-arow+.rl-arow::before{content:'';position:absolute;top:0;left:60px;right:0;border-top:.5px solid var(--rl-line)}" +
    // Receipts: no status line until there's news, the add-a-receipt row, and one search box in a group.
    ".rl-recstat{margin:12px 0 0}.rl-recstat .rl-msg:empty{min-height:0;margin:0}.rl-recstat:has(.rl-msg:empty){display:none}" +
    ".rl-rec-more{margin:22px 0 0}.rl-find-link{text-decoration:none}" +
    ".rl-in-cat>.rl-search{display:none}" +
    ".rl-cat-search{border:0;border-radius:12px;background:var(--rl-fill);min-height:44px;padding:0 14px;font-size:17px;margin:0 0 4px}" +
    ".rl-cat-back{font-weight:400;gap:2px;margin:0 0 2px -8px;padding:0 10px 0 2px}.rl-cat-back .rl-jic{margin:0;width:24px;height:24px}" +
    ".rl-cat-chips button{border:0;background:var(--rl-fill);font-size:15px;font-weight:600}" +
    ".rl-cat-month{margin:20px 4px 8px}.rl-cat-month b{font-size:17px;font-weight:600}.rl-cat-month span{font-size:15px}.rl-cat-list{border:0}" +
    // Profile's inner pages are screens of their own: no box around them, and the bar names the page instead of the title.
    "#view:has(#mePage>.rl-abar)>.title{display:none}" +
    ".rl-inpage .rl-ahead{border:0}.rl-inpage .rl-asub{background:none;border:0;border-radius:0;padding:0;margin-top:2px}" +
    // The help chat: plain bubbles, the AI named once, and Talk to a person as a quiet button.
    ".rl-chat-b.bot p{border:0}.rl-chat-bar{border:0;background:var(--rl-glass);-webkit-backdrop-filter:blur(30px) saturate(1.8);backdrop-filter:blur(30px) saturate(1.8)}" +
    ".rl-chat-person{border:0!important;background:none!important;color:var(--rl-accent)!important;margin-top:4px}" +
    // Swap & resell listings: name and price, shop and size, then tags, without a border.
    ".rl-mk-card{border:0;display:block;padding:14px 16px}.rl-mk-card>*{display:block}.rl-mk-card>[hidden]{display:none!important}.rl-mk-from{margin-top:2px}.rl-mk-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}" +
    ".rl-mk-top b{font-size:17px;font-weight:600}.rl-mk-price{font-size:17px;font-weight:600;white-space:nowrap;color:var(--rl-text)}.rl-mk-from{font-size:15px;color:var(--rl-text2)}" +
    ".rl-mk-card>.rl-mk-top,.rl-mk-card>.rl-mk-tags{display:flex}.rl-mk-tags{flex-wrap:wrap;gap:6px;margin:6px 0 2px}.rl-mk-tag{font-size:13px;font-weight:600;padding:4px 9px;border-radius:999px;background:var(--rl-fill);color:var(--rl-text)}" +
    ".rl-mk-card .rl-mk-top .rl-mk-price{color:var(--rl-text)}.rl-mk-card>.rl-mk-near{display:inline-flex}" +
    ".rl-mk-acts{display:flex;gap:8px;margin-top:10px}.rl-mk-acts .rl-btn{flex:1;margin:0;min-height:48px;padding:12px 10px;font-size:16px}" +
    ".rl-mk-card .rl-mk-select:not([hidden]){display:block;margin-top:8px}.rl-mk-card .rl-mk-report{margin-top:4px;font-size:15px;color:var(--rl-text2)}" +
    // Delivery details and buying at a shop's website with them filled in.
    ".rl-dl-intro{font-size:15px;line-height:1.45;color:var(--rl-text2);margin:0 0 14px}.rl-dl-item{display:flex;flex-direction:column;gap:2px;margin:0 0 16px}" +
    ".rl-dl-item b{font-size:17px;font-weight:600;color:var(--rl-text)}.rl-dl-item span{font-size:15px;color:var(--rl-text2)}" +
    ".rl-dl-to{margin:0 0 6px}.rl-dl-to .rl-dt-fact b{white-space:pre-line;line-height:1.4}.rl-dl-link,.rl-dl-open{display:flex;align-items:center;justify-content:center;box-sizing:border-box;text-decoration:none;min-height:50px}" +
    ".rl-dl-done{display:flex;flex-direction:column;gap:10px;margin:4px 0 16px}.rl-dl-tick{display:flex;align-items:flex-start;gap:10px;font-size:16px;line-height:1.35;color:var(--rl-text)}" +
    ".rl-dl-tick .rl-jic{flex:none;margin:1px 0 0;color:var(--rl-accent)}.rl-dl-tick.no .rl-jic{color:var(--rl-warn)}";
  document.head.appendChild(css);
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === "text") n.textContent = props[k]; else if (k.indexOf("data-") === 0) n.setAttribute(k, props[k]); else n[k] = props[k]; });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  // Receipt group icons: simple line drawings on a soft tile, one colour pair per group (no emoji, which look different on every phone).
  // Each kind of shopping's tile colour on the Receipts page.
  var TILE_COLOURS = { fashion: "#E0446E", food: "#D47B1F", electronics: "#4F72E0", home: "#2E9E5B", beauty: "#B455C9", travel: "#6662D9",
    digital: "#14918A", experiences: "#E0612F", other: "#7A7F8C", shop: "#2B3A5C",
    // Gifts aren't a kind of shopping: the tile of what you bought for other people is Relay's own lime, with navy text.
    gifts: "#C7F567" };
  // A wrapped present, for gifts (drawn lines, never an emoji).
  var GIFT_PATH = '<rect x="3.5" y="8" width="17" height="4.5" rx="1.2"/><path d="M5 12.5v8h14v-8M12 8v12.5"/><path d="M12 8C10.6 5.2 7.6 4 6.8 5.6 6.1 7 8.4 8 12 8Zm0 0c1.4-2.8 4.4-4 5.2-2.4.7 1.4-1.6 2.4-5.2 2.4Z"/>';
  var CAT_ICONS = {
    fashion: ["#FCE7F3", "#9D174D", '<path d="M9 3.5 4 5.8 2.5 10l3.2 1.3L7 10v10.5h10V10l1.3 1.3 3.2-1.3L20 5.8 15 3.5c-.4 1.5-1.6 2.5-3 2.5s-2.6-1-3-2.5Z"/>'],
    electronics: ["#E0F2FE", "#075985", '<rect x="4.5" y="5" width="15" height="10.5" rx="1.5"/><path d="M2.5 19h19"/>'],
    food: ["#FEF3C7", "#92400E", '<path d="M4.5 9.5h12v4.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5Z"/><path d="M16.5 11h1.25a2.25 2.25 0 0 1 0 4.5H16"/><path d="M8.5 3.5c-.6.8-.6 1.7 0 2.5M12.5 3.5c-.6.8-.6 1.7 0 2.5"/>'],
    home: ["#ECFCCB", "#3F6212", '<path d="M3.5 10.5 12 4l8.5 6.5"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>'],
    beauty: ["#FAE8FF", "#86198F", '<path d="M11 3.5c.5 3.6 2.4 5.5 6 6-3.6.5-5.5 2.4-6 6-.5-3.6-2.4-5.5-6-6 3.6-.5 5.5-2.4 6-6Z"/><path d="M18 14.5c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z"/>'],
    travel: ["#E0E7FF", "#3730A3", '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5v-2A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5v2"/><path d="M3.5 12.5h17"/>'],
    experiences: ["#FFEDD5", "#9A3412", '<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v2a2.5 2.5 0 0 0 0 5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-2a2.5 2.5 0 0 0 0-5Z"/><path d="M14.5 6v12" stroke-dasharray="1.5 2"/>'],
    digital: ["#CCFBF1", "#115E59", '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M10 9.2v5.6l4.6-2.8Z"/>'],
    other: ["#F1F5F9", "#334155", '<path d="M6.5 3.5h11v17l-1.85-1.2-1.85 1.2-1.8-1.2-1.85 1.2-1.8-1.2-1.85 1.2Z"/><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3"/>'],
    shop: ["rgba(199,245,103,.16)", "#c7f567", '<path d="M5 8h14l-1.2 12.5H6.2Z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>'],
    gifts: ["rgba(16,24,40,.1)", "#101828", GIFT_PATH]
  };
  function catIcon(k, size) {
    var c = CAT_ICONS[k] || CAT_ICONS.other, px = size || 44;
    var tile = el("span", { className: "rl-cat-ico", style: "display:inline-grid;place-items:center;flex:none;width:" + px + "px;height:" + px + "px;border-radius:" + Math.round(px * 0.32) + "px;background:" + c[0] + ";color:" + c[1] });
    tile.setAttribute("aria-hidden", "true");
    var g = Math.round(px * 0.55);
    tile.innerHTML = '<svg viewBox="0 0 24 24" width="' + g + '" height="' + g + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + c[2] + "</svg>";
    return tile;
  }

  // ---- Your name and photo. Only you see them: Relay never shows them to shops or other members. ----
  var PHOTO_SHAPE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/]+={0,2}$/;
  function profileNow() {
    var s = load(); if (!s || !s.token) return null;
    var p = null; try { p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); } catch (e) {}
    if (!p || p.email !== s.email) p = {};
    return { email: s.email || "", name: typeof p.name === "string" ? p.name : null, photo: PHOTO_SHAPE.test(p.photo || "") ? p.photo : null };
  }
  function keepProfile(p) {
    var s = load();
    try { if (s && p) localStorage.setItem(PROFILE_KEY, JSON.stringify({ email: s.email, name: p.name || null, photo: p.photo || null })); } catch (e) {}
  }
  var profileWatchers = [];
  function profileChanged() {
    paintAvatars();
    // Each screen showing the name or photo redraws itself; one that has been closed drops out.
    profileWatchers = profileWatchers.filter(function (f) { try { return f() !== false; } catch (e) { return false; } });
  }
  // Both initials, like the top of Spotify or Apple Music: "Sam Taylor" is ST. With no name yet, the email's
  // own parts are used (connor.gamble@ is CG); a single word gives its first letter.
  function firstLetter(p) {
    function first(w) { return Array.from(w)[0].toUpperCase(); }
    var name = String((p && p.name) || "").trim();
    var words = name ? name.split(/[\s\-]+/) : String((p && p.email) || "").split("@")[0].split(/[._+\-\d]+/);
    words = words.filter(function (w) { return /^\p{L}/u.test(w); });
    if (words.length > 1) return first(words[0]) + first(words[words.length - 1]);
    if (words.length) return first(words[0]);
    var t = name || String((p && p.email) || "").trim();
    return t ? first(t) : "R";
  }
  // A round picture of the shopper: their photo, or the first letter of their name (or email).
  function face(p, px) {
    var n = el("span", { className: "rl-face", style: "width:" + px + "px;height:" + px + "px;font-size:" + Math.round(px * 0.38) + "px" });
    n.setAttribute("aria-hidden", "true");
    if (p && p.photo) n.appendChild(el("img", { src: p.photo, alt: "" })); else n.textContent = firstLetter(p);
    return n;
  }
  // The round button at the top of every page.
  function paintAvatars() {
    var p = profileNow();
    Array.prototype.forEach.call(document.querySelectorAll(".avatar"), function (a) {
      var photo = Boolean(p && p.photo);
      a.classList.toggle("rl-has-photo", photo);
      a.style.backgroundImage = photo ? 'url("' + p.photo + '")' : "";
      a.textContent = photo ? "" : p ? firstLetter(p) : "R";
    });
  }
  var profileLoading = null;
  function loadProfile() {
    var s = load(); if (!s || !s.token) return Promise.resolve(null);
    if (!profileLoading) profileLoading = api("/relay/my/profile").then(function (r) {
      profileLoading = null;
      if (r.ok && r.body && r.body.email === (load() || {}).email) { keepProfile(r.body); profileChanged(); }
      return profileNow();
    }, function () { profileLoading = null; return profileNow(); });
    return profileLoading;
  }
  // Cuts the chosen photo to a centred square and shrinks it to 256 × 256 on this device. Re-drawing it also leaves the
  // camera's details (like where it was taken) behind. Only this small copy is sent to Relay.
  function squarePhoto(file) {
    return new Promise(function (resolve, reject) {
      if (file.type && !/^image\//.test(file.type)) return reject(new Error("not a picture"));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight, side = Math.min(w, h);
          if (!side) throw new Error("empty");
          var c = document.createElement("canvas"); c.width = c.height = 256;
          var g = c.getContext("2d"); g.fillStyle = "#ffffff"; g.fillRect(0, 0, 256, 256); g.imageSmoothingQuality = "high";
          g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 256, 256);
          var out = c.toDataURL("image/jpeg", 0.86);
          if (out.length > 180000) out = c.toDataURL("image/jpeg", 0.7);
          URL.revokeObjectURL(url);
          if (!PHOTO_SHAPE.test(out)) throw new Error("couldn't make a picture");
          resolve(out);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
      img.src = url;
    });
  }
  function profileView(sheet, onBack, backLabel) {
    var p = profileNow() || { email: "" };
    var photo = p.photo, photoChanged = false;
    var msg = el("div", { className: "rl-msg" });
    var nameIn = el("input", { type: "text", id: "rl-name", maxLength: 40, autocomplete: "name", placeholder: "Your name", value: p.name || "" });
    nameIn.setAttribute("aria-label", "Your name");
    var holder = el("div", { style: "display:flex;justify-content:center;margin:4px 0 12px" });
    var file = el("input", { type: "file", accept: "image/*", style: "display:none" });
    file.setAttribute("aria-label", "Choose a profile photo");
    var pick = el("button", { type: "button", className: "rl-btn ghost", style: "margin-top:0", onclick: function () { file.click(); } });
    var drop = el("button", { type: "button", className: "rl-btn ghost", text: "Remove photo", onclick: function () { photo = null; photoChanged = true; draw(); } });
    function draw() {
      holder.textContent = "";
      holder.appendChild(el("button", { type: "button", ariaLabel: photo ? "Change your photo" : "Add a photo", style: "all:unset;cursor:pointer;border-radius:50%", onclick: function () { file.click(); } },
        [face({ email: p.email, name: nameIn.value.trim() || p.name, photo: photo }, 96)]));
      pick.textContent = photo ? "Choose a different photo" : "Add a photo";
      drop.style.display = photo ? "" : "none";
    }
    file.onchange = function () {
      var f = file.files && file.files[0]; file.value = "";
      if (!f) return;
      say(msg, "Getting your photo ready…");
      squarePhoto(f).then(function (d) { photo = d; photoChanged = true; draw(); say(msg, ""); },
        function () { say(msg, "That photo couldn't be opened. Try a JPEG or PNG photo.", true); });
    };
    nameIn.addEventListener("input", function () { if (!photo) draw(); });
    var saveBtn = el("button", { type: "button", className: "rl-btn", text: "Save" });
    saveBtn.onclick = function () {
      var body = { name: nameIn.value.trim() || null };
      if (photoChanged) body.photo = photo;
      saveBtn.disabled = true; say(msg, "Saving…");
      api("/relay/my/profile", { method: "POST", body: body }).then(function (r) {
        saveBtn.disabled = false;
        if (r.ok) { keepProfile(r.body); profileChanged(); say(msg, "Saved."); if (onBack) onBack(); return; }
        say(msg, r.body && r.body.error === "bad_name" ? "Use letters, spaces, hyphens or apostrophes, up to 40 characters." :
          r.body && (r.body.error === "bad_photo" || r.body.error === "photo_too_big") ? "That photo couldn't be used. Try a different one." : "Couldn't save. Try again.", true);
      }).catch(function () { saveBtn.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    sheet.appendChild(el("h2", { text: "Your profile" }));
    sheet.appendChild(el("p", { text: "Add your name and a photo. Only you can see them." }));
    sheet.appendChild(holder); sheet.appendChild(file); sheet.appendChild(pick); sheet.appendChild(drop);
    sheet.appendChild(el("label", { htmlFor: "rl-name", text: "Your name", style: "display:block;font-weight:700;font-size:14px;margin:16px 0 6px" }));
    sheet.appendChild(nameIn); sheet.appendChild(saveBtn); sheet.appendChild(msg);
    sheet.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: backLabel || "Back", onclick: function () { if (onBack) onBack(); else close(); } }));
    draw();
  }
  function editProfile() { open(function (sheet) { profileView(sheet, close, "Cancel"); }); }
  // The top of the Profile page: photo, name and email, and a way to change them.
  function mountProfile(host, actions) {
    if (!host) return;
    function draw() {
      if (!document.body.contains(host)) return false;
      host.textContent = "";
      var p = profileNow();
      if (!p) return;
      host.appendChild(el("div", { style: "display:flex;gap:16px;align-items:center;margin:0 0 12px" }, [
        el("button", { type: "button", ariaLabel: p.photo ? "Change your photo" : "Add a photo", style: "all:unset;cursor:pointer;border-radius:50%;flex:none", onclick: editProfile }, [face(p, 64)]),
        el("div", { style: "min-width:0" }, [
          el("h2", { text: p.name || p.email, style: "margin:0 0 2px;word-break:break-word" }),
          el("div", { className: "small muted", text: p.name ? p.email : "Add your name and a photo so Relay feels like yours.", style: "word-break:break-all" })])]));
      var edit = el("button", { type: "button", className: "outline", text: p.name || p.photo ? "Edit profile" : "Add name and photo", onclick: editProfile });
      if (actions && document.body.contains(actions)) {
        var old = actions.querySelector("[data-rl-edit]"); if (old) old.remove();
        edit.setAttribute("data-rl-edit", "1"); actions.insertBefore(edit, actions.firstChild);
      } else host.appendChild(edit);
    }
    profileWatchers.push(draw);
    draw();
    loadProfile();
  }
  function askBox(message, yesLabel, withText, onYes) {
    var input = withText ? el("textarea", { rows: 3, style: "width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid var(--rl-line);border-radius:16px;font:inherit;font-size:15px;margin-bottom:6px" }) : null;
    var card = el("div", { className: "rl-sheet", role: "alertdialog", ariaModal: "true" }, [el("p", { text: message, style: "color:var(--rl-text);font-size:16px" })]);
    var layer = el("div", { className: "rl-back", style: "z-index:10000" }, [card]);
    function done() { layer.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") done(); }
    if (input) card.appendChild(input);
    card.appendChild(el("button", { className: "rl-btn", text: yesLabel || "Yes, continue", onclick: function () { var v = input ? input.value : true; done(); onYes(v); } }));
    card.appendChild(el("button", { className: "rl-btn ghost", text: "Cancel", onclick: done }));
    layer.addEventListener("click", function (e) { if (e.target === layer) done(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(layer);
    (input || card.querySelector("button")).focus();
  }
  function ask(message, yesLabel, onYes) { askBox(message, yesLabel, false, onYes); }
  // A short choice on top of whatever is showing: a button for each answer, then Cancel.
  function chooseBox(message, choices) {
    var card = el("div", { className: "rl-sheet", role: "alertdialog", ariaModal: "true" }, [el("p", { text: message, style: "color:var(--rl-text);font-size:17px;font-weight:700;margin:0 0 6px" })]);
    var layer = el("div", { className: "rl-back", style: "z-index:10000" }, [card]);
    function done() { layer.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") done(); }
    choices.forEach(function (c) { card.appendChild(el("button", { className: "rl-btn ghost", text: c[0], onclick: function () { done(); c[1](); } })); });
    card.appendChild(el("button", { className: "rl-btn ghost rl-plain", text: "Cancel", onclick: done }));
    layer.addEventListener("click", function (e) { if (e.target === layer) done(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(layer);
    card.querySelector("button").focus();
  }
  function askText(message, yesLabel, onText) { askBox(message, yesLabel, true, onText); }
  // "Fix this receipt": the shop, total, date and items as Relay read them, to correct. Only what changed is sent; the
  // shopper's words then show instead of what was read (worker/gmail.js), and which parts were wrong is counted for the
  // Relay health page. "Go back to what Relay read" undoes it. done() runs after a save or an undo.
  function fixSheet(x, done) {
    var gbp = !x.currency || x.currency === "GBP", sym = gbp ? "£" : x.currency;
    var shopNow = (x.retailer && (x.retailer.name || x.retailer.domain)) || "";
    var today = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    var toMoney = function (p) { return Number.isInteger(p) ? (p / 100).toFixed(2) : ""; };
    var readMoney = function (v) { var t = String(v || "").replace(/[£,\s]/g, ""); if (!t) return null; return /^\d{1,7}(\.\d{1,2})?$/.test(t) ? Math.round(parseFloat(t) * 100) : NaN; };
    var card = el("div", { className: "rl-sheet rl-fix", role: "dialog", ariaModal: "true", ariaLabel: "Fix this receipt" });
    var layer = el("div", { className: "rl-back", style: "z-index:10000" }, [card]);
    function shut() { layer.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") shut(); }
    var field = function (label, input, extra) { return el("label", { className: "rl-fix-f" + (extra || "") }, [el("span", { text: label }), input]); };
    var money = function (input) { return el("span", { className: "rl-fix-money" }, [el("i", { text: sym }), input]); };
    var shop = el("input", { type: "text", value: shopNow, maxLength: 80, autocomplete: "off", enterKeyHint: "next" });
    var total = el("input", { type: "text", inputMode: "decimal", value: toMoney(x.totalPence), placeholder: "0.00", autocomplete: "off", enterKeyHint: "next" });
    var date = el("input", { type: "date", value: /^\d{4}-\d{2}-\d{2}$/.test(x.orderDate || "") ? x.orderDate : "", max: today, min: "2000-01-01" });
    total.setAttribute("aria-label", "Total in " + (gbp ? "pounds" : x.currency));
    card.appendChild(el("h2", { text: "Fix this receipt" }));
    card.appendChild(el("p", { className: "rl-fix-lead", text: "Change anything Relay got wrong. It's fixed for you straight away, and it helps Relay read emails like this better." }));
    card.appendChild(field("Shop", shop));
    card.appendChild(el("div", { className: "rl-fix-2" }, [field("Total", money(total)), field("Date", date)]));
    var list = el("div", { className: "rl-fix-list" });
    var itemsBox = el("div", { className: "rl-fix-items" }, [el("span", { className: "rl-fix-h", text: "What you bought" }), list]);
    var was = (x.items || []).filter(function (i) { return i && i.name; }).map(function (i) { return { name: i.name, qty: i.qty || 1, pricePence: Number.isInteger(i.pricePence) ? i.pricePence : null }; });
    function line(it) {
      var name = el("input", { type: "text", value: it ? it.name : "", maxLength: 120, placeholder: "Item", autocomplete: "off" });
      var price = el("input", { type: "text", inputMode: "decimal", value: it ? toMoney(it.pricePence) : "", placeholder: "Price", autocomplete: "off" });
      var x2 = el("button", { type: "button", className: "rl-fix-x" }, [jIc("x", 18)]);
      var row = el("div", { className: "rl-fix-item" }, [name, money(price), x2]);
      row._qty = it ? it.qty : 1;
      x2.onclick = function () { row.remove(); number(); };
      list.appendChild(row); number();
      return name;
    }
    function number() { Array.prototype.forEach.call(list.children, function (r, i) { var ins = r.querySelectorAll("input"); ins[0].setAttribute("aria-label", "Item " + (i + 1)); ins[1].setAttribute("aria-label", "Price of item " + (i + 1)); r.querySelector("button").setAttribute("aria-label", "Remove item " + (i + 1)); }); }
    was.forEach(line);
    var add = el("button", { type: "button", className: "rl-fix-add" }, [jIc("plus", 18), el("span", { text: "Add an item" })]);
    add.onclick = function () { line(null).focus(); };
    itemsBox.appendChild(add);
    card.appendChild(itemsBox);
    var note = el("p", { className: "rl-msg" });
    note.setAttribute("role", "status");
    var save = el("button", { type: "button", className: "rl-btn", text: "Save" });
    card.appendChild(note); card.appendChild(save);
    var busy = false;
    function send(body, after) {
      if (busy) return;
      busy = true; save.disabled = true; if (undo) undo.disabled = true; say(note, "");
      api("/relay/my/receipts/" + x.id + "/fix", { method: "POST", body: body }).then(function (r) {
        busy = false; save.disabled = false; if (undo) undo.disabled = false;
        if (!r.ok) return say(note, r.status === 404 ? "This receipt isn't on your list any more. Pull down to refresh." : "Couldn't save that. Check what you typed and try again.", true);
        shut(); after(); if (done) done();
      }, function () { busy = false; save.disabled = false; if (undo) undo.disabled = false; say(note, "Couldn't reach Relay. Check your connection and try again.", true); });
    }
    save.onclick = function () {
      var body = {}, s1 = shop.value.replace(/\s+/g, " ").trim(), t = readMoney(total.value);
      if (!s1) return say(note, "Give the shop a name.", true);
      if (s1 !== shopNow) body.shop = s1;
      if (Number.isNaN(t)) return say(note, "Type the total like 12.99.", true);
      if (t !== null && t !== x.totalPence) body.totalPence = t;
      if (date.value && date.value !== x.orderDate) { if (date.value > today || date.value < "2000-01-01") return say(note, "Pick a date that's today or earlier.", true); body.orderDate = date.value; }
      var items = [], bad = false;
      Array.prototype.forEach.call(list.children, function (r) {
        var ins = r.querySelectorAll("input"), n = ins[0].value.replace(/\s+/g, " ").trim(), p = readMoney(ins[1].value);
        if (!n) return; if (Number.isNaN(p)) { bad = true; return; }
        items.push({ name: n, qty: r._qty || 1, pricePence: p });
      });
      if (bad) return say(note, "Type each price like 4.50, or leave it empty.", true);
      var same = items.length === was.length && items.every(function (it, i) { return it.name === was[i].name && it.pricePence === was[i].pricePence; });
      if (!same) body.items = items.map(function (it) { return it.pricePence === null ? { name: it.name, qty: it.qty } : it; });
      if (!Object.keys(body).length) return say(note, "Nothing has changed yet.", true);
      send(body, function () {});
    };
    var undo = null;
    if (x.fixed) {
      undo = el("button", { type: "button", className: "rl-btn ghost", text: "Go back to what Relay read" });
      undo.onclick = function () { send({ undo: true }, function () {}); };
      card.appendChild(undo);
    }
    // Too much to fix by hand: the email itself can go to Relay (only one that came from an inbox; a pasted one wasn't kept).
    if (x.id && mailRef(x)) {
      var sendIt = el("button", { type: "button", className: "rl-fix-add" }, [jIc("send", 18), el("span", { text: "Send this email to Relay" })]);
      sendIt.onclick = function () { shut(); shareSheet(x, function () { if (done) done("shared"); }); };
      card.appendChild(el("div", { className: "rl-fix-more" }, [el("p", { text: "Too much to fix, or keeps coming out wrong?" }), sendIt]));
    }
    card.appendChild(el("button", { type: "button", className: "rl-btn ghost rl-plain", text: "Cancel", onclick: shut }));
    layer.addEventListener("click", function (e) { if (e.target === layer) shut(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(layer);
    shop.focus();
  }
  // "Send this email to Relay" (worker/shared-emails.js). First shows exactly what would be sent: the email's text with the
  // shopper's details hidden. Then sends it, with a note if they want, for a person at Relay to read and improve the reader.
  // It's deleted after 30 days, or when they delete it here. done() runs after it's sent or deleted.
  function shareSheet(x, done) {
    var card = el("div", { className: "rl-sheet rl-fix", role: "dialog", ariaModal: "true", ariaLabel: "Send this email to Relay" });
    var layer = el("div", { className: "rl-back", style: "z-index:10000" }, [card]);
    function shut() { layer.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") shut(); }
    var day = function (iso) { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); };
    card.appendChild(el("h2", { text: "Send this email to Relay" }));
    card.appendChild(el("p", { className: "rl-fix-lead", text: "A person at Relay will read this one email to see why it was read wrong, and use what they learn to read emails like it better. Before it goes, Relay hides web links, email addresses, phone numbers, card numbers and codes, postcodes, addresses and your name. It's deleted after 30 days, or sooner if you delete it." }));
    var head = el("span", { className: "rl-fix-h", text: "What will be sent" });
    var box = el("div", { className: "rl-share-box rl-skel" });
    box.setAttribute("aria-busy", "true");
    var check = el("p", { className: "rl-share-check", text: "Check that nothing private is left in it before you send it." });
    var noteIn = el("textarea", { rows: 3, maxLength: 300, placeholder: "For example: the total is wrong" });
    var noteField = el("label", { className: "rl-fix-f" }, [el("span", { text: "What's wrong? (optional)" }), noteIn]);
    var msg = el("p", { className: "rl-msg" });
    msg.setAttribute("role", "status");
    var send = el("button", { type: "button", className: "rl-btn", text: "Send to Relay" });
    var del = el("button", { type: "button", className: "rl-btn ghost", text: "Delete what you sent" });
    send.disabled = true; del.hidden = true;
    [head, box, check, noteField, msg, send, del].forEach(function (n) { card.appendChild(n); });
    card.appendChild(el("button", { type: "button", className: "rl-btn ghost rl-plain", text: "Cancel", onclick: shut }));
    var problem = function (r) {
      var e = r.body && r.body.error;
      return e === "no_email" ? "This receipt was pasted in, so there's no email to send."
        : e === "gmail_not_connected" ? "The inbox this receipt came from isn't connected any more."
        : e === "gmail_reconnect_needed" ? "Your inbox needs connecting again. Open Profile, then Email connection."
        : e === "email_not_found" ? "That email is no longer in your inbox, so it can't be sent."
        : e === "consent_required" ? "Relay needs your permission to read your email first."
        : r.status === 404 ? "This receipt isn't on your list any more. Pull down to refresh."
        : r.status === 429 ? "You've sent a lot of emails to Relay today. Try again tomorrow."
        : r.status === 502 ? "Your inbox didn't answer just now. Try again in a moment."
        : "Couldn't load the email. Try again in a moment.";
    };
    // After sending or deleting, the sheet says what happened, with one way out.
    function finished(title, text) {
      card.textContent = "";
      card.appendChild(el("h2", { text: title }));
      card.appendChild(el("p", { className: "rl-fix-lead", text: text }));
      var ok = el("button", { type: "button", className: "rl-btn", text: "Done", onclick: function () { shut(); if (done) done(); } });
      card.appendChild(ok); ok.focus();
    }
    api("/relay/my/receipts/" + x.id + "/share", { fresh: true }).then(function (r) {
      box.classList.remove("rl-skel"); box.removeAttribute("aria-busy");
      if (!r.ok) { [head, box, check, noteField, send].forEach(function (n) { n.hidden = true; }); return say(msg, problem(r), true); }
      var b = r.body || {};
      box.textContent = "";
      box.appendChild(el("b", { text: b.subject || "(No subject)" }));
      box.appendChild(el("span", { className: "rl-share-from", text: "From " + (b.from || "an unknown sender") }));
      box.appendChild(document.createTextNode(b.text || ""));
      if (b.cut) box.appendChild(el("i", { text: "The rest of this long email is left out." }));
      box.tabIndex = 0; box.setAttribute("role", "region"); box.setAttribute("aria-label", "What will be sent");
      send.disabled = false;
      if (b.sent) { say(msg, "You sent this on " + day(b.sent.at) + ". Sending it again replaces that copy."); send.textContent = "Send it again"; del.hidden = false; }
    }, function () { box.classList.remove("rl-skel"); [head, box, check, noteField, send].forEach(function (n) { n.hidden = true; }); say(msg, "Couldn't reach Relay. Check your connection and try again.", true); });
    var busy = false;
    function post(body, after) {
      if (busy) return;
      busy = true; send.disabled = del.disabled = true; say(msg, "");
      api("/relay/my/receipts/" + x.id + "/share", { method: "POST", body: body }).then(function (r) {
        busy = false; send.disabled = del.disabled = false;
        if (!r.ok) return say(msg, body.delete ? "Couldn't delete it. Try again in a moment." : problem(r), true);
        after(r.body || {});
      }, function () { busy = false; send.disabled = del.disabled = false; say(msg, "Couldn't reach Relay. Check your connection and try again.", true); });
    }
    send.onclick = function () {
      var note = noteIn.value.replace(/\s+/g, " ").trim();
      post(note ? { note: note.slice(0, 300) } : {}, function (b) {
        finished("Sent to Relay", "Thanks. A person at Relay will read it to improve how Relay reads emails like it. It's deleted on " + day(b.sent.until) + ", and you can delete it sooner from this receipt.");
      });
    };
    del.onclick = function () { post({ delete: true }, function () { finished("Deleted", "Relay no longer has a copy of this email."); }); };
    layer.addEventListener("click", function (e) { if (e.target === layer) shut(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(layer);
    card.querySelector("button.rl-plain").focus();
  }
  var back = null;
  function dismiss() { if (back) { back.remove(); back = null; } if (pageLaunchers) pageLaunchers(); }
  // Closing the last page while signed out goes back to the welcome story (and carries it on from where it paused).
  function close() { dismiss(); if (!load()) mountWelcome(); }
  var pageLaunchers = null;
  function open(build) {
    dismiss();
    var sheet = el("div", { className: "rl-sheet", role: "dialog" });
    back = el("div", { className: "rl-back" }, [sheet]);
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    document.body.appendChild(back);
    build(sheet);
  }
  var errors = { invalid_email: "That doesn't look like an email address.", too_many_requests: "Too many attempts. Please try again later.",
    sign_in_not_configured: "Sign-in isn't switched on yet.", email_send_failed: "We couldn't send the email. Please try again.",
    no_deadline: "There's no return deadline to remind you about.", deadline_passed: "That deadline has already passed.", consent_required: "Please agree to the permission step first.", invalid_or_expired_code: "That code is wrong or has expired. Check it, or request a new one.", invalid_or_expired_link: "That sign-in link has expired or was already used. Request a new one.", origin_not_allowed: "Sign-in isn't available from this address.", invalid_code: "That code isn't right. Check it and try again.",
    phone_invalid: "That isn't a UK mobile number. Type it like 07700 900123.", sms_not_configured: "Relay can't send texts right now. Please try again later.",
    sms_send_failed: "The text didn't send. Check the number and try again.", wait: "A code is on its way. You can ask for another in a few seconds.",
    two_step_on: "Sign-in codes go to this number. Turn off codes by text under Two-step sign-in first.", no_phone: "Add your phone number first.",
    already_enabled: "That's already on.", not_enabled: "That's already off.",
    not_for_review_account: "This account is for reviewing Relay, so that can't be added to it.",
    last_second_step: "Relay needs at least one second step for signing in. Add another way first, then turn this one off.", second_step_needed: "Set up a second step for signing in first.",
    text_on: "Codes by text are on. Turn them off first to use an authenticator app instead.", app_on: "The authenticator app is on. Turn it off first to use texts instead.", sign_in_expired: "That sign-in timed out or was cancelled. Please start again." };
  function say(node, text, bad) { node.textContent = text; node.className = "rl-msg" + (bad ? " err" : ""); }
  // Unfinished writing is kept on this device, for this account only, until it's sent: leaving the screen, the app closing
  // or a dropped connection doesn't lose it. Drafts go when sent, after a week, and on sign-out.
  var DRAFTS_KEY = "relay.drafts.v1", DRAFT_MS = 7 * 864e5;
  function draftsAll() {
    var s = load(), d = null;
    try { d = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "null"); } catch (e) { d = null; }
    return d && s && d.email === s.email && d.items ? d : { email: s && s.email, items: {} };
  }
  function draftGet(key) { var x = draftsAll().items[key]; return x && Date.now() - x.at < DRAFT_MS ? x.v : ""; }
  function draftSet(key, v) {
    try {
      var s = load(); if (!s || !s.email) return;
      var d = draftsAll(); d.email = s.email;
      if (!v || !String(v).trim()) delete d.items[key]; else d.items[key] = { v: String(v), at: Date.now() };
      var t = JSON.stringify(d);
      if (t.length < 600000) localStorage.setItem(DRAFTS_KEY, t);
    } catch (e) { /* storage full or blocked: the draft just isn't kept */ }
  }
  // Comes back to y and stays there while the page fills in again (parts arrive a moment later), unless the person
  // scrolls first.
  var profileY = 0;
  function scrollBackTo(y) {
    if (!(y > 0)) return;
    var moved = false, stop = function () { moved = true; }, until = Date.now() + 1500;
    ["touchstart", "wheel", "keydown"].forEach(function (ev) { window.addEventListener(ev, stop, { once: true, passive: true }); });
    (function again() {
      if (moved) return;
      var max = document.documentElement.scrollHeight - window.innerHeight, want = Math.min(y, Math.max(0, max));
      if (Math.abs((window.scrollY || 0) - want) > 1) window.scrollTo(0, want);
      if (Date.now() < until) setTimeout(again, 50);
    })();
  }
  // A list shown part at a time brings in its next part before you reach the end (about two screens ahead), so scrolling
  // doesn't stop at a "Show more" button. The button stays for anyone who gets there first, or without scrolling.
  function loadAhead(btn) {
    if (!("IntersectionObserver" in window)) return btn;
    var io = new IntersectionObserver(function (seen) {
      if (!seen.some(function (e) { return e.isIntersecting; })) return;
      io.disconnect();
      if (btn.isConnected && !btn.disabled) btn.click();
    }, { rootMargin: "0px 0px 1200px 0px" });
    io.observe(btn);
    return btn;
  }
  // Keeps what's typed into an input as a draft and puts it back when the input appears again. Returns the restored text.
  function keepDraft(input, key) {
    var v = draftGet(key), t = 0;
    if (v && !input.value) input.value = v;
    input.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { draftSet(key, input.value); }, 300); });
    return v;
  }

  // ---- Getting started: one journey from "Welcome" to "You're all set" ----
  // Google and Microsoft sign you in AND bring your email in, in one visit (after you've read what Relay does). An email
  // link signs you in, and then you connect your inbox once. Either way the first scan starts at once and you see it
  // counting while you add your name, so the first screen after is full, not empty.
  var JI = {
    check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m3.8 7 8.2 6 8.2-6"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    trash: '<path d="M4.5 7h15M10 7V5h4v2M6.5 7l1 13h9l1-13"/>',
    face: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9.5v1M15 9.5v1M12 9.5V13h-1M9.5 16c1.5 1.2 3.5 1.2 5 0"/>',
    back: '<path d="m15 6-6 6 6 6"/>',
    ret: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    ext: '<path d="M14 4.5h5.5V10"/><path d="m19.5 4.5-8 8"/><path d="M18 14v4a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18V8a1.5 1.5 0 0 1 1.5-1.5H10"/>',
    parcel: '<path d="M12 3.5 19.5 7.5v9L12 20.5 4.5 16.5v-9z"/><path d="m4.5 7.5 7.5 4 7.5-4M12 11.5v9"/>',
    dot: '<circle cx="12" cy="12" r="4.5"/>',
    down: '<path d="m7 10 5 5 5-5"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    send: '<path d="M4.5 12h14M13 6l6 6-6 6"/>',
    pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>',
    gift: GIFT_PATH
  };
  function jIc(n, px) {
    var s = el("span", { className: "rl-jic" }); s.setAttribute("aria-hidden", "true");
    s.innerHTML = '<svg viewBox="0 0 24 24" width="' + (px || 20) + '" height="' + (px || 20) + '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + JI[n] + "</svg>";
    return s;
  }
  // The frame of every step: progress dots (when there is more than one step), Back or Close, then the step itself.
  function jFrame(sheet, o) {
    sheet.textContent = ""; sheet.classList.remove("rl-signin"); sheet.classList.add("rl-full", "rl-jr"); sheet.setAttribute("aria-label", "Getting started");
    try { sheet.scrollTop = 0; } catch (e) {}
    var top = el("div", { className: "rl-jtop" });
    top.appendChild(o.back ? el("button", { type: "button", className: "rl-abtn", ariaLabel: "Back", "data-back": "", onclick: o.back }, [jIc("back"), el("span", { text: "Back" })]) : el("span"));
    if (o.of > 1) {
      var dots = el("div", { className: "rl-dots" }); dots.setAttribute("role", "img"); dots.setAttribute("aria-label", "Step " + o.at + " of " + o.of);
      for (var i = 1; i <= o.of; i++) dots.appendChild(el("span", { className: i < o.at ? "done" : i === o.at ? "on" : "" }));
      top.appendChild(dots);
    } else top.appendChild(el("span"));
    top.appendChild(o.noClose ? el("span") : el("button", { type: "button", className: "rl-abtn done", text: o.closeText || "Close", onclick: o.onClose || close }));
    sheet.appendChild(top);
    var body = el("div", { className: "rl-jbody" });
    if (o.kicker) body.appendChild(el("div", { className: "rl-jkick", text: o.kicker }));
    body.appendChild(el("h2", { className: "rl-jh", text: o.title }));
    if (o.sub) body.appendChild(el("p", { className: "rl-jsub", text: o.sub }));
    sheet.appendChild(body);
    return body;
  }
  // Which inbox an address most likely lives in, so the right button comes first.
  function mailKindOf(email) {
    var d = String(email || "").split("@")[1] || "";
    if (/^(gmail|googlemail)\.com$/.test(d)) return "google";
    if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(d)) return "microsoft";
    return "";
  }
  // Steps someone chose to leave for later, kept per account on this device so later sign-ins don't ask again.
  var ONBOARD_KEY = "relay.onboard.v1";
  function obKey(email) { var h = 0, s = String(email || ""); for (var i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0; return "a" + h.toString(36); }
  function obGet(email) { try { var all = JSON.parse(localStorage.getItem(ONBOARD_KEY) || "{}"); return all[obKey(email)] || {}; } catch (e) { return {}; } }
  function obSet(email, patch) {
    try { var all = JSON.parse(localStorage.getItem(ONBOARD_KEY) || "{}"), k = obKey(email); all[k] = Object.assign({}, all[k] || {}, patch); localStorage.setItem(ONBOARD_KEY, JSON.stringify(all)); } catch (e) {}
  }

  // Step 1, signed out: welcome, and how to continue.
  // ---- Welcome: for anyone signed out, a short story about Relay (four slides on Relay's own colours), then a clean
  // sign-in page. Every step of signing in and getting started is a full page, not a sheet over the app. ----
  var WELCOME = [
    { bg: "#101828", art: "receipts", title: "Every receipt, in one place.", sub: "Relay finds them in your Gmail or Outlook. No scanning, no typing." },
    { bg: "#E0446E", art: "deadline", title: "Never miss a return.", sub: "Shops' return dates count down, with a reminder if you want one." },
    { bg: "#4F72E0", art: "price", title: "Catch the price drop.", sub: "Watch what you want. Relay tells you when it's cheaper." },
    { bg: "#6662D9", art: "wrapped", title: "Your year, wrapped.", sub: "See where your money went, shop by shop." }];
  // The pictures: made-up shops and things, drawn the way Relay shows your own.
  function welcomeArt(kind) {
    var art = el("div", { className: "rl-wart rl-wart-" + kind });
    art.setAttribute("aria-hidden", "true");
    var card = function (initial, colour, name, shop, price, extra) {
      return el("div", { className: "rl-wcard" }, [el("span", { className: "rl-wini", text: initial, style: "background:" + colour }),
        el("span", { className: "rl-wcard-t" }, [el("b", { text: name }), el("span", { text: shop })]), el("b", { className: "rl-wprice", text: price })].concat(extra || []));
    };
    var note = function (text) { return el("div", { className: "rl-wnote" }, [el("img", { src: "icons/icon-192.png", alt: "" }), el("span", { text: text })]); };
    if (kind === "receipts") {
      art.appendChild(card("K", "#E0446E", "Court Classic Trainers", "Kick Lane", "£85"));
      art.appendChild(card("C", "#D47B1F", "Burr Coffee Grinder", "Crema & Co", "£129"));
      art.appendChild(card("S", "#2E9E5B", "Linen Shirt", "Studio North", "£45"));
      art.appendChild(el("span", { className: "rl-wpill", text: "3 receipts found" }));
    } else if (kind === "deadline") {
      var due = new Date(Date.now() + 3 * 864e5).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      art.appendChild(note("Return the Wool Coat by " + due));
      var c = card("H", "#101828", "Wool Coat", "Harlow & Co", "£120");
      c.appendChild(el("div", { className: "rl-wdue" }, [el("div", { className: "rl-wtrack" }, [el("i")]), el("span", { text: "3 days left to return" })]));
      art.appendChild(c);
    } else if (kind === "price") {
      art.appendChild(note("Price drop on Wireless Earbuds"));
      var p = card("V", "#4F72E0", "Wireless Earbuds", "Voltline", "");
      p.appendChild(el("div", { className: "rl-wdrop" }, [el("b", { text: "£59" }), el("s", { text: "£79" }), el("span", { text: "£20 less" })]));
      art.appendChild(p);
    } else {
      var grid = el("div", { className: "rl-wtiles" });
      [["Fashion", "£1,240", "#E0446E"], ["Food & drink", "£860", "#D47B1F"], ["Electronics", "£540", "#4F72E0"], ["Home", "£310", "#2E9E5B"]].forEach(function (t) {
        grid.appendChild(el("div", { className: "rl-wtile", style: "background:" + t[2] }, [el("span", { text: t[0] }), el("b", { text: t[1] })]));
      });
      art.appendChild(el("b", { className: "rl-wyear", text: "Your " + new Date().getFullYear() }));
      art.appendChild(grid);
    }
    return art;
  }
  function welcomeWanted() {
    return !load() && !/[?&](demo|testing|testtools)=1(&|$)/.test(location.search) && !/(?:^|[#&])(signin|gsignin|msignin|gmail|outlook)=/.test(location.hash || "");
  }
  // The story's controls while it's on screen: paused while a sign-in page covers it, carried on when that page closes.
  var welcomeCtl = null;
  function mountWelcome() {
    if (document.querySelector(".rl-welcome")) { if (welcomeCtl && !document.querySelector(".rl-back")) welcomeCtl.resume(); return; }
    if (!welcomeWanted()) return;
    // i: the slide showing. The timer moves on after DUR; holding (or a sign-in page on top) freezes it and the bar
    // together, and letting go carries on with the time that was left, so the bar and the slide change stay in step.
    var i = 0, timer = null, left = 0, t0 = 0, downAt = 0, pressing = false, DUR = 5000, calm = false, LAST = WELCOME.length - 1;
    try { calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    var root = el("div", { className: "rl-welcome" });
    root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Welcome to Relay"); root.setAttribute("aria-modal", "true");
    root.tabIndex = -1; // focus sits on the story itself (no ring), so the arrow keys and a screen reader start here
    var col = el("div", { className: "rl-wcol" });
    var bars = el("div", { className: "rl-wbars" });
    WELCOME.forEach(function () { bars.appendChild(el("div", {}, [el("i")])); });
    var brand = el("div", { className: "rl-wbrand" }, [el("img", { src: "icons/icon-192.png", alt: "" }), el("b", { text: "Relay" })]);
    var stage = el("div", { className: "rl-wstage" });
    function arm(ms) { clearTimeout(timer); timer = null; if (calm || i >= LAST) return; left = ms; t0 = Date.now(); timer = setTimeout(function () { timer = null; show(i + 1); }, ms); }
    function freeze() { if (timer) { clearTimeout(timer); timer = null; left = Math.max(0, left - (Date.now() - t0)); } root.classList.add("held"); }
    function thaw() { root.classList.remove("held"); if (!timer && !calm && i < LAST) arm(left); }
    var start = el("button", { type: "button", className: "rl-wgo", text: "Get started", onclick: function () { freeze(); open(function (s) { signedOutView(s); }); } });
    var have = el("button", { type: "button", className: "rl-whave", text: "I already have an account", onclick: function () { freeze(); open(function (s) { signedOutView(s, { returning: true }); }); } });
    col.appendChild(bars); col.appendChild(brand); col.appendChild(stage); col.appendChild(el("div", { className: "rl-wact" }, [start, have]));
    root.appendChild(col);
    // A tap past the last slide (or back from the first) has nowhere to go: the slide stays as it is rather than being drawn
    // again, which made it flash on every tap. At the end, "Get started" gives a small nudge instead.
    function nudge() { if (calm) return; start.classList.remove("rl-nudge"); void start.offsetWidth; start.classList.add("rl-nudge"); }
    function show(n, first) {
      var to = Math.max(0, Math.min(LAST, n));
      if (!first && to === i) { if (n > LAST) nudge(); return; }
      i = to;
      var s = WELCOME[i];
      root.style.background = s.bg;
      Array.prototype.forEach.call(bars.children, function (b, k) {
        b.className = k < i ? "done" : k === i ? "now" : "";
        if (k === i) { var bar = el("i"); bar.style.animationDuration = DUR + "ms"; b.replaceChild(bar, b.firstChild); } // a new bar starts from empty
      });
      stage.textContent = "";
      var slide = el("div", { className: "rl-wslide" }, [welcomeArt(s.art), el("h1", { text: s.title }), el("p", { text: s.sub })]);
      slide.setAttribute("aria-label", "Slide " + (i + 1) + " of " + WELCOME.length);
      stage.appendChild(slide);
      root.classList.toggle("last", i === LAST);
      root.classList.remove("held");
      arm(DUR);
    }
    // Tap the left third to go back, anywhere else to go on; press and hold to pause (letting go doesn't skip ahead).
    root.addEventListener("click", function (e) {
      if (e.target.closest("button") || Date.now() - downAt > 400) return;
      var r = root.getBoundingClientRect();
      show(e.clientX - r.left < r.width / 3 ? i - 1 : i + 1);
    });
    root.addEventListener("pointerdown", function (e) { if (e.target.closest("button")) return; downAt = Date.now(); pressing = true; freeze(); });
    var letGo = function () { if (!pressing) return; pressing = false; thaw(); };
    root.addEventListener("pointerup", letGo); root.addEventListener("pointercancel", letGo);
    var onKey = function (e) {
      if (document.querySelector(".rl-back") || (e.target && e.target.closest && e.target.closest("input,textarea,select"))) return;
      if (e.key === "ArrowRight") show(i + 1); else if (e.key === "ArrowLeft") show(i - 1);
    };
    document.addEventListener("keydown", onKey);
    var focusStory = function () { try { root.focus({ preventScroll: true }); } catch (e) {} };
    welcomeCtl = {
      resume: function () { thaw(); focusStory(); },
      stop: function () { clearTimeout(timer); timer = null; document.removeEventListener("keydown", onKey); }
    };
    document.body.appendChild(root); document.body.classList.add("rl-welcoming");
    show(0, true); focusStory();
  }
  function unmountWelcome() {
    if (welcomeCtl) { welcomeCtl.stop(); welcomeCtl = null; }
    var w = document.querySelector(".rl-welcome");
    if (w) w.remove();
    document.body.classList.remove("rl-welcoming");
  }
  // The sign-in page: Relay's icon, one heading, three equal ways in, Face ID quietly underneath, and the legal line.
  // Signing in and creating an account are the same steps, so the heading just matches the button that led here.
  var signInOpts = {}; // so Back from a later step returns to the same page ("Welcome back" stays "Welcome back")
  function signedOutView(sheet, opts) {
    opts = signInOpts = opts || {};
    signInExtra = {};
    var fromWelcome = Boolean(document.querySelector(".rl-welcome"));
    var body = jFrame(sheet, { back: fromWelcome ? close : null, noClose: fromWelcome,
      title: opts.returning ? "Welcome back" : "Create your account",
      sub: opts.returning ? "Sign in the way you did last time. No password needed." : "Use the email you shop with. No password needed." });
    // On Relay's navy, as the welcome story ends: the name, a little wallet of receipts, then the ways in, rising in turn.
    sheet.classList.add("rl-signin");
    body.insertBefore(el("div", { className: "rl-wbrand rl-rise" }, [el("img", { src: "icons/icon-192.png", alt: "" }), el("b", { text: "Relay" })]), body.firstChild);
    body.insertBefore(signInArt(), body.querySelector(".rl-jh"));
    var msg = el("div", { className: "rl-msg" });
    var choices = el("div", { className: "rl-choices" });
    var gBtn = el("button", { type: "button", className: "rl-choice", text: "Continue with Google", onclick: function () { providerStep(sheet, "google"); } });
    var mBtn = el("button", { type: "button", className: "rl-choice", text: "Continue with Microsoft", onclick: function () { providerStep(sheet, "microsoft"); } });
    gBtn.style.display = mBtn.style.display = "none";
    var eBtn = el("button", { type: "button", className: "rl-choice", text: "Continue with email", onclick: function () { emailStep(sheet); } });
    [gBtn, mBtn, eBtn].forEach(function (n) { choices.appendChild(n); });
    body.appendChild(choices);
    if (passkeysSupported()) { var pk = passkeyButton(msg); pk.className = "rl-textbtn"; pk.insertBefore(jIc("face", 22), pk.firstChild); body.appendChild(pk); }
    body.appendChild(msg);
    var legal = el("p", { className: "rl-jlegal" });
    legal.appendChild(document.createTextNode("By continuing you agree to Relay's "));
    legal.appendChild(el("a", { href: "./terms.html", text: "Terms of use" }));
    legal.appendChild(document.createTextNode(" and "));
    legal.appendChild(el("a", { href: "./privacy.html", text: "Privacy policy" }));
    legal.appendChild(document.createTextNode("."));
    body.appendChild(legal);
    // Each part rises in a moment after the one above it (not at all where the phone asks for less motion).
    var rise = [body.querySelector(".rl-jh"), body.querySelector(".rl-jsub"), choices, body.querySelector(".rl-textbtn"), legal];
    rise.forEach(function (n, k) { if (n) { n.classList.add("rl-rise"); n.style.setProperty("--d", (0.18 + k * 0.06).toFixed(2) + "s"); } });
    signInProviders().then(function (p) {
      if (!document.body.contains(body)) return;
      if (p && p.google) gBtn.style.display = "";
      if (p && p.microsoft) mBtn.style.display = "";
      if (!p) say(msg, "Couldn't reach Relay. Check your connection.", true);
    });
  }
  // The sign-in page's picture: Relay's wallet, with a receipt (a made-up shop) counting down to its return date.
  function signInArt() {
    var due = new Date(Date.now() + 12 * 864e5).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    var front = el("div", { className: "rl-wcard rl-sfront" }, [el("span", { className: "rl-wini", text: "K", style: "background:#D47B1F" }),
      el("span", { className: "rl-wcard-t" }, [el("b", { text: "Court Classic Trainers" }), el("span", { text: "Kick Lane" })]), el("b", { className: "rl-wprice", text: "£85" }),
      el("div", { className: "rl-wdue" }, [el("div", { className: "rl-wtrack" }, [el("i")]), el("span", { text: "Return by " + due + " · 12 days left" })])]);
    var stack = el("div", { className: "rl-sstack" }, [el("div", { className: "rl-sback b1 rl-rise" }), el("div", { className: "rl-sback b2 rl-rise" }), front]);
    front.classList.add("rl-rise");
    var art = el("div", { className: "rl-sart" }, [stack]);
    art.setAttribute("aria-hidden", "true");
    return art;
  }
  // Step 2 for Google or Microsoft: what Relay will do with your email, agreed once, before going there.
  function providerStep(sheet, kind) {
    var g = kind === "google", who = g ? "Google" : "Microsoft", box = g ? "Gmail" : "Outlook";
    var body = jFrame(sheet, { back: function () { signedOutView(sheet, signInOpts); }, of: 3, at: 1,
      title: "Sign in and bring in your receipts", sub: "One visit to " + who + " signs you in and connects your " + box + ", so Relay can start finding your receipts straight away." });
    var points = el("div", { className: "rl-jcard" });
    [["eye", "Reads only order confirmations, receipts and return emails"], ["lock", "Read-only: never sends, deletes or changes anything in your inbox"], ["check", "Never sells or shares what it finds"], ["trash", "Disconnect and delete everything at any time"]]
      .forEach(function (x) { points.appendChild(el("div", { className: "rl-jpt" }, [jIc(x[0]), el("span", { text: x[1] })])); });
    body.appendChild(points);
    var words = el("div", { className: "rl-jwords", role: "region", tabIndex: 0 }, [el("b", { text: "What you're agreeing to" })]);
    words.setAttribute("aria-label", "Relay's permission wording");
    body.appendChild(words);
    var note = el("div", { className: "rl-msg" });
    var agree = el("button", { type: "button", className: "rl-btn", text: "Agree and continue with " + who, disabled: true });
    var just = el("button", { type: "button", className: "rl-btn ghost", text: "Just sign in for now" });
    body.appendChild(agree); body.appendChild(just); body.appendChild(note);
    body.appendChild(el("p", { className: "rl-jnote", text: "Already use Relay? “Just sign in” skips the permission step." }));
    var consent = null;
    signInProviders().then(function (p) {
      consent = p && p.consent;
      if (consent && consent.text) { consent.text.forEach(function (t) { words.appendChild(el("p", { text: t })); }); agree.disabled = false; }
      else { agree.style.display = "none"; words.style.display = "none"; }
    });
    function go(button, withMail) {
      if (agree.dataset.busy) return;
      agree.dataset.busy = "1"; agree.disabled = just.disabled = true; say(note, "Opening " + who + "…");
      var free = function () { delete agree.dataset.busy; agree.disabled = !consent; just.disabled = false; };
      var nonce = newNonce();
      try { localStorage.setItem("relay_gnonce", nonce); } catch (e) { free(); return say(note, "Your browser is blocking storage, so " + who + " sign-in can't work here. Continue with email instead.", true); }
      var body2 = { nonce: nonce }; if (withMail && consent) body2.consentVersion = consent.version;
      var host = g ? /^https:\/\/accounts\.google\.com\// : /^https:\/\/login\.microsoftonline\.com\//;
      api("/relay/auth/" + (g ? "google" : "microsoft") + "/start", { method: "POST", body: body2 }).then(function (r) {
        if (r.ok && r.body && host.test(r.body.url || "")) { location.href = r.body.url; return; }
        free();
        if (r.body && r.body.error === "consent_version_mismatch") providersAsked = null;
        say(note, r.status === 503 ? who + " sign-in isn't switched on yet. Continue with email instead." : r.body && r.body.error === "consent_version_mismatch" ? "Relay's wording has just changed. Go back and try again." : "Couldn't open " + who + ". Please try again.", true);
      }).catch(function () { free(); say(note, "Couldn't reach Relay. Check your connection.", true); });
    }
    agree.onclick = function () { go(agree, true); };
    just.onclick = function () { go(just, false); };
  }
  // Step 2 by email: a one-time link or code.
  function emailStep(sheet, typed) {
    var body = jFrame(sheet, { back: function () { signedOutView(sheet, signInOpts); }, title: "Continue with email", sub: "We'll email you a link and a 6-digit code. No password." });
    var input = el("input", { type: "email", id: "rl-signin-email", placeholder: "you@example.com", autocomplete: "email", inputMode: "email", value: typed || "" });
    input.setAttribute("aria-label", "Your email address");
    var hint = el("div", { className: "rl-jhint" });
    var msg = el("div", { className: "rl-msg" });
    var go = el("button", { type: "button", className: "rl-btn", text: "Email me a sign-in link" });
    // Gmail and Outlook addresses: one step through Google or Microsoft saves signing in and then connecting separately.
    function showHint() {
      var k = mailKindOf(input.value.trim()); hint.textContent = "";
      if (!k) return;
      var who = k === "google" ? "Google" : "Microsoft";
      hint.appendChild(el("p", { text: "Using " + (k === "google" ? "Gmail" : "Outlook") + "? Continue with " + who + " instead and you'll be signed in with your receipts on their way, in one step." }));
      hint.appendChild(el("button", { type: "button", className: "rl-btn rl-prov", text: "Continue with " + who, onclick: function () { providerStep(sheet, k); } }));
    }
    input.addEventListener("input", showHint);
    go.onclick = function () {
      go.disabled = true; say(msg, "Sending…");
      api("/relay/auth/request", { method: "POST", body: { email: input.value } }).then(function (r) {
        go.disabled = false;
        if (r.ok) return codeStep(sheet, input.value.trim(), Boolean(r.body && r.body.review === true));
        say(msg, errors[r.body.error] || "Something went wrong. Please try again.", true);
      }).catch(function () { go.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") go.click(); });
    [input, go, msg, hint].forEach(function (n) { body.appendChild(n); });
    showHint();
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
  }
  function codeStep(sheet, email, review) {
    // The reviewer sign-in sends no email (nobody can receive mail at its address): its code is in the review instructions.
    var body = jFrame(sheet, { back: function () { emailStep(sheet, email); }, title: review ? "Enter your code" : "Check your inbox",
      sub: review ? "Type the 6-digit code from Relay's instructions for reviewers. No email is sent to this address." : "We sent a sign-in link to " + email + ". Open it on this device, or type the 6-digit code from the same email. It works once, for 15 minutes." });
    var codeIn = codeBox("rl-signin-code", "6-digit code", function () { codeGo.click(); });
    var msg = el("div", { className: "rl-msg" });
    var codeGo = el("button", { type: "button", className: "rl-btn", text: "Continue" });
    codeGo.onclick = function () {
      if (codeGo.disabled) return;
      codeGo.disabled = true; say(msg, "Checking…");
      api("/relay/auth/verify-code", { method: "POST", body: { email: email, code: codeIn.value } }).then(function (r) {
        codeGo.disabled = false;
        if (!r.ok) { codeIn.value = ""; return say(msg, errors[r.body.error] || "Something went wrong. Please try again.", true); }
        if (r.body.needsSecondStep) return secondStepView(sheet, r.body);
        signedIn(r.body);
      }).catch(function () { codeGo.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    [codeIn, codeGo, msg, el("button", { type: "button", className: "rl-btn ghost", text: "Use a different email", onclick: function () { emailStep(sheet); } })].forEach(function (n) { body.appendChild(n); });
    setTimeout(function () { try { codeIn.focus(); } catch (e) {} }, 50);
  }
  // Every way of signing in ends here: keep the session, then carry on with what's still needed.
  var signInExtra = {};
  function signedIn(b) {
    save({ token: b.sessionToken, email: b.email, expiresAt: b.expiresAt, review: b.reviewAccount === true || undefined });
    keepStorage(); paintAvatars(); loadProfile();
    // Discover includes test shops for the reviewer account (their own development store), so it's read again.
    if (b.reviewAccount === true && window.catalogAsked && typeof window.loadCatalog === "function") { try { window.loadCatalog(); } catch (e) {} }
    var extra = Object.assign({}, signInExtra, b); signInExtra = {};
    if (extra.mailConnected || extra.outlookConnected) {
      rememberMailbox({ connected: true, provider: extra.mailConnected === "google" ? "google" : "microsoft" });
      memo.consent = null; memo.gmail = null; memo.receipts = null;
    }
    var connected = Boolean(extra.mailConnected || extra.outlookConnected);
    startJourney({ suggestedName: extra.suggestedName || "", justConnected: connected, viaProvider: connected });
  }
  // After signing in: only the steps this person still needs. Someone already set up goes straight to Home.
  function startJourney(info) {
    var s = load(); if (!s || !s.token) return open(signedOutView);
    var email = s.email || "";
    open(function (sheet) {
      sheet.classList.add("rl-full", "rl-jr");
      sheet.appendChild(el("div", { className: "rl-skel", style: "min-height:60px;border-radius:16px;margin:56px 0 14px" }));
      sheet.appendChild(el("div", { className: "rl-skel", style: "min-height:200px;border-radius:18px" }));
      api("/relay/my/second-step", { fresh: true }).then(function (ss) {
        // A second step comes first when the account needs one (it can't use anything else until then).
        if (ss.ok && ss.body.required && !ss.body.done) return protectAccount(function () { startJourney(info); });
        return Promise.all([loadProfile(), api("/relay/my/consent"), api("/relay/my/gmail")]).then(function (r) {
        if (!document.body.contains(sheet)) return;
        if (r[1].status === 401) { save(null); return open(signedOutView); }
        var p = r[0] || {}, c = r[1].ok ? r[1].body : {}, g = r[2].ok ? r[2].body : {};
        if (g && g.connected) rememberMailbox(g);
        var fl = obGet(email);
        var st = { email: email, consent: c, connected: Boolean(g && g.connected), provider: g && g.provider, scan: g && g.scan, suggested: info.suggestedName || "", justConnected: Boolean(info.justConnected), viaProvider: Boolean(info.viaProvider), mailNote: info.mailNote || null };
        var steps = [];
        if (!p.name && !fl.nameSkipped) steps.push("name");
        if (!st.connected && !fl.mailLater && !isReview()) steps.push("mail");
        if (!steps.length && !st.justConnected) { close(); if (window.go) window.go("profile"); return; }
        steps.push("done");
        runJourney(sheet, st, steps, 0);
        });
      }).catch(function () {
        if (!document.body.contains(sheet)) return;
        sheet.textContent = "";
        var body = jFrame(sheet, { title: "Couldn't reach Relay", sub: "You're signed in. Check your connection, then carry on." });
        body.appendChild(el("button", { type: "button", className: "rl-btn", text: "Try again", onclick: function () { startJourney(info); } }));
      });
    });
  }
  // Reads the inbox from the very start (Relay's own job does the work; asking for rounds just makes it quicker and shows
  // progress). The count shows on every step until the shopper leaves the journey.
  function journeyScan(sheet, st) {
    if (st.scanner) return st.scanner;
    var listeners = [], last = st.scan || null, stopped = false, done = false;
    function tell() { listeners.forEach(function (f) { try { f(last, done); } catch (e) {} }); }
    function step() {
      if (stopped || !document.body.contains(sheet)) return;
      api("/relay/my/gmail/scan", { method: "POST", body: {} }).then(function (x) {
        if (stopped || !document.body.contains(sheet)) return;
        if (!x.ok) return setTimeout(step, 5000);
        last = x.body.job || last;
        if (last && last.state === "failed") { done = true; tell(); return; }
        if (x.body.busy) { tell(); return setTimeout(step, x.body.retryAfterMs || 4000); }
        if (x.body.more) { tell(); return step(); }
        done = true; memo.receipts = null; memo.gmail = null; tell();
      }, function () { setTimeout(step, 5000); });
    }
    st.scanner = { on: function (f) { listeners.push(f); f(last, done); }, stop: function () { stopped = true; } };
    step();
    return st.scanner;
  }
  // The live count: what's been found, and how far back it has read (the first scan covers about the last 16 months).
  function scanCard(sheet, st) {
    var box = mailNameOf(st.provider);
    var card = el("div", { className: "rl-jscan", role: "status" });
    var line = el("b", { text: "Reading your " + box + "…" }), sub = el("span", { text: "Looking for receipts and order confirmations" });
    var bar = el("div", { className: "rl-jbar" }, [el("i")]);
    card.appendChild(el("div", { className: "rl-jscan-t" }, [jIc("mail"), el("div", {}, [line, sub])]));
    card.appendChild(bar);
    journeyScan(sheet, st).on(function (job, done) {
      // (The first call comes before the card is on the page: it fills it in then. Once the card has gone, it stops.)
      if (card.parentNode && !document.body.contains(card)) return;
      var found = (job && job.found) || 0;
      var m = /^(\d{4})-(\d{2})/.exec((job && job.scannedBack) || ""), pct = 6;
      if (m) { var months = (Date.now() - Date.UTC(+m[1], +m[2] - 1, 1)) / (30.4 * 864e5); pct = Math.max(6, Math.min(96, Math.round(months / 16 * 100))); }
      if (job && job.state === "failed") { line.textContent = "Relay will keep reading in the background"; sub.textContent = "Your receipts will appear as they're found."; pct = 100; }
      else if (done) { line.textContent = found ? found + " receipt" + (found === 1 ? "" : "s") + " found" : "All read"; sub.textContent = found ? "They're ready in Receipts." : "Nothing yet. New receipts will appear as they arrive."; pct = 100; }
      else { line.textContent = found ? found + " receipt" + (found === 1 ? "" : "s") + " found so far" : "Reading your " + box + "…"; sub.textContent = m ? "Read back to " + new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "Looking for receipts and order confirmations"; }
      bar.firstChild.style.width = pct + "%";
      card.classList.toggle("done", Boolean(done));
    });
    return card;
  }
  function mailNameOf(provider) { return provider === "microsoft" ? "Outlook" : "Gmail"; }
  function runJourney(sheet, st, steps, i) {
    // Through Google or Microsoft the permission step was step 1, so the count carries on from there.
    var off = st.justConnected && st.viaProvider ? 1 : 0, kind = steps[i], of = steps.length + off, at = i + 1 + off;
    var next = function () { runJourney(sheet, st, steps, i + 1); };
    var back = i > 0 ? function () { runJourney(sheet, st, steps, i - 1); } : null;
    var leave = function () { if (st.scanner) st.scanner.stop(); close(); };
    if (kind === "name") {
      var body = jFrame(sheet, { back: back, of: of, at: at, closeText: "Skip", onClose: function () { obSet(st.email, { nameSkipped: true }); next(); },
        title: "What should we call you?", sub: "Your first name is fine. Only you see it." });
      if (st.connected) body.appendChild(scanCard(sheet, st));
      var input = el("input", { type: "text", id: "rl-onboard-name", maxLength: 40, autocomplete: "name", placeholder: "Your name", value: st.name || st.suggested || "" });
      input.setAttribute("aria-label", "Your name");
      var note = el("div", { className: "rl-msg" });
      var go = el("button", { type: "button", className: "rl-btn", text: "Continue" });
      go.onclick = function () {
        var v = input.value.trim();
        if (!v) { obSet(st.email, { nameSkipped: true }); return next(); }
        go.disabled = true; say(note, "Saving…");
        api("/relay/my/profile", { method: "POST", body: { name: v } }).then(function (r) {
          go.disabled = false;
          if (r.ok) { keepProfile(r.body); profileChanged(); st.name = r.body.name; return next(); }
          say(note, r.body && r.body.error === "bad_name" ? "Use letters, spaces, hyphens or apostrophes, up to 40 characters." : "Couldn't save your name. Please try again.", true);
        }).catch(function () { go.disabled = false; say(note, "Couldn't reach Relay. Check your connection.", true); });
      };
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") go.click(); });
      [el("label", { htmlFor: "rl-onboard-name", className: "rl-jlabel", text: "Your name" }), input, go, note].forEach(function (n) { body.appendChild(n); });
      if (st.suggested && !st.name) body.appendChild(el("p", { className: "rl-jnote", text: "Filled in from your " + (st.provider === "microsoft" ? "Microsoft" : "Google") + " account. Change it if you like." }));
      return;
    }
    if (kind === "mail") {
      var c = st.consent || {}, first = mailKindOf(st.email) || (c.gmailAvailable ? "google" : "microsoft");
      var body2 = jFrame(sheet, { back: back, of: of, at: at, closeText: "Later", onClose: function () { obSet(st.email, { mailLater: true }); next(); },
        title: "Bring in your receipts", sub: "Connect the email you shop with. Relay reads it once now, then keeps up with new receipts by itself." });
      var pts = el("div", { className: "rl-jcard" });
      [["eye", "Reads only order confirmations, receipts and return emails"], ["lock", "Read-only: never sends, deletes or changes anything"], ["trash", "Disconnect and delete everything at any time"]]
        .forEach(function (x) { pts.appendChild(el("div", { className: "rl-jpt" }, [jIc(x[0]), el("span", { text: x[1] })])); });
      body2.appendChild(pts);
      var needAgree = !c.accepted && c.text;
      if (needAgree) {
        var words = el("div", { className: "rl-jwords", role: "region", tabIndex: 0 }, [el("b", { text: "What you're agreeing to" })]);
        words.setAttribute("aria-label", "Relay's permission wording");
        c.text.forEach(function (t) { words.appendChild(el("p", { text: t })); });
        body2.appendChild(words);
      }
      var note2 = el("div", { className: "rl-msg" });
      var connect = function (provider, label, host, button) {
        button.disabled = true; say(note2, "Opening " + (provider ? "Microsoft" : "Google") + "…");
        var agreed = needAgree ? api("/relay/my/consent", { method: "POST", body: { version: c.version } }) : Promise.resolve({ ok: true });
        agreed.then(function (a) {
          if (!a.ok) throw new Error("consent");
          memo.consent = null;
          return api("/relay/my/gmail/connect", { method: "POST", body: provider ? { provider: provider } : undefined });
        }).then(function (x) {
          // Coming back from Google or Microsoft carries on here, at "You're all set".
          if (x.ok && x.body && host.test(x.body.url || "")) { obSet(st.email, { back: "done" }); location.href = x.body.url; return; }
          button.disabled = false; say(note2, "Couldn't start the " + label + " connection. Please try again.", true);
        }).catch(function () { button.disabled = false; say(note2, "Couldn't reach Relay. Check your connection.", true); });
      };
      var verb = needAgree ? "Agree and connect " : "Connect ";
      var gb = el("button", { type: "button", className: "rl-btn", text: verb + "Gmail" }), ob = el("button", { type: "button", className: "rl-btn", text: verb + "Outlook" });
      gb.onclick = function () { connect(null, "Gmail", /^https:\/\/accounts\.google\.com\//, gb); };
      ob.onclick = function () { connect("microsoft", "Outlook", /^https:\/\/login\.microsoftonline\.com\//, ob); };
      var order = first === "microsoft" ? [ob, gb] : [gb, ob];
      order.forEach(function (b, k) { if (k) b.className = "rl-btn ghost"; if ((b === gb && c.gmailAvailable !== false) || (b === ob && c.outlookAvailable)) body2.appendChild(b); });
      body2.appendChild(note2);
      if (c.outlookAvailable) body2.appendChild(el("p", { className: "rl-jnote", text: "Outlook works with Outlook.com, Hotmail and Live addresses." }));
      if (st.mailNote) say(note2, st.mailNote.text, st.mailNote.bad);
      return;
    }
    // Done: a short welcome, the scan still counting, and where to go first.
    var p = profileNow() || {}, first2 = p.name ? String(p.name).split(/\s+/)[0] : "";
    var body3 = jFrame(sheet, { of: of, at: at, closeText: "Close", onClose: function () { leave(); if (window.go) window.go("profile"); },
      kicker: "YOU'RE IN", title: first2 ? "You're all set, " + first2 + "." : "You're all set.",
      sub: st.connected ? "Relay is bringing in your receipts now. It carries on even if you close the app."
        : isReview() ? "Orders you place at shops that use Relay, with this email address, show up on Home." : "You can connect your email any time from Account, under Receipts." });
    if (st.connected) body3.appendChild(scanCard(sheet, st));
    var tips = el("div", { className: "rl-jcard" });
    (isReview() ? [["check", "Swap a size or colour before the shop sends your order"], ["eye", "Price drops on things you watch, sent to your phone"]]
      : [["check", "Return deadlines from your receipts, counted down for you"], ["eye", "Price drops on things you watch, sent to your phone"]]).forEach(function (x) { tips.appendChild(el("div", { className: "rl-jpt" }, [jIc(x[0]), el("span", { text: x[1] })])); });
    body3.appendChild(tips);
    if (st.connected) {
      body3.appendChild(el("button", { type: "button", className: "rl-btn", text: "See my receipts", onclick: function () { leave(); if (window.go) { window.__relayAutoScan = true; window.go("receipts"); } } }));
      body3.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: "Go to Home", onclick: function () { leave(); if (window.go) window.go("profile"); } }));
    } else body3.appendChild(el("button", { type: "button", className: "rl-btn", text: "Go to Home", onclick: function () { leave(); if (window.go) window.go("profile"); } }));
  }
  var providersAsked = null;
  function signInProviders() {
    if (!providersAsked) providersAsked = api("/relay/auth/providers").then(function (r) { if (!r.ok) providersAsked = null; return r.ok ? r.body : null; }, function () { providersAsked = null; return null; });
    return providersAsked;
  }
  function newNonce() {
    var bytes = new Uint8Array(32); (window.crypto || window.msCrypto).getRandomValues(bytes);
    return btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // ---- Face ID / passkeys (WebAuthn). The phone keeps the private key; Relay stores only the public key. ----
  function passkeysSupported() { try { return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && navigator.credentials.get); } catch (e) { return false; } }
  function b64uToBytes(t) { t = String(t).replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; var b = atob(t), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function bytesToB64u(buf) { var u = new Uint8Array(buf), s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function passkeyProblem(e) {
    var n = e && e.name;
    if (n === "NotAllowedError" || n === "AbortError") return "That was cancelled or timed out. Try again when you're ready.";
    if (n === "InvalidStateError") return "This device already has a passkey for Relay.";
    return "Face ID / passkey isn't working on this device or browser. Use the email link instead.";
  }
  function passkeyButton(msg) {
    var b = el("button", { type: "button", className: "rl-btn ghost", text: "Sign in with Face ID or a passkey" });
    b.onclick = function () {
      b.disabled = true; say(msg, "Waiting for Face ID…");
      api("/relay/auth/passkey/options", { method: "POST" }).then(function (o) {
        if (!o.ok) { b.disabled = false; return say(msg, o.status === 503 ? "Passkey sign-in isn't switched on yet. Use the email link instead." : (errors[o.body.error] || "Couldn't start passkey sign-in. Try again."), true); }
        return navigator.credentials.get({ publicKey: { challenge: b64uToBytes(o.body.challenge), rpId: o.body.rpId, timeout: o.body.timeout, userVerification: "required", allowCredentials: [] } }).then(function (cred) {
          var r = cred.response;
          return api("/relay/auth/passkey/verify", { method: "POST", body: { id: cred.id, response: {
            clientDataJSON: bytesToB64u(r.clientDataJSON), authenticatorData: bytesToB64u(r.authenticatorData), signature: bytesToB64u(r.signature),
            userHandle: r.userHandle ? bytesToB64u(r.userHandle) : undefined } } });
        }).then(function (v) {
          b.disabled = false;
          if (!v.ok) return say(msg, "That passkey wasn't accepted. If you haven't added one yet, sign in another way first and add it from your account.", true);
          signedIn(v.body);
        });
      }).catch(function (e) { b.disabled = false; say(msg, passkeyProblem(e), true); });
    };
    return b;
  }
  // ---- Card for swaps that cost more (Stripe TEST MODE only: no real money moves). ----
  // Saved with a £0.00 check through Apple Pay / Google Pay where the device offers it, or a typed card.
  // Stripe keeps the card; Relay only ever sees the brand and last 4 digits.
  var stripeLoading = null;
  function loadStripe(pk) {
    if (window.Stripe) return Promise.resolve(window.Stripe(pk));
    if (!stripeLoading) stripeLoading = new Promise(function (ok, bad) {
      var sc = document.createElement("script"); sc.src = "https://js.stripe.com/v3/"; sc.onload = ok; sc.onerror = bad; document.head.appendChild(sc);
    });
    return stripeLoading.then(function () { return window.Stripe(pk); });
  }
  function cardText(c) {
    var w = c.wallet === "apple_pay" ? "Apple Pay · " : c.wallet === "google_pay" ? "Google Pay · " : "";
    return w + (c.brand ? c.brand.charAt(0).toUpperCase() + c.brand.slice(1) : "Card") + " ending " + c.last4;
  }
  function addCard(box, onSaved) {
    var note = el("div", { className: "rl-msg" });
    var holder = el("div", { style: "margin:10px 0" });
    box.appendChild(holder); box.appendChild(note);
    say(note, "Loading…");
    api("/relay/my/card/setup", { method: "POST", body: {} }).then(function (r) {
      if (!r.ok) return say(note, "Couldn't start. Please try again.", true);
      var secret = r.body.clientSecret;
      return loadStripe(r.body.publishableKey).then(function (stripe) {
        note.textContent = ""; note.className = "rl-msg";
        var finish = function (setupIntent) {
          api("/relay/my/card/confirm", { method: "POST", body: { setupIntentId: setupIntent.id } }).then(function (x) {
            if (x.ok) { say(note, "Card saved. Nothing was charged."); if (onSaved) onSaved(x.body.card); }
            else say(note, "Couldn't save the card. Please try again.", true);
          });
        };
        // Apple Pay / Google Pay sheet showing £0.00.
        var pr = stripe.paymentRequest({ country: "GB", currency: "gbp", total: { label: "Relay card check (nothing charged)", amount: 0 } });
        var elements = stripe.elements();
        var typeNote = el("p", { className: "small muted", text: "Type a card. Test mode: use 4242 4242 4242 4242, any future date, any 3 digits." });
        pr.canMakePayment().then(function (can) {
          if (can) {
            typeNote.textContent = "Or type a card. Test mode: use 4242 4242 4242 4242, any future date, any 3 digits.";
            var btnBox = el("div", { style: "margin-bottom:10px" }); holder.insertBefore(btnBox, holder.firstChild);
            elements.create("paymentRequestButton", { paymentRequest: pr }).mount(btnBox);
          }
        });
        pr.on("paymentmethod", function (ev) {
          stripe.confirmCardSetup(secret, { payment_method: ev.paymentMethod.id }, { handleActions: false }).then(function (res) {
            if (res.error || !res.setupIntent) { ev.complete("fail"); return say(note, (res.error && res.error.message) || "That didn't work.", true); }
            ev.complete("success"); finish(res.setupIntent);
          });
        });
        // Typed card (test mode: 4242 4242 4242 4242, any future date, any CVC).
        var cardBox = el("div", { style: "padding:12px 14px;border:1px solid var(--rl-line);border-radius:14px;background:var(--rl-card)" });
        holder.appendChild(typeNote);
        holder.appendChild(cardBox);
        var cardEl = elements.create("card", { hidePostalCode: true }); cardEl.mount(cardBox);
        var save = el("button", { className: "rl-btn", text: "Save card (£0.00)", style: "margin-top:10px" });
        save.onclick = function () {
          save.disabled = true; say(note, "Checking the card…");
          stripe.confirmCardSetup(secret, { payment_method: { card: cardEl } }).then(function (res) {
            save.disabled = false;
            if (res.error || !res.setupIntent) return say(note, (res.error && res.error.message) || "That didn't work.", true);
            finish(res.setupIntent);
          });
        };
        holder.appendChild(save);
      });
    }).catch(function () { say(note, "Couldn't load the card form. Check your connection and try again.", true); });
  }
  function cardSection(box) {
    api("/relay/my/card").then(function (r) {
      if (!r.ok || !r.body || !r.body.enabled) return;
      var test = r.body.testMode !== false;
      if (test && !testingOn() && !r.body.card) return;
      box.textContent = "";
      box.appendChild(el("h2", { text: "Card for swaps", style: "font-size:18px;margin-top:8px" }));
      if (test) box.appendChild(el("span", { text: "TEST MODE · no real money", style: "display:inline-block;margin-bottom:6px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;background:#fff3d7;color:#7a540c" }));
      box.appendChild(el("p", { text: "Used only when you swap to a size or colour that costs more: you pay the difference, after you've agreed it. Saving it charges nothing." }));
      var note = el("div", { className: "rl-msg" });
      if (r.body.card) {
        box.appendChild(el("p", { text: cardText(r.body.card) }));
        box.appendChild(el("button", { className: "rl-btn ghost", text: "Remove card", onclick: function () {
          ask("Remove " + cardText(r.body.card) + " from Relay?", "Remove card", function () {
            api("/relay/my/card/remove", { method: "POST", body: {} }).then(function (x) { if (x.ok) cardSection(box); else say(note, "Couldn't remove it. Try again.", true); });
          }); } }));
        box.appendChild(note);
      } else {
        var add = el("button", { className: "rl-btn ghost", text: "Add a card (£0.00 check)" });
        add.onclick = function () { add.remove(); addCard(box, function () { setTimeout(function () { cardSection(box); }, 900); }); };
        box.appendChild(add);
      }
    });
  }
  // Makes a passkey on this device and saves it to the account. Resolves with Relay's answer; rejects if the device
  // says no (cancelled, not supported).
  function newPasskey() {
    return api("/relay/my/passkeys/options", { method: "POST" }).then(function (o) {
      if (!o.ok) return o;
      var p = o.body;
      return navigator.credentials.create({ publicKey: { challenge: b64uToBytes(p.challenge), rp: p.rp, user: { id: b64uToBytes(p.user.id), name: p.user.name, displayName: p.user.displayName },
        pubKeyCredParams: p.pubKeyCredParams, authenticatorSelection: p.authenticatorSelection, attestation: "none", timeout: p.timeout,
        excludeCredentials: (p.excludeCredentials || []).map(function (c) { return { type: "public-key", id: b64uToBytes(c.id) }; }) } }).then(function (cred) {
        var ua = navigator.userAgent || "", name = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android phone" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : "This device";
        return api("/relay/my/passkeys/register", { method: "POST", body: { id: cred.id, name: name, response: {
          clientDataJSON: bytesToB64u(cred.response.clientDataJSON), attestationObject: bytesToB64u(cred.response.attestationObject) } } });
      });
    });
  }
  function passkeySaveProblem(x) { return x && x.body && x.body.error === "too_many_passkeys" ? "You've reached the limit of 5 passkeys. Remove one first." : "That passkey couldn't be saved. Try again."; }
  function passkeySection(box, msg) {
    if (!passkeysSupported()) return;
    var list = el("div"), note = el("div", { className: "rl-msg" });
    box.appendChild(el("h2", { text: "Face ID sign-in", style: "font-size:18px;margin-top:8px" }));
    box.appendChild(el("p", { text: "Sign in with Face ID, Touch ID or your phone's screen lock. No email needed." }));
    box.appendChild(list);
    var add = el("button", { className: "rl-btn ghost", text: "Add Face ID / passkey on this device" });
    box.appendChild(add); box.appendChild(note);
    function refresh() {
      api("/relay/my/passkeys").then(function (r) {
        list.textContent = "";
        if (!r.ok) return;
        ((r.body && r.body.passkeys) || []).forEach(function (k) {
          var rm = el("button", { className: "rl-btn ghost", text: "Remove", style: "width:auto;display:inline-block;margin:6px 0 0;padding:8px 14px;font-size:14px" });
          rm.onclick = function () {
            ask("Remove this passkey? You can still sign in with an email link.", "Remove passkey", function () {
              api("/relay/my/passkeys/remove", { method: "POST", body: { id: k.id } }).then(function (x) { if (x.ok) refresh(); else say(note, errors[x.body && x.body.error] || "Couldn't remove it. Try again.", true); });
            });
          };
          list.appendChild(el("div", { className: "rl-order" }, [el("b", { text: k.name || "Passkey" }),
            el("span", { text: "Added " + new Date(k.createdAt).toLocaleDateString("en-GB") + (k.lastUsedAt ? " · last used " + new Date(k.lastUsedAt).toLocaleDateString("en-GB") : "") }), rm]));
        });
      }).catch(function () {});
    }
    add.onclick = function () {
      add.disabled = true; say(note, "Waiting for Face ID…");
      newPasskey().then(function (x) {
        add.disabled = false;
        if (x.ok) { say(note, "Added. Next time you can sign in with Face ID."); refresh(); }
        else say(note, passkeySaveProblem(x), true);
      }).catch(function (e) { add.disabled = false; say(note, passkeyProblem(e), true); });
    };
    refresh();
  }

  // ---- Codes: by email, by text, from an authenticator app ----
  // A box for a 6-digit code. Phones offer the code from the text or email notification just above the keyboard
  // (one-time-code); pasting the whole message keeps just the code; six digits and it's sent by itself.
  // With recovery, it also takes a recovery code (letters and digits), so nothing is stripped out.
  function codeBox(id, label, onFull, recovery) {
    var input = el("input", { type: "text", id: id, className: recovery ? "rl-field" : "rl-field rl-code", placeholder: recovery ? "6-digit code or recovery code" : "6-digit code",
      autocomplete: "one-time-code", inputMode: recovery ? "text" : "numeric", maxLength: recovery ? 20 : 7 });
    if (!recovery) input.setAttribute("pattern", "[0-9]*");
    input.setAttribute("aria-label", label || "6-digit code"); input.setAttribute("autocapitalize", "none"); input.setAttribute("spellcheck", "false"); input.setAttribute("enterkeyhint", "done");
    var full = function () { if (onFull && /^\d{6}$/.test(input.value)) onFull(); };
    input.addEventListener("paste", function (e) {
      var t = ""; try { t = (e.clipboardData || window.clipboardData).getData("text") || ""; } catch (x) {}
      // Where a recovery code also fits, six digits only count on their own (not inside a code like ab234-567cd).
      var m = recovery ? /(?:^|[^0-9A-Za-z-])(\d{6})(?![0-9A-Za-z-])/.exec(t) : /(?:^|\D)(\d{3})[ -]?(\d{3})(?!\d)/.exec(t);
      if (m) { e.preventDefault(); input.value = m[2] ? m[1] + m[2] : m[1]; full(); }
    });
    input.addEventListener("input", function () {
      if (!recovery) { var d = input.value.replace(/\D/g, "").slice(0, 6); if (d !== input.value) input.value = d; }
      full();
    });
    if (onFull) input.addEventListener("keydown", function (e) { if (e.key === "Enter") onFull(); });
    return input;
  }
  // Android's Chrome can hand over the code from the text itself (the text's last line names Relay's site). One wait at a
  // time: a new code box, or a code accepted, ends the last one.
  var otpWait = null;
  function readTextCode(input, onCode) {
    stopReadingText();
    if (!("OTPCredential" in window) || !navigator.credentials || !window.AbortController) return;
    var ac = new AbortController(); otpWait = ac;
    navigator.credentials.get({ otp: { transport: ["sms"] }, signal: ac.signal }).then(function (otp) {
      if (otpWait === ac) otpWait = null;
      if (otp && /^\d{6}$/.test(otp.code || "") && document.body.contains(input)) { input.value = otp.code; onCode(); }
    }).catch(function () {});
  }
  function stopReadingText() { if (otpWait) { try { otpWait.abort(); } catch (e) {} otpWait = null; } }
  // "Text me a new code": greyed out and counting down until another text can be sent.
  function againButton(label, onclick) {
    var b = el("button", { type: "button", className: "rl-btn ghost", text: label, onclick: onclick }), timer = null, seen = false;
    b.wait = function (secs) {
      clearInterval(timer); var left = Math.max(1, Math.round(Number(secs) || 30));
      var tick = function () {
        if (b.isConnected) seen = true; else if (seen) return clearInterval(timer);
        if (left <= 0) { clearInterval(timer); b.disabled = false; b.textContent = label; return; }
        b.disabled = true; b.textContent = label + " (" + left + "s)"; left--;
      };
      tick(); timer = setInterval(tick, 1000);
    };
    return b;
  }
  // Asks Relay to text a code. Resolves with the answer ({ ending, resendIn }) or null after saying what went wrong.
  function textCode(path, body, msg, again) {
    if (again) again.disabled = true;
    return api(path, { method: "POST", body: body || {} }).then(function (r) {
      if (r.ok) { if (again) again.wait(r.body.resendIn); return r.body; }
      if (again) { if (r.body && r.body.error === "wait") again.wait(r.body.retryAfter); else again.disabled = false; }
      say(msg, errors[r.body && r.body.error] || "The text didn't send. Please try again.", true);
      return null;
    }, function () { if (again) again.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); return null; });
  }
  function recoveryCodesCard(box, codes, then) {
    box.appendChild(el("p", { text: "Save these recovery codes somewhere safe, like a password manager. If you lose your phone, each one gets you in once. You won't see them again." }));
    box.appendChild(el("div", { className: "rl-codes", text: codes.join("\n") }));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      var copy = el("button", { type: "button", className: "rl-btn ghost", text: "Copy codes" });
      copy.onclick = function () { navigator.clipboard.writeText(codes.join("\n")).then(function () { copy.textContent = "Copied"; }, function () {}); };
      box.appendChild(copy);
    }
    box.appendChild(el("button", { type: "button", className: "rl-btn", text: "I've saved them", style: "margin-top:10px", onclick: then }));
  }

  function passkeyStepView(sheet, info) {
    var body = jFrame(sheet, { back: function () { emailStep(sheet, info.email); }, title: "Finish with Face ID",
      sub: "This account uses Face ID or a passkey as its second step. Use it now to finish signing in." });
    sheet.setAttribute("aria-label", "Two-step sign-in");
    var msg = el("div", { className: "rl-msg", role: "status" });
    if (passkeysSupported()) { var b = passkeyButton(msg); b.className = "rl-btn"; b.textContent = "Use Face ID or a passkey"; body.appendChild(b); }
    else body.appendChild(el("p", { text: "This browser can't use passkeys. Open Relay on the phone or computer where you added it." }));
    body.appendChild(msg);
    body.appendChild(el("p", { className: "rl-jnote", text: "Your passkey is on another device? Your browser can show a code to scan with that phone." }));
  }
  // ---- "Protect your account": every account needs a second step for signing in (worker/second-step.js) ----
  // Opened when Relay answers "second_step_needed", or as a step after signing up. It can't be skipped: the shopper sets
  // one up (Face ID or the phone's screen lock, codes by text, or an authenticator app), or signs out.
  var protectTimer = null;
  function protectOpen() { return Boolean(document.querySelector('.rl-sheet[aria-label="Protect your account"]')); }
  function needSecondStep() {
    if (protectTimer || protectOpen() || !load()) return;
    // A moment's wait: the sign-up journey may be opening it itself.
    protectTimer = setTimeout(function () { protectTimer = null; if (!protectOpen() && load()) protectAccount(); }, 0);
  }
  function protectAccount(onDone) {
    open(function (sheet) {
      var body = jFrame(sheet, { noClose: true, title: "Protect your account",
        sub: "Relay asks everyone for a second step when they sign in, so nobody can get into your account with just your email. Pick one. It takes a minute." });
      sheet.setAttribute("aria-label", "Protect your account");
      var msg = el("div", { className: "rl-msg", role: "status" });
      function finish() {
        say(msg, "Checking…");
        api("/relay/my/second-step", { fresh: true }).then(function (r) {
          if (!r.ok || !r.body.done) return say(msg, "That didn't finish. Try again.", true);
          close(); forget();
          if (onDone) onDone(); else if (typeof window.render === "function") { try { window.render(); } catch (e) {} }
        }).catch(function () { say(msg, "Couldn't reach Relay. Check your connection.", true); });
      }
      if (passkeysSupported()) {
        var face = el("button", { type: "button", className: "rl-btn", text: "Use Face ID or screen lock" });
        face.onclick = function () {
          if (face.disabled) return;
          face.disabled = true; say(msg, "Waiting for Face ID…");
          newPasskey().then(function (x) {
            face.disabled = false;
            if (x.ok) return finish();
            say(msg, passkeySaveProblem(x), true);
          }).catch(function (e) { face.disabled = false; say(msg, passkeyProblem(e), true); });
        };
        body.appendChild(el("div", { className: "rl-2s" }, [el("div", { className: "rl-2s-h" }, [accIc("face"), el("b", { text: "Face ID or screen lock" })]),
          el("p", { text: "Your face, fingerprint or your phone's screen lock. Nothing to type, and it signs you in on its own next time." }), face]));
      }
      body.appendChild(msg);
      var others = el("div"); body.appendChild(others);
      twoStepSection(others, { onOn: finish });
      body.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: "Sign out", onclick: function () {
        api("/relay/auth/logout", { method: "POST" }).finally(function () { save(null); close(); if (window.go) window.go("home"); });
      } }));
    });
  }

  // Signing in, step two: the code texted to the phone (sent straight away), from the authenticator app, or a recovery code.
  // An account whose only second step is a passkey finishes with the passkey instead.
  function secondStepView(sheet, info) {
    if (info && info.methods && info.methods[0] === "passkey" && !info.pendingToken) return passkeyStepView(sheet, info);
    if (typeof info === "string") info = { pendingToken: info };
    var methods = info.methods && info.methods.length ? info.methods : ["app"], pending = info.pendingToken, ending = info.phoneEnding || "";
    var mode = methods[0], textSent = false, waitUntil = 0;
    function draw() {
      var text = mode === "text", app = mode === "app", recovery = mode === "recovery";
      var body = jFrame(sheet, {
        title: text ? "Check your phone" : app ? "Enter your code" : "Use a recovery code",
        sub: text ? "Relay texts a 6-digit code to your number ending " + ending + ". It works once, for 10 minutes."
          : app ? "Open your authenticator app and type the 6-digit code for Relay."
          : "Type one of the recovery codes you saved when you turned on two-step sign-in. Each one works once." });
      sheet.setAttribute("aria-label", "Two-step sign-in");
      var msg = el("div", { className: "rl-msg" }), busy = false, input;
      if (recovery) {
        input = el("input", { type: "text", id: "rl-2s-code", className: "rl-field", placeholder: "Recovery code", autocomplete: "off", maxLength: 20 });
        input.setAttribute("aria-label", "Recovery code"); input.setAttribute("autocapitalize", "none"); input.setAttribute("spellcheck", "false");
        input.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      } else input = codeBox("rl-2s-code", "6-digit code", function () { go(); });
      var confirm = el("button", { type: "button", className: "rl-btn", text: "Confirm", onclick: function () { go(); } });
      function go() {
        if (busy) return;
        var v = input.value.trim();
        if (!v) return say(msg, recovery ? "Type one of your recovery codes." : "Type the 6-digit code.", true);
        busy = true; confirm.disabled = true; say(msg, "Checking…");
        api("/relay/auth/2fa/verify", { method: "POST", body: { pendingToken: pending, code: v } }).then(function (r) {
          busy = false; confirm.disabled = false;
          if (r.ok) { stopReadingText(); return signedIn(r.body); }
          var e = r.body && r.body.error;
          say(msg, e === "invalid_code" ? (recovery ? "That recovery code isn't right, or it's already been used." : "That code isn't right. Check it and try again.") : errors[e] || "Something went wrong. Please try again.", true);
          if (!recovery) input.value = "";
          try { input.focus(); } catch (x) {}
        }).catch(function () { busy = false; confirm.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
      }
      [input, confirm, msg].forEach(function (n) { body.appendChild(n); });
      if (text) {
        var again = againButton("Text me a new code", function () { send(); });
        var send = function () {
          say(msg, "");
          textCode("/relay/auth/2fa/text", { pendingToken: pending }, msg, again).then(function (b) {
            if (!b) return;
            textSent = true; waitUntil = Date.now() + (b.resendIn || 30) * 1000; ending = b.ending || ending;
            readTextCode(input, go);
          });
        };
        body.appendChild(again);
        if (!textSent) send();
        else { if (waitUntil > Date.now()) again.wait((waitUntil - Date.now()) / 1000); readTextCode(input, go); }
      }
      methods.forEach(function (m) {
        if (m === mode) return;
        body.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: m === "text" ? "Text me a code instead" : "Use my authenticator app instead", onclick: function () { mode = m; draw(); } }));
      });
      body.appendChild(recovery ? el("button", { type: "button", className: "rl-btn ghost", text: methods[0] === "text" ? "Back to the texted code" : "Back to the app code", onclick: function () { mode = methods[0]; draw(); } })
        : el("button", { type: "button", className: "rl-btn ghost", text: "Use a recovery code", onclick: function () { mode = "recovery"; draw(); } }));
      setTimeout(function () { try { input.focus(); } catch (x) {} }, 50);
    }
    draw();
  }

  // Typing a mobile number, then the code texted to it. opts.confirm(code) replaces the usual confirm (the two-step page
  // uses it to confirm the number and switch codes by text on in one go); opts.onDone(answer) runs once it's confirmed.
  function numberStep(body, note, opts) {
    body.textContent = ""; say(note, "");
    body.appendChild(el("p", { text: opts.intro || "Relay texts a code to check it's yours. UK mobile numbers only for now." }));
    var input = el("input", { type: "tel", id: "rl-phone", className: "rl-field", placeholder: "07700 900123", autocomplete: "tel", inputMode: "tel", maxLength: 24, value: opts.typed || "" });
    var send = el("button", { type: "button", className: "rl-btn", text: "Text me a code" });
    send.onclick = function () {
      if (send.disabled) return;
      var v = input.value.trim();
      if (!v) { say(note, "Type your mobile number.", true); return; }
      send.disabled = true; say(note, "Sending a text…");
      textCode("/relay/my/phone/start", { phone: v }, note, null).then(function (b) { send.disabled = false; if (b) { say(note, ""); codeStep(v, b.ending); } });
    };
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") send.click(); });
    [el("label", { htmlFor: "rl-phone", className: "rl-jlabel", text: "Mobile number" }), input, send].forEach(function (n) { body.appendChild(n); });
    if (opts.onCancel) body.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: "Cancel", onclick: opts.onCancel }));
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
    function codeStep(number, ending) {
      body.textContent = "";
      body.appendChild(el("p", { text: "We've texted a 6-digit code to your number ending " + ending + ". It works once, for 10 minutes." }));
      var busy = false, box = codeBox("rl-phone-code", "6-digit code", function () { go(); });
      var ok = el("button", { type: "button", className: "rl-btn", text: opts.confirmLabel || "Confirm number", onclick: function () { go(); } });
      var again = againButton("Text me a new code", function () {
        say(note, "");
        textCode("/relay/my/phone/start", { phone: number }, note, again).then(function (b) { if (b) { say(note, "Another code is on its way."); readTextCode(box, go); } });
      });
      function go() {
        if (busy) return;
        if (!box.value) { say(note, "Type the 6-digit code.", true); return; }
        busy = true; ok.disabled = true; say(note, "Checking…");
        (opts.confirm ? opts.confirm(box.value) : api("/relay/my/phone/confirm", { method: "POST", body: { code: box.value } })).then(function (r) {
          busy = false; ok.disabled = false;
          if (r.ok) { stopReadingText(); say(note, ""); return opts.onDone(r.body); }
          var e = r.body && r.body.error;
          say(note, e === "invalid_code" || e === "invalid_or_expired_code" ? "That code isn't right, or it has expired. Check the text, or ask for a new code." : errors[e] || "Something went wrong. Please try again.", true);
          box.value = ""; try { box.focus(); } catch (x) {}
        }).catch(function () { busy = false; ok.disabled = false; say(note, "Couldn't reach Relay. Check your connection.", true); });
      }
      [box, ok, again, el("button", { type: "button", className: "rl-btn ghost", text: "Use a different number", onclick: function () { numberStep(body, note, Object.assign({}, opts, { typed: number })); } })]
        .forEach(function (n) { body.appendChild(n); });
      again.wait(30); readTextCode(box, go);
      setTimeout(function () { try { box.focus(); } catch (e) {} }, 50);
    }
  }
  // A code texted now to the number already on the account (or, when switching something off, an app or recovery code).
  function codeOnly(body, note, intro, label, confirm, onDone, onCancel, recovery) {
    body.textContent = ""; say(note, "");
    body.appendChild(el("p", { text: intro }));
    var busy = false, box = codeBox("rl-2s-manage", "Code", function () { go(); }, recovery);
    var ok = el("button", { type: "button", className: "rl-btn", text: label, onclick: function () { go(); } });
    var again = againButton("Text me a new code", function () { send(); });
    function send() { say(note, ""); textCode("/relay/my/2fa/text/send", {}, note, again).then(function (b) { if (b) readTextCode(box, go); }); }
    function go() {
      if (busy) return;
      if (!box.value.trim()) { say(note, "Type the code.", true); return; }
      busy = true; ok.disabled = true; say(note, "Checking…");
      confirm(box.value.trim()).then(function (r) {
        busy = false; ok.disabled = false;
        if (r.ok) { stopReadingText(); say(note, ""); return onDone(r.body); }
        say(note, r.body && r.body.error === "invalid_code" ? "That code isn't right. Check it and try again." : errors[r.body && r.body.error] || "Something went wrong. Please try again.", true);
        box.value = ""; try { box.focus(); } catch (x) {}
      }).catch(function () { busy = false; ok.disabled = false; say(note, "Couldn't reach Relay. Check your connection.", true); });
    }
    [box, ok, again, el("button", { type: "button", className: "rl-btn ghost", text: "Cancel", onclick: onCancel })].forEach(function (n) { body.appendChild(n); });
    send();
    setTimeout(function () { try { box.focus(); } catch (e) {} }, 50);
  }

  // Account → Phone number: a mobile number, confirmed by a texted code, for sign-in codes.
  function phoneSection(box, openTwoStep) {
    var body = el("div"), note = el("div", { className: "rl-msg", role: "status" });
    box.appendChild(body); box.appendChild(note);
    function draw(done) {
      body.textContent = ""; say(note, done || "");
      body.appendChild(el("div", { className: "rl-skel", style: "min-height:96px;border-radius:16px" }));
      api("/relay/my/phone").then(function (r) {
        body.textContent = "";
        if (!r.ok) return say(note, "Couldn't load your number. Check your connection and try again.", true);
        var p = r.body;
        if (p.ending) return confirmed(p);
        if (!p.available) return body.appendChild(el("p", { text: "Relay can't send texts yet. This is where you'll add your number when it can." }));
        numberStep(body, note, { onDone: function () { draw("Number confirmed."); } });
        if (done) say(note, done);
      }).catch(function () { body.textContent = ""; say(note, "Couldn't reach Relay. Check your connection.", true); });
    }
    function confirmed(p) {
      body.appendChild(el("div", { className: "rl-2s" }, [
        el("div", { className: "rl-2s-h" }, [accIc("phone"), el("b", { text: "Number ending " + p.ending }), el("span", { className: "rl-2s-st on", text: "Confirmed" })]),
        el("p", { text: p.twoStep ? "Relay texts a code to this number each time you sign in with an email link, Google or Microsoft." : "Used only for sign-in codes. Never for marketing, and never shown to anyone." })]));
      if (p.twoStep) {
        body.appendChild(el("p", { className: "rl-jnote", text: "To change or remove this number, turn off codes by text under Two-step sign-in first." }));
        if (openTwoStep) body.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: "Go to Two-step sign-in", onclick: openTwoStep }));
        return;
      }
      if (openTwoStep) body.appendChild(el("button", { type: "button", className: "rl-btn", text: "Text me a code when I sign in", onclick: openTwoStep }));
      body.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: "Change number", onclick: function () { numberStep(body, note, { onDone: function () { draw("Number changed."); }, onCancel: function () { draw(); } }); } }));
      var rm = el("button", { type: "button", className: "rl-btn ghost", text: "Remove number" });
      rm.onclick = function () {
        ask("Remove your number ending " + p.ending + "?", "Remove number", function () {
          rm.disabled = true;
          api("/relay/my/phone/remove", { method: "POST", body: {} }).then(function (x) {
            rm.disabled = false;
            if (x.ok) draw("Number removed."); else say(note, errors[x.body && x.body.error] || "Couldn't remove it. Try again.", true);
          }).catch(function () { rm.disabled = false; say(note, "Couldn't reach Relay. Check your connection.", true); });
        });
      };
      body.appendChild(rm);
    }
    draw();
  }

  // Account → Two-step sign-in: a code as well as the email link, Google or Microsoft. By text, from an app, or both.
  function twoStepSection(box, opts) {
    opts = opts || {};
    var body = el("div"), note = el("div", { className: "rl-msg", role: "status" });
    // After a way is on and its recovery codes are saved: carry on where the shopper came from, or show the settings again.
    var afterOn = function (done) { if (opts.onOn) opts.onOn(); else render(done); };
    box.appendChild(body); box.appendChild(note);
    function render(done) {
      body.textContent = ""; say(note, done || "");
      body.appendChild(el("div", { className: "rl-skel", style: "min-height:150px;border-radius:16px" }));
      api("/relay/my/2fa").then(function (r) {
        body.textContent = "";
        if (!r.ok) return say(note, "Couldn't load your settings. Check your connection and try again.", true);
        var s = r.body;
        if (!opts.onOn) body.appendChild(el("p", { text: "With this on, signing in with an email link, Google or Microsoft also asks for a code. Face ID sign-in doesn't need one." }));
        // One way at a time, so a stolen session can't add its own way and use it to switch the shopper's off.
        if (s.textAvailable || s.text) body.appendChild(textCard(s));
        body.appendChild(appCard(s));
        if (s.text || s.app) body.appendChild(el("p", { className: "rl-jnote", text: "One way at a time. To switch, turn this one off first." }));
        if (s.enabled) {
          var left = s.recoveryCodesLeft;
          body.appendChild(el("p", { className: "rl-jnote", text: left + " recovery code" + (left === 1 ? "" : "s") + " left." + (left <= 2 ? " You're running low: turn two-step sign-in off and on again for a fresh set." : "") }));
        }
      }).catch(function () { body.textContent = ""; say(note, "Couldn't reach Relay. Check your connection.", true); });
    }
    function card(icon, title, on, line) {
      return el("div", { className: "rl-2s" }, [el("div", { className: "rl-2s-h" }, [accIc(icon), el("b", { text: title }), el("span", { className: "rl-2s-st" + (on ? " on" : ""), text: on ? "On" : "Off" })]), el("p", { text: line })]);
    }
    var turnOn = function (code) { return api("/relay/my/2fa/text", { method: "POST", body: { on: true, code: code } }); };
    function textOnDone(b) {
      if (!b.recoveryCodes) return afterOn("Codes by text are on.");
      body.textContent = "";
      body.appendChild(el("p", { text: "Codes by text are on.", style: "color:var(--rl-text);font-weight:700" }));
      recoveryCodesCard(body, b.recoveryCodes, function () { afterOn(); });
    }
    function textCard(s) {
      var c = card("phone", "Text message", s.text, s.text ? "Codes go to your number ending " + s.phoneEnding + "."
        : s.phoneEnding ? "Text a code to your number ending " + s.phoneEnding + " each time you sign in." : "Text a code to your mobile each time you sign in.");
      if (s.app) return c;
      if (s.text) c.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: "Turn off codes by text", onclick: function () {
        codeOnly(body, note, "To turn this off, type the code we've just texted to your number ending " + s.phoneEnding + ". No phone? Type a recovery code instead.", "Turn off",
          function (code) { return api("/relay/my/2fa/text", { method: "POST", body: { on: false, code: code } }); }, function () { render("Codes by text are off."); }, function () { render(); }, true);
      } }));
      // In "Protect your account", Face ID is the one suggested first, so the other ways are quieter.
      else c.appendChild(el("button", { type: "button", className: "rl-btn" + (opts.onOn && passkeysSupported() ? " ghost" : ""), text: "Turn on codes by text", onclick: function () {
        if (!s.phoneEnding) return numberStep(body, note, { intro: "Which mobile should the codes go to? Relay texts a code now to check it's yours. UK mobile numbers only for now.", confirm: turnOn, confirmLabel: "Turn on", onDone: textOnDone, onCancel: function () { render(); } });
        codeOnly(body, note, "We've texted a 6-digit code to your number ending " + s.phoneEnding + ". Type it to turn this on.", "Turn on", turnOn, textOnDone, function () { render(); });
      } }));
      return c;
    }
    function appCard(s) {
      var c = card("lock", "Authenticator app", s.app, s.app ? "Codes come from your authenticator app." : "Use an app like Google Authenticator, 1Password or Authy for the code.");
      if (s.text) return c;
      c.appendChild(s.app ? el("button", { type: "button", className: "rl-btn ghost", text: "Turn off the app", onclick: appOff })
        : el("button", { type: "button", className: "rl-btn" + (s.textAvailable ? " ghost" : ""), text: "Set up authenticator app", onclick: setup }));
      return c;
    }
    function appOff() {
      body.textContent = ""; say(note, "");
      body.appendChild(el("p", { text: "To turn off the authenticator app, type a code from it, or one of your recovery codes." }));
      var busy = false, off = codeBox("rl-2s-off", "App code or recovery code", function () { go(); }, true);
      var btn = el("button", { type: "button", className: "rl-btn", text: "Turn off the app", onclick: function () { go(); } });
      function go() {
        if (busy || !off.value.trim()) return;
        busy = true; btn.disabled = true; say(note, "Checking…");
        api("/relay/my/2fa/disable", { method: "POST", body: { code: off.value.trim() } }).then(function (x) {
          busy = false; btn.disabled = false;
          if (x.ok) return render("The authenticator app is off.");
          say(note, x.body && x.body.error === "invalid_code" ? "That code isn't right. Check your app, or type a recovery code." : errors[x.body && x.body.error] || "Couldn't turn it off. Try again.", true);
        }).catch(function () { busy = false; btn.disabled = false; say(note, "Couldn't reach Relay. Check your connection.", true); });
      }
      [off, btn, el("button", { type: "button", className: "rl-btn ghost", text: "Cancel", onclick: function () { render(); } })].forEach(function (n) { body.appendChild(n); });
    }
    function setup() {
      say(note, "");
      api("/relay/my/2fa/setup", { method: "POST", body: {} }).then(function (r) {
        if (!r.ok) return say(note, "Couldn't start setup. Try again.", true);
        body.textContent = "";
        body.appendChild(el("p", { text: "1. In your authenticator app, add a new account and enter this key (or tap the link on your phone):" }));
        body.appendChild(el("div", { className: "rl-codes", text: r.body.secret }));
        if (/^otpauth:\/\//.test(r.body.otpauthUrl || "")) body.appendChild(el("a", { href: r.body.otpauthUrl, className: "rl-btn ghost", text: "Open in authenticator app", style: "box-sizing:border-box;text-align:center;text-decoration:none;margin:0 0 12px" }));
        body.appendChild(el("p", { text: "2. Type the 6-digit code it shows:" }));
        var busy = false, c = codeBox("rl-2s-app", "6-digit code from the app", function () { on.click(); });
        var on = el("button", { type: "button", className: "rl-btn", text: "Turn on" });
        on.onclick = function () {
          if (busy) return; busy = true; on.disabled = true; say(note, "Checking…");
          api("/relay/my/2fa/enable", { method: "POST", body: { code: c.value } }).then(function (x) {
            busy = false; on.disabled = false;
            if (!x.ok) { c.value = ""; return say(note, x.body && x.body.error === "invalid_code" ? "That code isn't right. Check your app and try again." : errors[x.body && x.body.error] || "Couldn't turn it on. Try again.", true); }
            body.textContent = ""; say(note, "");
            body.appendChild(el("p", { text: "The authenticator app is on.", style: "color:var(--rl-text);font-weight:700" }));
            recoveryCodesCard(body, x.body.recoveryCodes || [], function () { afterOn(); });
          }).catch(function () { busy = false; on.disabled = false; say(note, "Couldn't reach Relay. Check your connection.", true); });
        };
        [c, on, el("button", { type: "button", className: "rl-btn ghost", text: "Cancel", onclick: function () { render(); } })].forEach(function (n) { body.appendChild(n); });
      }).catch(function () { say(note, "Couldn't reach Relay. Check your connection.", true); });
    }
    render();
  }
  function money(minor, cur) { var n = (minor / 100).toFixed(2).split("."); return (minor < 0 ? "−" : "") + (cur === "GBP" || !cur ? "£" : cur + " ") + n[0].replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + n[1]; }
  function consentView(sheet, email, c) {
    var msg = el("div", { className: "rl-msg" });
    var agree = el("button", { className: "rl-btn", text: "I agree and continue" });
    agree.onclick = function () {
      agree.disabled = true; say(msg, "Saving…");
      api("/relay/my/consent", { method: "POST", body: { version: c.version } }).then(function (r) { memo.consent = null; memo.gmail = null;
        if (r.status === 401) { save(null); close(); return; }
        if (!r.ok) { agree.disabled = false; return say(msg, "Couldn't save your choice. Please try again.", true); }
        open(function (s) { gate(s, email); });
      }).catch(function () { agree.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    sheet.appendChild(el("h2", { text: c.acceptedEarlier ? "We've updated this" : "Before you start" }));
    sheet.appendChild(el("p", { text: c.acceptedEarlier ? "Relay can now read Outlook as well as Gmail, so the wording below changed to say so. What Relay reads and keeps is the same. Please agree again to keep your receipts updating."
      : "Relay is only useful if it can see your receipts, so this is needed to use it." }));
    c.text.forEach(function (t) { sheet.appendChild(el("p", { text: t })); });
    sheet.appendChild(agree); sheet.appendChild(msg);
    sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Sign out", onclick: function () {
      api("/relay/auth/logout", { method: "POST" }).finally(function () { save(null); close(); }); } }));
  }
  function gate(sheet, email, notice) {
    sheet.textContent = "";
    sheet.appendChild(el("div", { className: "rl-skel", style: "min-height:56px;border-radius:16px;margin-bottom:12px" })); sheet.appendChild(el("div", { className: "rl-skel", style: "min-height:180px;border-radius:16px" }));
    api("/relay/my/consent").then(function (r) {
      sheet.textContent = "";
      if (r.status === 401) { save(null); close(); return; }
      if (!r.ok) { sheet.appendChild(el("p", { text: "Couldn't reach Relay." })); sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Close", onclick: close })); return; }
      // The reviewer account never reads an inbox, so there's nothing for it to agree to.
      if (!r.body.accepted && !isReview()) return consentView(sheet, email, r.body);
      signedInView(sheet, email, notice, r.body);
    }).catch(function () { sheet.textContent = ""; sheet.appendChild(el("p", { text: "Couldn't reach Relay." })); });
  }
  // A receipt's details. slim: inside a row or a sheet that already names the shop. opts.inRow: the row above already shows
  // the days left, so they aren't repeated. refresh(kind) hears what changed: "confirm" or "dismiss".
  // Laid out simply: when to return it and why that date, the shop's returns page, then a row of small buttons, then (until
  // you've checked it) one question, "Is this right?".
  function receiptCard(x, refresh, slim, opts) {
    opts = opts || {};
    var who = (x.retailer && (x.retailer.name || x.retailer.domain)) || "Unknown store";
    var names = (x.items || []).map(function (i) { return i.qty + " × " + i.name + (i.variant ? " (" + i.variant + ")" : ""); }).join(", ");
    var card = el("div", { className: "rl-order" }, [el("b", { text: who + (x.orderRef ? " · " + x.orderRef : "") }),
      el("span", { text: (names ? names + " · " : "") + (x.totalPence == null ? "total not found" : money(x.totalPence, x.currency)) + (/^\d{4}-\d{2}-\d{2}$/.test(x.orderDate || "") ? " · " + shortDate(x.orderDate + "T12:00:00Z") : "") })]);
    if (slim) { card.removeChild(card.firstChild); card.removeChild(card.firstChild); card.style.margin = "0"; card.style.padding = "0"; card.style.border = "0"; card.style.boxShadow = "none"; card.style.background = "none"; }
    if (!slim && x.hasImage && x.id) {
      var ph = el("img", { alt: "", style: "float:right;width:64px;height:64px;object-fit:cover;border-radius:12px;margin:0 0 8px 10px;background:var(--rl-fill)" });
      card.insertBefore(ph, card.firstChild);
      apiBlob("/relay/my/receipts/" + x.id + "/image").then(function (u) { if (u) ph.src = u; else ph.remove(); });
    }
    var dv = x.delivery;
    if (!slim && dv && dv.status && (dv.status === "delivered" || freshDelivery(x))) card.appendChild(shipLine(dv));
    var keepNames = x.returnable === false ? (x.returnableItems || []).map(function (i) { return (x.items || [])[i] && x.items[i].name; }).filter(Boolean) : [];
    if (keepNames.length) card.appendChild(el("p", { className: "rl-keep", text: "The food can't go back, but you can usually return the " + keepNames.join(", the ") + "." ,
      style: "margin:8px 0 0;padding:10px 12px;border-radius:12px;background:var(--rl-accent-bg);color:var(--rl-text);font-size:14px;font-weight:600;line-height:1.4" }));
    else if (x.returnable === false) card.appendChild(el("span", { text: "Usually can't be returned", style: "display:inline-block;margin:6px 6px 0 0;padding:4px 10px;border-radius:999px;font-weight:700;font-size:13px;background:var(--rl-fill);color:var(--rl-text2)" }));
    var left = daysLeft(statedDeadline(x));
    var leftText = left === null ? "" : left < 0 ? "Deadline passed" : left === 0 ? "Return today" : left + " day" + (left === 1 ? "" : "s") + " left";
    var leftTone = left === null ? "" : left < 0 ? "past" : left <= 2 ? "red" : left <= 7 ? "amber" : "green";
    // When to return it, in two lines: the date to go by, then why that date (and whose words they are).
    var by = x.returnBy && deadlineOf(x) === x.returnBy.date ? x.returnBy : null;
    var legal = by && by.basis === "uk_law" ? by.date : null;
    var rt = x.returns || (legal ? {} : null) || {};
    var day = function (d) { var t = new Date(d + "T00:00:00Z"), f = function (o) { return t.toLocaleDateString("en-GB", Object.assign({ timeZone: "UTC" }, o)); }; return f({ weekday: "short" }) + " " + f({ day: "numeric", month: "short" }); };
    var head = null, why = null, policyLink = null;
    // The shop's published returns policy, when its emails say nothing and Relay has read it (worker/return-policies.js).
    var pol = x.returnPolicy && x.returnPolicy.days && /^https:\/\//.test(x.returnPolicy.url || "") ? x.returnPolicy : null;
    // Only the shop's own words make a deadline. When its email gives none, Relay says so, and gives the legal minimum as
    // what it is (with a date only when the delivery day is known), never as the shop's deadline.
    if (rt.deadline) { head = "Return by " + day(rt.deadline); why = "The date in " + who + "'s email."; }
    else if (rt.windowDays && by && by.basis === "window" && by.from === "delivery" && !by.estimate) {
      head = "Return by " + day(by.date);
      why = rt.windowDays + " days from delivery, as " + who + "'s email says.";
    } else if (rt.windowDays) {
      head = rt.windowDays + " days to return";
      why = rt.windowFrom === "delivery" ? "From the day it arrives, " + who + "'s email says." + (by ? " Even counting from your order, that's until at least " + day(by.date) + "." : "")
        : who + "'s email doesn't say from when." + (by ? " Counting from your order, that's until at least " + day(by.date) + "." : "");
    } else if (pol) {
      // No date or window in the emails, but Relay has read the shop's own returns policy: what it gives for most items,
      // and the least that means for this order (never a countdown: sale items and the like can have less).
      var pby = by && by.basis === "policy" ? by : null, arrivedAt = dv && dv.status === "delivered" && dv.at ? dv.at : null;
      var fromTxt = pol.from === "delivery" ? " from delivery" : pol.from === "dispatch" ? " from when it's sent" : pol.from === "purchase" ? " from purchase" : "";
      var dm = function (d) { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); };
      head = pol.days + " days to return" + (pol.most ? " most items" : "");
      why = pol.shop + "'s returns policy gives " + pol.days + " days" + fromTxt + (pol.most ? " for most items" : "") + ".";
      if (pby && pby.from === "festive" && pol.festive) why += " Bought between " + dm(pol.festive.from) + " and " + dm(pol.festive.to) + ", so it can go back until at least " + day(pby.date) + ".";
      else if (pby && pby.from === "delivery" && arrivedAt) why += " It arrived " + day(arrivedAt) + ", so that's until at least " + day(pby.date) + ".";
      else if (pby) why += " Counting from your order, that's until at least " + day(pby.date) + ".";
      else if (pol.from === "delivery" && !arrivedAt && !x.orderDate) why += " Relay adds the date once it arrives.";
      policyLink = pol.url;
    } else if (legal) {
      // The legal minimum's date only beside the delivery it counts from, so the two can't disagree on screen.
      var arrived = dv && dv.status === "delivered" && dv.at && !by.estimate && by.from !== "order" ? dv.at : null;
      head = "No return date in " + who + "'s email";
      why = "By UK law you have at least 14 days from delivery to change your mind about most online orders" +
        (arrived ? ": it arrived " + day(arrived) + ", so until at least " + day(legal) + "." : ". Relay adds the date once it arrives.") +
        " " + who + " may give longer.";
    }
    var portal = rt.portalUrl && /^https:\/\//.test(rt.portalUrl) ? rt.portalUrl : null;
    if (head || rt.address || (portal && !opts.noPortal)) {
      var rb = el("div", { className: "rl-ret" });
      var polLink = policyLink ? el("a", { className: "rl-ret-go", href: policyLink, target: "_blank", rel: "noopener noreferrer" }, [el("span", { text: "Read " + pol.shop + "'s returns policy" }), jIc("ext", 18)]) : null;
      if (head) rb.appendChild(el("div", { className: "rl-ret-top" }, [el("b", { className: "rl-ret-h", text: head })].concat(leftText && !opts.inRow ? [el("span", { className: "rl-rr-chip " + leftTone, text: leftText })] : [])));
      if (why) rb.appendChild(el("span", { className: "rl-ret-why", text: why }));
      if (rt.address) rb.appendChild(el("span", { className: "rl-ret-why", text: "Send it to " + rt.address }));
      if (portal && !opts.noPortal) rb.appendChild(el("a", { className: "rl-ret-go", href: portal, target: "_blank", rel: "noopener noreferrer" }, [el("span", { text: "Start a return with " + who }), jIc("ext", 18)]));
      if (polLink) rb.appendChild(polLink);
      card.appendChild(rb);
    } else if (leftText && !opts.inRow) card.appendChild(el("span", { className: "rl-rr-chip " + leftTone, text: leftText, style: "display:inline-block;margin-top:2px" }));
    var rp = x.returnPlan || (x.kind === "return_instructions" ? x : null);
    var prog = x.returnProgress || null;
    if (!rp && prog) rp = {};
    if (rp) {
      var pb = el("div", { className: "rl-ret" });
      pb.appendChild(el("b", { className: "rl-ret-h", text: "Your return" }));
      var pl = function (t, st) { pb.appendChild(el("span", { className: "rl-ret-why", text: t, style: st || "" })); };
      if (rp.deadline) {
        var past = rp.deadline < new Date().toISOString().slice(0, 10);
        pl((past ? "Deadline passed: " : "Return by ") + day(rp.deadline), past ? "" : "color:var(--rl-text);font-weight:600");
      }
      if (prog) {
        // Where the return has got to, step by step. Each step comes from an email; Relay can't confirm the refund itself.
        var shortDay = function (d) { return d ? " · " + new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : ""; };
        var pc = prog.parcel, arrived = Boolean(prog.receivedAt || prog.refundedAt || (pc && pc.status === "delivered"));
        var steps = [
          ["Sent back", Boolean(pc || arrived), pc && pc.status !== "delivered" ? shortDay(pc.at) : ""],
          ["Arrived at " + who, arrived, shortDay(prog.receivedAt || (pc && pc.status === "delivered" ? pc.at : null))],
          [prog.refundPence != null ? "Refund of " + money(prog.refundPence, prog.currency || "GBP") + " processed" : "Refund processed", Boolean(prog.refundedAt), shortDay(prog.refundedAt)]
        ];
        var track = el("div", { className: "rl-ret-steps" });
        steps.forEach(function (st) {
          track.appendChild(el("span", { className: st[1] ? "done" : "" }, [jIc(st[1] ? "check" : "dot", 16), el("span", { text: st[0] + (st[1] ? st[2] : "") })]));
        });
        pb.appendChild(track);
        if (prog.trackUrl && !rp.trackUrl && /^https:\/\//.test(prog.trackUrl)) pb.appendChild(el("a", { className: "rl-ret-go", href: prog.trackUrl, target: "_blank", rel: "noopener noreferrer" }, [el("span", { text: "Track your return parcel" }), jIc("ext", 18)]));
        if (prog.refundedAt) pl("The refund comes from " + who + "'s email. Allow a few days for it to show on your statement.");
      }
      if (rp.carrier) pl("Drop off with " + rp.carrier);
      if (rp.returnId) pl("Return ID: " + rp.returnId);
      (rp.steps || []).forEach(function (t) { pl(t); });
      if (rp.estimatedRefundPence != null) pl("Estimated refund: " + money(rp.estimatedRefundPence, rp.currency) + " (an estimate from the email, not a confirmed refund)");
      if (rp.id && mailRef(rp) && openOriginal) {
        pb.appendChild(el("button", { className: "rl-btn", text: "Show my QR code / return email", style: "margin-top:8px;padding:10px 14px;font-size:15px", onclick: function () { openOriginal(rp.id); } }));
      } else if (/^[A-Za-z0-9]{6,40}$/.test(rp.gmailId || "")) {
        pb.appendChild(el("a", { className: "rl-ret-go", href: "https://mail.google.com/mail/u/0/#all/" + rp.gmailId, target: "_blank", rel: "noopener noreferrer" }, [el("span", { text: "Open the email with your QR code" }), jIc("ext", 18)]));
      }
      if (rp.trackUrl && /^https:\/\//.test(rp.trackUrl)) pb.appendChild(el("a", { className: "rl-ret-go", href: rp.trackUrl, target: "_blank", rel: "noopener noreferrer" }, [el("span", { text: "Track your return" }), jIc("ext", 18)]));
      pl("Read from the store's email. Relay can't confirm the refund.", "font-size:13px");
      card.appendChild(pb);
    }
    // One row of small buttons: the receipt itself (with the QR code or label it mentions), the parcel, a reminder.
    var acts = el("div", { className: "rl-rc-acts" });
    var pill = function (text, onclick, extra) { var b = el("button", { type: "button", className: "rl-pill", text: text, onclick: onclick }); if (extra) extra(b); acts.appendChild(b); return b; };
    if (x.id && mailRef(x) && openOriginal) pill(rt.qrMentioned ? "Receipt and QR code" : rt.labelMentioned ? "Receipt and label" : "View receipt", function () { openOriginal(x.id); });
    if (dv && dv.trackUrl && /^https:\/\//.test(dv.trackUrl) && freshDelivery(x))
      acts.appendChild(el("a", { className: "rl-pill", href: dv.trackUrl, target: "_blank", rel: "noopener noreferrer", text: "Track parcel" }));
    if (left !== null && left >= 0 && x.id && x.reminder && !(x.returnBy && deadlineOf(x) === x.returnBy.date)) {
      var rem = pill(x.reminder === "on" ? "Reminder on · turn off" : x.reminder === "sent" ? "Reminder sent" : "Remind me 3 days before", function () {
        rem.disabled = true; api("/relay/my/receipts/" + x.id + "/remind", { method: "POST", body: { on: x.reminder === "off" } }).then(function () { refresh("remind"); }); });
      rem.disabled = x.reminder === "sent";
    }
    if (left !== null && left < 0 && x.id && x.kind !== "return_instructions" && (x.items || []).length && openResale && marketOn()) pill("Sell or swap it instead", function () { openResale(x.id); });
    if (acts.childNodes.length) card.appendChild(acts);
    if (x.status === "confirmed" || !x.id) return card;
    // Until you've checked it: one question. "No" asks what's wrong (not yours, or just a promotion) and removes it.
    var chk = el("div", { className: "rl-rc-ask" }, [el("span", { text: x.needsShopperConfirmation ? "Relay may have missed something. Is this right?" : "Is this right?" })]);
    var no = el("button", { type: "button", className: "rl-pill", text: "No" }), yes = el("button", { type: "button", className: "rl-pill rl-pill-on", text: "Yes" });
    var post = function (path, body, kind, done) {
      if (yes.disabled) return;
      yes.disabled = no.disabled = true;
      api("/relay/my/receipts/" + x.id + "/" + path, { method: "POST", body: body }).then(function (r) {
        if (!r.ok) { yes.disabled = no.disabled = false; chk.firstChild.textContent = "Couldn't save that. Please try again."; return; }
        chk.textContent = ""; chk.appendChild(el("span", { text: done })); refresh(kind);
      }, function () { yes.disabled = no.disabled = false; chk.firstChild.textContent = "Couldn't reach Relay. Please try again."; });
    };
    yes.onclick = function () { post("confirm", {}, "confirm", "Thanks. Marked as right."); };
    no.onclick = function () {
      chooseBox("What's wrong with this receipt?", [
        ["Some details are wrong", function () { fixSheet(x, function () { refresh("fix"); }); }],
        ["It's not mine", function () { post("dismiss", {}, "dismiss", "Removed. It won't come back."); }],
        ["It's just a promotion", function () { post("dismiss", { reason: "promo" }, "dismiss", "Removed. Relay will skip emails like it."); }]]);
    };
    chk.appendChild(no); chk.appendChild(yes);
    card.appendChild(chk);
    return card;
  }
  // A parcel's latest news, in a line with a small drawing: on its way (with whom), due, or delivered.
  function shipLine(dv) {
    var day = function (d) { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); };
    var today = new Date().toISOString().slice(0, 10), done = dv.status === "delivered", by = dv.carrier ? " with " + dv.carrier : "";
    var said = done ? "Delivered" + (dv.at ? " " + (dv.at === today ? "today" : day(dv.at)) : "")
      : dv.status === "out_for_delivery" ? "Out for delivery" + by
      : dv.status === "due" ? (dv.at && dv.at !== today ? "Arriving " + day(dv.at) : "Arriving today") + by : "On its way" + by;
    return el("div", { className: "rl-po-ship" + (done ? " done" : "") }, [jIc(done ? "check" : "parcel", 17), el("span", { text: said })]);
  }
  function disconnectGmail(done, msg) {
    ask("Disconnect " + mailName() + " and delete every receipt Relay captured from it?", "Disconnect and delete", function () {
      api("/relay/my/gmail/disconnect", { method: "POST" }).then(function (x) {
        if (!x.ok) return say(msg, "Couldn't disconnect. Try again.", true);
        memo.gmail = null; memo.receipts = null; memo.walletPurchases = null; memo.openCat = null; try { localStorage.removeItem("relay.cache.v1"); } catch (e) {}
        if (x.body && x.body.nowFirst !== undefined) cachedGet("gmail", "/relay/my/gmail").then(function () { done(); }, done);
        else { rememberMailbox({ connected: false }); done(); }
      });
    });
  }
  // Another inbox: Google's or Microsoft's own account picker, then back to Relay, which reads it in the background.
  function addAnotherInbox(provider, btn, note) {
    if (btn.disabled) return;
    var outlook = provider === "microsoft", name = outlook ? "Outlook" : "Gmail";
    btn.disabled = true;
    api("/relay/my/gmail/connect", { method: "POST", body: outlook ? { provider: "microsoft", another: true } : { another: true } }).then(function (x) {
      var host = outlook ? /^https:\/\/login\.microsoftonline\.com\// : /^https:\/\/accounts\.google\.com\//;
      if (x.ok && x.body && host.test(x.body.url || "")) { try { sessionStorage.setItem("relay.addingInbox", "1"); } catch (e) {} location.href = x.body.url; return; }
      btn.disabled = false;
      say(note, x.body && x.body.error === "too_many_inboxes" ? "Relay can read up to " + (x.body.max || 5) + " inboxes for one account." : "Couldn't start adding " + name + ". Please try again.", true);
    }, function () { btn.disabled = false; say(note, "Couldn't reach Relay. Check your connection.", true); });
  }
  // The buttons for adding another inbox: one per kind of inbox Relay can read.
  function addInboxButtons(host, note, cls) {
    cachedGet("consent", "/relay/my/consent").then(function (r) {
      var c = (r.ok && r.body) || {};
      [["google", "Add a Gmail inbox", c.gmailAvailable], ["microsoft", "Add an Outlook inbox", c.outlookAvailable]].forEach(function (k) {
        if (!k[2]) return;
        var b = el("button", { type: "button", className: cls || "rl-btn ghost rl-ibx-addbtn" }, [jIc("plus", 18), el("span", { text: k[1] })]);
        b.onclick = function () { addAnotherInbox(k[0], b, note); };
        host.appendChild(b);
      });
    }, function () {});
  }
  function inboxName(provider) { return provider === "microsoft" ? "Outlook" : "Gmail"; }
  function inboxWhen(x) {
    if (x.scan && x.scan.state === "running") return "Reading… " + (x.scan.found || 0) + " found so far";
    var t = Math.max(x.lastScanAt || 0, x.autoAt || 0);
    if (!t) return "Reading for the first time";
    var d = new Date(t);
    return "Checked " + (d.toDateString() === new Date().toDateString() ? "today at " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }));
  }
  // Without a connected inbox, the Receipts page still lets the shopper add a receipt themselves, and lists the ones they added.
  function addedByHand(box) {
    box.appendChild(el("button", { type: "button", className: "rl-find-link", text: "Or add a receipt yourself",
      onclick: function () { open(function (sheet) { addReceiptView(sheet, close); }); } }));
    var holder = el("div"); box.appendChild(holder);
    function draw(rows) {
      holder.textContent = "";
      rows = (rows || []).slice().sort(function (a, b) { return String(b.orderDate || "").localeCompare(String(a.orderDate || "")); });
      if (!rows.length) return;
      holder.appendChild(el("h3", { className: "rl-ar-h", text: "Receipts you added" }));
      rows.forEach(function (row) { holder.appendChild(receiptCard(row, load, false)); });
    }
    function load() {
      if (memo.receipts) draw(memo.receipts.rows);
      api("/relay/my/receipts?all=1").then(function (x) {
        if (!x.ok || !box.isConnected) return;
        var rows = (x.body && x.body.receipts) || [];
        memo.receipts = { rows: rows, sig: JSON.stringify(rows), at: Date.now() }; diskWrite("receipts", rows);
        draw(rows);
      }, function () {});
    }
    load();
  }
  function gmailSection(box, c, msg, onPage) {
    box.textContent = "";
    if (!onPage) box.appendChild(el("h2", { text: "Your receipts", style: "font-size:18px;margin-top:8px" }));
    var list = el("div");
    var shopRows = [];
    // Placeholder squares while the first load is on its way, so the page is never blank.
    if (onPage && !memo.receipts) {
      var sk = el("div", { className: "rl-cats", style: "margin-top:52px" });
      for (var si = 0; si < 6; si++) sk.appendChild(el("div", { className: "rl-po rl-skel", style: "min-height:150px;margin:0" }));
      list.appendChild(sk); box.appendChild(list);
    }
    cachedGet("gmail", "/relay/my/gmail").then(function (r) {
      if (r.status === 401) { save(null); close(); return; }
      if (!r.ok || !r.body.connected) list.textContent = "";
      if (!r.ok) { box.appendChild(el("p", { text: "Couldn't load your email connection." })); return; }
      if (!r.body.connected) {
        var both = c.gmailAvailable && c.outlookAvailable;
        box.appendChild(el("p", { text: both ? "Connect the email you shop with, Gmail or Outlook, so Relay can find your order confirmations and receipts for you."
          : c.gmailAvailable ? "Connect Gmail so Relay can find your order confirmations and receipts for you."
          : c.outlookAvailable ? "Connect Outlook so Relay can find your order confirmations and receipts for you."
          : "Email connection isn't switched on yet. You can still add a receipt by pasting it below." }));
        var connectBtn = function (label, provider, start, name) {
          var b = el("button", { className: "rl-btn", text: label, style: "margin-top:8px" });
          b.onclick = function () {
            b.disabled = true;
            api("/relay/my/gmail/connect", { method: "POST", body: provider ? { provider: provider } : undefined }).then(function (x) {
              if (x.ok && x.body && start.test(x.body.url || "")) { location.href = x.body.url; return; }
              b.disabled = false; say(msg, "Couldn't start the " + name + " connection. Please try again.", true);
            }).catch(function () { b.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
          };
          return b;
        };
        if (c.gmailAvailable) box.appendChild(connectBtn("Connect Gmail", null, /^https:\/\/accounts\.google\.com\//, "Gmail"));
        if (c.outlookAvailable) box.appendChild(connectBtn("Connect Outlook", "microsoft", /^https:\/\/login\.microsoftonline\.com\//, "Outlook"));
        if (c.outlookAvailable) box.appendChild(el("p", { text: "Outlook works with Outlook.com, Hotmail and Live addresses.", style: "font-size:13px;opacity:.75;margin-top:8px" }));
        if (onPage) addedByHand(box);
        return;
      }
      var MB = r.body.provider === "microsoft" ? "Outlook" : "Gmail", owner = MB === "Outlook" ? "Microsoft" : "Google";
      if (!onPage) box.appendChild(el("p", { text: MB + " connected" + (r.body.googleEmail ? ": " + r.body.googleEmail : "") + ". Relay only looks for order confirmations, receipts and return emails." }));
      var lastScan = r.body.lastScanAt ? new Date(r.body.lastScanAt) : null;
      var scanBtn = el("button", { className: "rl-btn", text: lastScan ? "Check for new receipts" : "Scan my " + MB + " for receipts" });
      var status = el("div", { className: "rl-msg" });
      var autoAt = r.body.autoAt ? new Date(r.body.autoAt) : null;
      var checked = autoAt && (!lastScan || autoAt > lastScan) ? autoAt : lastScan;
      var when = function (d) { return d.toDateString() === new Date().toDateString() ? "today at " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); };
      var nInbox = 1 + ((r.body.others || []).length);
      // On the Receipts page the line stays empty until there's news (reading, or what was found); Profile says how it works.
      status.textContent = onPage ? ""
        : (r.body.instant
          // Gmail or Outlook tells Relay when new mail arrives (mail-push.js); Google says notices usually take seconds.
          ? "New receipts and parcel updates from your " + MB + " usually show up in Relay within a minute"
          : "Relay checks your " + MB + " for new receipts and parcel updates every 15 minutes") + (checked ? ". Last checked " + when(checked) + "." : ".");
      if (onPage) { scanBtn.className = "rl-po-secondary rl-check-now"; scanBtn.style.cssText = "flex:0 0 auto;padding:6px 14px;font-size:13px"; scanBtn.textContent = "Check now"; }
      var query = "";
      var search = el("input", { type: "search", placeholder: "Search your receipts (store, item, order number)", style: "margin-top:12px" });
      search.addEventListener("input", function () { var was = Boolean(query); query = search.value.trim().toLowerCase(); if (was !== Boolean(query)) drawList(); else applyFilter(); });
      function applyFilter() {
        var shown = 0;
        Array.prototype.forEach.call(list.children, function (c) {
          if (!c.getAttribute("data-find")) return;
          var hit = !query || c.getAttribute("data-find").indexOf(query) !== -1;
          c.style.display = hit ? "" : "none"; if (hit) shown++;
        });
        var none = list.querySelector(".rl-none");
        if (none) none.style.display = query && !shown ? "" : "none";
      }
      var GROUP_KEYS = ["fashion", "electronics", "food", "home", "beauty", "travel", "digital", "other"];
      var allRows = memo.receipts ? memo.receipts.rows : [];
      function pill(text, bg, fg) { return el("span", { text: text, style: "display:inline-block;margin-top:4px;padding:3px 9px;border-radius:999px;font-weight:700;font-size:12px;background:" + bg + ";color:" + fg }); }
      // One tidy line per receipt: picture (the item's photo, or the shop's logo), what was bought, the shop and date,
      // and the price. The whole line opens the details underneath; nothing in it looks like a link.
      function receiptRow(row) {
        var who = (row.retailer && (row.retailer.name || row.retailer.domain)) || "Unknown store";
        var named = (row.items || []).filter(function (i) { return i.name; });
        var names = named.map(function (i) { return i.name + (i.variant && named.length === 1 ? " · " + i.variant : ""); }).join(", ");
        var ref = row.orderRef && /^[#A-Za-z0-9-]{3,14}$/.test(row.orderRef) ? "Order " + (row.orderRef.charAt(0) === "#" ? "" : "#") + row.orderRef : null;
        var title = named.length ? headlineItem(row).name + (named.length > 1 ? " + " + (named.length - 1) + " more" : "") : who;
        var subOf = function () { return [named.length ? who : ref, row.gift ? (row.gift.for ? "Gift for " + row.gift.for : "Gift") : null,
          row.orderDate ? shortDate(row.orderDate + "T12:00:00Z") : null].filter(Boolean).join(" · ") || "Receipt"; };
        var sub = subOf();
        var wrap = el("div", { className: "rl-rr" });
        var btn = el("button", { type: "button", className: "rl-rr-main" });
        btn.setAttribute("aria-expanded", "false");
        var thumb = el("span", { className: "rl-rr-pic" });
        thumb.setAttribute("aria-hidden", "true");
        receiptPic(thumb, row, 28, 32);
        // A gift shows a small present on its picture (the picture itself may be replaced once it loads, so it sits beside it).
        var picw = el("span", { className: "rl-rr-picw" }, [thumb]);
        picw.setAttribute("aria-hidden", "true");
        var giftMark = function () {
          var had = picw.querySelector(".rl-rr-gift");
          if (row.gift && !had) { var gm = jIc("gift", 14); gm.className = "rl-jic rl-rr-gift"; picw.appendChild(gm); }
          else if (!row.gift && had) had.remove();
        };
        giftMark();
        var end = el("span", { className: "rl-rr-end" }, [el("b", { text: row.totalPence == null ? "" : money(row.totalPence, row.currency) })]);
        var left = daysLeft(statedDeadline(row));
        if (left !== null && left >= 0) end.appendChild(el("span", { className: "rl-rr-chip " + (left <= 2 ? "red" : left <= 7 ? "amber" : "green"), text: left === 0 ? "Return today" : left + " day" + (left === 1 ? "" : "s") + " left" }));
        btn.appendChild(picw);
        var subEl = el("span", { text: sub });
        btn.appendChild(el("span", { className: "rl-rr-mid" }, [el("b", { text: title }), subEl]));
        btn.appendChild(end);
        wrap.appendChild(btn);
        var detail = null;
        btn.onclick = function () {
          if (detail) { delete memo.openIds[row.id]; detail.remove(); detail = null; btn.setAttribute("aria-expanded", "false"); wrap.classList.remove("open"); return; }
          detail = el("div", { className: "rl-rr-detail" });
          if (names && named.length > 1) detail.appendChild(el("p", { className: "rl-rr-items", text: names }));
          detail.appendChild(receiptCard(row, loadList, true, { inRow: true }));
          // Its group, as a quiet setting: pick another and Relay moves it (and remembers that for this shop).
          var keys = GROUP_KEYS.indexOf(row.category) >= 0 || !groupNames[row.category] ? GROUP_KEYS : GROUP_KEYS.concat([row.category]);
          var pick = el("select", { ariaLabel: "Group", className: "rl-rc-pick" });
          keys.forEach(function (k) { pick.appendChild(el("option", { value: k, text: groupNames[k] || k })); });
          pick.value = keys.indexOf(row.category) >= 0 ? row.category : "other";
          pick.onchange = function () {
            pick.disabled = true;
            api("/relay/my/receipts/" + row.id + "/category", { method: "POST", body: { category: pick.value } }).then(function () { say(status, "Thanks, Relay will remember this for " + who + "."); loadList(); }); };
          detail.appendChild(el("label", { className: "rl-rc-group" }, [el("span", { text: row.categoryLearned ? "Group (as you taught Relay)" : "Group" }), el("span", { className: "rl-rc-pickw" }, [pick, jIc("down", 16)])]));
          detail.appendChild(giftControl(row, function () { subEl.textContent = subOf(); giftMark(); find(); }));
          // Anything read wrong: fix it here (and say what was fixed, once it has been).
          var fx = row.fixed || null, fixedParts = fx ? [fx.shop && "shop", fx.total && "total", fx.date && "date", fx.items && "items"].filter(Boolean) : [];
          var fixText = fixedParts.length ? "You corrected the " + (fixedParts.length > 1 ? fixedParts.slice(0, -1).join(", ") + " and " + fixedParts[fixedParts.length - 1] : fixedParts[0]) + "." : "Something read wrong?";
          detail.appendChild(el("div", { className: "rl-rc-fix" }, [el("span", { text: fixText }),
            el("button", { type: "button", className: "rl-pill", text: fixedParts.length ? "Change" : "Fix details", onclick: function () { fixSheet(row, function (what) { if (what !== "shared") say(status, "Fixed. Thanks, this helps Relay read emails like this better."); loadList(); }); } })]));
          // What the AI filled in (AI help), for the shopper to check.
          if (row.aiFilled && row.aiFilled.length) {
            var AIP = { total: "total", items: "items", date: "date", number: "order number", shop: "shop" }, ap = row.aiFilled.map(function (k) { return AIP[k] || k; });
            detail.appendChild(el("p", { className: "rl-rc-ai", text: "The " + (ap.length > 1 ? ap.slice(0, -1).join(", ") + " and " + ap[ap.length - 1] : ap[0]) + (ap.length > 1 || ap[0] === "items" ? " were" : " was") + " read by AI. Check " + (ap.length > 1 || ap[0] === "items" ? "they're" : "it's") + " right, and use Fix details if not." }));
          }
          // Sent to Relay: until when it's kept, whether it's been read, and a way to delete it now.
          if (row.shared) {
            var sh = row.shared, until = new Date(sh.until).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            var drop = el("button", { type: "button", className: "rl-pill", text: "Delete it" });
            drop.onclick = function () {
              ask("Delete the copy of this email you sent to Relay?", "Delete it", function () {
                drop.disabled = true;
                api("/relay/my/receipts/" + (row.sharedId || row.id) + "/share", { method: "POST", body: { delete: true } }).then(function (r) {
                  drop.disabled = false;
                  if (!r.ok) return say(status, "Couldn't delete it. Try again in a moment.", true);
                  say(status, "Deleted. Relay no longer has a copy of that email."); loadList();
                }, function () { drop.disabled = false; say(status, "Couldn't reach Relay. Check your connection and try again.", true); });
              });
            };
            detail.appendChild(el("div", { className: "rl-rc-fix" }, [el("span", { text: "You sent this email to Relay" + (sh.read ? " and it's been read" : "") + ". It's deleted on " + until + "." }), drop]));
          }
          wrap.appendChild(detail); memo.openIds[row.id] = true; btn.setAttribute("aria-expanded", "true"); wrap.classList.add("open");
        };
        // What the search box matches: the shop, the order number, what was bought, and who a gift was for.
        var find = function () {
          wrap.setAttribute("data-find", [row.retailer && row.retailer.name, row.retailer && row.retailer.domain, row.orderRef, names,
            row.gift ? "gift " + (row.gift.for || "") : null].filter(Boolean).join(" ").toLowerCase());
        };
        find();
        if (memo.openIds[row.id]) btn.onclick();
        return wrap;
      }
      // "Bought as a gift": a switch, then who it was for (optional). Gifts get their own tile here and their own part of
      // Wrapped, and are left out of what Relay works out about your own style. The row changes straight away; the list
      // catches up the next time it loads, so nothing jumps while you're typing.
      function giftControl(row, changed) {
        var on = Boolean(row.gift), box = el("div", { className: "rl-rc-giftw" });
        var sw = el("button", { type: "button", className: "rl-sw" }, [el("i")]);
        sw.setAttribute("role", "switch"); sw.setAttribute("aria-label", "Bought as a gift"); sw.setAttribute("aria-checked", on ? "true" : "false");
        var note = el("p", { className: "rl-rc-gift-note" });
        note.setAttribute("role", "status");
        var forRow = null, input = null, saveBtn = null, busy = false;
        var saved = function () { return (row.gift && row.gift.for) || ""; };
        function drawFor() {
          if (forRow) { forRow.remove(); forRow = null; input = saveBtn = null; }
          if (!on) return;
          input = el("input", { type: "text", maxLength: 40, value: saved(), placeholder: "Who's it for? (optional)", autocomplete: "off", enterKeyHint: "done" });
          input.setAttribute("aria-label", "Who it's for");
          saveBtn = el("button", { type: "button", className: "rl-pill", text: "Save", disabled: true });
          input.addEventListener("input", function () { saveBtn.disabled = busy || input.value.replace(/\s+/g, " ").trim() === saved(); });
          input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); if (!saveBtn.disabled) saveBtn.click(); } });
          saveBtn.onclick = function () { var who = input.value.replace(/\s+/g, " ").trim(); send(true, who, who ? "Saved. It's a gift for " + who + "." : "Saved."); };
          forRow = el("div", { className: "rl-rc-giftfor" }, [input, saveBtn]);
          box.insertBefore(forRow, note);
        }
        function lock(yes) { busy = yes; sw.disabled = yes; if (input) input.disabled = yes; if (saveBtn) saveBtn.disabled = yes || (input && input.value.replace(/\s+/g, " ").trim() === saved()); }
        function send(gift, who, done) {
          if (busy) return;
          lock(true); note.textContent = "";
          var undo = function (msg) { sw.setAttribute("aria-checked", on ? "true" : "false"); lock(false); note.textContent = msg; };
          api("/relay/my/receipts/" + row.id + "/gift", { method: "POST", body: gift ? (who ? { gift: true, for: who } : { gift: true }) : { gift: false } }).then(function (r) {
            if (!r.ok) return undo(r.status === 404 ? "This receipt isn't on your list any more. Pull down to refresh." : "Couldn't save that. Please try again.");
            var typing = on && gift;
            on = gift; row.gift = gift ? { for: who || null } : null;
            sw.setAttribute("aria-checked", on ? "true" : "false");
            lock(false);
            if (!typing) drawFor();
            else if (saveBtn) saveBtn.disabled = true;
            note.textContent = done;
            memoDrop("wrapped"); changed();
          }, function () { undo("Couldn't reach Relay. Check your connection and try again."); });
        }
        sw.onclick = function () {
          if (busy) return;
          var next = !on;
          sw.setAttribute("aria-checked", next ? "true" : "false");
          send(next, "", next ? "Marked as a gift. Add who it's for if you like." : "Not a gift any more.");
        };
        box.appendChild(el("div", { className: "rl-rc-gift" }, [el("span", { className: "rl-rc-gift-l" }, [jIc("gift", 18), el("span", { text: "Bought as a gift" })]), sw]));
        box.appendChild(note);
        drawFor();
        return box;
      }
      var groupNames = { fashion: "Fashion", electronics: "Electronics", food: "Food & drink", home: "Home & garden", beauty: "Beauty & health", travel: "Travel & transport", digital: "Digital & subscriptions", experiences: "Tickets & experiences", other: "Other", gifts: "Gifts" };
      // One group's page: a header in the group's colour with what's in it, filters, then receipts by month (newest first)
      // with each month's total. Long groups show 40 at a time.
      var GBP = function (rs) { return rs.reduce(function (n, r) { return n + (Number.isInteger(r.totalPence) && (!r.currency || r.currency === "GBP") ? r.totalPence : 0); }, 0); };
      function drawCategory(k, rowsIn) {
        var rows = rowsIn.slice().sort(function (a, b) { return String(b.orderDate || "").localeCompare(String(a.orderDate || "")); });
        var today = new Date().toISOString().slice(0, 10);
        var canReturn = function (r) { var dl = deadlineOf(r); return Boolean(dl && dl >= today); };
        var years = []; rows.forEach(function (r) { var y = String(r.orderDate || "").slice(0, 4); if (/^\d{4}$/.test(y) && years.indexOf(y) === -1) years.push(y); });
        var c = CAT_ICONS[k] || CAT_ICONS.other;
        list.appendChild(el("button", { type: "button", className: "rl-cat-back rl-navback", "data-back": "", onclick: function () { memo.openCat = null; memo.catFilter = null; drawList(); window.scrollTo && window.scrollTo(0, memo.catY || 0); } }, [jIc("back", 24), el("span", { text: "All groups" })]));
        // One search box: in a group, the group's own (the page's search steps aside until you're back).
        if (list.parentNode) list.parentNode.classList.add("rl-in-cat");
        var oldest = rows.filter(function (r) { return r.orderDate; }).slice(-1)[0];
        var spent = GBP(rows);
        var isGifts = k === "gifts", ink = isGifts ? "#101828" : "#fff", noun = function (n) { return n + (isGifts ? (n === 1 ? " gift" : " gifts") : (n === 1 ? " receipt" : " receipts")); };
        var hero = el("div", { className: "rl-cat-hero", style: "background:" + (TILE_COLOURS[k] || TILE_COLOURS.other) + ";color:" + ink }, [catIcon(k, 52),
          el("div", { className: "rl-cat-hero-t" }, [el("h3", { text: groupNames[k] }),
            el("span", { text: (spent ? money(spent, "GBP") + " across " : "") + noun(rows.length) + (oldest ? " since " + new Date(oldest.orderDate + "T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "") })])]);
        hero.firstChild.style.background = isGifts ? "rgba(16,24,40,.1)" : "rgba(255,255,255,.2)"; hero.firstChild.style.color = ink;
        list.appendChild(hero);
        if (!isGifts && rows[0] && rows[0].returnable === false && rows[0].notReturnableReason) list.appendChild(el("p", { className: "rl-cat-note", text: rows[0].notReturnableReason }));
        // Filters: all, what can still go back (when there is any), and each year.
        var filters = [["all", "All"]];
        if (rows.some(canReturn)) filters.push(["return", "Can still return"]);
        if (years.length > 1) years.forEach(function (y) { filters.push([y, y]); });
        // Gifts: one filter per person they were for (as the shopper typed it), most gifts first.
        if (isGifts) {
          var forWho = {};
          rows.forEach(function (r) { var w = r.gift && r.gift.for; if (w) { var key = w.toLowerCase(); (forWho[key] = forWho[key] || { name: w, n: 0 }).n++; } });
          var whoList = Object.keys(forWho).map(function (key) { return forWho[key]; }).sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
          if (whoList.length > 1 || (whoList.length === 1 && whoList[0].n < rows.length)) whoList.slice(0, 8).forEach(function (p) { filters.push(["for:" + p.name.toLowerCase(), p.name]); });
        }
        var f = memo.catFilter && filters.some(function (x) { return x[0] === memo.catFilter; }) ? memo.catFilter : "all";
        var chips = el("div", { className: "rl-cat-chips", role: "group" });
        chips.setAttribute("aria-label", "Show");
        if (filters.length > 1) filters.forEach(function (x) {
          var b = el("button", { type: "button", className: x[0] === f ? "on" : "", text: x[1], onclick: function () { memo.catFilter = x[0]; draw(); } });
          b.setAttribute("aria-pressed", x[0] === f ? "true" : "false");
          chips.appendChild(b);
        });
        var cq = el("input", { type: "search", className: "rl-cat-search", placeholder: "Search " + groupNames[k].toLowerCase() });
        cq.setAttribute("aria-label", "Search " + groupNames[k].toLowerCase());
        var body = el("div");
        list.appendChild(chips); list.appendChild(cq); list.appendChild(body);
        var shown = 40;
        function draw() {
          f = memo.catFilter && filters.some(function (x) { return x[0] === memo.catFilter; }) ? memo.catFilter : "all";
          Array.prototype.forEach.call(chips.children, function (b, i) { var on = filters[i][0] === f; b.className = on ? "on" : ""; b.setAttribute("aria-pressed", on ? "true" : "false"); });
          var q = cq.value.trim().toLowerCase();
          var pick = rows.filter(function (r) {
            if (f === "return" && !canReturn(r)) return false;
            if (/^\d{4}$/.test(f) && String(r.orderDate || "").slice(0, 4) !== f) return false;
            if (f.indexOf("for:") === 0 && String((r.gift && r.gift.for) || "").toLowerCase() !== f.slice(4)) return false;
            if (!q) return true;
            var names = (r.items || []).map(function (i) { return i.name; }).join(" ");
            return [r.retailer && r.retailer.name, r.retailer && r.retailer.domain, r.orderRef, names, r.gift && r.gift.for].filter(Boolean).join(" ").toLowerCase().indexOf(q) !== -1;
          });
          body.textContent = "";
          if (!pick.length) { body.appendChild(el("div", { className: "rl-empty" }, [el("h3", { text: q ? "Nothing matches that search" : "Nothing here" }), el("p", { text: q ? "Try a shop name, an item or an order number." : "Try another filter." })])); return; }
          var month = null, card = null;
          pick.slice(0, shown).forEach(function (r) {
            var m = r.orderDate ? r.orderDate.slice(0, 7) : "none";
            if (m !== month) {
              month = m;
              var inMonth = pick.filter(function (x) { return (x.orderDate ? x.orderDate.slice(0, 7) : "none") === m; }), tot = GBP(inMonth);
              body.appendChild(el("div", { className: "rl-cat-month" }, [el("b", { text: m === "none" ? "No date" : new Date(m + "-01T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric" }) }),
                el("span", { text: tot ? money(tot, "GBP") : noun(inMonth.length) })]));
              card = el("div", { className: "rl-cat-list" }); body.appendChild(card);
            }
            card.appendChild(receiptRow(r));
          });
          if (pick.length > shown) body.appendChild(loadAhead(el("button", { type: "button", className: "rl-po-secondary rl-cat-more", text: "Show " + Math.min(40, pick.length - shown) + " more of " + (pick.length - shown), onclick: function () { shown += 40; draw(); } })));
        }
        cq.addEventListener("input", function () { shown = 40; draw(); });
        draw();
      }
      function drawList() {
        list.textContent = "";
        if (list.parentNode) list.parentNode.classList.remove("rl-in-cat");
        var rows = allRows;
        // An email from a shop on Relay is the same purchase as its shop order, which is already under "Shop orders".
        if (onPage && shopRows.length) { var dup = {}; shopRows.forEach(function (x) { dup[label(x[0].store) + "|" + x[0].amountMinor] = true; });
          rows = rows.filter(function (r) { return !dup[label(r.retailer && r.retailer.name) + "|" + r.totalPence]; }); }
        if (!rows.length && !shopRows.length) { list.appendChild(el("p", { text: "No receipts found yet." })); return; }
        // Soonest deadline first, then no deadline, then expired.
        var rank = function (r) { var d = daysLeft(deadlineOf(r)); return d === null ? [1, 0] : d < 0 ? [2, -d] : [0, d]; };
        var sorted = rows.slice().sort(function (a, b) { var A = rank(a), B = rank(b); return A[0] - B[0] || A[1] - B[1]; });
        if (query) { sorted.forEach(function (r) { list.appendChild(receiptRow(r)); }); list.appendChild(el("p", { className: "rl-none", text: "No receipts match that search.", style: "display:none" })); applyFilter(); return; }
        var by = {}; sorted.forEach(function (r) { var k = r.category || "other"; (by[k] = by[k] || []).push(r); });
        var keys = Object.keys(by).sort(function (a, b) { var na = by[a][0].returnable === false ? 1 : 0, nb = by[b][0].returnable === false ? 1 : 0; return (a === "other") - (b === "other") || na - nb || by[b].length - by[a].length; });
        if (memo.openCat === "shop" && shopRows.length) {
          list.appendChild(el("button", { className: "rl-po-secondary", text: "‹ All groups", "data-back": "", style: "flex:none;padding:7px 14px;font-size:14px", onclick: function () { memo.openCat = null; drawList(); window.scrollTo && window.scrollTo(0, memo.catY || 0); } }));
          list.appendChild(el("h3", { style: "font-size:20px;margin:14px 0 8px;color:var(--rl-text);display:flex;align-items:center;gap:10px" }, [catIcon("shop", 32), el("span", { text: "Shop orders (" + shopRows.length + ")" })]));
          list.lastChild.firstChild.style.background = "#101828";
          var sq = el("input", { type: "search", placeholder: "Search shop orders", style: "margin:0 0 12px;width:100%;box-sizing:border-box;padding:12px 16px;border:1px solid var(--rl-line);border-radius:14px;font-size:15px;background:var(--rl-card);font-family:inherit" });
          var sh = el("div", { className: "rl-po-grid" });
          shopRows.forEach(function (x) { var c = confirmedCard(x[0], x[1], function () { memo.purchases = null; loadList(); }); c.setAttribute("data-find", [x[0].store, x[1].title, x[1].variant].join(" ").toLowerCase()); sh.appendChild(c); });
          sq.addEventListener("input", function () { var q = sq.value.trim().toLowerCase(); Array.prototype.forEach.call(sh.children, function (c) { c.style.display = !q || c.getAttribute("data-find").indexOf(q) !== -1 ? "" : "none"; }); });
          list.appendChild(sq); list.appendChild(sh);
          return;
        }
        // Gifts aren't a group of their own: each stays in its group too, and they're also gathered under one tile.
        var giftRows = sorted.filter(function (r) { return r.gift; });
        if (memo.openCat === "gifts" && giftRows.length) { drawCategory("gifts", giftRows); return; }
        if (memo.openCat && by[memo.openCat]) {
          drawCategory(memo.openCat, by[memo.openCat]);
          return;
        }
        memo.openCat = null;
        var grid = el("div", { className: "rl-tiles" });
        // Opening a group starts at its top; coming back lands where the groups were.
        var open = function (k) { return function () { memo.catY = window.scrollY || 0; memo.openCat = k; drawList(); window.scrollTo && window.scrollTo(0, 0); }; };
        // This year's Wrapped comes first, as soon as there's a receipt from this year.
        var year = new Date().getFullYear();
        if (rows.some(function (r) { return String(r.orderDate || "").slice(0, 4) === String(year); }))
          grid.appendChild(el("button", { type: "button", className: "rl-tile rl-year", ariaLabel: "Your " + year + " Wrapped", onclick: function () { if (window.go) window.go("wrapped"); } },
            [el("span", { className: "rl-year-n", text: String(year) }), el("b", { text: "Wrapped" })]));
        if (giftRows.length) {
          var giftPic = giftRows.slice().sort(function (a, b) { return String(b.orderDate || "").localeCompare(String(a.orderDate || "")); })
            .filter(function (r) { return r.hasImage && r.id && (r.items || []).filter(function (i) { return i && i.name; }).length <= 1; })[0];
          grid.appendChild(tile("gifts", "Gifts", giftRows.length + (giftRows.length === 1 ? " gift" : " gifts"), giftPic, 0, open("gifts")));
        }
        if (shopRows.length) grid.appendChild(tile("shop", "Shop orders", shopRows.length + " item" + (shopRows.length === 1 ? "" : "s"), null, 0, open("shop")));
        keys.forEach(function (k) {
          var soon = by[k].filter(function (r) { var d = daysLeft(statedDeadline(r)); return d !== null && d >= 0 && d <= 7; }).length;
          // The tile's picture: the newest photo of something bought in this group (only a receipt's own item photo).
          var photo = by[k].slice().sort(function (a, b) { return String(b.orderDate || "").localeCompare(String(a.orderDate || "")); })
            .filter(function (r) { return r.hasImage && r.id && (r.items || []).filter(function (i) { return i && i.name; }).length <= 1; })[0];
          grid.appendChild(tile(k, groupNames[k] || "Other", by[k].length + (by[k].length === 1 ? " receipt" : " receipts"), photo, soon, open(k)));
        });
        list.appendChild(grid);
      }
      // One kind of shopping as a tile: its colour, a tinted photo of something bought there (or its drawing), its name, and
      // how many return deadlines are coming up.
      function tile(k, name, count, photo, soon, onclick) {
        var t = el("button", { type: "button", className: "rl-tile" + (k === "gifts" ? " rl-gifts" : ""), ariaLabel: name + ", " + count + (soon ? ", " + soon + " due soon" : ""), onclick: onclick,
          style: "background:" + (TILE_COLOURS[k] || TILE_COLOURS.other) });
        var c = CAT_ICONS[k] || CAT_ICONS.other;
        var art = el("span", { className: "rl-tile-art" });
        art.innerHTML = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + c[2] + "</svg>";
        t.appendChild(art);
        if (photo) apiBlob("/relay/my/receipts/" + photo.id + "/image").then(function (u) {
          if (!u || !t.isConnected) return;
          art.remove(); t.insertBefore(el("img", { className: "rl-tile-pic", src: u, alt: "" }), t.firstChild);
        });
        if (soon) t.appendChild(el("span", { className: "rl-tile-badge", text: soon + " due soon" }));
        t.appendChild(el("b", { text: name }));
        return t;
      }
      var drawnSig = null;
      function loadList() {
        // Show what was loaded last time straight away, then quietly update if anything changed.
        if (onPage && !shopRows.length && memo.shopRows) shopRows = memo.shopRows;
        if (drawnSig === null && memo.receipts) { allRows = memo.receipts.rows; drawnSig = memo.receipts.sig; drawList(); }
        var sk = list.firstChild; if (sk && sk.className === "rl-cats" && sk.style.marginTop) sk.style.marginTop = "8px";
        // Shop orders and email receipts are drawn together, so the page never redraws itself a moment later.
        var shopsLoaded = !onPage ? Promise.resolve() : (memo.purchases || api(purchasesPath())).then(function (pr) {
          var rows = []; ((pr.ok && pr.body && pr.body.purchases) || []).forEach(function (o) { (o.items || []).forEach(function (it) { rows.push([o, it]); }); });
          var sig = JSON.stringify(rows.map(function (x) { return [x[0].id, x[1].lineId, x[1].exchange && x[1].exchange.status, x[1].returnInfo && x[1].returnInfo.status]; }));
          var changed = sig !== memo.shopSig; shopRows = rows; memo.shopRows = rows; memo.shopSig = sig;
          return changed;
        }, function () { return false; });
        Promise.all([api("/relay/my/receipts" + (onPage ? "?all=1" : "")), shopsLoaded]).then(function (both) {
          var x = both[0], shopsChanged = both[1];
          if (!x.ok) { if (drawnSig === null || shopsChanged) drawList(); return; }
          if (!x.ok) { if (drawnSig === null) drawList(); return; }
          var rows = (x.body && x.body.receipts) || [], sig = JSON.stringify(rows);
          memo.receipts = { rows: rows, sig: sig, at: Date.now() }; diskWrite("receipts", rows);
          if (sig === drawnSig && !shopsChanged) return;
          if (sig !== drawnSig) memoDrop("wrapped");
          allRows = rows; drawnSig = sig; drawList();
        });
      }
      // Reading happens on Relay's side as a job, so it carries on if the shopper leaves the app (or the phone locks).
      // While this page is open the app asks for the rounds itself (quicker, with progress on screen); if Relay is already
      // busy with them, the app just shows how far it has got.
      var scanning = false;
      try { localStorage.removeItem("relay_scan_cursor"); } catch (e) {}
      var monthOf = function (sb) { var m = /^(\d{4})[\/-](\d{2})/.exec(sb || ""); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : ""; };
      var progress = function (job) {
        var found = (job && job.found) || 0, label = monthOf(job && job.scannedBack);
        say(status, (label ? "Reading back to " + label : "Reading your " + MB) + "… " + found + " found so far. You can close Relay, it carries on.");
      };
      var doScan = function (full) {
        if (scanning) return;
        scanning = true; scanBtn.disabled = true; say(status, lastScan && !full ? "Checking for new mail…" : "Scanning…");
        var rounds = 0, tries = 0;
        function finish(text, bad) { scanning = false; scanBtn.disabled = false; memo.gmail = null; if (text) say(status, text, bad); }
        // A round that fails (the mailbox or Relay busy for a moment) is tried again a few seconds later; Relay also carries on by itself.
        function retry() {
          tries++;
          if (tries > 3) return finish(MB + " is busy right now. Relay will carry on by itself and your receipts will appear here.");
          say(status, MB + " is busy, trying again…");
          return new Promise(function (res) { setTimeout(res, 3000 * tries); }).then(function () { return step(true); });
        }
        function step(small) {
          // The shopper went to another page: Relay carries on by itself.
          if (!document.body.contains(status)) { scanning = false; return; }
          return api("/relay/my/gmail/scan", { method: "POST", body: Object.assign({}, full ? { full: true } : {}, small ? { small: true } : {}) }).then(function (x) {
            if (x.status === 401) return finish(owner + " needs you to reconnect " + MB + ". Disconnect and connect again.", true);
            if (!x.ok) return retry();
            tries = 0;
            var job = x.body.job;
            if (job && job.state === "failed") return finish(job.error === "gmail_reconnect_needed" ? owner + " needs you to reconnect " + MB + ". Disconnect and connect again." : "Couldn't finish reading " + MB + ". Please try again later.", true);
            // Relay is reading this mailbox right now: show its progress and look again in a moment.
            if (x.body.busy) { progress(job); loadList(); return new Promise(function (res) { setTimeout(res, x.body.retryAfterMs || 4000); }).then(function () { return step(); }); }
            rounds++;
            loadList();
            if (x.body.more && rounds < 150) { progress(job); return step(); }
            if (x.body.more) return finish("Still reading in the background. New receipts will appear here as they're found.");
            // "Connected. Scanning for receipts…" is out of date once the scan has finished.
            if (onPage && msg.textContent && !/\berr\b/.test(msg.className)) say(msg, "");
            try { if (job && job.finishedAt) localStorage.setItem("relay.scanSeen", String(job.finishedAt)); } catch (e) {}
            var found = job ? job.found : (x.body.added || 0) + (x.body.updated || 0);
            finish(found ? "Found or updated " + found + " receipt or return email" + (found === 1 ? "" : "s") + ". Please check them below." : "Nothing new found.");
          // A dropped connection is treated like a busy round: wait, then carry on.
          }, function () { return retry(); });
        }
        Promise.resolve(step()).catch(function () { finish("Couldn't reach Relay. Check your connection and try again.", true); });
      };
      // Coming back to the app: carry on showing a scan Relay kept going, or say it finished while the shopper was away.
      var resume = function (job) {
        if (!job || scanning || !document.body.contains(status)) return;
        if (job.state === "running") { progress(job); doScan(job.full); return; }
        var seen = ""; try { seen = localStorage.getItem("relay.scanSeen") || ""; } catch (e) {}
        if (job.state === "done" && job.finishedAt && String(job.finishedAt) !== seen && Date.now() - job.finishedAt < 24 * 3600e3) {
          try { localStorage.setItem("relay.scanSeen", String(job.finishedAt)); } catch (e) {}
          say(status, "Finished reading your " + MB + " while you were away: " + job.found + " found.");
        }
      };
      window.__relayScanResume = function () {
        if (scanning || !document.body.contains(status)) return;
        api("/relay/my/gmail").then(function (g) { if (g.ok && g.body && g.body.scan) { loadList(); resume(g.body.scan); } });
      };
      if (!window.__relayScanVisBound) {
        window.__relayScanVisBound = true;
        document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && window.__relayScanResume) window.__relayScanResume(); });
      }
      scanBtn.onclick = function () { doScan(false); };
      if (onPage) {
        status.style.cssText = "margin:0;font-size:13px";
        search.setAttribute("aria-label", "Search your receipts");
        search.placeholder = "Shops, items and order numbers";
        search.style.cssText = "";
        var mag = el("span"); mag.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';
        box.appendChild(el("label", { className: "rl-search" }, [mag, search]));
        box.appendChild(list);
        box.appendChild(el("div", { className: "rl-recstat" }, [status]));
        // Pulling the page down checks the inbox now (relay-gestures.js through checkInbox), so there's no button for it.
        window.__relayCheckNow = function () { if (document.body.contains(status) && !scanBtn.disabled) scanBtn.onclick(); };
        // A shop missing from the list can be looked for directly (Relay reads only the email the shopper picks).
        box.appendChild(el("div", { className: "rl-acard rl-rec-more" }, [accRow("doc", "Add a missing receipt", null, function () { open(function (sheet) { addReceiptView(sheet, close); }); })]));
      } else { box.appendChild(scanBtn); box.appendChild(status); box.appendChild(search); box.appendChild(list); }
      loadList();
      // On the Receipts page these housekeeping options stay out of the way; they live under the account button (top right).
      if (!onPage) {
        if (lastScan) box.appendChild(el("button", { className: "rl-btn ghost", text: "Re-scan all my email (slower)", onclick: function () { doScan(true); } }));
        if (openFind) box.appendChild(el("button", { className: "rl-btn ghost", text: "Add a missing receipt", onclick: function () { openFind(); } }));
        box.appendChild(el("button", { className: "rl-btn ghost", text: "Disconnect " + MB + " and delete captured receipts", onclick: function () { disconnectGmail(function () { gmailSection(box, c, msg, onPage); }, msg); } }));
      }
      if (window.__relayAutoFull) { window.__relayAutoFull = false; window.__relayAutoScan = false; doScan(true); }
      else if (window.__relayAutoScan) { window.__relayAutoScan = false; scanBtn.onclick(); }
      else resume(r.body.scan);
    }).catch(function () { box.appendChild(el("p", { text: "Couldn't reach Relay." })); });
  }

  // ---- View original receipt: fetched live from Gmail or Outlook when opened; nothing is stored ----
  var openOriginal = null;
  function originalView(sheet, receiptId, onBack, title) {
    var msg = el("div", { className: "rl-msg" });
    var body = el("div");
    var MB = mailName();
    [el("h2", { text: title || "Original receipt" }), el("p", { text: "Loading it from your " + MB + "…", style: "opacity:.7" }), body, msg,
      el("button", { className: "rl-btn ghost", text: "Back", "data-back": "", onclick: onBack })].forEach(function (n) { sheet.appendChild(n); });
    var note = sheet.children[1];
    api("/relay/my/receipts/" + encodeURIComponent(receiptId) + "/original").then(function (r) {
      if (!r.ok) {
        note.textContent = r.body && r.body.error === "gmail_reconnect_needed" ? MB + " needs to be reconnected. Go back, disconnect it and connect again."
          : r.status === 404 ? "That email is no longer in your " + MB + ", so it can't be shown."
          : r.status === 409 ? "Connect your email again to open the original."
          : "Couldn't load the original email. Try again in a moment.";
        return;
      }
      note.textContent = "Shown straight from your " + MB + ". Relay doesn't keep a copy.";
      note.style.fontSize = "13px";
      var b = r.body || {};
      (b.links || []).forEach(function (l) {
        if (!/^https:\/\//.test(l.url || "")) return;
        body.appendChild(el("a", { href: l.url, target: "_blank", rel: "noopener noreferrer", text: String(l.label), className: "rl-btn", style: "display:block;text-align:center;text-decoration:none;margin-bottom:8px" }));
      });
      (b.extraImages || []).forEach(function (u) {
        if (!/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+\/=]+$/.test(u)) return;
        body.appendChild(el("img", { src: u, alt: "Picture attached to the email", style: "display:block;max-width:100%;margin:8px auto;background:var(--rl-card);border-radius:8px" }));
      });
      var frame = el("iframe", { title: "Original receipt email", style: "width:100%;height:60vh;border:1px solid var(--rl-line);border-radius:12px;background:var(--rl-card);margin-top:8px" });
      // No scripts, no same-origin: the email can show itself but cannot run code or touch Relay.
      frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.srcdoc = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data:; style-src \'unsafe-inline\'; font-src https:">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>body{margin:8px;font-family:-apple-system,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>' + String(b.html || "");
      body.appendChild(frame);
    }).catch(function () { note.textContent = "Couldn't reach Relay."; });
  }

  // ---- Add a receipt: find it in the inbox as you type, paste it in one tap, or forward it ----
  // Relay reads only the email the shopper picks or pastes, and keeps only the details it reads from it, never the email.
  var openFind = null;
  var SEARCH_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/></svg>';
  function shortDay(d) { return /^\d{4}-\d{2}-\d{2}/.test(d || "") ? new Date(d.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : ""; }
  // The shops this shopper buys from most (from the receipts already on this device), for one-tap searches.
  function usualShops() {
    var rows = (memo.receipts && memo.receipts.rows) || [], n = {}, since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    rows.forEach(function (x) {
      var who = x && x.retailer && x.retailer.name;
      if (!who || who === "Forwarded receipt" || x.kind !== "receipt" || String(x.orderDate || "") < since) return;
      n[who] = (n[who] || 0) + 1;
    });
    var top = Object.keys(n).sort(function (a, b) { return n[b] - n[a] || (a < b ? -1 : 1); }).slice(0, 6);
    return top.length >= 3 ? top : top.concat(["Amazon", "ASOS", "Argos", "Apple", "Zara", "Nike"].filter(function (k) { return top.indexOf(k) === -1; })).slice(0, 6);
  }
  function addReceiptView(host, onBack, opts) {
    opts = opts || {};
    var wrap = el("div", { className: "rl-ar" });
    if (!opts.inPage) wrap.appendChild(el("h2", { text: "Add a receipt" }));
    var lead = el("p", { className: "rl-ar-lead", text: "Relay brings your receipts in by itself. Missing one? Find it here." });
    wrap.appendChild(lead);
    var inbox = el("div"), pasted = el("div"), fwd = el("div");
    [inbox, pasted, fwd].forEach(function (n) { wrap.appendChild(n); });
    if (onBack) wrap.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: "Back", "data-back": "", style: "margin-top:18px", onclick: onBack }));
    host.appendChild(wrap);
    inbox.appendChild(el("div", { className: "rl-skel", style: "min-height:48px;border-radius:12px" }));
    var unsure = function () { inbox.textContent = ""; inbox.appendChild(el("p", { className: "rl-ar-help", text: "Couldn't reach your inbox just now. You can still paste the email below." })); };
    cachedGet("gmail", "/relay/my/gmail").then(function (g) {
      if (!g.ok) return unsure();
      inbox.textContent = "";
      if (g.body && g.body.connected) { searchPart(inbox, g.body); forwardPart(fwd, g.body); }
      else { lead.remove(); connectPart(inbox); }
    }, unsure);
    pastePart(pasted);
  }
  // Search the inbox as you type: a pause in typing (or a tap on a shop) searches, and only the newest search is shown.
  function searchPart(host, g) {
    var many = (g.others || []).length > 0, MB = many ? "inboxes" : g.provider === "microsoft" ? "Outlook" : "Gmail";
    var mag = el("span"); mag.innerHTML = SEARCH_ICON;
    var input = el("input", { type: "search", id: "rl-ar-q", placeholder: "Search your " + MB, autocomplete: "off" });
    input.setAttribute("aria-label", "Search " + MB + " for a receipt"); input.setAttribute("enterkeyhint", "search");
    host.appendChild(el("label", { className: "rl-search rl-ar-q" }, [mag, input]));
    var chips = el("div", { className: "rl-ar-chips" });
    usualShops().forEach(function (name) {
      chips.appendChild(el("button", { type: "button", className: "rl-ar-chip", text: name, onclick: function () { input.value = name; last = ""; run(0); } }));
    });
    host.appendChild(chips);
    var status = el("p", { className: "rl-ar-status" }); status.setAttribute("role", "status");
    var list = el("div", { className: "rl-ar-list" });
    host.appendChild(status); host.appendChild(list);
    var seq = 0, timer = null, last = "";
    function run(wait) { clearTimeout(timer); timer = setTimeout(go, wait); }
    function go() {
      var q = input.value.trim();
      if (q === last) return;
      last = q;
      var mine = ++seq;
      list.textContent = "";
      if (q.length < 2) { status.textContent = ""; return; }
      status.textContent = "Searching " + MB + "…";
      for (var k = 0; k < 3; k++) list.appendChild(el("div", { className: "rl-ar-row rl-skel" }));
      api("/relay/my/gmail/find", { method: "POST", body: { query: q } }).then(function (r) {
        if (mine !== seq) return;
        list.textContent = "";
        if (!r.ok) {
          status.textContent = r.body && r.body.error === "gmail_reconnect_needed" ? MB + " needs reconnecting first: open Profile, then Email connection."
            : r.status === 409 ? "Connect your email first: open Profile, then Email connection." : "Couldn't search " + MB + " just now. Try again in a moment.";
          return;
        }
        var rows = (r.body && r.body.results) || [];
        status.textContent = rows.length ? "Tap Add on the order email." : "Nothing in " + MB + " for “" + q + "”. Try the shop's name or the order number.";
        rows.forEach(function (x) { list.appendChild(resultRow(x, many)); });
        (r.body.problems || []).forEach(function (p) { list.appendChild(el("p", { className: "rl-ar-status", text: "Couldn't search " + (p.inbox || "one inbox") + " just now." })); });
      }, function () { if (mine === seq) { list.textContent = ""; status.textContent = "Couldn't reach Relay. Check your connection."; } });
    }
    input.addEventListener("input", function () { run(450); });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); last = ""; run(0); } });
  }
  function resultRow(x, many) {
    var who = String(x.from || "").trim() || "Email";
    var add = el("button", { type: "button", className: "rl-ar-add" + (x.added ? " done" : ""), text: x.added ? "Added" : "Add", disabled: Boolean(x.added) });
    add.setAttribute("aria-label", (x.added ? "Already added: " : "Add ") + (x.subject || who));
    var note = el("span", { className: "rl-ar-note" });
    add.onclick = function () {
      if (add.disabled) return;
      add.disabled = true; add.textContent = "Adding…";
      api("/relay/my/gmail/add", { method: "POST", body: x.mailbox ? { messageId: x.id, mailbox: x.mailbox } : { messageId: x.id } }).then(function (a) {
        if (a.ok && a.body && a.body.ok) {
          add.textContent = "Added"; add.classList.add("done"); memo.receipts = null;
          note.textContent = a.body.kind === "receipt" ? "In your Receipts now." : "Added to the order it belongs to.";
          return;
        }
        add.disabled = false; add.textContent = "Add";
        note.textContent = a.ok && a.body && a.body.reason === "not_recognised" ? "That one isn't an order, delivery or return email." : "Couldn't add it. Try again.";
      }, function () { add.disabled = false; add.textContent = "Add"; note.textContent = "Couldn't reach Relay. Check your connection."; });
    };
    var colours = ["#E0446E", "#D47B1F", "#4F72E0", "#2E9E5B", "#14918A", "#2B3A5C"];
    var ini = el("span", { className: "rl-ar-ini", text: who.charAt(0).toUpperCase(), style: "background:" + colours[who.charCodeAt(0) % colours.length] });
    ini.setAttribute("aria-hidden", "true");
    return el("div", { className: "rl-ar-row" }, [ini,
      el("span", { className: "rl-ar-t" }, [el("b", { text: x.subject || "(no subject)" }), el("span", { text: [who, shortDay(x.date)].filter(Boolean).join(" · ") }),
        many && x.inbox ? el("span", { text: "In " + x.inbox }) : null, note].filter(Boolean)), add]);
  }
  // Paste: one tap reads what was copied (the phone asks first), and the receipt goes straight into Receipts.
  function pastePart(host) {
    host.appendChild(el("h3", { className: "rl-ar-h", text: "Or paste the email" }));
    host.appendChild(el("p", { className: "rl-ar-help", text: "In your mail app, open the order email, choose Select All, then Copy. Then tap Paste." }));
    // Where the phone won't let Relay read what was copied, a box to paste into appears instead (and Paste becomes Add it).
    var box = el("textarea", { className: "rl-ar-box", rows: 5, maxLength: 250000, placeholder: "Press and hold here, then tap Paste" });
    box.setAttribute("aria-label", "The order email"); box.hidden = true;
    var btn = el("button", { type: "button", className: "rl-btn", text: "Paste", style: "margin-top:10px" });
    var msg = el("div", { className: "rl-msg" }), out = el("div"), busy = false;
    function label() { btn.disabled = busy; btn.textContent = busy ? "Reading…" : box.hidden ? "Paste" : "Add it"; }
    function read(text) {
      if (busy) return;
      text = String(text || "");
      if (text.trim().length < 40) return say(msg, "That's too short to be an order email. Copy the whole email (Select All, then Copy) and try again.", true);
      busy = true; label(); out.textContent = ""; say(msg, "");
      api("/relay/my/receipts/add-pasted", { method: "POST", body: { email: text } }).then(function (r) {
        busy = false; label();
        if (r.status === 401) { save(null); close(); return; }
        if (r.status === 429) return say(msg, "That's a lot of receipts in one go. Try again in an hour.", true);
        if (!r.ok) return say(msg, "Couldn't add that. Check your connection and try again.", true);
        if (!r.body.ok) return say(msg, "That doesn't look like an order, delivery or return email. Copy the whole email and try again.", true);
        memo.receipts = null; box.value = ""; box.hidden = true; draftSet("paste", ""); label();
        out.appendChild(addedCard(r.body));
      }, function () { busy = false; label(); say(msg, "Couldn't reach Relay. Check your connection.", true); });
    }
    function byHand() { box.hidden = false; label(); say(msg, ""); try { box.focus(); } catch (e) {} }
    btn.onclick = function () {
      if (busy) return;
      if (!box.hidden) return read(box.value);
      try { if (navigator.clipboard && navigator.clipboard.readText) { navigator.clipboard.readText().then(function (t) { if (t && t.trim()) read(t); else byHand(); }, byHand); return; } } catch (e) {}
      byHand();
    };
    box.addEventListener("paste", function (e) {
      var t = e.clipboardData && e.clipboardData.getData ? e.clipboardData.getData("text/plain") : "";
      if (t && t.trim()) { e.preventDefault(); box.value = t; read(t); return; }
      setTimeout(function () { read(box.value); }, 0);
    });
    // An email pasted (or typed) here last time and not added yet is still here.
    if (keepDraft(box, "paste")) { box.hidden = false; label(); say(msg, "The email you pasted last time is still here. Tap Add it when you're ready."); }
    box.addEventListener("paste", function () { setTimeout(function () { draftSet("paste", box.value); }, 0); });
    [box, btn, msg, out].forEach(function (n) { host.appendChild(n); });
  }
  function addedCard(b) {
    var card = el("div", { className: "rl-ar-done" }, [el("b", { text: (b.again ? "Already in your receipts: " : "Added: ") + (b.store || "your receipt") }),
      el("span", { text: [b.orderRef ? "Order " + b.orderRef : null, shortDay(b.orderDate), b.totalPence != null ? money(b.totalPence, b.currency) : null].filter(Boolean).join(" · ") || "Check its details in Receipts." })]);
    (b.items || []).slice(0, 3).forEach(function (i) { if (i && i.name) card.appendChild(el("span", { text: (i.qty > 1 ? i.qty + " × " : "") + i.name })); });
    if (window.go) card.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: "See it in Receipts", style: "margin-top:8px", onclick: function () { close(); window.go("receipts"); } }));
    return card;
  }
  // For a receipt in another inbox: forward it to the inbox Relay reads (each person's own, so it lands in their account).
  function forwardPart(host, g) {
    if (!g.email) return;
    var copy = el("button", { type: "button", className: "rl-ar-copy", text: "Copy " + g.email });
    copy.onclick = function () { copyText(g.email).then(function (ok) { copy.textContent = ok ? "Copied" : "Select it to copy"; }); };
    var adds = el("div", { className: "rl-ar-adds" }), note = el("div", { className: "rl-msg" });
    var full = 1 + (g.others || []).length >= (g.maxInboxes || 5);
    host.appendChild(el("div", { className: "rl-ar-fwd" }, [el("b", { text: "In another inbox?" }),
      el("span", { text: full ? "Forward the email to " + g.email + ". Relay will pick it up, or search for it above to add it now."
        : "Add that inbox to Relay as well, or forward the email to " + g.email + "." }), adds, copy, note]));
    if (!full) addInboxButtons(adds, note, "rl-ar-copy rl-ar-addbtn");
  }
  function connectPart(host) {
    host.appendChild(el("div", { className: "rl-ar-fwd" }, [el("b", { text: "Let Relay find them for you" }),
      el("span", { text: "Connect the email you shop with and Relay brings your receipts in by itself." }),
      el("button", { type: "button", className: "rl-btn", text: "Connect your email", style: "margin-top:6px", onclick: function () { close(); if (window.go) window.go("receipts"); } })]));
  }

  // ---- Swap & resell (v1: matches members; no payments or postage through Relay yet) ----
  // ---- Report review (only shown to the Relay admin; the server refuses everyone else) ----
  function adminView(sheet, onBack) {
    var list = el("div"), msg = el("div", { className: "rl-msg" });
    [el("h2", { text: "Reports to review" }),
     el("p", { text: "You see the conversation or the listing only, never who the members are. Dismiss, take the listing down, or block the member." }),
     list, msg, el("button", { className: "rl-btn ghost", text: "Back", "data-back": "", onclick: onBack })].forEach(function (n) { sheet.appendChild(n); });
    function act(id, outcome, question) {
      if (question) return ask(question, "Yes, do it", function () { act(id, outcome, null); });
      api("/relay/my/admin/reports/" + id + "/review", { method: "POST", body: { outcome: outcome } }).then(function (r) {
        if (r.ok) { say(msg, "Done."); load(); }
        else say(msg, r.body.error === "conflict_of_interest" ? "You're part of this report, so another admin has to review it." : "That didn't work. Try again.", true);
      }).catch(function () { say(msg, "Couldn't reach Relay.", true); });
    }
    function load() {
      list.textContent = "";
      api("/relay/my/admin/reports").then(function (r) {
        if (!r.ok) return say(msg, "You can't review reports from this account.", true);
        var rows = r.body.reports || [];
        if (!rows.length) list.appendChild(el("p", { text: "No reports waiting. Nice and quiet." }));
        rows.forEach(function (x) {
          var card = el("div", { className: "rl-order" });
          card.appendChild(el("b", { text: x.reason || "(no reason given)" }));
          card.appendChild(el("span", { text: x.item.title + (x.item.store ? " · " + x.item.store : "") + " · " + new Date(x.createdAt).toLocaleDateString("en-GB") }));
          var listing = x.kind === "listing", it = x.item || {};
          card.appendChild(el("span", { style: "display:block;margin-top:4px", text: (listing ? "A member reported this listing." : "Reported by the " + x.reporterRole + " about the " + x.reportedRole + ".") +
            " Reports against this " + (listing ? "seller" : "member") + ": " + x.reportsAgainstReported + (x.reportedAlreadyBlocked ? " (already blocked)" : "") + "." }));
          var log = el("div", { style: "margin:8px 0;max-height:180px;overflow:auto;border-top:1px solid var(--rl-line);padding-top:6px" });
          if (listing) {
            // The listing as members see it.
            log.appendChild(el("div", { style: "font-size:14px;margin:4px 0" }, [el("span", { text: [it.size ? "Size " + it.size : null, CONDITION[it.condition] || null,
              it.askPence == null ? "Open to offers" : it.askPence === 0 ? "Free" : money(it.askPence, it.currency || "GBP"), it.status === "active" ? "On sale" : it.status === "matched" ? "Matched" : "Taken down"].filter(Boolean).join(" · ") })]));
            if (it.note) log.appendChild(el("div", { style: "font-size:14px;margin:4px 0" }, [el("span", { text: "Seller's note: “" + it.note + "”" })]));
          } else {
            (x.messages || []).forEach(function (m) {
              log.appendChild(el("div", { style: "font-size:13px;margin:4px 0" }, [el("b", { text: m.from + ": " }), el("span", { text: m.body })]));
            });
            if (!(x.messages || []).length) log.appendChild(el("span", { text: "No messages in this conversation." }));
          }
          card.appendChild(log);
          var small = "min-height:44px;padding:9px 14px;font-size:14px;margin:4px 6px 0 0;width:auto;display:inline-block";
          card.appendChild(el("button", { className: "rl-btn ghost", text: "Dismiss", style: small, onclick: function () { act(x.id, "dismiss"); } }));
          if (x.canRemoveListing) card.appendChild(el("button", { className: "rl-btn ghost", text: "Take listing down", style: small, onclick: function () { act(x.id, "remove_listing", "Take this listing down?"); } }));
          card.appendChild(el("button", { className: "rl-btn ghost", text: "Block member", style: small, onclick: function () { act(x.id, "block", "Block this member? Their listings come down and they can't list, ask or message again."); } }));
          list.appendChild(card);
        });
      }).catch(function () { say(msg, "Couldn't reach Relay.", true); });
    }
    load();
  }
  var openResale = null;
  var CONDITION = { new_with_tags: "New with tags", like_new: "Like new", good: "Good", fair: "Fair" };
  var resaleErrors = { area_needed: "Add your postcode area (like SW11) so buyers know where to collect, or choose Post only.", invalid_area: "That doesn't look like a postcode area. Use the first part, like SW11 or M1.", invalid_handover: "Choose how the item changes hands.", not_resellable: "Only physical items can be listed. Food, travel and digital purchases can't be resold.", account_restricted: "Your account can't use the swap and resell board right now.", agreement_required: "Please tick the box to agree.", already_listed: "That item is already listed.", too_many_listings: "You have the maximum number of listings.",
    already_asked: "You've already asked about this one.", offer_one_of_your_listings: "Choose one of your own listings to offer.", swap_not_offered: "The seller isn't open to swaps.",
    not_found: "That's no longer available.", invalid_price: "Enter a price between £0 and £5,000.", too_many_requests: "Too many requests today. Try again tomorrow." };

  // A conversation between a seller and the member whose request they accepted.
  var chatErrors = { no_contact_details: "Please keep emails, phone numbers and links out of messages for now.", too_many_messages: "That's a lot of messages. Try again in a bit.",
    thread_full: "This conversation has reached its limit.", conversation_closed: "This conversation has ended.", empty_message: "Write a message first." };
  function chatView(sheet, requestId, onBack) {
    var log = el("div", { style: "margin:10px 0;max-height:42vh;overflow:auto" }), msg = el("div", { className: "rl-msg" });
    var head = el("h2", { text: "Messages" }), sub = el("p", { text: "" });
    var input = el("input", { placeholder: "Write a message", maxLength: 500 });
    var send = el("button", { className: "rl-btn", text: "Send" });
    var tools = el("div");
    // How to do the deal safely. Relay doesn't take payments yet, so this is what keeps both sides safe.
    var tips = el("details", { style: "background:var(--rl-fill);border-radius:14px;padding:10px 14px;margin:6px 0;font-size:14px;color:var(--rl-text2)" }, [
      el("summary", { text: "Doing the deal safely", style: "font-weight:800;cursor:pointer" }),
      el("p", { text: "Collecting: meet somewhere public in daylight, check the item, then pay on the spot (cash, or a bank transfer you can see arrive).", style: "margin:8px 0 4px" }),
      el("p", { text: "Posting: Relay doesn't handle payments, so never pay a stranger in advance by bank transfer. Collecting in person is the safer way.", style: "margin:4px 0" }),
      el("p", { text: "Keep chatting here. Relay hides phone numbers and emails to protect you both.", style: "margin:4px 0 0" })]);
    [head, sub, tips, log, input, send, msg, tools, el("button", { className: "rl-btn ghost", text: "Back", "data-back": "", onclick: function () { stop(); onBack(); } })].forEach(function (n) { sheet.appendChild(n); });
    var timer = null, isOpen = false;
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function load() {
      if (!document.body.contains(sheet)) return stop();
      api("/relay/my/resale/requests/" + requestId + "/messages").then(function (r) {
        if (!r.ok) return say(msg, "Couldn't load this conversation.", true);
        var b = r.body; isOpen = b.open;
        head.textContent = b.title; sub.textContent = "Chatting with the " + b.with.toLowerCase() + ". Names and contact details stay private. Relay doesn't handle payment or postage, so agree them here.";
        log.textContent = "";
        if (!b.messages.length) log.appendChild(el("p", { text: "No messages yet. Say hello and agree how this will work." }));
        b.messages.forEach(function (m) {
          log.appendChild(el("div", { text: m.body, style: "margin:6px 0;padding:8px 12px;border-radius:14px;max-width:85%;font-size:15px;" +
            (m.mine ? "margin-left:auto;background:#c7f567;color:#0f1b33" : "background:var(--rl-fill);color:var(--rl-text)") }));
        });
        log.scrollTop = log.scrollHeight;
        input.style.display = send.style.display = isOpen ? "" : "none";
        if (!isOpen) say(msg, "This conversation has ended.");
        tools.textContent = "";
        if (isOpen) {
          tools.appendChild(el("button", { className: "rl-btn ghost", text: "End conversation", style: "padding:9px 14px;font-size:14px", onclick: function () {
            ask("End this conversation? The item goes back on sale.", "End conversation", function () {
              api("/relay/my/resale/requests/" + requestId + "/end", { method: "POST", body: {} }).then(load); }); } }));
          tools.appendChild(el("button", { className: "rl-btn ghost", text: "Report a problem", style: "padding:9px 14px;font-size:14px", onclick: function () {
            askText("What went wrong? (for example: they wanted a bank transfer before you'd seen the item). Reporting lets the Relay team read this conversation to review it. They won't see who either of you is.", "Send report", function (why) {
              api("/relay/my/resale/requests/" + requestId + "/report", { method: "POST", body: { reason: why } }).then(function (x) { if (x.ok) { say(msg, "Reported and ended. Thank you."); load(); } else say(msg, "Couldn't send the report. Try again.", true); }); }); } }));
        }
      });
    }
    send.onclick = function () {
      var t = input.value.trim(); if (!t) return;
      send.disabled = true;
      api("/relay/my/resale/requests/" + requestId + "/messages", { method: "POST", body: { body: t } }).then(function (r) {
        send.disabled = false;
        if (r.ok) { input.value = ""; draftSet("msg:" + requestId, ""); say(msg, ""); load(); } else say(msg, chatErrors[r.body && r.body.error] || "Couldn't send. Try again.", true);
      });
    };
    keepDraft(input, "msg:" + requestId);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") send.onclick(); });
    load(); timer = setInterval(load, 8000);
  }
  function resaleView(sheet, onBack, focusReceipt, startTab) {
    var body = el("div"), msg = el("div", { className: "rl-msg" });
    var tabs = el("div", { className: "rl-mk-tabs", role: "group", ariaLabel: "Swap & resell" });
    var cur = startTab || (focusReceipt ? "sell" : "browse");
    function openChat(id) { sheet.textContent = ""; chatView(sheet, id, function () { sheet.textContent = ""; resaleView(sheet, onBack, null, "mine"); }); }
    [["browse", "Browse"], ["mine", "Yours"], ["sell", "Sell"]].forEach(function (t) {
      var b = el("button", { type: "button", text: t[1], onclick: function () { if (cur === t[0] && !focusReceipt) return; cur = t[0]; focusReceipt = null; draw(); } });
      b.setAttribute("data-tab", t[0]); tabs.appendChild(b);
    });
    // On the Market page (no onBack) the page supplies its own heading and there is nothing to go back to.
    [onBack ? el("h2", { text: "Swap & resell" }) : null,
     onBack ? el("p", { className: "rl-mk-lead", text: "Passed the return date? Sell or swap it with other Relay members. Relay puts you in touch, and you agree payment and handover between you." }) : null,
     tabs, body, msg,
     onBack ? el("button", { className: "rl-btn ghost", text: "Back", "data-back": "", onclick: onBack }) : null].forEach(function (n) { if (n) sheet.appendChild(n); });
    function tell(t, bad) { say(msg, t, bad); }
    function fail(r) { tell(resaleErrors[r.body && r.body.error] || "Something went wrong. Please try again.", true); }
    function photo(card, id, has) {
      if (!has) return;
      var ph = el("img", { alt: "", style: "float:right;width:72px;height:72px;object-fit:cover;border-radius:12px;margin:0 0 8px 10px;background:var(--rl-fill)" });
      card.insertBefore(ph, card.firstChild);
      apiBlob("/relay/my/resale/listings/" + id + "/image").then(function (u) { if (u) ph.src = u; else ph.remove(); });
    }
    // A listing: its name and price on top, the shop and size under it, then its condition, swaps and handover as tags.
    function priceOf(l) { return l.askPence == null ? "Open to offers" : l.askPence === 0 ? "Free" : money(l.askPence, l.currency); }
    function listingHead(l) {
      var tags = [CONDITION[l.condition] || null, l.swapOk ? "Open to swaps" : null,
        l.handover === "collect" ? "Collection in " + l.area : l.handover === "either" ? "Collect in " + l.area + " or post" : l.handover === "post" ? "Posted" : null].filter(Boolean);
      return [el("div", { className: "rl-mk-top" }, [el("b", { text: l.title }), el("span", { className: "rl-mk-price", text: priceOf(l) })]),
        el("span", { className: "rl-mk-from", text: [l.store, l.size ? "size " + l.size : null].filter(Boolean).join(", ") }),
        el("span", { className: "rl-mk-tags" }, tags.map(function (t) { return el("span", { className: "rl-mk-tag", text: t }); }))];
    }
    // Where a request has got to, in words (the server keeps a short code).
    var STATUS = { pending: "Waiting for the seller", accepted: "Accepted", declined: "Declined", closed: "Ended", withdrawn: "Taken down", matched: "Matched", active: "On sale" };
    var said = function (s) { return STATUS[s] || "Ended"; };
    var dayOf = function (d) { return /^\d{4}-\d{2}-\d{2}/.test(d || "") ? new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null; };
    // Greyed outlines while a list loads.
    var outlines = function (n) { for (var i = 0; i < n; i++) body.appendChild(el("div", { className: "rl-skel rl-mk-skel" })); };
    function draw() {
      Array.prototype.forEach.call(tabs.children, function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-tab") === cur ? "true" : "false"); });
      body.textContent = ""; tell("");
      if (cur === "browse") return drawBrowse();
      if (cur === "mine") return drawMine();
      drawSell();
    }
    function drawBrowse() {
      outlines(3);
      Promise.all([api("/relay/my/resale/feed"), api("/relay/my/resale/mine")]).then(function (rs) {
        if (cur !== "browse") return;
        body.textContent = "";
        if (!rs[0].ok) return body.appendChild(el("p", { text: "Couldn't load what's listed. Pull down to try again." }));
        var mine = ((rs[1].body && rs[1].body.listings) || []).filter(function (l) { return l.status === "active"; });
        var rows = rs[0].body.listings || [];
        // Like a local marketplace: put things you could collect near you first. Only the postcode area is used.
        var near = ""; try { near = localStorage.getItem("relay-market-area") || ""; } catch (e) {}
        var nearBox = el("input", { placeholder: "Your postcode area, e.g. SW11", value: near, maxLength: 8, autocomplete: "off", enterKeyHint: "done" });
        nearBox.setAttribute("aria-label", "Your postcode area, to show things near you first");
        nearBox.addEventListener("change", function () { try { localStorage.setItem("relay-market-area", nearBox.value.trim().toUpperCase().split(" ")[0]); } catch (e) {} drawBrowse(); });
        if (rows.length) body.appendChild(el("label", { className: "rl-mk-area" }, [jIc("pin", 20), nearBox]));
        var mineArea = near.toUpperCase().split(" ")[0], letters = mineArea.replace(/[0-9].*$/, "");
        var score = function (l) { if (!mineArea || !l.area || l.handover === "post") return 0; return l.area === mineArea ? 2 : l.area.replace(/[0-9].*$/, "") === letters ? 1 : 0; };
        rows = rows.slice().sort(function (a, b) { return score(b) - score(a); });
        if (!rows.length) body.appendChild(el("div", { className: "rl-empty", style: "margin-top:14px" }, [el("h3", { text: "Nothing listed yet" }), el("p", { text: "When other Relay members list something they no longer need, it shows up here. Got something past its return date? List it from the Sell tab." })]));
        rows.forEach(function (l) {
          var card = el("div", { className: "rl-order rl-mk-card" }, listingHead(l));
          if (score(l)) card.appendChild(el("span", { className: "rl-mk-near" }, [jIc("pin", 14), el("span", { text: score(l) === 2 ? "Near you" : "In your area" })]));
          photo(card, l.id, l.hasImage);
          if (l.note) card.appendChild(el("span", { className: "rl-mk-quote", text: "“" + l.note + "”" }));
          if (l.myRequest) {
            card.appendChild(el("span", { className: "rl-mk-status", text: "You asked about this: " + said(l.myRequest.status).toLowerCase() + "." }));
            if (l.myRequest.status === "accepted") card.appendChild(el("button", { type: "button", className: "rl-btn", text: "Message the seller", onclick: function () { openChat(l.myRequest.id); } }));
          } else {
            // The two asks side by side; for a swap, the first tap shows what you'd offer, the second sends it.
            var acts = el("div", { className: "rl-mk-acts" }); card.appendChild(acts);
            var add = function (label, kind) {
              var btn = el("button", { type: "button", className: "rl-btn" + (kind === "buy" ? "" : " ghost"), text: label, onclick: function () {
                if (btn.disabled) return;
                var pick = card.querySelector("select");
                var b = { kind: kind };
                if (kind === "swap") {
                  if (!pick) return tell("List something of your own first (Sell tab), then offer it in a swap.", true);
                  if (pick.hidden) { pick.hidden = false; btn.textContent = "Send swap offer"; pick.focus(); return; }
                  b.offeredListingId = pick.value;
                }
                btn.disabled = true;
                api("/relay/my/resale/listings/" + l.id + "/ask", { method: "POST", body: b }).then(function (r) { btn.disabled = false; if (r.ok) { tell("Sent. The seller sees your request from “Member”, not your name."); drawBrowse(); } else fail(r); },
                  function () { btn.disabled = false; tell("Couldn't reach Relay. Check your connection and try again.", true); }); } });
              acts.appendChild(btn);
            };
            add("I'd like this", "buy");
            if (l.swapOk) {
              if (mine.length) {
                var sel = el("select", { className: "rl-mk-select" });
                sel.setAttribute("aria-label", "What you'd offer in a swap");
                mine.forEach(function (m) { sel.appendChild(el("option", { value: m.id, text: "Offer my " + m.title })); });
                sel.hidden = true;
              }
              add("Offer a swap", "swap");
              if (sel) card.appendChild(sel);
            }
          }
          // Anyone can report a listing; it goes to Relay's team and stops showing here for them.
          var rep = el("button", { type: "button", className: "rl-btn ghost rl-plain rl-mk-report", text: "Report this listing", onclick: function () {
            askText("What's wrong with this listing? For example, it isn't what it says, or it's something that shouldn't be sold. Relay's team will look at it. The seller won't see who reported it.", "Send report", function (why) {
              why = String(why || "").trim();
              if (!why) return tell("Say what's wrong, so Relay's team can check it.", true);
              if (rep.disabled) return;
              rep.disabled = true;
              api("/relay/my/resale/listings/" + l.id + "/report", { method: "POST", body: { reason: why } }).then(function (r) {
                rep.disabled = false;
                if (r.ok || (r.body && r.body.error === "already_reported")) { tell("Reported. Relay's team will look at it, and you won't see this listing again."); drawBrowse(); }
                else tell(r.body && r.body.error === "too_many_reports" ? "That's 10 reports today. Try again tomorrow, or use Talk to a person in Help." : "Couldn't send the report. Please try again.", true);
              }, function () { rep.disabled = false; tell("Couldn't reach Relay. Check your connection and try again.", true); });
            });
          } });
          card.appendChild(rep);
          body.appendChild(card);
        });
      });
    }
    function drawMine() {
      outlines(2);
      api("/relay/my/resale/mine").then(function (r) {
        if (cur !== "mine") return;
        body.textContent = "";
        if (!r.ok) return body.appendChild(el("p", { text: "Couldn't load your listings. Pull down to try again." }));
        var ls = r.body.listings || [];
        if (!ls.length) body.appendChild(el("div", { className: "rl-empty", style: "margin-top:14px" }, [el("h3", { text: "Nothing listed yet" }), el("p", { text: "Use the Sell tab to list something from your receipts." })]));
        ls.forEach(function (l) {
          var card = el("div", { className: "rl-order rl-mk-card" }, listingHead(l));
          if (l.status === "matched") card.appendChild(el("span", { className: "rl-mk-status", text: "Matched: you're chatting with a member about this." }));
          photo(card, l.id, l.hasImage);
          (l.requests || []).forEach(function (q) {
            var row = el("div", { className: "rl-mk-req" });
            row.appendChild(el("b", { text: q.who + (q.kind === "swap" ? " offers a swap" : " would like to buy") }));
            if (q.offered) row.appendChild(el("span", { text: "Offering: " + q.offered.title + (q.offered.size ? " (size " + q.offered.size + ")" : "") }));
            if (q.message) row.appendChild(el("span", { text: "“" + q.message + "”" }));
            if (q.status === "pending" && l.status === "active") {
              var acts = el("div", { className: "rl-mk-acts" });
              [["Accept", "accept", "rl-btn"], ["Decline", "decline", "rl-btn ghost"]].forEach(function (a) {
                var b = el("button", { type: "button", className: a[2], text: a[0], onclick: function () {
                  if (b.disabled) return;
                  Array.prototype.forEach.call(acts.children, function (x) { x.disabled = true; });
                  api("/relay/my/resale/requests/" + q.id + "/" + a[1], { method: "POST" }).then(function (x) {
                    if (x.ok) return drawMine();
                    Array.prototype.forEach.call(acts.children, function (y) { y.disabled = false; }); fail(x);
                  }, function () { Array.prototype.forEach.call(acts.children, function (y) { y.disabled = false; }); tell("Couldn't reach Relay. Check your connection and try again.", true); }); } });
                acts.appendChild(b);
              });
              row.appendChild(acts);
            } else {
              row.appendChild(el("span", { className: "rl-mk-status", text: q.status === "accepted" ? "Accepted. Relay doesn't handle payment or postage, so agree the handover by message." : said(q.status) + "." }));
              if (q.status === "accepted") row.appendChild(el("button", { type: "button", className: "rl-btn", text: "Open messages", onclick: function () { openChat(q.id); } }));
            }
            card.appendChild(row);
          });
          var down = el("button", { type: "button", className: "rl-btn ghost", text: "Take this down", onclick: function () {
            ask("Take " + l.title + " off Relay? Anyone who asked about it is told it's gone.", "Take it down", function () {
              if (down.disabled) return;
              down.disabled = true;
              api("/relay/my/resale/listings/" + l.id + "/withdraw", { method: "POST" }).then(function (x) { if (x.ok) { tell("Taken down."); drawMine(); } else { down.disabled = false; fail(x); } },
                function () { down.disabled = false; tell("Couldn't reach Relay. Check your connection and try again.", true); });
            }); } });
          card.appendChild(down);
          body.appendChild(card);
        });
        var mr = r.body.myRequests || [];
        if (mr.length) {
          body.appendChild(el("h3", { className: "rl-mk-h", text: "Things you asked about" }));
          mr.forEach(function (q) {
            var c = el("div", { className: "rl-order" }, [el("b", { text: q.title }), el("span", { text: (q.kind === "swap" ? "You offered a swap" : "You'd like to buy it") + ". " + said(q.status) + "." })]);
            if (q.status === "accepted") c.appendChild(el("button", { type: "button", className: "rl-btn", text: "Message the seller", onclick: function () { openChat(q.id); } }));
            body.appendChild(c); });
        }
      });
    }
    function drawSell() {
      outlines(2);
      api("/relay/my/resale/items").then(function (r) {
        if (cur !== "sell") return;
        body.textContent = "";
        if (!r.ok) return body.appendChild(el("p", { text: "Couldn't load your items. Pull down to try again." }));
        var items = (r.body.items || []).filter(function (i) { return !i.alreadyListed && (!focusReceipt || i.receiptId === focusReceipt); });
        if (!items.length) body.appendChild(el("p", { text: focusReceipt ? "That item is already listed." : "Nothing to list yet. Items come from the receipts Relay found in your email." }));
        items.forEach(function (i) { body.appendChild(sellCard(i)); });
        if (focusReceipt) body.appendChild(el("button", { className: "rl-btn ghost", text: "Show all my items", onclick: function () { focusReceipt = null; draw(); } }));
      });
    }
    function sellCard(i) {
      var card = el("div", { className: "rl-order" }, [el("b", { text: i.title }), el("span", { text: [i.store, i.pricePence != null ? "Paid " + money(i.pricePence, i.currency) : null, dayOf(i.orderDate)].filter(Boolean).join(" · ") })]);
      if (i.returnWindowOpen === true) card.appendChild(el("span", { className: "rl-mk-warn", text: "You can still return this to the shop for a refund" + (dayOf(i.returnDeadline) ? " until " + dayOf(i.returnDeadline) : "") + "." }));
      var start = el("button", { type: "button", className: "rl-btn", text: "List this", onclick: function () {
        start.remove();
        var form = el("div", { className: "rl-mk-form" });
        var field = function (label, input) { input.setAttribute("aria-label", label); return el("label", { className: "rl-mk-field" }, [el("span", { text: label }), input]); };
        var cond = el("select");
        Object.keys(CONDITION).forEach(function (k) { cond.appendChild(el("option", { value: k, text: CONDITION[k] })); });
        cond.value = "like_new";
        var size = el("input", { placeholder: "Optional", maxLength: 20, autocomplete: "off" });
        var price = el("input", { placeholder: "Leave empty for offers", inputMode: "decimal", autocomplete: "off" });
        var note = el("input", { placeholder: "Optional, no contact details", maxLength: 200, autocomplete: "off" });
        var dk = "listing:" + i.receiptId + ":" + i.itemIndex + ":";
        keepDraft(size, dk + "size"); keepDraft(price, dk + "price"); keepDraft(note, dk + "note");
        var swap = el("input", { type: "checkbox" });
        var hand = el("select");
        [["either", "Collection or post"], ["collect", "Collection only"], ["post", "Post only"]].forEach(function (o) { hand.appendChild(el("option", { value: o[0], text: o[1] })); });
        var savedArea = ""; try { savedArea = localStorage.getItem("relay-market-area") || ""; } catch (e) {}
        var area = el("input", { placeholder: "For example SW11", maxLength: 8, value: savedArea, autocomplete: "off" });
        var areaField = el("div", {}, [field("Postcode area for collection", area), el("span", { className: "rl-mk-note", text: "Only the first part of your postcode is shown, never your address." })]);
        hand.onchange = function () { areaField.hidden = hand.value === "post"; };
        var agree = el("input", { type: "checkbox" });
        var go = el("button", { type: "button", className: "rl-btn", text: "Put it on Relay", onclick: function () {
          if (go.disabled) return;
          var p = price.value.trim(), pence = null;
          if (p) { var n = Number(p.replace(/[£,\s]/g, "")); if (!isFinite(n) || n < 0 || n > 5000) return tell(resaleErrors.invalid_price, true); pence = Math.round(n * 100); }
          go.disabled = true;
          api("/relay/my/resale/listings", { method: "POST", body: { receiptId: i.receiptId, itemIndex: i.itemIndex, condition: cond.value, size: size.value, askPence: pence, swapOk: swap.checked, note: note.value, agree: agree.checked, handover: hand.value, area: hand.value === "post" ? null : area.value.trim() || null } })
            .then(function (r) { go.disabled = false; if (r.ok) { ["size", "price", "note"].forEach(function (f) { draftSet(dk + f, ""); }); cur = "mine"; focusReceipt = null; draw(); tell("Listed. Other members can now see it."); } else fail(r); },
              function () { go.disabled = false; tell("Couldn't reach Relay. Check your connection and try again.", true); });
        } });
        [field("Condition", cond), field("Size", size), field("Asking price in £", price), field("Note for buyers", note), field("Handover", hand), areaField,
         el("label", { className: "rl-mk-check" }, [swap, el("span", { text: "I'm open to swaps" })]),
         el("label", { className: "rl-mk-check small" }, [agree, el("span", { text: "I agree Relay shows this item's name, shop, size, condition, price, note and photo to other Relay members. My name, email, order number and address are never shown." })]),
         go].forEach(function (n) { form.appendChild(n); });
        card.appendChild(form);
        cond.focus();
      } });
      card.appendChild(start);
      return card;
    }
    draw();
  }
  // ---- The Account page. Laid out like a phone's Settings: a few short groups, each row opening a page of its own,
  // and Back returns here. Detail that used to crowd one long sheet now sits one tap away. ----
  var ACC_IC = {
    pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m3.8 7 8.2 6 8.2-6"/>',
    paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9.5 4V3h5v1M9.5 10h5M9.5 14h5"/>',
    bag: '<path d="M5 8h14l-1.2 12.5H6.2Z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M16.5 6.5l2.5 2.5M14 9l2 2"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    face: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9.5v1M15 9.5v1M12 9.5V13h-1M9.5 16c1.5 1.2 3.5 1.2 5 0"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.6"/><path d="M10.5 18.5h3"/>',
    devices: '<rect x="2.5" y="5" width="13.5" height="9.5" rx="1.6"/><path d="M1.5 18h15"/><rect x="18" y="8.5" width="4.5" height="11" rx="1.2"/>',
    card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
    shield: '<path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6Z"/><path d="m9 12 2 2 4-4"/>',
    trash: '<path d="M4.5 7h15M10 7V5h4v2M6.5 7l1 13h9l1-13"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
    doc: '<path d="M7 3.5h7l4 4v13H7Z"/><path d="M14 3.5v4h4M10 12h5M10 16h5"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.5M12 17h.01"/>',
    swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    pulse: '<path d="M3 12.5h4l2.5-6.5 4.5 13 2.5-6.5H21"/>',
    chat: '<path d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v9a1.5 1.5 0 0 1-1.5 1.5h-7l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 16V7A1.5 1.5 0 0 1 5 5.5Z"/>',
    out: '<path d="M14 4.5h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
    chev: '<path d="m9 6 6 6-6 6"/>', back: '<path d="m15 6-6 6 6 6"/>',
    ext: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>'
  };
  function accIc(n, px, cls) {
    var s = el("span", { className: cls || "rl-ai" }); s.setAttribute("aria-hidden", "true");
    s.innerHTML = '<svg viewBox="0 0 24 24" width="' + (px || 20) + '" height="' + (px || 20) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ACC_IC[n] + "</svg>";
    return s;
  }
  // One row: icon, label, an optional line underneath, and a chevron (or an arrow for pages that open outside the app).
  function accRow(icon, label, detail, onclick, opts) {
    opts = opts || {};
    var sub = el("span", { className: "rl-arow-d", text: detail || "" });
    if (!detail) sub.style.display = "none";
    var tag = opts.href ? "a" : "button";
    var props = { className: "rl-arow" + (opts.danger ? " danger" : "") };
    if (opts.href) { props.href = opts.href; } else { props.type = "button"; props.onclick = onclick; }
    var row = el(tag, props, [accIc(icon), el("span", { className: "rl-arow-t" }, [el("b", { text: label }), sub]), accIc(opts.href ? "ext" : "chev", 18, "rl-arow-c")]);
    row.setDetail = function (t) { sub.textContent = t || ""; sub.style.display = t ? "" : "none"; };
    return row;
  }
  function accGroup(title, rows) {
    var card = el("div", { className: "rl-acard" }, rows);
    return el("section", { className: "rl-agroup" }, (title ? [el("h3", { text: title })] : []).concat([card]));
  }
  // The bar across the top: Back on the left (on inner pages), the page name, and Done on the right.
  function accBar(sheet, title, onBack) {
    // On the Profile page the same sections sit in the page itself: no Done button, and the page already has its title.
    var inPage = sheet.classList.contains("rl-inpage"), home = inPage ? "Profile" : "Account";
    if (inPage && !onBack) return;
    var bar = el("div", { className: "rl-abar" }, [
      onBack ? el("button", { type: "button", className: "rl-abtn", ariaLabel: "Back to " + home, "data-back": "", onclick: onBack }, [accIc("back", 20, "rl-ab-i"), el("span", { text: home })]) : el("span"),
      el("b", { className: "rl-abar-t", text: onBack ? title : "" }),
      inPage ? el("span") : el("button", { type: "button", className: "rl-abtn done", text: "Done", onclick: close })]);
    sheet.appendChild(bar);
    if (!onBack) sheet.appendChild(el("h2", { className: "rl-atitle", text: title }));
  }
  var HELP = [
    ["How does Relay find my receipts?", "With your permission, Relay reads your Gmail or Outlook in read-only mode and picks out order confirmations, receipts and return emails. It keeps the details it needs (store, items, total, return deadline) and a link back to the original email, not the email itself."],
    ["I shop with more than one email address. Can Relay read them all?", "Yes. Open Profile, then Email connection, and add a Gmail or Outlook inbox. Relay reads up to five and puts all their receipts together. Disconnecting one deletes only the receipts it brought in."],
    ["A receipt is missing. What can I do?", "Open Profile and choose Add a missing receipt. Start typing the shop's name to search your inbox, or paste the order email in. If it's in another inbox, forward it to the one Relay reads."],
    ["Can Relay refund me automatically?", "No. Relay finds your purchases and return deadlines from your email, so it can remind you and show you how to return something, but the refund itself always comes from the shop."],
    ["Will Relay ever email from my account?", "Never. Relay can't send, delete or change anything in your inbox. The only emails it sends are sign-in emails and, if you ask for one, a single return reminder to your sign-in address."],
    ["How do I stop Relay reading my email?", "Open Profile, then Email connection, and choose Disconnect. Relay deletes every receipt it captured from that inbox. You can also withdraw your permission under Privacy & data."],
    ["How do I get a copy of my data?", "Open Profile, then Download my data under Privacy & data. You get one file with everything Relay keeps about you."],
    ["How do I make signing in safer?", "Open Profile, then Two-step sign-in. Relay can text a code to your phone, or you can use an authenticator app, so signing in with an email link, Google or Microsoft also needs that code. Keep the recovery codes it shows you in case you lose your phone."],
    ["How do I delete my account?", "Open Profile, then Delete my account under Privacy & data. Your sign-in and everything linked to it are deleted, and it can't be undone."]
  ];
  var CONSENT_FALLBACK = ["Relay reads your email in read-only mode and looks only for order confirmations, receipts and return emails.", "It never sends email from your account, never deletes or changes anything in your inbox, and never sells or shares what it finds."];
  function signedInView(sheet, email, notice, c) {
    sheet.textContent = "";
    var inPage = sheet.classList.contains("rl-inpage");
    if (!inPage) sheet.classList.add("rl-full");
    sheet.setAttribute("aria-label", "Account");
    try { sheet.scrollTop = 0; } catch (e) {}
    var msg = el("div", { className: "rl-msg" });
    // On the Profile page, an inner page starts at its top and Back lands where Profile was.
    function home() { signedInView(sheet, email, null, c); if (inPage) scrollBackTo(profileY); }
    // An inner page with the top bar. Each section keeps its own heading out of the way: the bar already names it.
    function page(title, build) {
      if (inPage) profileY = window.scrollY || 0;
      sheet.textContent = ""; try { sheet.scrollTop = 0; } catch (e) {}
      if (inPage) window.scrollTo(0, 0);
      accBar(sheet, title, home);
      var body = el("div", { className: "rl-asub" }); sheet.appendChild(body);
      build(body);
    }
    // Screens that bring their own heading and Back button.
    function screen(view) { sheet.textContent = ""; try { sheet.scrollTop = 0; } catch (e) {} view(sheet); }
    openFind = function () { page("Add a receipt", function (b) { addReceiptView(b, null, { inPage: true }); }); };
    openOriginal = function (id) { screen(function (sh) { originalView(sh, id, home); }); };
    openResale = function (rid) { screen(function (sh) { resaleView(sh, home, rid); }); };
    function editHere() { screen(function (sh) { profileView(sh, home); }); }

    accBar(sheet, "Account");
    var head = el("button", { type: "button", className: "rl-ahead", ariaLabel: "Edit your name and photo", onclick: editHere });
    function drawHead() {
      if (!document.body.contains(head)) return false;
      var p = profileNow() || { email: email };
      head.textContent = "";
      head.appendChild(face(p, 60));
      head.appendChild(el("span", { className: "rl-ahead-t" }, [el("b", { text: p.name || "Add your name" }), el("span", { text: email }), el("em", { text: p.name || p.photo ? "Edit profile" : "Add your name and photo" })]));
      head.appendChild(accIc("chev", 18, "rl-arow-c"));
    }
    sheet.appendChild(head); sheet.appendChild(msg);
    drawHead(); profileWatchers.push(drawHead); loadProfile();
    // On the Profile page, this year's Wrapped comes first.
    // The reviewer account (isReview) can't have an inbox or sign-in settings, so those rows, and Wrapped (made from inbox
    // receipts), are left out for it.
    var review = isReview();
    if (inPage && !review) { var wr = el("div", { className: "rl-agroup", id: "rl-wrapped" }, [el("h3", { text: "Wrapped" })]), wb = el("div"); wr.appendChild(wb); sheet.appendChild(wr); mountWrapped(wb); }
    if (notice) say(msg, notice.text, notice.bad);

    // Receipts
    var mailRow = accRow("mail", "Email connection", "Checking…", function () { page("Email connection", mailPage); });
    var receiptRows = review ? [] : [mailRow, accRow("paste", "Add a missing receipt", "Search your inbox or paste an email", function () { openFind(); })];
    var ordersRow = accRow("bag", "Shop orders", review ? "None yet" : "", function () { page("Shop orders", ordersPage); }); if (!review) ordersRow.style.display = "none";
    receiptRows.push(ordersRow);
    if (marketOn()) receiptRows.push(accRow("swap", "Swap & resell", "Sell or swap what you can't return", function () { openResale(); }));
    sheet.appendChild(accGroup("Receipts", receiptRows));
    var mailState = null;
    api("/relay/my/gmail").then(function (g) {
      if (g.ok) rememberMailbox(g.body);
      mailState = g.ok && g.body ? g.body : null;
      var more = mailState && (mailState.others || []).length;
      mailRow.setDetail(!mailState ? "" : mailState.connected ? (more ? more + 1 + " inboxes" : mailName()) + " · connected" : "Not connected yet");
    }).catch(function () { mailRow.setDetail(""); });
    var orders = [];
    api(purchasesPath()).then(function (r) {
      if (r.status === 401) { save(null); close(); return; }
      orders = (r.ok && r.body && r.body.purchases) || [];
      if (orders.length) { ordersRow.style.display = ""; ordersRow.setDetail(orders.length + " confirmed by the shop"); }
    }).catch(function () {});

    // Alerts (only where the app's pages are here to open)
    if (window.go) {
      var alertRow = accRow("bell", "Price alerts", "", function () { close(); window.go("radar"); });
      sheet.appendChild(accGroup("Alerts", [alertRow]));
      alertStatus().then(function (st) {
        var n = st && st.watches ? st.watches.length : 0;
        alertRow.setDetail(n ? "Watching " + n + " product" + (n === 1 ? "" : "s") : "Get told when prices drop");
      });
    }

    // Shopping: the delivery details Relay fills in at shops' checkouts.
    if (!review) {
      var deliveryRow = accRow("pin", "Delivery details", "", function () { page("Delivery details", function (b) {
        deliveryForm(b, { onSaved: function () { home(); }, onRemoved: function () { home(); } }); }); });
      sheet.appendChild(accGroup("Shopping", [deliveryRow]));
      api("/relay/my/delivery").then(function (r) { if (r.ok && r.body) deliveryRow.setDetail(r.body.delivery ? deliveryLine(r.body.delivery) : "Add your address"); }).catch(function () {});
    }

    // Sign-in & security
    var secRows = [];
    if (passkeysSupported()) secRows.push(accRow("face", "Face ID & passkeys", "Sign in without an email", function () { page("Face ID & passkeys", function (b) { passkeySection(b, el("div")); }); }));
    var openTwoStep = function () { page("Two-step sign-in", function (b) { twoStepSection(b); }); };
    // Shown once Relay can send texts (or when a number is already on the account).
    var phoneRow = accRow("phone", "Phone number", "", function () { page("Phone number", function (b) { phoneSection(b, openTwoStep); }); });
    phoneRow.style.display = "none"; secRows.push(phoneRow);
    var twoRow = accRow("lock", "Two-step sign-in", "", openTwoStep);
    secRows.push(twoRow);
    var devicesRow = accRow("devices", "Devices", "Phones and computers you're signed in on", function () { page("Devices", devicesPage); });
    secRows.push(devicesRow);
    var cardRow = accRow("card", "Card for swaps", "", function () { page("Card for swaps", function (b) { var cb = el("div"); b.appendChild(cb); cardSection(cb); }); });
    cardRow.style.display = "none"; secRows.push(cardRow);
    sheet.appendChild(accGroup("Sign-in & security", review ? [devicesRow] : secRows));
    if (review) sheet.appendChild(el("p", { className: "rl-anote", text: "This account is shared by Relay's reviewers, so a passkey, two-step sign-in, a phone number or a card can't be added to it." }));
    api("/relay/my/2fa").then(function (r) {
      if (!r.ok || !r.body) return;
      var t = r.body; twoRow.setDetail(t.text && t.app ? "On: text and app" : t.text ? "On: text message" : t.app ? "On: authenticator app" : "Off");
    }).catch(function () {});
    api("/relay/my/phone").then(function (r) {
      if (!r.ok || !r.body || !(r.body.available || r.body.ending)) return;
      phoneRow.style.display = ""; phoneRow.setDetail(r.body.ending ? "Ending " + r.body.ending : "Add one for sign-in codes");
    }).catch(function () {});
    api("/relay/my/card").then(function (r) {
      if (!r.ok || !r.body || !r.body.enabled) return;
      if (r.body.testMode !== false && !testingOn() && !r.body.card) return;
      cardRow.style.display = ""; cardRow.setDetail(r.body.card ? cardText(r.body.card) : "None saved");
    }).catch(function () {});

    // Privacy & data
    sheet.appendChild(accGroup("Privacy & data", (review ? [] : [
      accRow("shield", "Email permission", "What Relay reads and keeps", function () { page("Email permission", permissionPage); })]).concat([
      accRow("download", "Download my data", "A copy of everything Relay keeps", function () { page("Download my data", exportPage); }),
      accRow("trash", "Delete my account", "", function () { page("Delete my account", deletePage); }, { danger: true })])));

    // Help & legal
    // The help chat: shown once Relay says it's on (an AI assistant), or that a person can be reached by email.
    var chatRow = accRow("chat", "Chat with us", "Ask Relay's assistant, or a person", function () { page(chatRow._ai ? "Help chat" : "Contact us", chatPage); });
    chatRow.style.display = "none";
    (memo.helpChat ? Promise.resolve(memo.helpChat) : api("/relay/my/help/chat").then(function (r) { return r.ok && r.body ? (memo.helpChat = r.body) : null; }, function () { return null; })).then(function (hc) {
      if (!hc || !(hc.available || hc.handoff)) return;
      chatRow._ai = Boolean(hc.available);
      if (!hc.available) { chatRow.querySelector(".rl-arow-t b").textContent = "Contact us"; chatRow.setDetail("Write to Relay's team. They'll reply by email"); }
      chatRow.style.display = "";
    });
    sheet.appendChild(accGroup("Help & legal", [
      accRow("help", "Help", "Common questions", function () { page("Help", helpPage); }), chatRow,
      accRow("doc", "Terms of use", "", null, { href: "./terms.html" }),
      accRow("doc", "Privacy policy", "", null, { href: "./privacy.html" })]));

    // Reviewing member reports: only for the people who do that.
    var abox = el("div"); sheet.appendChild(abox);
    api("/relay/my/admin/me").then(function (r) {
      // Relay's team signs in with their second step to use the team tools (worker/second-step.js).
      if (r.ok && r.body && r.body.signInAgain) {
        abox.appendChild(accGroup("Team", [accRow("shield", "Sign in again for team tools", "Team tools need a sign-in with your second step", function () {
          api("/relay/auth/logout", { method: "POST" }).finally(function () { save(null); open(function (sh) { signedOutView(sh); }); });
        })]));
        abox.appendChild(teamTesting());
        return;
      }
      if (!r.ok || !r.body || r.body.admin !== true) return;
      var revRow = accRow("key", "Sign-in for app reviewers", "", function () { page("Sign-in for app reviewers", reviewerPage); });
      openHealthPage = function () { if (!abox.isConnected) return false; page("Relay health", healthPage); return true; };
      if (wantHealth) setTimeout(function () { if (wantHealth && openHealthPage()) wantHealth = false; }, 0);
      abox.appendChild(accGroup("Team", [accRow("pulse", "Relay health", "How well emails are read, and how Relay is used", function () { page("Relay health", healthPage); }),
        accRow("mail", "Emails shoppers sent", "Receipts read wrong, sent in to be read", function () { page("Emails shoppers sent", sharedPage); }),
        accRow("flag", "Review reports", (r.body.openReports || 0) + " open", function () { screen(function (sh) { adminView(sh, home); }); }), revRow]));
      abox.appendChild(teamTesting());
      api("/relay/my/admin/review-account").then(function (x) { if (x.ok && x.body) revRow.setDetail(x.body.on ? "On" : "Off"); }).catch(function () {});
    }).catch(function () {});

    var outBtn = el("button", { type: "button", className: "rl-aout", text: "Sign out" });
    // Signing out (or deleting the account) from the Profile page goes back to the welcome screen on Home.
    var leave = function () { save(null); close(); if (inPage && window.go) window.go("profile"); };
    outBtn.onclick = function () { outBtn.disabled = true; api("/relay/auth/logout", { method: "POST" }).finally(leave); };
    sheet.appendChild(outBtn);
    sheet.appendChild(el("p", { className: "rl-afoot", text: "Signed in as " + email }));

    // Two switches for Relay's team, each changing only what this device shows (so they also work in the app on the home
    // screen, which a link can't reach). Shoppers never see them.
    //  * Shops' websites: the preview from shops' own websites in Discover and search by photo. Real products only.
    //  * Testing tools: Relay's test shops, test orders and sample items (the same as opening Relay with ?testtools=1).
    function teamSwitch(title, label, text, key) {
      var box = el("div", { className: "rl-aih" });
      var sw = el("button", { type: "button", className: "rl-sw" }, [el("i")]);
      sw.setAttribute("role", "switch"); sw.setAttribute("aria-label", label);
      var on = function () { try { return key === "relay-testing-tools" ? testingOn() : localStorage.getItem(key) === "1"; } catch (e) { return false; } };
      var draw = function () { sw.setAttribute("aria-checked", on() ? "true" : "false"); };
      box.appendChild(el("div", { className: "rl-aih-top" }, [el("b", { text: title }), sw]));
      box.appendChild(el("p", { text: text }));
      draw();
      sw.onclick = function () {
        try { localStorage.setItem(key, on() ? "0" : "1"); } catch (e) {}
        draw();
        if (typeof window.testToolsChanged === "function") window.testToolsChanged();
      };
      return box;
    }
    function teamTesting() {
      var box = el("div");
      box.appendChild(teamSwitch("Shops' websites in Discover", "Shops' websites in Discover on this device",
        "Real products and prices from shops' own websites, read once a day, in Discover and search by photo. Only Relay's team sees them.", "relay-web-preview"));
      box.appendChild(teamSwitch("Testing tools", "Testing tools on this device",
        "Relay's test shops, test orders and sample items, for trying things out. Off shows Relay as shoppers see it.", "relay-testing-tools"));
      return box;
    }
    // AI help (worker/ai-reader.js): Claude reads emails Relay's own reader isn't sure about, only once switched on here.
    // Shown only once Relay can offer it (the AI key is set). Switching it off deletes what the AI read.
    function aiHelp() {
      var box = el("div", { className: "rl-aih" }); box.hidden = true;
      var sw = el("button", { type: "button", className: "rl-sw" }, [el("i")]);
      sw.setAttribute("role", "switch"); sw.setAttribute("aria-label", "AI help with receipts");
      var msg = el("p", { className: "rl-msg" }); msg.setAttribute("role", "status");
      box.appendChild(el("div", { className: "rl-aih-top" }, [el("b", { text: "AI help with receipts" }), sw]));
      box.appendChild(el("p", { text: "When Relay's own reader can't work out a receipt, Claude, an AI made by Anthropic, can read that email to fill in what's missing. It gets the email's text with your name, addresses, links, phone numbers and card numbers hidden, and Anthropic can't train its AI on it. What it fills in is marked for you to check." }));
      box.appendChild(msg);
      var on = false, busy = false;
      var draw = function () { sw.setAttribute("aria-checked", on ? "true" : "false"); };
      api("/relay/my/ai-reading", { fresh: true }).then(function (r) {
        if (!r.ok || !r.body || !r.body.available) return;
        on = Boolean(r.body.on); draw(); box.hidden = false;
      }, function () {});
      sw.onclick = function () {
        if (busy) return;
        var want = !on;
        busy = true; sw.disabled = true; say(msg, "");
        api("/relay/my/ai-reading", { method: "POST", body: { on: want } }).then(function (r) {
          busy = false; sw.disabled = false;
          if (!r.ok) return say(msg, r.status === 503 ? "AI help isn't available right now. Try again later." : "Couldn't change that. Try again in a moment.", true);
          on = Boolean(r.body && r.body.on); draw();
          say(msg, on ? "On. Relay will ask the AI about receipts it isn't sure of, a few at a time." : "Off. What the AI read has been deleted.");
          memo.receipts = null;
        }, function () { busy = false; sw.disabled = false; say(msg, "Couldn't reach Relay. Check your connection and try again.", true); });
      };
      return box;
    }
    function mailPage(b) {
      if (!window.go) return gmailSection(b, c || {}, msg);
      var note = el("div", { className: "rl-msg" });
      var on = mailState && mailState.connected;
      if (!on) {
        b.appendChild(el("p", { text: "Connect the email you shop with, Gmail or Outlook, and Relay brings your receipts in for you." }));
        b.appendChild(el("button", { className: "rl-btn", text: "Connect your email", onclick: function () { close(); window.go("receipts"); } }));
        b.appendChild(note);
        return;
      }
      var boxes = [{ mailbox: null, provider: mailState.provider, email: mailState.email, lastScanAt: mailState.lastScanAt, autoAt: mailState.autoAt, scan: mailState.scan }].concat(mailState.others || []);
      b.appendChild(el("p", { text: boxes.length > 1 ? "Relay reads these inboxes in read-only mode and puts all their receipts together." : "Relay is reading your " + mailName() + " in read-only mode and sorting your receipts for you." }));
      var list = el("div", { className: "rl-ibx" });
      boxes.forEach(function (x, i) {
        var off = el("button", { type: "button", className: "rl-ibx-off", text: "Disconnect" });
        off.setAttribute("aria-label", "Disconnect " + (x.email || inboxName(x.provider)));
        off.onclick = function () { disconnectInbox(x, i === 0 ? boxes[1] : null); };
        var ic = jIc("mail", 20); ic.className = "rl-ibx-ic " + (x.provider === "microsoft" ? "ms" : "g");
        list.appendChild(el("div", { className: "rl-ibx-row" }, [ic, el("div", { className: "rl-ibx-t" }, [el("b", { text: x.email || inboxName(x.provider) }),
          el("span", { text: [inboxName(x.provider), boxes.length > 1 && i === 0 ? "main inbox" : null, inboxWhen(x)].filter(Boolean).join(" · ") }), off])]));
      });
      b.appendChild(list);
      var adds = el("div", { className: "rl-ibx-adds" });
      if (boxes.length < (mailState.maxInboxes || 5)) {
        b.appendChild(el("p", { className: "rl-anote", text: "Shop with more than one email address? Add the others and Relay reads them all." }));
        b.appendChild(adds); addInboxButtons(adds, note);
      } else b.appendChild(el("p", { className: "rl-anote", text: "That's the most inboxes Relay can read for one account." }));
      b.appendChild(aiHelp());
      b.appendChild(note);
      b.appendChild(el("button", { className: "rl-btn", text: "Open my receipts", style: "margin-top:18px", onclick: function () { close(); window.go("receipts"); } }));
      b.appendChild(el("button", { className: "rl-btn ghost", text: "Add a missing receipt", onclick: function () { openFind(); } }));
      b.appendChild(el("button", { className: "rl-btn ghost", text: "Re-scan all my email", onclick: function () { window.__relayAutoFull = true; close(); window.go("receipts"); } }));
      b.appendChild(el("p", { className: "rl-anote", text: "A full re-scan looks through every email again. It can take a few minutes." }));
      b.appendChild(el("p", { className: "rl-anote", text: "Disconnecting an inbox deletes every receipt Relay captured from it. Receipts you added by hand stay." }));
      function again() { memo.gmail = null; cachedGet("gmail", "/relay/my/gmail").then(function (g) { mailState = g.ok && g.body ? g.body : mailState; page("Email connection", mailPage); }); }
      function disconnectInbox(x, next) {
        if (!x.mailbox && !next) return disconnectGmail(again, note);
        var who = x.email || inboxName(x.provider);
        ask("Disconnect " + who + " and delete the receipts Relay captured from it?" + (next ? " " + (next.email || inboxName(next.provider)) + " becomes your main inbox." : ""), "Disconnect and delete", function () {
          api("/relay/my/gmail/disconnect", { method: "POST", body: x.mailbox ? { mailbox: x.mailbox } : {} }).then(function (r) {
            if (!r.ok) return say(note, "Couldn't disconnect " + who + ". Try again.", true);
            memo.receipts = null; memo.walletPurchases = null; memo.openCat = null; try { localStorage.removeItem("relay.cache.v1"); } catch (e) {}
            again();
          }, function () { say(note, "Couldn't reach Relay. Check your connection.", true); });
        });
      }
    }
    // Lost a phone, or signed in on a shared computer: sign Relay out everywhere else in one tap (this device stays in).
    function devicesPage(b) {
      b.appendChild(el("p", { text: "Signs Relay out on every other phone, tablet and computer, including ones that are lost or shared. You stay signed in here." }));
      var note = el("div", { className: "rl-msg" });
      var again = function (text) { go.disabled = false; go.textContent = "Sign out other devices"; say(note, text, true); };
      var go = el("button", { type: "button", className: "rl-btn", text: "Sign out other devices", onclick: function () {
        go.disabled = true; go.textContent = "Signing out…";
        api("/relay/my/devices/sign-out-others", { method: "POST", body: {} }).then(function (r) {
          if (!r.ok) return again("That didn't work. Check your connection and try again.");
          var n = (r.body && r.body.count) || 0;
          go.textContent = "Done";
          say(note, n ? (n === 1 ? "1 other device was" : n + " other devices were") + " signed out. Only this one is signed in now." : "No other devices were signed in. Only this one is.");
        }, function () { again("That didn't work. Check your connection and try again."); });
      } });
      b.appendChild(go);
      b.appendChild(note);
      b.appendChild(el("p", { className: "rl-anote", text: "Relay emails you whenever how you sign in changes (two-step sign-in, your phone number, a passkey or a recovery code), so you'd know if it wasn't you." }));
    }
    function ordersPage(b) {
      b.appendChild(el("p", { text: "Orders the shop itself confirmed to Relay." }));
      if (!orders.length) b.appendChild(el("p", { className: "rl-anote", text: "None yet. An order shows up here when a shop that uses Relay confirms one placed with " + email + "." }));
      orders.forEach(function (o) {
        var names = o.items.map(function (i) { return i.quantity + " × " + i.title; }).join(", ");
        b.appendChild(el("div", { className: "rl-order" }, [el("b", { text: names || "Order" }),
          el("span", { text: (o.store ? o.store + " · " : "") + money(o.amountMinor, o.currency) + " · " + new Date(o.orderedAt).toLocaleDateString("en-GB") })]));
      });
    }
    // The sign-in for Shopify's reviewers (worker/review-account.js): turn it on, copy the address and code into the App
    // Store submission's testing instructions, and turn it off when the review is over.
    function reviewerPage(b) {
      var note = el("div", { className: "rl-msg" }), box = el("div");
      b.appendChild(box); b.appendChild(note);
      box.appendChild(el("div", { className: "rl-skel", style: "min-height:150px;border-radius:18px" }));
      function line(label, value, cls) {
        var copy = el("button", { type: "button", className: "rl-po-secondary", text: "Copy", ariaLabel: "Copy the " + label.toLowerCase() });
        copy.onclick = function () { copyText(value).then(function (ok) { copy.textContent = ok ? "Copied" : "Copy"; if (!ok) say(note, "Couldn't copy. Press and hold it to copy it yourself.", true); }); };
        return el("div", { className: "rl-rev-l" }, [el("span", { className: "rl-arow-t" }, [el("b", { text: label }), el("span", { className: "rl-rev-v" + (cls ? " " + cls : ""), text: value })]), copy]);
      }
      function set(on, btn) {
        if (btn.disabled) return;
        btn.disabled = true;
        api("/relay/my/admin/review-account", { method: "POST", body: { on: on } }).then(function (r) {
          btn.disabled = false;
          if (!r.ok || !r.body) return say(note, "That didn't work. Try again.", true);
          draw(r.body);
          say(note, on ? "On. Copy the email and code into the testing instructions." : "Off. The account and everything in it are deleted.");
        }).catch(function () { btn.disabled = false; say(note, "Couldn't reach Relay. Check your connection.", true); });
      }
      function draw(st) {
        box.textContent = ""; say(note, "");
        if (!st.on) {
          box.appendChild(el("p", { text: "Shopify's reviewers need an account they can sign in to without an emailed code. This makes one: a made-up email address and a 6-digit code that stays the same until you turn it off." }));
          var on = el("button", { type: "button", className: "rl-btn", text: "Turn on" });
          on.onclick = function () { set(true, on); };
          box.appendChild(on);
          return;
        }
        box.appendChild(el("p", { text: "Put these in the testing instructions when you submit Relay. No email goes to this address, so anyone with the code can sign in: share it only with Shopify." }));
        box.appendChild(el("div", { className: "rl-acard" }, [line("Email", st.email), line("Code", st.code, "rl-rev-code")]));
        box.appendChild(el("p", { className: "rl-anote", text: "The account can't connect an inbox or add a passkey, two-step sign-in, a phone number or a card. Turning it off deletes it and everything in it; turning it on again makes a new address and code." }));
        var off = el("button", { type: "button", className: "rl-btn ghost rl-red", text: "Turn off" });
        off.onclick = function () { ask("Turn off the sign-in for reviewers? Its account and everything in it are deleted, and the address and code stop working.", "Turn off", function () { set(false, off); }); };
        box.appendChild(off);
      }
      api("/relay/my/admin/review-account").then(function (r) {
        if (!r.ok || !r.body) { box.textContent = ""; return say(note, "Couldn't load this. Try again in a moment.", true); }
        draw(r.body);
      }).catch(function () { box.textContent = ""; say(note, "Couldn't reach Relay. Check your connection.", true); });
    }
    // ---- Relay health (admins only): counts of how well emails are read and how the app is used. Never what one person
    // bought: other people's receipts only as totals, and a shop only once 3 or more people have receipts from it
    // (worker/health.js). The admin's own receipts are broken down by shop, for checking the reader while testing. ----
    function healthPage(b) {
      var note = el("div", { className: "rl-msg" }), box = el("div", { className: "rl-hp" });
      var when = el("span", { className: "rl-hp-when" });
      var again = el("button", { type: "button", className: "rl-po-secondary rl-hp-again", text: "Refresh" });
      b.appendChild(el("p", { className: "rl-hp-lead", text: "Counts from everyone's receipts, never what one person bought. Shops are named once 3 or more people have receipts from them." }));
      b.appendChild(el("div", { className: "rl-hp-top" }, [when, again]));
      b.appendChild(note); b.appendChild(box);
      var N = function (x) { return (Number(x) || 0).toLocaleString("en-GB"); };
      var pct = function (a, t) { return t ? Math.round(a / t * 100) : 0; };
      var plural = function (x, one, more) { return N(x) + " " + (Number(x) === 1 ? one : more); };
      var stamp = function (iso) {
        if (!iso) return "never";
        var d = new Date(iso), t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        return d.toDateString() === new Date().toDateString() ? "today at " + t : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " at " + t;
      };
      var group = function (title, kids) { return el("section", { className: "rl-agroup" }, [el("h3", { text: title }), el("div", { className: "rl-acard rl-hp-card" }, kids)]); };
      var row = function (label, value, sub) { return el("div", { className: "rl-hp-row" }, [el("span", {}, [el("span", { text: label })].concat(sub ? [el("small", { text: sub })] : [])), el("b", { text: value })]); };
      var words = function (k) { k = String(k || "unknown").replace(/_/g, " "); return k.charAt(0).toUpperCase() + k.slice(1); };
      // Why a scan stopped, in plain words (the server gives a short code).
      var SCAN_ERR = { gmail_reconnect_needed: "Inbox needs connecting again", gmail_not_connected: "Inbox was disconnected", gmail_unavailable: "Gmail or Outlook was busy, tried again later",
        scan_busy: "A check was already running", too_many_requests: "Too many checks at once", consent_required: "Waiting for the shopper's permission", consent_version_mismatch: "Waiting for the shopper's permission" };
      function skeleton() {
        box.textContent = "";
        var k = el("div", { className: "rl-hp-kpis" });
        for (var i = 0; i < 4; i++) k.appendChild(el("div", { className: "rl-hp-kpi rl-skel", style: "min-height:96px" }));
        box.appendChild(k);
        box.appendChild(el("div", { className: "rl-skel", style: "min-height:260px;border-radius:18px;margin-top:22px" }));
      }
      // Receipts found each day, as columns. Tap or hover one for its numbers; the table underneath has them all.
      function dayChart(days) {
        var max = Math.max.apply(null, days.map(function (d) { return d.kept; }).concat([1]));
        var wrap = el("div", { className: "rl-hp-chartw" }), tip = el("div", { className: "rl-hp-tip" });
        tip.setAttribute("aria-hidden", "true"); tip.hidden = true;
        var dname = function (d, o) { return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", Object.assign({ timeZone: "UTC" }, o)); };
        var chart = el("div", { className: "rl-hp-chart" });
        chart.setAttribute("role", "group");
        chart.setAttribute("aria-label", "Receipts found each day, last 14 days");
        days.forEach(function (d) {
          var label = dname(d.day, { weekday: "short", day: "numeric", month: "short" }) + ": " + plural(d.kept, "receipt", "receipts") + " found, " + plural(d.skipped, "other email", "other emails") + " skipped";
          var col = el("button", { type: "button", ariaLabel: label }, [el("i", { style: "height:" + (d.kept ? Math.max(3, Math.round(d.kept / max * 100)) : 0) + "%" })]);
          var show = function () {
            tip.textContent = ""; tip.appendChild(el("b", { text: dname(d.day, { weekday: "short", day: "numeric", month: "short" }) }));
            tip.appendChild(el("span", { text: plural(d.kept, "receipt", "receipts") + " · " + plural(d.skipped, "skipped", "skipped") }));
            tip.hidden = false;
            var x = col.offsetLeft + col.offsetWidth / 2, w = chart.offsetWidth;
            tip.style.left = Math.max(70, Math.min(w - 70, x)) + "px";
          };
          col.addEventListener("mouseenter", show); col.addEventListener("focus", show); col.addEventListener("click", show);
          col.addEventListener("mouseleave", function () { tip.hidden = true; }); col.addEventListener("blur", function () { tip.hidden = true; });
          chart.appendChild(col);
        });
        wrap.appendChild(el("div", { className: "rl-hp-chead" }, [el("b", { text: "Receipts found each day" }), el("span", { text: "Most in a day: " + N(max === 1 && !days.some(function (d) { return d.kept; }) ? 0 : max) })]));
        wrap.appendChild(el("div", { className: "rl-hp-plot" }, [chart, tip]));
        wrap.appendChild(el("div", { className: "rl-hp-axis" }, [el("span", { text: dname(days[0].day, { day: "numeric", month: "short" }) }), el("span", { text: "Today" })]));
        // The same numbers as a table.
        var table = el("table", { className: "rl-hp-table" }, [el("thead", {}, [el("tr", {}, [el("th", { text: "Day" }), el("th", { text: "Receipts" }), el("th", { text: "Skipped" })])])]);
        var tb = el("tbody"); days.slice().reverse().forEach(function (d) { tb.appendChild(el("tr", {}, [el("td", { text: dname(d.day, { weekday: "short", day: "numeric", month: "short" }) }), el("td", { text: N(d.kept) }), el("td", { text: N(d.skipped) })])); });
        table.appendChild(tb);
        var more = el("details", { className: "rl-hp-more" }, [el("summary", {}, [el("span", { text: "See the numbers" }), jIc("down", 18)]), table]);
        wrap.appendChild(more);
        return wrap;
      }
      // One shop's problems as small labels; "Nothing to fix" when there are none.
      function chips(s) {
        var c = el("div", { className: "rl-hp-chips" }), any = false;
        [[s.fixed, "fixed by the shopper"], [s.dismissed, "removed as not theirs"], [s.noTotal, "no total"], [s.low, "low confidence"], [s.pasted, "added by hand"], [s.noItems, "no items"]].forEach(function (x) {
          if (x[0]) { any = true; c.appendChild(el("i", { text: N(x[0]) + " " + x[1] })); }
        });
        if (!any) c.appendChild(el("i", { className: "ok", text: "Nothing to fix" }));
        return c;
      }
      function shopList(list, withPeople) {
        var l = el("div", { className: "rl-hp-shops" });
        list.forEach(function (s) {
          l.appendChild(el("div", { className: "rl-hp-shop" }, [el("b", { text: s.domain }),
            el("span", { text: plural(s.receipts, "receipt", "receipts") + (withPeople ? " from " + plural(s.people, "person", "people") : "") + (s.receipts ? " · " + pct(s.high, s.receipts) + "% read confidently" : "") }), chips(s)]));
        });
        return l;
      }
      // Shops as the answer key (worker/answer-key.js): orders connected shops confirmed, found in the shopper's own inbox, and
      // what Relay read checked against the shop's record.
      function answerKey(k) {
        if (!k) return [el("p", { className: "rl-hp-sub", text: "Couldn't check this part just now. Try Refresh in a moment." })];
        var how = "When a shop connected to Relay confirms an order, Relay finds that order's email in the shopper's own inbox and checks what it read against the shop's record.";
        if (!k.orders) return [el("p", { className: "rl-hp-sub", text: how + " Nothing to check yet: none of the last " + k.days + " days' orders from connected shops belong to a Relay shopper." })];
        var money = function (p) { return (Number(p) / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP" }); };
        var day = function (d) { return d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "–"; };
        var P = k.parts, right = pct(k.allRight, k.found);
        var part = function (label, t, more) {
          var all = t.right + t.wrong + t.missing;
          return row(label, all ? pct(t.right, all) + "%" : "–", all ? N(t.right) + " of " + N(all) + (t.wrong ? ", " + N(t.wrong) + " wrong" : "") + (t.missing ? ", " + N(t.missing) + " not read" : "") + (more || "") : "Nothing to check yet");
        };
        var it = P.items, items = it.right + it.none + it.missing + it.extra + it.quantity;
        var out = [
          el("div", { className: "rl-hp-mhead" }, [el("b", { text: "Read exactly right" }), el("span", { text: k.found ? right + "%" : "–" })]),
          el("div", { className: "rl-hp-meter", role: "img", ariaLabel: right + "% of orders found were read exactly right" }, [el("i", { style: "width:" + right + "%" })]),
          el("p", { className: "rl-hp-sub", text: how + " " + plural(k.found, "order was", "orders were") + " found, out of " + plural(k.withInbox, "order", "orders") + " in the last " + k.days + " days from shoppers with an inbox connected." }),
          el("div", { className: "rl-hp-rows" }, [
            row("Found in the shopper's inbox", N(k.found), k.found ? N(k.byNumber) + " by order number, the rest by shop and day" : null),
            row("Not found", N(k.notFound), "The email may be in an inbox they haven't connected, or the shop was read as another")]
            .concat(k.unsure ? [row("Not sure which receipt", N(k.unsure), "Two receipts from the shop that day, so left out")] : [])
            .concat(k.orders > k.withInbox ? [row("From shoppers without an inbox", N(k.orders - k.withInbox), "Nothing to look in")] : [])
            .concat([part("Shop name right", P.shop), part("Total right", P.total), part("Date right", P.date)])
            .concat(P.number.right + P.number.wrong + P.number.missing ? [part("Order number right", P.number)] : [])
            .concat([row("Items right", items ? pct(it.right, items) + "%" : "–", items ? N(it.right) + " of " + N(items) + [[it.none, "with none read"], [it.missing, "missing some"], [it.extra, "with extra lines"], [it.quantity, "with a wrong quantity"]]
              .filter(function (x) { return x[0]; }).map(function (x) { return ", " + N(x[0]) + " " + x[1]; }).join("") : "Nothing to check yet")])
            .concat((k.byReader || []).map(function (v) { return row("Reader version " + (v.version || "unknown"), N(v.allRight) + " of " + N(v.found), "Read exactly right"); })))];
        if (k.shops && k.shops.length) {
          var l = el("div", { className: "rl-hp-shops" });
          out.push(el("p", { className: "rl-hp-sub", text: "By shop, once 3 or more people's orders there were checked, most mistakes first:" }));
          k.shops.forEach(function (s) {
            var c = el("div", { className: "rl-hp-chips" });
            if (s.found - s.totalRight) c.appendChild(el("i", { text: plural(s.found - s.totalRight, "total wrong", "totals wrong") }));
            if (s.found - s.itemsRight) c.appendChild(el("i", { text: "Items wrong in " + plural(s.found - s.itemsRight, "order", "orders") }));
            if (s.found && s.allRight === s.found) c.appendChild(el("i", { className: "ok", text: "All read right" }));
            l.appendChild(el("div", { className: "rl-hp-shop" }, [el("b", { text: s.name }), el("span", { text: plural(s.orders, "order", "orders") + " from " + plural(s.people, "person", "people") + ", " + N(s.found) + " found" }), c]));
          });
          out.push(l);
        }
        // The admin's own orders, in detail: what Relay read beside what the shop says.
        var m = k.mine || { orders: 0, differences: [], notFound: [] };
        out.push(el("p", { className: "rl-hp-sub", text: !m.orders ? "None of your own orders are from a connected shop yet. Buy something from one with your sign-in email and Relay checks its email here." :
          !m.withInbox ? plural(m.orders, "of your orders is", "of your orders are") + " from connected shops. Connect your inbox to check them." :
          "Your own orders: " + N(m.found) + " of " + N(m.orders) + " found, " + N(m.allRight) + " read exactly right." }));
        var say1 = function (d) {
          if (d.part === "shop") return d.read ? "Shop read as " + d.read : "No shop name read";
          if (d.part === "total") return d.read == null ? "No total read (shop says " + money(d.shop) + ")" : "Total read as " + money(d.read) + ", shop says " + money(d.shop);
          if (d.part === "date") return d.read ? "Date read as " + day(d.read) + ", shop says " + day(d.shop) : "No date read";
          if (d.part === "number") return d.read ? "Order number read as " + d.read : "No order number read";
          if (d.verdict === "none") return "No items read (shop lists " + N(d.shop) + ")";
          if (d.verdict === "missing") return "Items missed: " + d.missing.join(", ");
          if (d.verdict === "extra") return "Extra lines read: " + d.extra.join(", ");
          return "An item's quantity read wrong";
        };
        var own = el("div", { className: "rl-hp-shops" });
        (m.differences || []).forEach(function (d) {
          var c = el("div", { className: "rl-hp-chips" });
          d.parts.forEach(function (x) { c.appendChild(el("i", { text: say1(x) })); });
          own.appendChild(el("div", { className: "rl-hp-shop" }, [el("b", { text: d.shop + (d.number ? " " + d.number : "") }), el("span", { text: day(d.day) + ", read by version " + (d.readerVersion || "unknown") }), c]));
        });
        (m.notFound || []).forEach(function (u) {
          own.appendChild(el("div", { className: "rl-hp-shop" }, [el("b", { text: u.shop + (u.number ? " " + u.number : "") }),
            el("span", { text: day(u.day) + (u.unsure ? ": two receipts from the shop that day, so not checked" : ": not found in your inbox") })]));
        });
        if (own.childNodes.length) out.push(own);
        return out;
      }
      function draw(h) {
        box.textContent = "";
        when.textContent = "Updated " + stamp(h.generatedAt);
        var rd = h.reading, pu = rd.purchases, wk = rd.purchasesThisWeek, ib = h.inboxes;
        var k = el("div", { className: "rl-hp-kpis" });
        [["Shoppers", N(h.people.shoppers), h.people.newThisWeek ? "+" + N(h.people.newThisWeek) + " this week" : "None new this week"],
          ["Inboxes connected", N(ib.gmail + ib.outlook), plural(ib.checkedToday, "checked today", "checked today")],
          ["Receipts this week", N(wk.receipts), "from " + plural(rd.emailsThisWeek, "email", "emails") + " read"],
          ["Read confidently", pu.receipts ? pct(pu.high, pu.receipts) + "%" : "–", "of " + plural(pu.receipts, "purchase", "purchases")]].forEach(function (x) {
          k.appendChild(el("div", { className: "rl-hp-kpi" }, [el("span", { text: x[0] }), el("b", { text: x[1] }), el("small", { text: x[2] })]));
        });
        box.appendChild(k);
        // How well emails are read.
        var conf = pct(pu.high, pu.receipts);
        var meter = el("div", { className: "rl-hp-meter", role: "img", ariaLabel: conf + "% of purchases read confidently" }, [el("i", { style: "width:" + conf + "%" })]);
        var older = (rd.byReader || []).filter(function (v) { return v.version && v.version < rd.readerVersion; }).reduce(function (n, v) { return n + v.emails; }, 0);
        var current = (rd.byReader || []).filter(function (v) { return v.version === rd.readerVersion; }).reduce(function (n, v) { return n + v.emails; }, 0);
        box.appendChild(group("Reading emails", [
          el("div", { className: "rl-hp-mhead" }, [el("b", { text: "Read confidently" }), el("span", { text: conf + "%" })]), meter,
          el("p", { className: "rl-hp-sub", text: "Relay asks the shopper to check the rest: " + N(pu.medium) + " with medium confidence, " + N(pu.low) + " with low." }),
          dayChart(rd.days || []),
          el("div", { className: "rl-hp-rows" }, [
            row("Emails looked at", N(rd.emailsLookedAt), N(rd.notReceipts) + " weren't receipts, so only that was kept"),
            row("Purchases found", N(pu.receipts)),
            row("Confirmed by shoppers", N(pu.confirmed), pu.receipts ? pct(pu.confirmed, pu.receipts) + "% of purchases" : null),
            row("Removed as not theirs", N(pu.dismissed), pu.receipts ? pct(pu.dismissed, pu.receipts) + "% of purchases" : null),
            row("Added by hand", N(pu.pasted), "Receipts Relay missed"),
            (function () {
              var fx = rd.fixedByShoppers || { receipts: 0 }, parts = [[fx.shop, "shop"], [fx.total, "total"], [fx.date, "date"], [fx.items, "items"]].filter(function (x) { return x[0]; });
              return row("Fixed by shoppers", N(fx.receipts), parts.length ? parts.map(function (x) { return x[1] + " " + N(x[0]); }).join(", ") : "Receipts shoppers corrected");
            })(),
            row("No total found", N(pu.noTotal)),
            row("No items found", N(pu.noItems)),
            row("Groups changed by shoppers", N(rd.shoppersTaught.groupsChanged), rd.shoppersTaught.shopsMarkedPromotions ? N(rd.shoppersTaught.shopsMarkedPromotions) + " shops marked as just promotions" : null),
            row("Waiting to be read again", N(rd.waitingToBeRead), "Emails the inbox couldn't give yet"),
            row("Reader version", String(rd.readerVersion), N(current) + " emails read by this version" + (older ? ", " + N(older) + " by older ones" : ""))])]));
        box.appendChild(group("Shops read wrong most often", h.shops.length ? [shopList(h.shops, true)]
          : [el("p", { className: "rl-hp-sub", text: "Shops appear here once " + h.minShoppersPerShop + " or more people have receipts from them. While you're testing, your own receipts are below." })]));
        var mine = h.mine || { shops: [] };
        box.appendChild(group("Your own receipts", [el("p", { className: "rl-hp-sub", text: plural(mine.receipts, "purchase", "purchases") + ", by shop, problems first" +
          (mine.personalMail ? ". " + plural(mine.personalMail, "receipt was", "receipts were") + " forwarded from a personal address" : "") + "." })].concat(mine.shops.length ? [shopList(mine.shops, false)] : [])));
        box.appendChild(group("Checked against shops' own records", answerKey(h.checkedByShops)));
        // AI help: who has it on, and where the AI and the rules agreed or differed (the rules get better from the differences).
        var ar = h.aiReader;
        if (ar) {
          var arRows = [row("AI help", ar.on ? "On" : "Off", ar.on ? null : "Comes on once the AI key is added in Cloudflare"),
            row("Shoppers with it on", N(ar.shoppersOn)), row("Emails read by the AI", N(ar.reads), N(ar.thisWeek) + " this week" + (ar.failed ? ", " + N(ar.failed) + " couldn't be read" : "") + (ar.notPurchase ? ", " + N(ar.notPurchase) + " not purchases" : ""))];
          [["total", "Totals"], ["items", "Items"], ["date", "Dates"], ["number", "Order numbers"], ["shop", "Shop names"]].forEach(function (x) {
            var p = ar.parts && ar.parts[x[0]]; if (!p || !(p.filled + p.agreed + p.differed)) return;
            arRows.push(row(x[1], N(p.filled) + " filled in", N(p.agreed) + " agreed with the rules, " + N(p.differed) + " differed"));
          });
          box.appendChild(group("AI help", [el("div", { className: "rl-hp-rows" }, arRows)]));
        }
        // Emails shoppers sent because they were read wrong: how many are waiting, and the way to read them.
        var se = h.sharedEmails;
        if (se) box.appendChild(group("Emails shoppers sent", [el("div", { className: "rl-hp-rows" }, [
          row("Waiting to be read", N(se.waiting)), row("Kept", N(se.kept), "Each is deleted " + se.keptDays + " days after it was sent"),
          row("Sent this week", N(se.thisWeek), se.people ? "From " + plural(se.people, "person", "people") + " in all" : null)]),
          el("button", { type: "button", className: "rl-po-secondary rl-hp-mail", text: "Read them", onclick: function () { page("Emails shoppers sent", sharedPage); } })]));
        // Checking inboxes.
        var sc = ib.scansThisWeek || {}, errs = {};
        (ib.scanErrorsThisWeek || []).forEach(function (e) { var t = SCAN_ERR[e.error] || "Other problems"; errs[t] = (errs[t] || 0) + e.count; });
        box.appendChild(group("Checking inboxes", [el("div", { className: "rl-hp-rows" }, [
          row("Gmail", N(ib.gmail)), row("Outlook", N(ib.outlook)), row("People with an inbox", N(ib.shoppers)),
          row("Checked in the last day", N(ib.checkedToday)), row("Not checked in the last day", N(ib.notCheckedToday)),
          row("Last check", stamp(ib.lastChecked)), row("Connected this week", N(ib.newThisWeek)),
          row("Scans this week", N((sc.done || 0) + (sc.failed || 0) + (sc.running || 0)), N(sc.done || 0) + " finished, " + N(sc.running || 0) + " still going, " + N(sc.failed || 0) + " stopped")]
          .concat(Object.keys(errs).map(function (t) { return row(t, N(errs[t]), "This week"); })))]));
        // Returns, swaps and the rest.
        var rs = h.returnsAndSwaps, statusRows = function (o, what) { var ks = Object.keys(o || {}); return ks.length ? ks.map(function (s) { return row(what + ": " + words(s).toLowerCase(), N(o[s])); }) : [row(what, "0")]; };
        var paid = (rs.payments || []).reduce(function (a, p) { a[p.test ? "test" : "live"] += p.count; return a; }, { test: 0, live: 0 });
        box.appendChild(group("Returns and swaps", [el("div", { className: "rl-hp-rows" }, statusRows(rs.returns, "Returns").concat(statusRows(rs.swaps, "Swaps"))
          .concat([row("Return labels made", N(rs.labels)), row("Swap payments", N(paid.test + paid.live), N(paid.live) + " live, " + N(paid.test) + " test")]))]));
        var ex = h.extras, sh = h.shopsConnected;
        box.appendChild(group("Everything else", [el("div", { className: "rl-hp-rows" }, [
          row("Gifts tagged", N(ex.gifts), ex.giftGivers ? "by " + plural(ex.giftGivers, "person", "people") : null),
          row("Earlier years read for Wrapped", N(ex.earlierYearsRead)),
          row("Phones with notifications on", N(ex.notificationDevices), ex.notificationPeople ? plural(ex.notificationPeople, "person", "people") : null),
          row("Price watches", N(ex.priceWatches), ex.watchers ? plural(ex.watchers, "person", "people") : null),
          row("Shops on Shopify", N(sh.shopify), sh.shopifyTest ? N(sh.shopifyTest) + " of them test shops" : null),
          row("Shops on Square", N(sh.square)),
          row("Wrong sign-in codes in the last day", N(h.security.wrongCodesToday))].concat(h.helpChat ? [
          row("Help chat", h.helpChat.on ? "On" : "Off", h.helpChat.on ? null : "Comes on once the AI key is added in Cloudflare"),
          row("Help chat messages this week", N(h.helpChat.messagesThisWeek), plural(h.helpChat.peopleThisWeek, "person", "people") + ", " + N(h.helpChat.handoffsThisWeek) + " asked for a person")] : []))]));
      }
      // Refresh always asks Relay again (an ordinary read can reuse one from the last minute).
      function load(fresh) {
        if (again.disabled) return;
        again.disabled = true; say(note, "");
        api("/relay/my/admin/health", fresh ? { fresh: true } : undefined).then(function (r) {
          again.disabled = false;
          if (!b.isConnected) return;
          if (!r.ok || !r.body || !r.body.reading) { if (!memo.health) box.textContent = ""; return say(note, "Couldn't load the numbers. Try again in a moment.", true); }
          memo.health = r.body; draw(r.body);
        }).catch(function () { again.disabled = false; if (!memo.health) box.textContent = ""; say(note, "Couldn't reach Relay. Check your connection and try again.", true); });
      }
      // By email: the morning summary and alerts (worker/health-digest.js), and one now, to see what it looks like. Built once,
      // beside the numbers, so a refresh redrawing them never wipes its message.
      var sent = el("p", { className: "rl-msg" }), mail = el("button", { type: "button", className: "rl-po-secondary rl-hp-mail", text: "Email me one now" });
      mail.onclick = function () {
        if (mail.disabled) return;
        mail.disabled = true; say(sent, "");
        api("/relay/my/admin/health/email", { method: "POST", body: {} }).then(function (r) {
          mail.disabled = false;
          if (r.ok) return say(sent, "Sent to " + ((r.body && r.body.to) || "you") + ". It can take a minute to arrive.");
          say(sent, r.status === 429 ? "One was sent a moment ago. Try again in a few minutes." : r.status === 503 ? "Email isn't set up on the server yet." : "Couldn't send it. Try again in a moment.", true);
        }, function () { mail.disabled = false; say(sent, "Couldn't reach Relay. Check your connection and try again.", true); });
      };
      b.appendChild(group("By email", [el("p", { className: "rl-hp-sub", text: "Each morning from 8am, Relay's admins get a summary of these numbers by email, and an alert when something breaks, such as most inbox checks stopping." }), mail, sent]));
      again.onclick = function () { load(true); };
      if (memo.health) draw(memo.health); else skeleton();
      load(false);
    }
    // Emails shoppers chose to send to Relay because they were read wrong (worker/shared-emails.js), newest first. Each opens
    // to what Relay read beside the email itself, personal details already hidden. Opening one is recorded on Relay's side,
    // and who sent it is never shown. Each is deleted after 30 days, or here.
    function sharedPage(b) {
      var note = el("div", { className: "rl-msg" }), list = el("div", { className: "rl-se" });
      b.appendChild(el("p", { className: "rl-hp-lead", text: "Emails shoppers chose to send because Relay read them wrong, with their personal details hidden. You never see who sent one, and each time one is opened it's recorded. Each is deleted 30 days after it was sent." }));
      b.appendChild(note); b.appendChild(list);
      var day = function (iso) { return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "–"; };
      var dayOf = function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null; };
      var cash = function (p, cur) { return Number.isInteger(p) ? (p / 100).toLocaleString("en-GB", { style: "currency", currency: cur || "GBP" }) : null; };
      var row = function (label, value, sub) { return el("div", { className: "rl-hp-row" }, [el("span", {}, [el("span", { text: label })].concat(sub ? [el("small", { text: sub })] : [])), el("b", { text: value })]); };
      var itemsText = function (items) { return (items || []).map(function (i) { return (i.qty > 1 ? i.qty + " × " : "") + i.name + (Number.isInteger(i.pricePence) ? " " + cash(i.pricePence) : ""); }).join("; "); };
      // What Relay read, and what the shopper says it should be (from "Fix this receipt") where they changed it.
      function compare(rd, fx) {
        rd = rd || {}; fx = fx || {};
        var says = function (k, show) { return fx[k] !== undefined && fx[k] !== null ? "Shopper says: " + show(fx[k]) : null; };
        return el("div", { className: "rl-hp-rows" }, [
          row("Shop", rd.shop || "Not read", says("shop", String)),
          row("Total", cash(rd.totalPence, rd.currency) || "Not found", says("totalPence", function (v) { return cash(v, rd.currency); })),
          row("Date", dayOf(rd.orderDate) || "Not read", says("orderDate", dayOf)),
          row("Order number", rd.orderRef || "Not read"),
          row("Items", String((rd.items || []).length), [itemsText(rd.items), says("items", itemsText)].filter(Boolean).join(". ") || null)]);
      }
      function empty() { list.textContent = ""; list.appendChild(el("p", { className: "rl-hp-sub", text: "No emails yet. When a shopper sends one from a receipt Relay read wrong, it shows here for 30 days." })); }
      function item(e) {
        var card = el("div", { className: "rl-acard rl-se-card" });
        card.appendChild(el("b", { text: e.shop || e.domain || "Shop not read" }));
        card.appendChild(el("span", { text: "Sent " + day(e.sentAt) + ", deleted on " + day(e.deletedBy) + ". Read by version " + (e.reader || "unknown") + (e.lookedAt ? ". Opened before" : "") + "." }));
        if (e.note) card.appendChild(el("p", { className: "rl-se-note", text: "“" + e.note + "”" }));
        var fx = e.fixed || {}, fixedParts = [["shop", "shop"], ["totalPence", "total"], ["orderDate", "date"], ["items", "items"]].filter(function (k) { return fx[k[0]] !== undefined; }).map(function (k) { return k[1]; });
        var chips = el("div", { className: "rl-hp-chips" }, [el("i", { text: fixedParts.length ? "Shopper fixed the " + fixedParts.join(", ") : "Not fixed by the shopper" })]);
        if (e.read && e.read.confidence) chips.appendChild(el("i", { text: "Read with " + e.read.confidence + " confidence" }));
        card.appendChild(chips);
        var body = el("div", { className: "rl-se-body" }); body.hidden = true;
        var open = el("button", { type: "button", className: "rl-pill", text: "Read it" }), drop = el("button", { type: "button", className: "rl-pill", text: "Delete" });
        open.setAttribute("aria-expanded", "false");
        open.onclick = function () {
          if (!body.hidden) { body.hidden = true; open.textContent = "Read it"; open.setAttribute("aria-expanded", "false"); return; }
          if (open.disabled) return;
          open.disabled = true; body.hidden = false; body.textContent = "";
          body.appendChild(el("div", { className: "rl-skel", style: "min-height:160px;border-radius:12px" }));
          api("/relay/my/admin/shared-emails/" + e.id, { fresh: true }).then(function (r) {
            open.disabled = false; body.textContent = "";
            if (!r.ok) return body.appendChild(el("p", { className: "rl-msg err", text: r.status === 404 ? "This email has been deleted." : "Couldn't open it. Try again in a moment." }));
            var v = r.body || {};
            e.lookedAt = v.lookedAt;
            body.appendChild(compare(v.read, v.fixed));
            var box = el("div", { className: "rl-share-box", tabIndex: 0 }, [el("b", { text: v.subject || "(No subject)" }), el("span", { className: "rl-share-from", text: "From " + (v.from || "an unknown sender") }), document.createTextNode(v.text || "")]);
            box.setAttribute("role", "region"); box.setAttribute("aria-label", "The email");
            if (v.cut) box.appendChild(el("i", { text: "The rest of this long email was left out." }));
            body.appendChild(box);
            open.textContent = "Close"; open.setAttribute("aria-expanded", "true");
          }, function () { open.disabled = false; body.textContent = ""; body.appendChild(el("p", { className: "rl-msg err", text: "Couldn't reach Relay. Check your connection and try again." })); });
        };
        drop.onclick = function () {
          ask("Delete this email now? It can't be brought back.", "Delete it", function () {
            if (drop.disabled) return;
            drop.disabled = true;
            api("/relay/my/admin/shared-emails/" + e.id, { method: "POST", body: { delete: true } }).then(function (r) {
              drop.disabled = false;
              if (!r.ok && r.status !== 404) return say(note, "Couldn't delete it. Try again in a moment.", true);
              card.remove(); say(note, "Deleted.");
              if (memo.sharedEmails) memo.sharedEmails = memo.sharedEmails.filter(function (x) { return x.id !== e.id; });
              if (!list.childNodes.length) empty();
            }, function () { drop.disabled = false; say(note, "Couldn't reach Relay. Check your connection and try again.", true); });
          });
        };
        card.appendChild(el("div", { className: "rl-se-acts" }, [open, drop]));
        card.appendChild(body);
        return card;
      }
      function draw(emails) { list.textContent = ""; if (!emails.length) return empty(); emails.forEach(function (e) { list.appendChild(item(e)); }); }
      if (memo.sharedEmails) draw(memo.sharedEmails);
      else for (var i = 0; i < 3; i++) list.appendChild(el("div", { className: "rl-skel", style: "min-height:110px;border-radius:18px;margin:0 0 12px" }));
      api("/relay/my/admin/shared-emails", { fresh: true }).then(function (r) {
        if (!b.isConnected) return;
        if (!r.ok || !r.body || !Array.isArray(r.body.emails)) { if (!memo.sharedEmails) list.textContent = ""; return say(note, "Couldn't load the emails. Try again in a moment.", true); }
        var sig = JSON.stringify(r.body.emails), was = memo.sharedEmails && JSON.stringify(memo.sharedEmails);
        memo.sharedEmails = r.body.emails;
        if (sig !== was) draw(r.body.emails);
      }, function () { if (!memo.sharedEmails) list.textContent = ""; say(note, "Couldn't reach Relay. Check your connection and try again.", true); });
    }
    function permissionPage(b) {
      var note = el("div", { className: "rl-msg" });
      b.appendChild(el("p", { text: "This is what you agreed to when you connected your email." }));
      ((c && c.text) || CONSENT_FALLBACK).forEach(function (t) { b.appendChild(el("p", { className: "rl-aterm", text: t })); });
      var w = el("button", { className: "rl-btn ghost rl-red", text: "Withdraw my permission" });
      w.onclick = function () {
        ask("Withdraw permission? Relay will disconnect your email and delete everything it captured. You'll be asked again next time you open your account.", "Withdraw permission", function () {
          w.disabled = true;
          api("/relay/my/consent/withdraw", { method: "POST" }).then(function (x) { if (x.ok) { memoReset(); gate(sheet, email); } else { w.disabled = false; say(note, "Couldn't withdraw. Try again.", true); } })
            .catch(function () { w.disabled = false; say(note, "Couldn't reach Relay. Check your connection.", true); });
        });
      };
      b.appendChild(w); b.appendChild(note);
    }
    // A copy of everything Relay keeps about the shopper, as one file (their right to a copy of their data).
    function exportPage(b) {
      var note = el("div", { className: "rl-msg" });
      b.appendChild(el("p", { text: "Get a copy of everything Relay keeps about you: your account, the receipts it found, your alerts, returns, swaps and settings. It comes as one file you can open in any text editor, or take to another service." }));
      b.appendChild(el("p", { className: "rl-anote", text: "The emails themselves stay in your inbox. The keys to your inbox, sign-in codes and card numbers are never in the file." }));
      var d = el("button", { className: "rl-btn", text: "Download my data" });
      d.onclick = function () {
        if (d.disabled) return;
        d.disabled = true; d.textContent = "Preparing your file…"; say(note, "");
        api("/relay/my/export").then(function (r) {
          if (!r.ok || !r.body) { say(note, "Couldn't prepare your file. Try again in a moment.", true); return; }
          var url = URL.createObjectURL(new Blob([JSON.stringify(r.body, null, 2)], { type: "application/json" }));
          var a = el("a", { href: url }); a.setAttribute("download", "relay-my-data-" + new Date().toISOString().slice(0, 10) + ".json");
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
          say(note, "Your file is downloading. Keep it somewhere safe: it has your receipts in it.");
        }).catch(function () { say(note, "Couldn't reach Relay. Check your connection.", true); })
          .finally(function () { d.disabled = false; d.textContent = "Download my data"; });
      };
      b.appendChild(d); b.appendChild(note);
    }
    function deletePage(b) {
      var note = el("div", { className: "rl-msg" });
      b.appendChild(el("p", { text: "This removes your sign-in, your email connection, every receipt Relay captured, your profile, price alerts, passkeys, two-step sign-in, any saved card, and your swap and sell listings and messages. If you connected Gmail, Relay also cancels its access at Google. If you connected Outlook, Relay deletes its access, and you can also remove Relay from your Microsoft account's app permissions." }));
      b.appendChild(el("p", { text: "Records of returns and swaps you made through Relay are kept, because the shops involved rely on them. Deleting can't be undone." }));
      var d = el("button", { className: "rl-btn rl-danger", text: "Delete my account" });
      d.onclick = function () {
        ask("Delete your Relay account and everything linked to it? This can't be undone.", "Delete my account", function () {
          d.disabled = true;
          api("/relay/my/delete", { method: "POST" }).then(function (r) { if (r.ok) { memoReset(); save(null); close(); if (window.go && window.page === "me") window.go("profile"); } else { d.disabled = false; say(note, "Couldn't delete your account. Try again.", true); } })
            .catch(function () { d.disabled = false; say(note, "Couldn't reach Relay. Check your connection.", true); });
        });
      };
      b.appendChild(d); b.appendChild(note);
    }
    // ---- The help chat (worker/support-chat.js): Relay's AI assistant, and "Talk to a person", which emails the chat to
    // Relay's team. The conversation lives only on this screen (and this session): Relay keeps no copy. With the
    // assistant off, it's a message to Relay's team. ----
    function chatPage(b) {
      var hc = memo.helpChat || {}, ai = Boolean(hc.available), log = memo.chatLog || (memo.chatLog = []);
      var list = el("div", { className: "rl-chat", role: "log" });
      list.setAttribute("aria-live", "polite");
      var note = el("p", { className: "rl-msg" });
      var box = el("textarea", { className: "rl-chat-in", rows: 1, maxLength: 1000, placeholder: ai ? "Ask about Relay" : "Write your question", value: draftGet("help-chat") });
      box.setAttribute("aria-label", ai ? "Your question for Relay's assistant" : "Your message to Relay's team");
      var send = el("button", { type: "button", className: "rl-chat-send", ariaLabel: ai ? "Send" : "Send to Relay's team" }, [jIc("send", 22)]);
      var person = el("button", { type: "button", className: "rl-btn ghost rl-chat-person", text: "Talk to a person" });
      var busy = false;
      function bubble(t) {
        var who = t.role === "user" ? "me" : t.role === "note" ? "note" : "bot";
        var n = el("div", { className: "rl-chat-b " + who }, [el("p", { text: t.text })]);
        // Said once, over its first message: who's answering, and that it's an AI.
        if (who === "bot" && t.first) n.insertBefore(el("span", { className: "rl-chat-who", text: "Relay's assistant (AI)" }), n.firstChild);
        return n;
      }
      function draw() {
        list.textContent = "";
        list.appendChild(bubble({ role: "bot", first: true, text: ai ? "Hi, I'm Relay's assistant. I'm an AI, so I can get things wrong. Ask me anything about using Relay, or tap Talk to a person."
          : "Write your question and tap send. Relay's team will reply by email to " + (load() || {}).email + "." }));
        if (ai && !log.length) {
          var chips = el("div", { className: "rl-chat-chips" });
          ["How does Relay find my receipts?", "A receipt is missing", "How do I mark a gift?"].forEach(function (q) {
            chips.appendChild(el("button", { type: "button", text: q, onclick: function () { box.value = q; sendQuestion(); } }));
          });
          list.appendChild(chips);
        }
        log.forEach(function (t) { list.appendChild(bubble(t)); });
      }
      function turns(extra) {
        var out = log.filter(function (t) { return t.role === "user" || t.role === "assistant"; }).map(function (t) { return { role: t.role, text: t.text }; });
        if (extra) out.push({ role: "user", text: extra });
        return out.slice(-24);
      }
      function lock(yes) { busy = yes; send.disabled = yes; person.disabled = yes; }
      function sendQuestion() {
        var q = box.value.replace(/\s+$/, "").trim();
        if (busy || !q) return;
        if (!ai) return handoff();
        say(note, "");
        log.push({ role: "user", text: q }); box.value = ""; draftSet("help-chat", ""); fit();
        draw();
        var typing = el("div", { className: "rl-chat-b bot rl-chat-typing" }, [el("span", { className: "rl-skel" }), el("span", { className: "rl-skel" })]);
        typing.setAttribute("aria-label", "Relay's assistant is writing");
        list.appendChild(typing); scrollEnd();
        lock(true);
        api("/relay/my/help/chat", { method: "POST", body: { messages: turns() } }).then(function (r) {
          lock(false); typing.remove();
          if (r.ok && r.body && r.body.reply) { log.push({ role: "assistant", text: r.body.reply }); draw(); scrollEnd(); return; }
          log.pop(); box.value = q; fit(); draw();
          var e = r.body && r.body.error;
          say(note, e === "chat_off" ? "The assistant is off right now. Tap Talk to a person and Relay's team will email you."
            : r.status === 429 ? "That's a lot of messages for one day. Tap Talk to a person, or try again tomorrow."
            : "The assistant couldn't answer just now. Try again in a moment, or tap Talk to a person.", true);
        }, function () { lock(false); typing.remove(); log.pop(); box.value = q; fit(); draw(); say(note, "Couldn't reach Relay. Check your connection and try again.", true); });
      }
      function handoff() {
        var extra = box.value.trim(), msgs = turns(extra || null), email = (load() || {}).email;
        if (!msgs.some(function (t) { return t.role === "user"; })) { say(note, "Write your question first, then send it.", true); box.focus(); return; }
        ask("Send this to Relay's team? They'll reply by email to " + email + ".", "Send", function () {
          lock(true); say(note, "");
          api("/relay/my/help/handoff", { method: "POST", body: { messages: msgs } }).then(function (r) {
            lock(false);
            if (!r.ok) return say(note, r.status === 429 ? "You've already sent a few today. Relay's team will reply by email." : "Couldn't send that. Try again in a moment.", true);
            if (extra) { log.push({ role: "user", text: extra }); box.value = ""; draftSet("help-chat", ""); fit(); }
            log.push({ role: "note", text: "Sent to Relay's team. They'll reply by email to " + email + "." });
            draw(); scrollEnd();
          }, function () { lock(false); say(note, "Couldn't reach Relay. Check your connection and try again.", true); });
        });
      }
      function fit() { box.style.height = "auto"; box.style.height = Math.min(140, Math.max(48, box.scrollHeight)) + "px"; }
      function scrollEnd() { try { send.scrollIntoView({ block: "end", behavior: "smooth" }); } catch (e) {} }
      box.addEventListener("input", function () { draftSet("help-chat", box.value); fit(); });
      box.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendQuestion(); } });
      send.onclick = sendQuestion;
      person.onclick = handoff;
      // A problem is said just above the box, so it's never hidden behind the tab bar.
      b.appendChild(list);
      b.appendChild(note);
      b.appendChild(el("div", { className: "rl-chat-bar" }, [box, send]));
      if (ai) b.appendChild(person);
      b.appendChild(el("p", { className: "rl-anote", text: ai ? "Relay keeps no copy of this chat. Your messages go to Anthropic, the AI company that answers them, without your receipts or email address. Talk to a person emails the chat to Relay's team."
        : "Relay's team will see your message and your email address, so they can reply." }));
      draw(); setTimeout(fit, 0);
    }
    function helpPage(b) {
      HELP.forEach(function (q) {
        b.appendChild(el("details", { className: "rl-faq" }, [el("summary", { text: q[0] }), el("p", { text: q[1] })]));
      });
      b.appendChild(el("p", { className: "rl-anote", text: "Read the full terms and privacy policy under Help & legal." }));
    }
  }
  function show() {
    var s = load();
    if (!s || !s.token) return open(signedOutView);
    open(function (sheet) { gate(sheet, s.email || ""); });
  }
  // The Profile tab: everything that was in the account menu, on a page, with Wrapped at the top.
  function mountMe(host) {
    if (!host) return;
    host.textContent = "";
    var s = load();
    if (!s || !s.token) {
      host.appendChild(el("div", { className: "rl-po" }, [el("h3", { text: "Sign in to see your profile", style: "margin:0" }),
        el("p", { text: "Your account, email connection, privacy settings and your year's Wrapped live here.", style: "margin:0;color:var(--rl-text2);font-size:15px;line-height:1.45" }),
        el("button", { className: "rl-po-primary", text: "Sign in", style: "max-width:220px", onclick: show })]));
      return;
    }
    host.classList.add("rl-inpage");
    gate(host, s.email || "");
  }
  // The avatar opens the Profile tab once signed in (and the sign-in sheet before).
  function avatarTap() { var s = load(); if (s && s.token && window.go) window.go("me"); else show(); }
  function bind() {
    var a = document.querySelector(".avatar");
    if (!a) return;
    a.style.cursor = "pointer"; a.setAttribute("role", "button"); a.setAttribute("tabindex", "0");
    a.setAttribute("aria-label", "Account");
    a.addEventListener("click", avatarTap);
    a.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); avatarTap(); } });
    paintAvatars(); loadProfile();
  }
  function completeLinkSignIn() {
    var m = /(?:^|[#&])signin=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash || "");
    if (!m) return;
    signInExtra = {};
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    open(function (sheet) {
      sheet.classList.add("rl-full", "rl-jr");
      jFrame(sheet, { noClose: true, title: "Signing you in…", sub: "Just a moment." });
      sheet.appendChild(el("div", { className: "rl-skel", style: "min-height:160px;border-radius:18px" }));
    });
    var gn = ""; try { gn = localStorage.getItem("relay_gnonce") || ""; localStorage.removeItem("relay_gnonce"); } catch (e) {}
    api("/relay/auth/verify", { method: "POST", body: gn ? { token: m[1], nonce: gn } : { token: m[1] } }).then(function (r) {
      if (!r.ok) return open(function (sheet) { sheet.appendChild(el("h2", { text: "Sign-in failed" }));
        sheet.appendChild(el("p", { text: errors[r.body.error] || "Something went wrong." }));
        sheet.appendChild(el("button", { className: "rl-btn", text: "Try again", onclick: show })); });
      // Signed in (and, through Google or Microsoft, the inbox connected and its first scan started): on to what's still needed.
      if (r.body.needsSecondStep) { signInExtra = { mailConnected: r.body.mailConnected, outlookConnected: r.body.outlookConnected, suggestedName: r.body.suggestedName }; return open(function (sheet) { secondStepView(sheet, r.body); }); }
      signedIn(r.body);
    }).catch(function () { open(function (sheet) { sheet.appendChild(el("h2", { text: "Couldn't reach Relay" })); sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Close", onclick: close })); }); });
  }
  // What to say when Google or Microsoft sends the shopper back after "Connect Gmail" / "Connect Outlook".
  function mailNote(result, name) {
    var notes = { connected: [name + " connected. Scanning for receipts…", false], denied: ["You chose not to connect " + name + ". Relay needs a way to see your receipts, so you can try again or paste one.", true],
      failed: ["Couldn't connect " + name + ". Please try again.", true], consent_needed: ["Please agree to the permission step first, then connect " + name + ".", true], not_configured: [name + " connection isn't switched on yet.", true],
      added: [name + " inbox added. Relay is reading it now, and its receipts appear here in a few minutes.", false], already_connected: ["That inbox is already connected to Relay.", false] };
    // Adding another inbox that didn't go ahead: the inboxes already connected carry on as they were.
    var adding = false; try { adding = sessionStorage.getItem("relay.addingInbox") === "1"; sessionStorage.removeItem("relay.addingInbox"); } catch (e) {}
    if (adding && result === "denied") return { text: "No inbox was added. Your other inboxes carry on as before.", bad: false };
    if (adding && result === "failed") return { text: "Couldn't add that inbox. Please try again.", bad: true };
    return { text: notes[result][0], bad: notes[result][1] };
  }
  function completeGmail() {
    var m = /(?:^|[#&])(gmail|outlook)=(connected|added|already_connected|denied|failed|consent_needed|not_configured)(?:&|$)/.exec(location.hash || "");
    if (!m) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    var s = load(); if (!s || !s.token) return open(signedOutView);
    memo.gmail = null; memo.receipts = null;
    if (m[2] === "connected") rememberMailbox({ connected: true, provider: m[1] === "outlook" ? "microsoft" : "google" });
    var note = mailNote(m[2], m[1] === "outlook" ? "Outlook" : "Gmail");
    if (obGet(s.email).back) { obSet(s.email, { back: null }); return startJourney(m[2] === "connected" ? { justConnected: true } : { mailNote: note }); }
    window.__relayAutoScan = m[2] === "connected";
    if (window.go) { window.__relayReceiptsNote = note; window.go("receipts"); return; }
    open(function (sheet) { gate(sheet, s.email || "", note); });
  }
  function completeGoogleNote() {
    var m = /(?:^|[#&])(gsignin|msignin)=(denied|failed|other_address)(?:&|$)/.exec(location.hash || "");
    if (!m) return;
    try { history.replaceState(null, "", location.pathname + location.search); localStorage.removeItem("relay_gnonce"); } catch (e) {}
    var who = m[1] === "msignin" ? "Microsoft" : "Google";
    open(function (sheet) {
      sheet.appendChild(el("h2", { text: m[2] === "denied" ? who + " sign-in cancelled" : who + " sign-in didn't work" }));
      sheet.appendChild(el("p", { text: m[2] === "denied" ? "No problem. You can try again or use an email link instead."
        : m[2] === "other_address" ? "Microsoft sign-in works with Outlook, Hotmail and Live addresses. For any other address, use the email link or code instead."
        : "Please try again, or use an email link instead." }));
      sheet.appendChild(el("button", { className: "rl-btn", text: "Back to sign in", onclick: show }));
    });
  }
  // The Receipts page: the same Gmail/receipt tools as before, on a page of their own. Detail screens open over it and Back returns to it.
  function mountReceipts(host, notice) {
    host.textContent = "";
    var s = load();
    var msg = el("div", { className: "rl-msg" });
    if (!s || !s.token) {
      host.appendChild(el("p", { text: "Sign in to bring your receipts in from your email. Relay only reads order confirmations, receipts and return emails." }));
      host.appendChild(el("button", { className: "rl-btn", text: "Sign in", style: "max-width:260px", onclick: show }));
      return;
    }
    pageLaunchers = function () {
      openFind = function () { open(function (sh) { addReceiptView(sh, function () { close(); mountReceipts(host); }); }); };
      openOriginal = function (id) { open(function (sh) { originalView(sh, id, close); }); };
      openResale = function (rid) { open(function (sh) { resaleView(sh, close, rid); }); };
    };
    pageLaunchers();
    // The reviewer account reads no inbox: say where its orders are instead.
    if (isReview()) {
      host.appendChild(el("div", { className: "rl-empty" }, [el("h3", { text: "Your orders are on Home" }),
        el("p", { text: "This account is for reviewing Relay, so it doesn't read an inbox. Orders you place at shops that use Relay, with " + (s.email || "its email") + ", show up on Home." }),
        el("button", { className: "rl-po-primary", text: "Go to Home", style: "max-width:220px", onclick: function () { if (window.go) window.go("profile"); } })]));
      return;
    }
    if (memo.receipts) { var sk0 = el("div", { className: "rl-cats" }); for (var k0 = 0; k0 < 4; k0++) sk0.appendChild(el("div", { className: "rl-po rl-skel", style: "min-height:150px;margin:0" })); host.appendChild(sk0); }
    else host.appendChild(el("div", { className: "rl-skel", style: "min-height:150px;border-radius:22px" }));
    cachedGet("consent", "/relay/my/consent").then(function (r) {
      host.textContent = "";
      if (r.status === 401) { save(null); mountReceipts(host); return; }
      if (!r.ok) { host.appendChild(el("p", { text: "Couldn't reach Relay." })); return; }
      if (!r.body.accepted) {
        host.appendChild(el("p", { text: r.body.acceptedEarlier ? "Relay's permission wording changed: it now works with Outlook as well as Gmail. Agree again to keep your receipts updating."
          : "Relay needs your OK before it looks at your receipts. It takes a moment." }));
        host.appendChild(el("button", { className: "rl-btn", text: "Review and agree", style: "max-width:260px", onclick: show }));
        return;
      }
      var box = el("div");
      host.appendChild(box); host.appendChild(msg);
      if (notice) say(msg, notice.text, notice.bad);
      gmailSection(box, r.body, msg, true);
    }).catch(function () { host.textContent = ""; host.appendChild(el("p", { text: "Couldn't reach Relay." })); });
  }
  // The Market page: swap and resell with other members, on a page of its own.
  function mountMarket(host) {
    host.textContent = "";
    var s = load();
    if (!s || !s.token) {
      host.appendChild(el("p", { text: "Sign in to see what other Relay members are swapping and selling, or to list something of your own." }));
      host.appendChild(el("button", { className: "rl-btn", text: "Sign in", style: "max-width:260px", onclick: show }));
      return;
    }
    host.appendChild(el("div", { className: "rl-skel rl-mk-skel" }));
    cachedGet("consent", "/relay/my/consent").then(function (r) {
      host.textContent = "";
      if (r.status === 401) { save(null); mountMarket(host); return; }
      if (!r.ok) { host.appendChild(el("p", { text: "Couldn't reach Relay." })); return; }
      if (!r.body.accepted) {
        host.appendChild(el("p", { text: "Relay needs your OK before it can list anything from your receipts. It takes a moment." }));
        host.appendChild(el("button", { className: "rl-btn", text: "Review and agree", style: "max-width:260px", onclick: show }));
        return;
      }
      resaleView(host, null, null, "browse");
    }).catch(function () { host.textContent = ""; host.appendChild(el("p", { text: "Couldn't reach Relay." })); });
  }

  // ---- Wrapped: a year of purchases, built only from the shopper's own captured receipts ----
  function memoDrop(prefix) { Object.keys(memo).forEach(function (k) { if (k.indexOf(prefix) === 0) delete memo[k]; }); }
  // Wrapped is one story a year: the year's total, how it split, then a chapter for each kind of shopping. It lives on the
  // Profile page as a card: this year's (and earlier years' that have receipts), with Play.
  function mountWrapped(host, year) {
    host.textContent = "";
    var s = load();
    if (!s || !s.token) return;
    var thisYear = new Date().getFullYear();
    year = year || thisYear;
    var card = el("div", { className: "rl-wr-cover" }, [el("div", { className: "rl-wr-kicker", text: "RELAY WRAPPED " + year }), el("div", { className: "rl-skel", style: "height:44px;border-radius:12px;margin:10px 0;opacity:.25" })]);
    var yrs = el("div", { className: "rl-wr-years" }), extra = el("div");
    host.appendChild(card); host.appendChild(yrs); host.appendChild(extra);
    // Building Wrapped is heavy work for the server, so one failed try is retried once before showing an error.
    var getW = function () { return cachedGet("wrapped" + year, "/relay/my/wrapped?year=" + year); };
    getW().catch(function () { return { ok: false }; }).then(function (r) { return r.ok || r.status === 401 ? r : new Promise(function (ok) { setTimeout(ok, 1200); }).then(getW); }).then(function (r) {
      if (!document.body.contains(host)) return;
      if (r.status === 401) { save(null); return; }
      card.textContent = "";
      card.appendChild(el("div", { className: "rl-wr-kicker", text: "RELAY WRAPPED " + year }));
      if (!r.ok) { card.appendChild(el("p", { text: "Couldn't build your Wrapped just now. Try again in a moment." })); return; }
      var w = r.body;
      // One chip per year that has receipts (newest first). Each year is its own story.
      var list = (w.years || []).filter(function (y) { return y.receipts > 0; }).map(function (y) { return y.year; });
      if (list.indexOf(year) < 0) list.push(year);
      if (list.length > 1) list.sort(function (a, b) { return b - a; }).forEach(function (y) {
        yrs.appendChild(el("button", { type: "button", text: String(y), ariaPressed: y === year ? "true" : "false", className: y === year ? "on" : "", onclick: function () { if (y !== year) mountWrapped(host, y); } }));
      });
      if (!w.receipts) {
        card.appendChild(el("h2", { text: "Nothing to wrap for " + year + " yet." }));
        card.appendChild(el("p", { text: year < thisYear ? "Relay hasn't read your " + year + " emails. Add earlier years below." : "Once Relay has found your receipts, your year's story appears here." }));
      } else {
        card.appendChild(el("h2", { text: "Your " + year + " in purchases." }));
        card.appendChild(el("p", { text: (w.coverage.withTotal ? money(w.spentPence, "GBP") + " · " : "") + w.receipts + (w.receipts === 1 ? " receipt" : " receipts") + ((w.chapters || []).length ? " · " + w.chapters.length + (w.chapters.length === 1 ? " chapter" : " chapters") : "") +
          (w.gifts && w.gifts.count ? " · " + w.gifts.count + (w.gifts.count === 1 ? " gift" : " gifts") : "") }));
        var dots = el("div", { className: "rl-wr-dots" });
        var tot = (w.industries || []).reduce(function (n, k) { return n + (k.spentPence || 0); }, 0);
        if (tot) (w.industries || []).forEach(function (k) { var pct = k.spentPence / tot * 100; if (pct >= 0.5) dots.appendChild(el("i", { title: (KIND[k.category] || KIND.other).label, style: "flex:" + pct.toFixed(1) + ";background:" + (KIND[k.category] || KIND.other).bar })); });
        if (dots.childNodes.length) card.appendChild(dots);
        var play = el("button", { className: "rl-wr-play", onclick: function () { playStory(w); } });
        play.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="vertical-align:-3px;margin-right:8px"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>';
        play.appendChild(document.createTextNode("Play your " + year + " story"));
        card.appendChild(play);
        if (window.__relayOpenWrapped) { window.__relayOpenWrapped = false; try { host.scrollIntoView({ block: "start" }); } catch (e) {} }
      }
      // Earlier years are added rarely, so they sit behind one button until wanted.
      var hb = el("div"); extra.appendChild(hb);
      hb.appendChild(el("button", { type: "button", className: "rl-po-secondary", text: "Add an earlier year", style: "max-width:260px", onclick: function () {
        mountHistory(hb, w, function (firstYear) { memoDrop("wrapped"); mountWrapped(host, firstYear || year); }); } }));
    }).catch(function () { card.textContent = ""; card.appendChild(el("p", { text: "Couldn't reach Relay. Check your connection." })); });
  }
  // Opt-in: read past years of order emails so Wrapped works for them too. Same email permission, same rules: only receipts and order emails.
  function mountHistory(host, w, done) {
    host.textContent = "";
    var thisYear = new Date().getFullYear();
    var card = el("div", { className: "rl-wr-glance" });
    host.appendChild(card);
    card.appendChild(el("h3", { text: "Add earlier years" }));
    card.appendChild(el("p", { text: "Pick a year and Relay finds its order emails, so you can play that year's Wrapped too.", style: "color:var(--rl-text2);font-size:14px;margin:0 0 12px;line-height:1.5" }));
    var chips = el("div", { className: "rl-wr-years" }), picked = {}, status = el("p", { className: "rl-wr-note", style: "font-size:13px" });
    var go = el("button", { className: "rl-po-primary", text: "Read these years", style: "max-width:260px", disabled: true });
    card.appendChild(chips); card.appendChild(go); card.appendChild(status);
    var have = {}; (w.years || []).forEach(function (y) { have[y.year] = y.receipts; });
    api("/relay/my/gmail/history").then(function (r) {
      var doneYears = {}; ((r.ok && r.body.years) || []).forEach(function (y) { doneYears[y.year] = true; });
      var earliest = (r.ok && r.body.earliest) || thisYear - 10;
      for (var y = thisYear - 1; y >= Math.max(earliest, thisYear - 8); y--) (function (y) {
        // A year already read gets a small drawn tick (never a symbol character).
        var b = el("button", { type: "button", text: String(y), className: doneYears[y] ? "read" : "", title: doneYears[y] ? "Already read" + (have[y] ? " · " + have[y] + " receipts" : "") : "", ariaLabel: doneYears[y] ? y + ", already read" : String(y), ariaPressed: "false",
          onclick: function () { picked[y] = !picked[y]; b.className = (picked[y] ? "on " : "") + (doneYears[y] ? "read" : ""); b.ariaPressed = picked[y] ? "true" : "false"; go.disabled = !Object.keys(picked).some(function (k) { return picked[k]; }); } });
        if (doneYears[y]) b.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-left:6px"><path d="m5 12.5 4.2 4.2L19 7"/></svg>');
        chips.appendChild(b);
      })(y);
    });
    go.onclick = function () {
      var years = Object.keys(picked).filter(function (k) { return picked[k]; }).map(Number).sort(function (a, b) { return b - a; });
      if (!years.length) return;
      go.disabled = true; Array.prototype.forEach.call(chips.children, function (b) { b.disabled = true; });
      var found = 0, errors = 0;
      function oneYear(k) {
        if (k >= years.length) { status.textContent = "Done. Relay found " + found + " receipts in " + years.join(", ") + "."; setTimeout(function () { done(years[0]); }, 900); return; }
        var y = years[k];
        function round(cursor) {
          status.textContent = "Reading " + y + (cursor ? " · back to " + cursor.replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, "$3/$2") : "") + "… " + found + " receipts found so far. Keep this page open.";
          api("/relay/my/gmail/scan", { method: "POST", body: Object.assign({ year: y }, cursor ? { cursor: cursor } : {}) }).then(function (x) {
            if (!x.ok) {
              if (x.status === 401) { status.textContent = mailOwner() + " needs you to reconnect " + mailName() + " on the Receipts tab."; return; }
              if (++errors > 8) { status.textContent = mailName() + " is busy. Relay saved its place: press the button again in a few minutes to carry on."; go.disabled = false; return; }
              return setTimeout(function () { round(cursor); }, 4000 * Math.min(errors, 4));
            }
            errors = 0; found += (x.body.added || 0);
            if (x.body.more && x.body.cursor) setTimeout(function () { round(x.body.cursor); }, 800); else oneYear(k + 1);
          }, function () { if (++errors > 8) { status.textContent = "Couldn't reach Relay. Try again in a moment."; go.disabled = false; return; } setTimeout(function () { round(cursor); }, 4000); });
        }
        round("");
      }
      oneYear(0);
    };
  }
  var MONTH_FULL = { Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June", Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December" };
  // Counts a number up from zero, so the big figure on a slide lands with a bit of drama.
  function countUp(node, to, fmt, ms) {
    var t0 = null; ms = ms || 1200;
    function step(t) { if (!t0) t0 = t; var k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); node.textContent = fmt(Math.round(to * e)); if (k < 1 && node.isConnected) requestAnimationFrame(step); }
    node.textContent = fmt(0); requestAnimationFrame(step);
  }
  // Real photos from the shopper's own receipts (only ones Relay checked are of the item). Never a stand-in picture.
  function photoGrid(list, cls) {
    var g = el("div", { className: cls + " n" + list.length });
    var gone = function (f) { f.remove(); g.className = cls + " n" + g.children.length; };
    list.forEach(function (p, i) {
      var f = el("figure", { style: "animation-delay:" + (0.2 + i * 0.12) + "s" }), cap = p.item ? p.item + (p.more ? " +" + p.more : "") : p.shop;
      if (cls === "rl-wr-strip") { var box = el("div", { className: "im" }); f.appendChild(box); f.appendChild(el("figcaption", { text: cap })); apiBlob("/relay/my/receipts/" + p.id + "/image").then(function (u) { if (u) box.appendChild(el("img", { src: u, alt: cap })); else gone(f); }); }
      else { f.appendChild(el("figcaption", { text: cap })); apiBlob("/relay/my/receipts/" + p.id + "/image").then(function (u) { if (u) f.insertBefore(el("img", { src: u, alt: cap }), f.firstChild); else gone(f); }); }
      g.appendChild(f);
    });
    return g;
  }
  // The style slide is worked out from the year's things (clothes, shoes, homeware) with the same rules as Discover.
  function wrappedStyle(w) {
    var E = window.RelayRecommendationEngine;
    if (!E || !(w.things || []).length) return null;
    var pr = E.profile(w.things.map(function (t) { return { item: t.name, detail: t.variant || t.name, merchant: t.shop, price: t.pricePence ? t.pricePence / 100 : 0, verified: true }; }), []);
    // One or two items aren't enough to call it a style.
    if (pr.bought < 3 || !pr.headline || (!pr.styles.length && !pr.sizes.clothing && !pr.sizes.footwear && !pr.sizes.bed)) return null;
    return pr;
  }
  var SW = { white: "#fff", black: "#111", grey: "#9aa0a6", gray: "#9aa0a6", cream: "#f3ead6", navy: "#1d2b55", blue: "#3b6fd8", green: "#3f9b4f", pink: "#f2a7c3", red: "#d33a2f", brown: "#7a4e2d", beige: "#e6d5b8", oat: "#e2d6bf", olive: "#6b7034", purple: "#7c4dbd", lilac: "#c8a2c8", lavender: "#b9a7e0", sage: "#a3b18a", charcoal: "#36393f", stone: "#c9c1b1", khaki: "#b3a26b" };
  function longDate(d) { return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long" }); }
  // Each kind of shopping gets its own little animated scene in the story (drawn lines, no emoji), its own colours and words.
  var KIND = {
    food: { label: "Food & drink", bg: "#7c2d12", fg: "#fff", accent: "#fdba74", bar: "#fbbf24", go: "Your go-to spot", repeat: "Ordered most",
      scene: '<path class="st s1" d="M78 58c-9-11 9-19 0-32"/><path class="st s2" d="M100 58c-9-11 9-19 0-32"/><path class="st s3" d="M122 58c-9-11 9-19 0-32"/><path class="fill" d="M42 74h116a58 58 0 0 1-116 0Z"/><path d="M32 74h136"/><path class="tilt" d="M176 40v62M170 40v18a6 6 0 0 0 12 0V40"/>' },
    fashion: { label: "Fashion", bg: "#831843", fg: "#fff", accent: "#f9a8d4", bar: "#f472b6", go: "Your go-to shop", repeat: "Bought again and again",
      scene: '<path d="M18 22h164"/><g class="sw s1"><path d="M52 22v9"/><path class="fill" d="M52 31 30 46h44Z"/><path class="fill" d="M34 46h36l4 50H30Z"/></g><g class="sw s2"><path d="M100 22v9"/><path class="fill" d="M100 31 78 46h44Z"/><path class="fill" d="M80 46h40v24l-6 34H86l-6-34Z"/></g><g class="sw s3"><path d="M148 22v9"/><path class="fill" d="M148 31 126 46h44Z"/><path class="fill" d="M130 46h36l-2 40h-32Z"/></g>' },
    electronics: { label: "Electronics", bg: "#0c4a6e", fg: "#fff", accent: "#7dd3fc", bar: "#38bdf8", go: "Your go-to for tech", repeat: "Bought again and again",
      scene: '<rect x="70" y="14" width="60" height="104" rx="12"/><path d="M92 24h16"/><rect class="charge" x="82" y="44" width="36" height="56" rx="4"/><path class="wave w1" d="M150 50a22 22 0 0 1 0 32"/><path class="wave w2" d="M162 40a36 36 0 0 1 0 52"/><path class="wave w1" d="M50 50a22 22 0 0 0 0 32"/><path class="wave w2" d="M38 40a36 36 0 0 0 0 52"/>' },
    home: { label: "Home & garden", bg: "#365314", fg: "#fff", accent: "#d9f99d", bar: "#a3e635", go: "Your go-to for the home", repeat: "Bought again and again",
      scene: '<path d="M30 70 100 18l70 52"/><path d="M44 60v62h112V60"/><rect class="win w1" x="60" y="72" width="26" height="22" rx="3"/><rect class="win w2" x="114" y="72" width="26" height="22" rx="3"/><path d="M90 122V100h20v22"/><path class="smoke" d="M138 40v-14"/>' },
    beauty: { label: "Beauty & health", bg: "#701a75", fg: "#fff", accent: "#f5d0fe", bar: "#e879f9", go: "Your go-to for beauty", repeat: "Restocked most",
      scene: '<path class="tw t1" d="M100 18c3 22 13 32 35 35-22 3-32 13-35 35-3-22-13-32-35-35 22-3 32-13 35-35Z"/><path class="tw t2" d="M44 70c2 11 7 16 18 18-11 2-16 7-18 18-2-11-7-16-18-18 11-2 16-7 18-18Z"/><path class="tw t3" d="M158 78c2 11 7 16 18 18-11 2-16 7-18 18-2-11-7-16-18-18 11-2 16-7 18-18Z"/>' },
    travel: { label: "Travel & transport", bg: "#312e81", fg: "#fff", accent: "#c7d2fe", bar: "#818cf8", go: "Your go-to for getting about", repeat: "Your regular trip",
      scene: '<path class="dash" d="M20 110C60 30 140 30 180 90"/><circle cx="20" cy="110" r="5" class="fill"/><circle cx="180" cy="90" r="5" class="fill"/><g class="fly"><path class="fill" d="M0 0 22 8 0 16 5 8Z"/></g>' },
    digital: { label: "Digital & subscriptions", bg: "#134e4a", fg: "#fff", accent: "#99f6e4", bar: "#2dd4bf", go: "Your top app or service", repeat: "Bought again and again",
      scene: '<rect x="40" y="20" width="120" height="78" rx="14"/><path class="fill" d="M90 44v30l26-15Z"/><rect class="eq e1" x="56" y="106" width="10" height="20" rx="3"/><rect class="eq e2" x="76" y="106" width="10" height="20" rx="3"/><rect class="eq e3" x="96" y="106" width="10" height="20" rx="3"/><rect class="eq e4" x="116" y="106" width="10" height="20" rx="3"/><rect class="eq e5" x="136" y="106" width="10" height="20" rx="3"/>' },
    experiences: { label: "Tickets & experiences", bg: "#9a3412", fg: "#fff", accent: "#fed7aa", bar: "#fb923c", go: "Your go-to for days out", repeat: "Booked most",
      scene: '<g class="tk k1"><path class="fill" d="M30 40h80v14a8 8 0 0 0 0 16v14H30V70a8 8 0 0 0 0-16Z"/><path class="cut" d="M88 40v44"/></g><g class="tk k2"><path class="fill" d="M90 56h80v14a8 8 0 0 0 0 16v14H90V86a8 8 0 0 0 0-16Z"/><path class="cut" d="M148 56v44"/></g>' },
    other: { label: "Other", bar: "#94a3b8" },
    // Not a kind of shopping (never a chapter): the scene for the gifts slide.
    gifts: { label: "Gifts", gift: true,
      scene: '<path class="tw t1" d="M36 30c1.2 6 3.8 8.8 10 10-6.2 1.2-8.8 4-10 10-1.2-6-3.8-8.8-10-10 6.2-1.2 8.8-4 10-10Z"/><path class="tw t2" d="M166 24c1 5 3 7 8 8-5 1-7 3-8 8-1-5-3-7-8-8 5-1 7-3 8-8Z"/><path class="tw t3" d="M170 88c.9 4.4 2.6 6.1 7 7-4.4.9-6.1 2.6-7 7-.9-4.4-2.6-6.1-7-7 4.4-.9 6.1-2.6 7-7Z"/>' +
        '<rect class="fill" x="58" y="62" width="84" height="60" rx="5"/><path d="M100 62v60"/>' +
        '<g class="lid"><rect class="fill" x="50" y="46" width="100" height="16" rx="4"/><path d="M100 46v16"/><path d="M100 46c-6-14-26-20-29-10-2 7 12 10 29 10Zm0 0c6-14 26-20 29-10 2 7-12 10-29 10Z"/></g>' }
  };
  function scene(kind) {
    var box = el("div", { className: "scene sc-" + kind });
    box.setAttribute("aria-hidden", "true");
    box.innerHTML = '<svg viewBox="0 0 200 132" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' + KIND[kind].scene + "</svg>";
    return box;
  }
  // A plain sentence of the one fun number each kind has (worked out on the server from that kind's receipts).
  function factLine(c) {
    var f = c.fact, gbp = function (p) { return money(p, "GBP"); };
    if (!f) return null;
    if (f.kind === "perWeek") return f.orders + " orders. About " + gbp(f.pence) + " a week.";
    if (f.kind === "perPiece") return f.pieces + " pieces added to your wardrobe, about " + gbp(f.pence) + " each.";
    if (f.kind === "gadgets") return f.count + (f.count === 1 ? " gadget" : " gadgets") + " came home.";
    if (f.kind === "homeThings") return f.count + (f.count === 1 ? " thing" : " things") + " for your home.";
    if (f.kind === "beautyThings") return f.count + (f.count === 1 ? " beauty buy" : " beauty buys") + " to treat yourself.";
    if (f.kind === "trips") return f.count + (f.count === 1 ? " journey" : " journeys") + " booked.";
    if (f.kind === "perMonth") return f.pence ? "About " + gbp(f.pence) + " a month on apps and subscriptions." : null;
    if (f.kind === "outings") return f.count + (f.count === 1 ? " day out" : " days out") + " booked.";
    return null;
  }
  function storySlides(w) {
    var S = [], top = w.topShops[0], gbp = function (p) { return money(p, "GBP"); };
    var chapters = (w.chapters || []).filter(function (c) { return KIND[c.category] && KIND[c.category].scene; });
    var photos = (w.photos || []).slice(0, 6);
    var fashion = chapters.filter(function (c) { return c.category === "fashion"; })[0];
    var style = fashion ? wrappedStyle(w) : null;
    // 1. The year.
    S.push({ bg: "#101828", fg: "#fff", accent: "#c7f567", build: function (b) {
      b.appendChild(el("div", { className: "k", text: "RELAY WRAPPED " + w.year }));
      b.appendChild(el("h1", { text: "Your " + w.year + ", one receipt at a time." }));
      var fb = w.firstBuy;
      if (fb && fb.date) b.appendChild(el("p", { text: "It started on " + longDate(fb.date) + (fb.item ? " with " + fb.item : "") + (fb.shop ? (fb.item ? " from " : " at ") + fb.shop : "") + "." }));
      b.appendChild(el("p", { text: w.receipts + " receipts and " + w.shops + (w.shops === 1 ? " shop" : " shops") + " later, here's your year." }));
    } });
    // 2. The total.
    if (w.coverage.withTotal) S.push({ bg: "#14532d", fg: "#fff", accent: "#c7f567", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "In " + w.year + " you spent" }));
      var n = el("div", { className: "big" }); b.appendChild(n); countUp(n, w.spentPence, gbp, 1400);
      b.appendChild(el("p", { text: "across " + w.shops + (w.shops === 1 ? " shop" : " shops") + (w.activeMonths ? " in " + w.activeMonths + (w.activeMonths === 1 ? " month" : " months") : "") + "." }));
      if (w.coverage.noTotal) b.appendChild(el("p", { className: "fine", text: "Added up from " + w.coverage.withTotal + " of " + w.receipts + " receipts. " + w.coverage.noTotal + " had no amount Relay could read." }));
    } });
    // 3. Where it went: every kind of shopping as one bar, then a line each.
    var kinds = (w.industries || []).filter(function (k) { return k.spentPence > 0 || k.receipts > 0; });
    var total = kinds.reduce(function (n, k) { return n + (k.spentPence || 0); }, 0);
    if (kinds.length > 1 && total > 0) S.push({ bg: "#111827", fg: "#fff", accent: "#c7f567", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Where it went" }));
      var stack = el("div", { className: "stack" });
      kinds.forEach(function (k, i) { var pct = k.spentPence / total * 100; if (pct < 0.5) return;
        stack.appendChild(el("i", { style: "--w:" + pct.toFixed(1) + "%;background:" + (KIND[k.category] || KIND.other).bar + ";animation-delay:" + (0.2 + i * 0.12) + "s" })); });
      b.appendChild(stack);
      var ol = el("ol", { className: "kindlist" });
      kinds.slice(0, 7).forEach(function (k, i) {
        var pct = Math.round(k.spentPence / total * 100);
        ol.appendChild(el("li", { style: "animation-delay:" + (0.3 + i * 0.12) + "s" }, [el("i", { style: "background:" + (KIND[k.category] || KIND.other).bar }),
          el("span", { text: (KIND[k.category] || KIND.other).label }), el("em", { text: (pct < 1 ? "<1" : pct) + "% · " + gbp(k.spentPence) })]));
      });
      b.appendChild(ol);
    } });
    // 4. A chapter for each kind, biggest first, each with its own scene.
    chapters.forEach(function (c, ci) {
      var K = KIND[c.category];
      S.push({ bg: K.bg, fg: K.fg, accent: K.accent, build: function (b) {
        b.appendChild(el("div", { className: "k", text: "CHAPTER " + (ci + 1) + " · " + K.label.toUpperCase() }));
        b.appendChild(scene(c.category));
        if (c.withTotal) { var n = el("div", { className: "big" }); b.appendChild(n); countUp(n, c.spentPence, gbp, 1100); }
        else b.appendChild(el("div", { className: "big", text: c.receipts + (c.receipts === 1 ? " receipt" : " receipts") }));
        var sub = [c.share ? c.share + "% of your year" : null, c.receipts + (c.receipts === 1 ? " order" : " orders"), c.shops > 1 ? c.shops + " places" : null].filter(Boolean).join(" · ");
        b.appendChild(el("p", { text: sub }));
        var fact = factLine(c); if (fact) b.appendChild(el("p", { className: "fact", text: fact }));
        var lines = el("div", { className: "facts" });
        if (c.topShop) lines.appendChild(el("div", {}, [el("span", { text: K.go }), el("b", { text: c.topShop.name + (c.topShop.receipts > 1 ? " · " + c.topShop.receipts + "×" : "") })]));
        if (c.topItem) lines.appendChild(el("div", {}, [el("span", { text: K.repeat }), el("b", { text: c.topItem.name + " · " + c.topItem.times + "×" })]));
        else if (c.biggest && c.biggest.item) lines.appendChild(el("div", {}, [el("span", { text: "Biggest" }), el("b", { text: c.biggest.item + " · " + gbp(c.biggest.totalPence) })]));
        if (c.category === "fashion" && style && style.styles.length) lines.appendChild(el("div", {}, [el("span", { text: "Your style" }), el("b", { text: style.styles.slice(0, 2).map(function (x) { return x.name; }).join(" & ") })]));
        if (lines.childNodes.length) b.appendChild(lines);
      } });
    });
    // 5. The rest of the year's highlights.
    if (top && w.topShops.length > 1) S.push({ bg: "#172554", fg: "#fff", accent: "#93c5fd", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your top shops" }));
      var ol = el("ol", { className: "rank" });
      w.topShops.forEach(function (sh, i) {
        ol.appendChild(el("li", { style: "animation-delay:" + (0.15 + i * 0.18) + "s" }, [el("b", { text: String(i + 1) }), el("span", { text: sh.name }), el("em", { text: sh.spentPence ? gbp(sh.spentPence) : sh.receipts + " orders" })]));
      });
      b.appendChild(ol);
    } });
    if (photos.length) S.push({ bg: "#f6f3ec", fg: "#101828", accent: "#101828", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: photos.length === 1 ? "One thing you brought home" : "Some things you brought home" }));
      b.appendChild(photoGrid(photos, "ph"));
    } });
    if (w.busiestMonth) S.push({ bg: "#0f3d5c", fg: "#fff", accent: "#bae6fd", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your busiest month" }));
      b.appendChild(el("div", { className: "big name", text: MONTH_FULL[w.busiestMonth] || w.busiestMonth }));
      var max = Math.max.apply(null, w.byMonth.map(function (m) { return m.receipts; })) || 1;
      var chart = el("div", { className: "months" });
      w.byMonth.forEach(function (m, i) { chart.appendChild(el("div", {}, [el("i", { className: m.month === w.busiestMonth ? "hot" : "", style: "--h:" + Math.max(4, Math.round(m.receipts / max * 100)) + "%;animation-delay:" + (0.1 + i * 0.05) + "s" }), el("span", { text: m.month.slice(0, 1) })])); });
      b.appendChild(chart);
      var bm = w.byMonth.filter(function (m) { return m.month === w.busiestMonth; })[0];
      if (bm) b.appendChild(el("p", { text: bm.receipts + " receipts" + (bm.spentPence ? " · " + gbp(bm.spentPence) : "") + "." }));
    } });
    if (w.biggest) S.push({ bg: "#0f5132", fg: "#fff", accent: "#b7f0cf", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your biggest treat" }));
      var n = el("div", { className: "big" }); b.appendChild(n); countUp(n, w.biggest.totalPence, gbp, 1100);
      b.appendChild(el("p", { text: (w.biggest.item ? w.biggest.item + ", " : "") + "at " + w.biggest.shop + (w.biggest.date ? " on " + longDate(w.biggest.date) : "") + "." }));
      if (w.biggest.photoId) b.appendChild(photoGrid([{ id: w.biggest.photoId, item: w.biggest.item, shop: w.biggest.shop }], "ph"));
    } });
    // For everyone else: the receipts the shopper tagged as presents, and who for (only names they typed themselves).
    var gf = w.gifts, many = function (n, one, more) { return n + " " + (n === 1 ? one : more); };
    if (gf && gf.count) S.push({ bg: "#c7f567", fg: "#101828", accent: "#101828", build: function (b) {
      b.appendChild(el("div", { className: "k", text: "FOR EVERYONE ELSE" }));
      b.appendChild(scene("gifts"));
      if (gf.withTotal) { var n = el("div", { className: "big" }); b.appendChild(n); countUp(n, gf.spentPence, gbp, 1100); }
      else b.appendChild(el("div", { className: "big", text: many(gf.count, "gift", "gifts") }));
      // "For 3 people" only when every gift says who it was for.
      var ppl = gf.people || [], allNamed = gf.named === gf.count && ppl.length > 0;
      var sub = [gf.withTotal ? "on " + many(gf.count, "gift", "gifts") : null, allNamed ? "for " + (ppl.length === 1 ? ppl[0].name : ppl.length + " people") : null,
        gf.share ? gf.share + "% of your spending" : null].filter(Boolean).join(" · ");
      if (sub) b.appendChild(el("p", { text: sub }));
      if (gf.withTotal < gf.count) b.appendChild(el("p", { className: "fine", text: "Added up from " + gf.withTotal + " of " + many(gf.count, "gift", "gifts") + ". The others had no amount Relay could read." }));
      var lines = el("div", { className: "facts" }), top = ppl[0], big = (gf.list || [])[0];
      if (top && top.gifts >= 2 && (ppl.length === 1 || top.gifts > ppl[1].gifts) && !(allNamed && ppl.length === 1))
        lines.appendChild(el("div", {}, [el("span", { text: "Most went to" }), el("b", { text: top.name + " · " + many(top.gifts, "gift", "gifts") })]));
      if (big && big.totalPence && gf.count > 1) lines.appendChild(el("div", {}, [el("span", { text: "Biggest gift" }), el("b", { text: (big.item || big.shop || "A gift") + (big.for ? " for " + big.for : "") + " · " + gbp(big.totalPence) })]));
      if (gf.busiestMonth) lines.appendChild(el("div", {}, [el("span", { text: "Most giving month" }), el("b", { text: MONTH_FULL[gf.busiestMonth] || gf.busiestMonth })]));
      if (lines.childNodes.length) b.appendChild(lines);
    } });
    var giftPhotos = gf ? (gf.list || []).filter(function (x) { return x.photoId; }).slice(0, 4).map(function (x) { return { id: x.photoId, item: x.item, more: x.more, shop: x.shop }; }) : [];
    if (giftPhotos.length) S.push({ bg: "#101828", fg: "#fff", accent: "#c7f567", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: giftPhotos.length === 1 ? "Something you gave" : "Some things you gave" }));
      b.appendChild(photoGrid(giftPhotos, "ph"));
    } });
    var bd = w.badges || [];
    if (bd.length) S.push({ bg: "#c7f567", fg: "#16210a", accent: "#16210a", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: bd.length === 1 ? "Your badge" : "Your badges" }));
      var g = el("div", { className: "badges" });
      bd.slice(0, 4).forEach(function (x, i) { g.appendChild(el("div", { style: "animation-delay:" + (0.2 + i * 0.2) + "s" }, [el("b", { text: x.label }), el("small", { text: x.why })])); });
      b.appendChild(g);
    } });
    if (w.personality) S.push({ bg: "#9a3412", fg: "#fff", accent: "#fed7aa", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your shopping style" }));
      b.appendChild(el("div", { className: "big name", text: w.personality.label }));
      b.appendChild(el("p", { text: w.personality.why }));
    } });
    // 6. The card to keep or share.
    S.push({ bg: "#101828", fg: "#fff", accent: "#c7f567", summary: true, build: function (b, again, close) {
      var title = "My " + w.year + " on Relay", c0 = chapters[0];
      var card = el("div", { className: "sum" }, [el("div", { className: "k", text: title.toUpperCase() })]);
      var rows = [["Spent", w.coverage.withTotal ? gbp(w.spentPence) : "—"], ["Top shop", top ? top.name : "—"], ["Biggest chapter", c0 ? KIND[c0.category].label : "—"],
        ["Busiest month", w.busiestMonth ? MONTH_FULL[w.busiestMonth] : "—"], ["Receipts", String(w.receipts)], [style && style.styles[0] ? "Style" : "Shops", style && style.styles[0] ? style.styles.slice(0, 2).map(function (x) { return x.name; }).join(" & ") : String(w.shops)]];
      var g = el("div", { className: "sumgrid" }); rows.forEach(function (r) { g.appendChild(el("div", {}, [el("span", { text: r[0] }), el("strong", { text: r[1] })])); }); card.appendChild(g);
      if (kinds.length > 1 && total > 0) { var st = el("div", { className: "stack small" }); kinds.forEach(function (k) { var pct = k.spentPence / total * 100; if (pct >= 0.5) st.appendChild(el("i", { style: "--w:" + pct.toFixed(1) + "%;background:" + (KIND[k.category] || KIND.other).bar })); }); card.appendChild(st); }
      b.appendChild(card);
      var text = title + ": " + rows.map(function (r) { return r[0] + " " + r[1]; }).join(" · ");
      var msg = el("p", { className: "fine" });
      b.appendChild(el("div", { className: "acts" }, [
        el("button", { type: "button", text: "Share", onclick: function (e) { e.stopPropagation();
          if (navigator.share) navigator.share({ title: title, text: text }).catch(function () {});
          else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { msg.textContent = "Copied. Paste it anywhere."; }, function () {}); } }),
        el("button", { type: "button", className: "ghost", text: "Watch again", onclick: function (e) { e.stopPropagation(); again(); } }),
        el("button", { type: "button", className: "ghost", text: "Done", onclick: function (e) { e.stopPropagation(); close(); } })]));
      b.appendChild(msg);
    } });
    return S;
  }
  // ---- Wrapped's soundtrack: original music the app makes itself (Web Audio), so there's no song to license or download.
  // A four-bar loop at 112 beats a minute (A minor: Am F C G, then C G Am F at its fullest), built up as the story goes on:
  // pads and hats to start, then kick and bass, then the melody; the last slide keeps the pads and melody and eases off.
  // On iPhone it follows the silent switch. It pauses while the story is held or the app is in the background, and the
  // speaker button turns it off (remembered on this device). ----
  var STORY_SOUND_KEY = "relay.storySound.v1";
  function storySoundOn() { try { return localStorage.getItem(STORY_SOUND_KEY) !== "off"; } catch (e) { return true; } }
  function rememberStorySound(on) { try { localStorage.setItem(STORY_SOUND_KEY, on ? "on" : "off"); } catch (e) {} }
  function noteHz(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  // What plays on each beat, at each level (0 intro, 1 and 2 building, 3 full, 4 the last slide). Works with a live or an
  // offline audio context, so the same song can be listened to before it ships.
  function storySong(ctx, out) {
    var SPB = 60 / 112;
    var A = { chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], roots: [45, 41, 48, 43],
      arp: [[69, 72, 76, 72, 69, 71, 72, 76], [69, 72, 77, 72, 69, 72, 77, 76], [67, 72, 76, 79, 76, 72, 67, 72], [67, 71, 74, 79, 74, 71, 67, 71]] };
    var B = { chords: [[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]], roots: [48, 43, 45, 41],
      arp: [[72, 76, 79, 76, 84, 79, 76, 72], [71, 74, 79, 74, 83, 79, 74, 71], [72, 76, 81, 76, 84, 81, 76, 72], [72, 77, 81, 77, 84, 81, 77, 72]] };
    var noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate), d = noise.getChannelData(0);
    for (var k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
    function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
    function voice(type, hz, cutoff) {
      var o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = type; o.frequency.value = hz; f.type = "lowpass"; f.frequency.value = cutoff; o.connect(f); f.connect(g); g.connect(out);
      return { o: o, g: g };
    }
    function kick(t) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
      env(g, t, 0.004, 0.8, 0.32); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.42);
    }
    function hiss(t, v, len, type, hz, q) {
      var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noise; f.type = type; f.frequency.value = hz; if (q) f.Q.value = q;
      env(g, t, 0.002, v, len); s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + len + 0.05);
    }
    function tone(t, n, len, type, v, cutoff) { var x = voice(type, noteHz(n), cutoff); env(x.g, t, 0.008, v, len); x.o.start(t); x.o.stop(t + len + 0.1); }
    function pad(t, notes, len, v) {
      notes.forEach(function (n) { [-8, 8].forEach(function (cents) {
        var x = voice("sawtooth", noteHz(n), 1000); x.o.detune.value = cents;
        x.g.gain.setValueAtTime(0.0001, t); x.g.gain.linearRampToValueAtTime(v, t + 0.4); x.g.gain.setValueAtTime(v, t + len - 0.25); x.g.gain.linearRampToValueAtTime(0.0001, t + len + 0.2);
        x.o.start(t); x.o.stop(t + len + 0.3);
      }); });
    }
    return {
      spb: SPB,
      // A soft rush between slides.
      swoosh: function (t) {
        var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noise; s.loop = true; f.type = "bandpass"; f.Q.value = 1.2; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(4000, t + 0.45);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + 0.6);
      },
      beat: function (b, t, level) {
        var inBar = b % 4, part = level === 3 ? B : A, c = Math.floor(b / 4) % 4, drums = level >= 1 && level <= 3;
        if (inBar === 0) pad(t, part.chords[c], SPB * 4, level === 4 ? 0.022 : 0.03);
        if (drums && (level >= 2 || inBar % 2 === 0)) kick(t);
        if (level >= 2 && level <= 3 && inBar % 2 === 1) hiss(t, 0.42, 0.16, "bandpass", 1700, 0.9);
        if (level <= 3) { hiss(t + SPB / 2, level === 0 ? 0.07 : 0.12, level === 3 ? 0.2 : 0.045, "highpass", 7600); if (drums) hiss(t, 0.06, 0.04, "highpass", 8200); }
        if (drums) { tone(t, part.roots[c] - 12, SPB * 0.45, "sawtooth", 0.2, 640); if (level >= 2) tone(t + SPB / 2, part.roots[c] - 12, SPB * 0.4, "sawtooth", 0.16, 640); }
        if (level >= 2) for (var h = 0; h < 2; h++) tone(t + h * SPB / 2, part.arp[c][inBar * 2 + h], 0.26, level === 4 ? "sine" : "triangle", level === 3 ? 0.12 : 0.085, 3400);
      }
    };
  }
  // The live player. Returns null where the browser can't make sound.
  function storyMusic() {
    var AC = window.AudioContext || window.webkitAudioContext, ctx;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    try { if (navigator.audioSession) navigator.audioSession.type = "ambient"; } catch (e) {}
    var comp = ctx.createDynamicsCompressor(), master = ctx.createGain();
    master.gain.value = 0.0001; comp.connect(master); master.connect(ctx.destination);
    var song = storySong(ctx, comp), level = 0, beat = 0, next = ctx.currentTime + 0.1, held = false, hidden = false, stopped = false;
    function fade(v, s) { var t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), t); master.gain.exponentialRampToValueAtTime(Math.max(v, 0.0001), t + s); }
    var timer = setInterval(function () {
      if (stopped || ctx.state !== "running") return;
      if (next < ctx.currentTime) next = ctx.currentTime + 0.05;
      while (next < ctx.currentTime + 0.25) { song.beat(beat, next, level); beat++; next += song.spb; }
    }, 50);
    function sync() { if (stopped) return; if (held || hidden) ctx.suspend().catch(function () {}); else ctx.resume().catch(function () {}); }
    function vis() { hidden = document.hidden; sync(); }
    document.addEventListener("visibilitychange", vis);
    ctx.resume().catch(function () {}); fade(0.6, 1.2);
    return {
      context: ctx,
      level: function (l, swoosh) { if (swoosh && ctx.state === "running") song.swoosh(ctx.currentTime + 0.02); level = l; },
      hold: function (on) { held = Boolean(on); sync(); },
      stop: function () {
        if (stopped) return; stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", vis);
        try { fade(0.0001, 0.3); } catch (e) {}
        setTimeout(function () { try { ctx.close(); } catch (e) {} }, 400);
      }
    };
  }
  var SOUND_ON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9.3a4 4 0 0 1 0 5.4M18.2 6.8a7.5 7.5 0 0 1 0 10.4"/></svg>';
  var SOUND_OFF = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>';
  function playStory(w) {
    var slides = storySlides(w), i = 0, timer = null, paused = false, DUR = 6500;
    var root = el("div", { className: "rl-story", role: "dialog", ariaLabel: "Your " + w.year + " Wrapped" });
    var frame = el("div", { className: "rl-story-frame" });
    var bars = el("div", { className: "rl-story-bars" });
    slides.forEach(function () { bars.appendChild(el("div", {}, [el("i")])); });
    var closeBtn = el("button", { type: "button", className: "rl-story-x", ariaLabel: "Close" });
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    var body = el("div", { className: "rl-story-body" });
    // The soundtrack starts with the tap that opened the story (phones only allow sound after a tap).
    var music = null, soundOn = storySoundOn(), sound = el("button", { type: "button", className: "rl-story-snd" });
    var levelOf = function (n) { return slides[n].summary ? 4 : n < 2 ? n : Math.floor(n / 2) % 2 ? 3 : 2; };
    function drawSound() { sound.innerHTML = soundOn ? SOUND_ON : SOUND_OFF; sound.setAttribute("aria-label", soundOn ? "Turn the music off" : "Turn the music on"); sound.setAttribute("aria-pressed", String(soundOn)); }
    function startMusic() { if (!music && soundOn) { music = storyMusic(); if (music) music.level(levelOf(i)); } }
    sound.onclick = function (e) {
      e.stopPropagation(); soundOn = !soundOn; rememberStorySound(soundOn); drawSound();
      if (soundOn) startMusic(); else if (music) { music.stop(); music = null; }
    };
    drawSound(); startMusic();
    frame.appendChild(bars); frame.appendChild(sound); frame.appendChild(closeBtn); frame.appendChild(body); root.appendChild(frame);
    document.body.appendChild(root); document.body.style.overflow = "hidden";
    function close() { clearTimeout(timer); document.removeEventListener("keydown", key); if (music) { music.stop(); music = null; } root.remove(); document.body.style.overflow = ""; }
    function show(n) {
      var was = i;
      i = Math.max(0, Math.min(slides.length - 1, n)); clearTimeout(timer);
      if (music) music.level(levelOf(i), i !== was);
      var sl = slides[i];
      frame.style.background = sl.bg; frame.style.color = sl.fg; frame.style.setProperty("--accent", sl.accent);
      Array.prototype.forEach.call(bars.children, function (b, k) { b.className = k < i ? "done" : k === i ? "now" : ""; b.firstChild.style.animationDuration = DUR + "ms"; });
      body.textContent = ""; var inner = el("div", { className: "rl-story-slide" }); body.appendChild(inner);
      sl.build(inner, function () { show(0); }, close);
      if (!sl.summary) timer = setTimeout(function () { if (!paused) show(i + 1); }, DUR);
    }
    function key(e) { if (e.key === "Escape") close(); else if (e.key === "ArrowRight") show(i + 1); else if (e.key === "ArrowLeft") show(i - 1); }
    document.addEventListener("keydown", key);
    closeBtn.onclick = function (e) { e.stopPropagation(); close(); };
    // Tap the right side to go on, the left side to go back; press and hold to pause.
    frame.addEventListener("click", function (e) { if (e.target.closest("button")) return; var r = frame.getBoundingClientRect(); if (e.clientX - r.left < r.width * 0.33) show(i - 1); else if (!slides[i].summary) show(i + 1); });
    frame.addEventListener("pointerdown", function () { paused = true; frame.classList.add("paused"); if (music) music.hold(true); });
    frame.addEventListener("pointerup", function () { if (!paused) return; paused = false; frame.classList.remove("paused"); if (music) music.hold(false); });
    show(0);
  }

  // ---- Investor/shop demo of the Market (only with ?demo=1). Everything here is made up and stays in this browser:
  // nothing is sent to Relay, and real members never see it. It shows how buying and selling works end to end. ----
  function mountDemoMarket(host) {
    host.textContent = "";
    var D = [
      { id: "d1", title: "Waterproof Rain Shell", store: "Fieldhouse", size: "M", cond: "Like new", price: 4500, paid: 12000, ago: "5 weeks ago", area: "SW11", how: "either", who: "Priya", img: "ltd-rain-shell.png" },
      { id: "d2", title: "Court Classic Trainers", store: "Kick Lane", size: "UK 8", cond: "Good", price: 3500, paid: 8500, ago: "2 months ago", area: "SW4", how: "collect", who: "Tom", img: "court-classic-sneakers.png", swap: true },
      { id: "d3", title: "Oversized Hoodie", store: "Studio North", size: "L", cond: "New with tags", price: 3000, paid: 5500, ago: "3 weeks ago", area: "SW11", how: "either", who: "Maya", img: "studio-oversized-hoodie.png" },
      { id: "d4", title: "Wool Coat", store: "Harlow & Co", size: "UK 10", cond: "Like new", price: 9000, paid: 22000, ago: "6 weeks ago", area: "N1", how: "post", who: "Ellie", img: "wool-coat.png" },
      { id: "d5", title: "Yoga Leggings", store: "Relay Demo Store", size: "S", cond: "Like new", price: 1800, paid: 4800, ago: "1 month ago", area: "SE15", how: "collect", who: "Aisha", img: "rd-yoga-leggings.png", swap: true },
      { id: "d6", title: "Leather Crossbody Bag", store: "Harlow & Co", size: null, cond: "Good", price: 4000, paid: 9500, ago: "4 months ago", area: "SW11", how: "collect", who: "Sam", img: "leather-crossbody.png" },
      { id: "d7", title: "Trail Grip Boots", store: "Fieldhouse", size: "UK 9", cond: "Good", price: 5500, paid: 14000, ago: "2 months ago", area: "M1", how: "post", who: "Josh", img: "trail-grip-boots.png" },
      { id: "d8", title: "Wireless Earbuds", store: "Voltline", size: null, cond: "Like new", price: 3500, paid: 7900, ago: "3 weeks ago", area: "SW12", how: "either", who: "Leo", img: "wireless-earbuds.png" }];
    var MINE = [{ id: "s1", title: "Linen Shirt", store: "Studio North", paid: 4500, ago: "Bought 7 weeks ago", img: "linen-shirt.png" },
      { id: "s2", title: "Retro High Trainers", store: "Kick Lane", paid: 9500, ago: "Bought 3 months ago", img: "ltd-retro-high.png" },
      { id: "s3", title: "Steel Water Bottle", store: "Fieldhouse", paid: 2200, ago: "Bought 5 weeks ago", img: "steel-water-bottle.png" }];
    var listed = [], cur = "browse", near = "SW11";
    var pic = function (f) { return el("img", { src: "pics/products/" + f, alt: "", style: "width:100%;aspect-ratio:1;object-fit:contain;background:var(--rl-fill);border-radius:16px" }); };
    var howText = function (l) { return l.how === "collect" ? "Collection in " + l.area : l.how === "post" ? "Posted" : "Collect in " + l.area + " or post"; };
    host.appendChild(el("div", { style: "background:#fff4d6;border:1px solid #f2d27b;color:#5c4400;border-radius:14px;padding:10px 14px;font-size:13px;margin:0 0 12px" }, [
      el("b", { text: "Demo: " }), document.createTextNode("made-up members and listings to show how the Market works. Nothing here is real or sent anywhere.")]));
    var tabs = el("div", { style: "display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px" }), body = el("div");
    host.appendChild(tabs); host.appendChild(body);
    [["browse", "Browse"], ["mine", "Mine"], ["sell", "Sell"]].forEach(function (t) {
      var b = el("button", { className: "rl-btn ghost", text: t[1], style: "margin:0;padding:9px 6px;font-size:14px", onclick: function () { cur = t[0]; draw(); } });
      b.setAttribute("data-tab", t[0]); tabs.appendChild(b);
    });
    function draw() {
      Array.prototype.forEach.call(tabs.children, function (b) { b.style.background = b.getAttribute("data-tab") === cur ? "#c7f567" : "transparent"; });
      body.textContent = "";
      if (cur === "browse") browse(); else if (cur === "mine") mine(); else sell();
    }
    function browse() {
      var box = el("input", { value: near, maxLength: 8, placeholder: "Your postcode area", style: "flex:1;padding:10px 14px;border:1px solid var(--rl-line);border-radius:12px;font-size:15px" });
      box.onchange = function () { near = box.value.trim().toUpperCase(); draw(); };
      body.appendChild(el("div", { style: "display:flex;gap:8px;align-items:center;margin:0 0 12px" }, [el("span", { text: "📍" }), box]));
      var letters = near.replace(/[0-9].*$/, "");
      var score = function (l) { return l.how === "post" ? 0 : l.area === near ? 2 : l.area.replace(/[0-9].*$/, "") === letters ? 1 : 0; };
      var grid = el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px" });
      D.slice().sort(function (a, b) { return score(b) - score(a); }).forEach(function (l) {
        var c = el("div", { className: "rl-po", style: "padding:12px" }, [pic(l.img),
          el("div", { style: "display:flex;justify-content:space-between;gap:8px;margin-top:10px" }, [el("b", { text: l.title, style: "font-size:15px;color:var(--rl-text)" }), el("b", { text: money(l.price, "GBP"), style: "color:var(--rl-text)" })]),
          el("div", { text: [l.size ? "Size " + l.size : null, l.cond, howText(l)].filter(Boolean).join(" · "), style: "font-size:13px;color:var(--rl-text2);margin-top:4px" }),
          el("div", { text: "✓ Bought at " + l.store + " " + l.ago + " for " + money(l.paid, "GBP") + ". Receipt checked by Relay.", style: "font-size:12px;color:var(--rl-accent);background:var(--rl-accent-bg);border-radius:10px;padding:6px 8px;margin-top:8px" })]);
        if (score(l)) c.appendChild(el("span", { text: score(l) === 2 ? "📍 Near you" : "📍 In your area", style: "display:inline-block;margin-top:8px;background:var(--rl-accent-bg);color:var(--rl-accent);border-radius:999px;padding:3px 10px;font-size:12px;font-weight:800" }));
        c.appendChild(el("div", { style: "display:flex;gap:6px;margin-top:10px" }, [
          el("button", { className: "rl-po-primary", text: "I'd like this", onclick: function () { chat(l, "Hi! Is the " + l.title.toLowerCase() + " still available?", [
            "Yes, it is! " + (l.how === "post" ? "I can post it this week." : "I'm in " + l.area + ". Could you collect on Saturday morning?"),
            l.how === "post" ? "Great. Once Relay payments are live you'll pay through the app; for now we'd arrange it safely here." : "Perfect, see you then. I'll message the exact spot here."]); } }),
          l.swap ? el("button", { className: "rl-po-secondary", text: "Offer a swap", onclick: function () { chat(l, "Hi! Would you swap for my Linen Shirt (M)?", ["Ooh, maybe! What colour is it?", "Sounds good, let's swap when we meet."]); } }) : null].filter(Boolean)));
        grid.appendChild(c);
      });
      body.appendChild(grid);
    }
    function chat(l, opener, replies) {
      var back = el("div", { className: "rl-back", style: "z-index:10000" });
      var sheet = el("div", { className: "rl-sheet", role: "dialog" });
      back.appendChild(sheet); document.body.appendChild(back);
      var log = el("div", { style: "display:flex;flex-direction:column;gap:8px;margin:12px 0;max-height:40vh;overflow:auto" });
      var bubble = function (t, me) { log.appendChild(el("div", { text: t, style: "max-width:80%;padding:10px 14px;border-radius:16px;font-size:15px;" + (me ? "align-self:flex-end;background:#101828;color:#fff" : "align-self:flex-start;background:var(--rl-fill);color:var(--rl-text)") })); log.scrollTop = 1e6; };
      var n = 0, reply = function () { if (n < replies.length) { var t = replies[n++]; setTimeout(function () { bubble(t, false); }, 1100); } };
      var input = el("input", { placeholder: "Write a message", maxLength: 300 });
      var send = el("button", { className: "rl-btn", text: "Send", onclick: function () { var t = input.value.trim(); if (!t) return; if (/@|(?:\d[\s-]*){9,}/.test(t)) { note.textContent = "Relay keeps phone numbers and emails out of chats, to protect you both."; return; } note.textContent = ""; bubble(t, true); input.value = ""; reply(); } });
      var note = el("div", { className: "rl-msg" });
      [el("h2", { text: l.title }), el("p", { text: "Chatting with " + l.who + " (made-up demo member) · " + money(l.price, "GBP") + " · " + howText(l), style: "color:var(--rl-text2);margin:0" }),
       el("details", { style: "background:var(--rl-fill);border-radius:14px;padding:10px 14px;margin:10px 0 0;font-size:14px" }, [el("summary", { text: "Doing the deal safely", style: "font-weight:800;cursor:pointer" }),
         el("p", { text: "Meet somewhere public, check the item, pay on the spot. Don't pay a stranger in advance by bank transfer.", style: "margin:8px 0 0" })]),
       log, input, send, note, el("button", { className: "rl-btn ghost", text: "Close", onclick: function () { back.remove(); } })].forEach(function (x) { sheet.appendChild(x); });
      bubble(opener, true); reply();
    }
    function sell() {
      body.appendChild(el("p", { text: "Things Relay found in this demo shopper's receipts. Pick one to list it: the name, shop and price paid come from the receipt, so buyers know it's genuine.", style: "color:var(--rl-text2);margin:0 0 12px;font-size:14px" }));
      MINE.filter(function (m) { return !listed.some(function (x) { return x.id === m.id; }); }).forEach(function (m) {
        var c = el("div", { className: "rl-po", style: "display:flex;gap:12px;align-items:center;padding:12px;margin-bottom:10px" }, [el("div", { style: "width:72px;flex:none" }, [pic(m.img)]),
          el("div", { style: "flex:1" }, [el("b", { text: m.title }), el("div", { text: m.store + " · " + m.ago + " · paid " + money(m.paid, "GBP"), style: "font-size:13px;color:var(--rl-text2)" })]),
          el("button", { className: "rl-po-primary", text: "List it", style: "flex:none;width:auto;padding:10px 16px", onclick: function () {
            listed.push({ id: m.id, title: m.title, img: m.img, price: Math.round(m.paid * 0.45 / 100) * 100, state: "listed" }); cur = "mine"; draw();
            setTimeout(function () { var x = listed.filter(function (q) { return q.id === m.id; })[0]; if (x) { x.state = "asked"; if (cur === "mine") draw(); } }, 2500);
          } })]);
        body.appendChild(c);
      });
    }
    function mine() {
      if (!listed.length) { body.appendChild(el("div", { className: "rl-empty" }, [el("h3", { text: "Nothing listed yet" }), el("p", { text: "Use the Sell tab to list something from your receipts." })])); return; }
      listed.forEach(function (x) {
        var c = el("div", { className: "rl-po", style: "display:flex;gap:12px;align-items:center;padding:12px;margin-bottom:10px" }, [el("div", { style: "width:72px;flex:none" }, [pic(x.img)]),
          el("div", { style: "flex:1" }, [el("b", { text: x.title + " · " + money(x.price, "GBP") }),
            el("div", { text: x.state === "listed" ? "Listed · waiting for interest…" : x.state === "asked" ? "🔔 Jordan (demo member, SW11) would like this" : "✓ Deal agreed with Jordan", style: "font-size:13px;color:" + (x.state === "asked" ? "#2f4a10;font-weight:800" : "#475467") })])]);
        if (x.state === "asked") c.appendChild(el("button", { className: "rl-po-primary", text: "Accept", style: "flex:none;width:auto;padding:10px 16px", onclick: function () { x.state = "agreed"; draw();
          chat({ title: x.title, who: "Jordan", price: x.price, how: "collect", area: "SW11" }, "Hi Jordan, it's yours! I'm in SW11. Does Sunday work?", ["Sunday's great! Outside the station at 11?", "See you then 👍"]); } }));
        body.appendChild(c);
      });
    }
    draw();
  }
  // ---- Phone alerts: price drops sent to this device. Nothing is sent unless the shopper turns it on here. ----
  function pushOk() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  function keyBytes(t) { var s = t.replace(/-/g, "+").replace(/_/g, "/"); s += "=".repeat((4 - s.length % 4) % 4); return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  function race(p, ms, fallback) { return new Promise(function (res) { var t = setTimeout(function () { res(fallback); }, ms); p.then(function (v) { clearTimeout(t); res(v); }, function () { clearTimeout(t); res(fallback); }); }); }
  function swReady() { return race(navigator.serviceWorker.ready, 10000, null).then(function (r) { if (!r) throw new Error("sw_not_ready"); return r; }); }
  function thisDevice() { return pushOk() ? race(swReady().then(function (r) { return r.pushManager.getSubscription(); }), 12000, null) : Promise.resolve(null); }
  function alertStatus() { memoDrop("alerts"); return race(cachedGet("alerts", "/relay/my/alerts/status").then(function (r) { return r.ok ? r.body : null; }), 20000, null); }
  // Watching shows at once on the phone and is sent to Relay straight after. If Relay can't be reached (no signal, or busy
  // for a moment), the change waits on this device and is sent again when the connection is back or Relay next opens, so
  // a watch never quietly goes missing. The latest change to each item or shop is the one kept.
  var PENDING_KEY = "relay.pending-watches.v1";
  function pendingAll() { var s = load(); try { var a = JSON.parse(localStorage.getItem(PENDING_KEY) || "null"); return a && s && a.email === s.email && a.items ? a : { email: s && s.email, items: {} }; } catch (e) { return { items: {} }; } }
  function pendingPut(key, job) { try { var a = pendingAll(); if (job) a.items[key] = job; else delete a.items[key]; if (Object.keys(a.items).length) localStorage.setItem(PENDING_KEY, JSON.stringify(a)); else localStorage.removeItem(PENDING_KEY); } catch (e) {} }
  function sendWatchJob(key, job) {
    pendingPut(key, job);
    return api(job.path, { method: "POST", body: job.body }).then(function (r) {
      // Sent, or refused for good (an item Relay no longer knows): either way it's done. Busy or offline: it waits.
      if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429)) pendingPut(key, null);
      return r;
    }, function () { return { ok: false, status: 0, body: {} }; });
  }
  function retryWatches() { var s = load(); if (!s || !s.token) return; var a = pendingAll(); Object.keys(a.items).forEach(function (k) { sendWatchJob(k, a.items[k]); }); }
  window.addEventListener("online", retryWatches);
  setTimeout(retryWatches, 3000);
  function syncWatch(p, on) {
    var s = load(); if (!s || !s.token || !p || !p.sku) return Promise.resolve();
    memoDrop("alerts");
    return sendWatchJob("item:" + p.sku, { path: "/relay/my/alerts/watch", body: on === false ? { sku: String(p.sku), on: false } : { sku: String(p.sku), product: p.product, variant: p.variation, store: p.store, priceMinor: Math.round(Number(p.priceMinor)) } });
  }
  function syncStore(store, on, items) {
    memoDrop("alerts");
    return sendWatchJob("shop:" + store, { path: "/relay/my/alerts/store", body: on === false ? { store: store, on: false } : { store: store, items: (items || []).map(function (p) { return { sku: String(p.sku), product: p.product, variant: p.variation, priceMinor: Math.round(Number(p.priceMinor)) }; }) } });
  }
  function enablePush() {
    if (!pushOk()) return Promise.resolve({ ok: false, reason: "unsupported" });
    return Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") return { ok: false, reason: "denied" };
      return Promise.all([swReady(), api("/relay/my/push/key")]).then(function (x) {
        if (!x[1].ok) return { ok: false, reason: "server" };
        return x[0].pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(x[1].body.publicKey) }).then(function (sub) {
          var j = sub.toJSON();
          return api("/relay/my/push/subscribe", { method: "POST", body: { endpoint: j.endpoint, keys: j.keys } }).then(function (r) {
            if (!r.ok) return { ok: false, reason: "server" };
            // Anything already on the watchlist starts being watched by the server too.
            var local = (window.relayLocalWatches && window.relayLocalWatches()) || [];
            return Promise.all(local.map(function (p) { return syncWatch(p, true); })).then(function () { memoDrop("alerts"); return { ok: true }; });
          });
        });
      });
    }).catch(function () { return { ok: false, reason: "failed" }; });
  }
  function disablePush() {
    return thisDevice().then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint;
      return sub.unsubscribe().catch(function () {}).then(function () { return api("/relay/my/push/unsubscribe", { method: "POST", body: { endpoint: ep } }); });
    }).then(function () { memoDrop("alerts"); });
  }
  // ---- Purchases the shop confirmed (orders placed with the shopper's Relay email), with exchanges done through Relay. ----
  var RETURN_REASONS = [["wrong_size", "Wrong size or fit"], ["changed_mind", "Changed my mind"], ["faulty", "Faulty or damaged"], ["not_as_described", "Not as described"]];
  var RETURN_ERR = { outside_return_window: "This order is outside the 7-day return window.", already_returned: "A return has already been started for this item.", already_exchanged: "This item was exchanged — it can't also be returned.", retailer_not_supported: "This retailer doesn't support Relay returns yet.", not_your_order: "We couldn't find this order on your account." };

  function openReturn(o, it, done) {
    // Shown as a proper sheet over the page (same look as the other Relay sheets), above the bottom bar on phones.
    var sheet = el("div", { className: "rl-sheet", role: "dialog" });
    var layer = el("div", { className: "rl-back" }, [sheet]);
    layer.addEventListener("click", function (e) { if (e.target === layer) close(); });
    document.body.appendChild(layer);
    function close() { if (layer.parentNode) layer.parentNode.removeChild(layer); }
    var msg = el("div", { className: "rl-msg" });
    var step = "reason";
    var selectedReason = null;

    // A Royal Mail label is shown only when Royal Mail actually made one (the shop connected its own Click & Drop account).
    function showLabel(result) {
      sheet.textContent = "";
      var shop = o.store || "the shop";
      var inner = el("div", { className: "sheet-inner" });
      var msg2 = el("div", { className: "rl-msg" });
      inner.appendChild(el("div", { className: "eyebrow", text: "ROYAL MAIL RETURN LABEL" }));
      inner.appendChild(el("h2", { text: "Your return label is ready" }));
      inner.appendChild(el("p", { className: "small", text: shop + " has sent you a Royal Mail " + (result.serviceName || "returns") + " label for " + (result.item || it.title) + "." }));
      if (result.qrImage) inner.appendChild(el("div", { className: "card", style: "text-align:center;margin:12px 0" }, [
        el("img", { src: result.qrImage, alt: "Royal Mail QR code for your return", style: "width:200px;height:200px;image-rendering:pixelated" }),
        el("p", { className: "small", style: "margin:8px 0 0", text: "Pack the item, then show this QR code at a Post Office counter. They'll print the label for you." })
      ]));
      inner.appendChild(el("div", { className: "card", style: "margin:0 0 12px" }, [
        el("div", { className: "eyebrow", text: "TRACKING NUMBER" }),
        el("div", { style: "font-family:monospace;font-size:18px;letter-spacing:1px;margin:4px 0", text: result.trackingNumber }),
        el("div", { className: "small muted", text: "Relay reference " + result.returnRef + ". Your refund comes from " + shop + " once they receive the item." })
      ]));
      if (result.hasPdf) inner.appendChild(el("button", { className: "rl-btn ghost", text: "Download label to print (PDF)", style: "margin-bottom:8px", onclick: function() {
        var s0 = load(), h = {}; if (s0 && s0.token) h.Authorization = "Bearer " + s0.token;
        fetch(API + "/relay/my/return/label?kind=pdf&id=" + encodeURIComponent(result.returnId), { headers: h })
          .then(function(r) { return r.ok ? r.blob() : null; })
          .then(function(b) {
            if (!b || b.type !== "application/pdf") return say(msg2, "Couldn't download the label just now. The QR code still works.", true);
            var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "royal-mail-return-label.pdf"; document.body.appendChild(a); a.click(); a.remove();
          }).catch(function() { say(msg2, "Connection error. Please try again.", true); });
      } }));
      inner.appendChild(msg2);
      inner.appendChild(el("p", { className: "small muted", text: result.shopNotified ? "We've emailed " + shop + " to say this return is coming." : "Relay hasn't been able to email " + shop + ", but the label is on their Royal Mail account." }));
      inner.appendChild(el("button", { className: "rl-btn", text: "Done", onclick: function() { close(); if (done) done(); } }));
      sheet.appendChild(inner);
    }

    // No Royal Mail label (the shop hasn't set that up, or Royal Mail didn't make one): there is no QR code to show.
    // Say exactly what happened (a request saved in Relay) and what the shopper should do.
    function showSaved(result) {
      if (result.labelAvailable && result.trackingNumber) return showLabel(result);
      sheet.textContent = "";
      var shop = o.store || "the shop";
      var inner = el("div", { className: "sheet-inner" });
      inner.appendChild(el("div", { className: "eyebrow", text: "RETURN REQUEST SAVED" }));
      inner.appendChild(el("h2", { text: "Saved in Relay" }));
      inner.appendChild(el("p", { className: "small", text: "Relay has noted that you're returning " + (result.item || it.title) + ", so it won't be offered for exchange." }));
      inner.appendChild(el("div", { className: "card", style: "background:var(--surface2,var(--rl-fill));margin:12px 0 16px" }, [
        el("div", { className: "eyebrow", text: "WHAT TO DO NEXT" }),
        el("p", { className: "small", style: "margin:6px 0 0", text: (result.shopNotified ? "We've emailed " + shop + " to say this return is coming. " : "Relay hasn't been able to contact " + shop + " about this. ") +
          (result.inStore ? "Take the item back to " + shop + " and show them your Relay reference, or send it using their own returns process. Your refund comes from " + shop + ", and Relay will show it here once they've refunded it."
            : shop + " hasn't set up Royal Mail labels in Relay, so to send the item back, use " + shop + "'s own returns process (usually in your order confirmation email or on their website). Your refund comes from " + shop + ".") })
      ]));
      inner.appendChild(el("div", { className: "card", style: "margin:0 0 16px" }, [
        el("div", { className: "eyebrow", text: "RELAY REFERENCE" }),
        el("div", { style: "font-family:monospace;font-size:18px;letter-spacing:2px;margin:4px 0", text: result.returnRef }),
        el("div", { className: "small muted", text: "For your records. This is not a postage label or tracking number." })
      ]));
      inner.appendChild(el("button", { className: "rl-btn", text: "Done", onclick: function() { close(); if (done) done(); } }));
      sheet.appendChild(inner);
    }

    function showReasonPicker() {
      sheet.textContent = "";
      var inner = el("div", { className: "sheet-inner" });
      inner.appendChild(el("div", { className: "eyebrow", text: "RETURN" }));
      inner.appendChild(el("h2", { text: "Return: " + it.title }));
      inner.appendChild(el("p", { className: "small muted", text: "What's the reason for the return?" }));
      RETURN_REASONS.forEach(function(r) {
        var btn = el("button", { className: "rl-btn ghost", text: r[1], style: "width:100%;text-align:left;margin-bottom:8px;padding:12px 16px;border-radius:10px",
          onclick: function() {
            selectedReason = r[0];
            // Confirm step
            sheet.textContent = "";
            var inner2 = el("div", { className: "sheet-inner" });
            inner2.appendChild(el("div", { className: "eyebrow", text: "CONFIRM RETURN" }));
            inner2.appendChild(el("h2", { text: it.title }));
            inner2.appendChild(el("p", { className: "small muted", text: "Relay will note this return on your account. If " + (o.store || "the shop") + " has set up Royal Mail returns in Relay, you'll get a return label straight away; if not, you'll send it back using their own returns process." }));
            inner2.appendChild(el("p", { className: "small", text: "Reason: " + r[1] }));
            inner2.appendChild(el("p", { className: "small", text: "Item price: " + money(it.priceMinor, it.currency) }));
            inner2.appendChild(msg);
            var confirmBtn = el("button", { className: "rl-btn", text: "Start return →", onclick: function() {
              confirmBtn.disabled = true; msg.textContent = "";
              api("/relay/my/return", { method: "POST", body: { orderId: o.id, lineId: it.lineId, reason: selectedReason } }).then(function(res) {
                confirmBtn.disabled = false;
                if (res.ok) { showSaved(res.body); }
                else { say(msg, RETURN_ERR[res.body && res.body.error] || "Couldn't start the return. Please try again.", true); }
              }).catch(function() { confirmBtn.disabled = false; say(msg, "Connection error. Please try again.", true); });
            }});
            inner2.appendChild(confirmBtn);
            inner2.appendChild(el("button", { className: "rl-btn ghost", text: "Back", "data-back": "", style: "margin-top:8px", onclick: showReasonPicker }));
            sheet.appendChild(inner2);
          }
        });
        inner.appendChild(btn);
      });
      inner.appendChild(el("button", { className: "rl-btn ghost", text: "Cancel", onclick: close }));
      sheet.appendChild(inner);
    }
    showReasonPicker();
  }

  var EXCHANGE_ERR = { out_of_stock: "That one has just sold out. Pick another.", already_sent: "This order has already been sent, so it can't be changed here. Use the shop's returns process instead.",
    different_price: "That option costs a different amount, which Relay can't handle yet.", shop_not_connected: "This shop isn't connected to Relay any more.",
    already_exchanged: "This item has already been exchanged.", already_returned: "You've started a return for this item, so it can't also be swapped.", not_your_order: "Relay couldn't match this order to you.", order_cancelled: "This order was cancelled.",
    card_needed: "Add a card first to pay the difference.", card_declined: "Your card didn't go through, so nothing changed. Try another card.",
    price_changed: "The price has just changed. Close this and look again.", outside_window: "It's more than 7 days since you bought this, so it can't be swapped through Relay.",
    order_not_complete: "This order isn't finished at the shop yet, so it can't be swapped." };
  function absPounds(m) { return "£" + (Math.abs(m) / 100).toFixed(2); }
  function openExchange(o, it, done) {
    open(function (sheet) {
      sheet.appendChild(el("h2", { text: "Exchange " + it.title, style: "margin:0 0 4px" }));
      sheet.appendChild(el("p", { className: "small muted", text: (o.store || "The shop") + " · you have " + (it.variant || "this item") + ". Choose what you'd like instead." }));
      var list = el("div", {}, [el("p", { text: "Checking what the shop has in stock…" })]); sheet.appendChild(list);
      var msg = el("div", { className: "rl-msg" }); sheet.appendChild(msg);
      api("/relay/my/exchange/options?orderId=" + encodeURIComponent(o.id) + "&lineId=" + encodeURIComponent(it.lineId)).then(function (r) {
        list.textContent = "";
        var opts = (r.ok && r.body && r.body.options) || [];
        if (!opts.length) { list.appendChild(el("p", { text: r.ok ? "This product has no other sizes or colours." : "Couldn't load the options." })); return; }
        var shop = o.store || "The shop", card = r.body.card;
        opts.forEach(function (x) {
          var d = x.priceDiffMinor || 0;
          var price = d > 0 ? " · " + absPounds(d) + " more" : d < 0 ? " · " + absPounds(d) + " less" : "";
          var b = el("button", { className: x.available ? "rl-btn" : "rl-btn ghost", disabled: !x.available && !x.needsCard, style: "margin:6px 0;text-align:left",
            text: x.title + (x.available ? price + (Number(x.quantity) <= 5 ? " · only " + x.quantity + " left" : " · in stock") : " · " + x.reason) });
          b.onclick = function () {
            if (x.needsCard) {
              list.textContent = ""; list.appendChild(el("p", { text: "Add a card to pay the " + absPounds(d) + " difference. Saving it charges nothing." }));
              addCard(list, function () { setTimeout(function () { close(); openExchange(o, it, done); }, 900); });
              return;
            }
            var viaShop = d > 0 && (x.payBy === "shopify" || x.payBy === "square");
            var what = d === 0 ? "Same price, nothing to pay or refund."
              : d > 0 && x.payBy === "square" ? "It costs " + absPounds(d) + " more. You'll pay the " + absPounds(d) + " to " + shop + " on Square's secure payment page, and the swap is confirmed once it's paid."
              : viaShop ? "It costs " + absPounds(d) + " more. " + shop + " will update your order and send you a link to pay the " + absPounds(d) + ", using any way of paying " + shop + " accepts. Your new " + (x.title || "item") + " is kept for you."
              : d > 0 ? "It costs " + absPounds(d) + " more. We'll take " + absPounds(d) + " from your " + (card ? cardText(card) : "card") + " only once the shop has updated your order. (Test mode: no real money.)"
              : "It costs " + absPounds(d) + " less. " + shop + " will refund the " + absPounds(d) + " to how you paid.";
            ask("Swap " + (it.variant || it.title) + " for " + x.title + "? " + what, viaShop ? "Swap, then pay " + absPounds(d) : d > 0 ? "Swap and pay " + absPounds(d) : "Yes, swap it", function () {
              list.querySelectorAll("button").forEach(function (n) { n.disabled = true; });
              say(msg, "Asking " + (o.store || "the shop") + " to update your order…");
              api("/relay/my/exchange", { method: "POST", body: { orderId: o.id, lineId: it.lineId, variantKey: x.key, agreedDiffMinor: d } }).then(function (res) {
                if (res.ok) {
                  say(msg, res.body.message); list.textContent = "";
                  // Shopify's own payment page for the extra, on the shop's checkout (opens in a new tab).
                  if (res.body.payUrl && /^https:\/\//.test(res.body.payUrl))
                    list.appendChild(el("a", { className: "rl-btn", href: res.body.payUrl, target: "_blank", rel: "noopener noreferrer", text: "Pay " + absPounds(d) + " to " + shop + " →", style: "text-align:center;text-decoration:none;margin-bottom:8px" }));
                  list.appendChild(el("button", { className: res.body.payUrl ? "rl-btn ghost" : "rl-btn", text: "Done", onclick: function () { close(); if (done) done(); } }));
                  return;
                }
                say(msg, EXCHANGE_ERR[res.body && res.body.error] || "The shop didn't accept the change. Please try again, or contact the shop.", true);
                list.querySelectorAll("button").forEach(function (n) { n.disabled = false; });
              });
            });
          };
          list.appendChild(b);
        });
      });
      sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Close", style: "margin-top:10px", onclick: close }));
    });
  }
  // ---- Search by photo (Discover): a screenshot or a picture, and the closest items from shops on Relay. ----
  // The picture is made smaller here first (which also drops its hidden details, like where a photo was taken), then sent
  // to Relay, which asks Claude what it is and which items on Relay are closest (worker/photo-search.js). Nothing of it is
  // kept. Shown only when it's on (the AI key is set).
  var photoOn = null, PHOTO_OK_KEY = "relay.photo-ok";
  function photoAvailable() {
    if (photoOn === null && load()) {
      photoOn = false;
      cachedGet("photo", "/relay/my/photo-search").then(function (r) {
        photoOn = Boolean(r.ok && r.body && r.body.available);
        var b = document.getElementById("dcCam"); if (b) b.hidden = !(photoOn || (typeof window.testTools === "function" && window.testTools()));
      }, function () { photoOn = null; });
    }
    return Boolean(photoOn);
  }
  var PHOTO_ERR = { too_many_searches: "That's 30 photo searches today. Try again tomorrow.", image_unreadable: "Couldn't read that picture. Try another photo or screenshot.",
    busy: "Photo search is busy right now. Try again in a minute.", ai_off: "Photo search isn't available right now." };
  // The picture, at most 1024 pixels across, as a JPEG. null if it can't be read.
  function shrinkPhoto(file) {
    return new Promise(function (done) {
      if (!file || !/^image\//.test(file.type || "")) return done(null);
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var k = Math.min(1, 1024 / Math.max(im.naturalWidth || 1, im.naturalHeight || 1)), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
        var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        try { done(c.toDataURL("image/jpeg", 0.82)); } catch (e) { done(null); }
      };
      im.onerror = function () { URL.revokeObjectURL(url); done(null); };
      im.src = url;
    });
  }
  function photoSearch(opts) {
    opts = opts || {};
    if (!load()) return show();
    // Only Relay's testing tools show the camera while it's off: say why, and what turns it on.
    if (photoOn === false) return photoOffSheet();
    var input = el("input", { type: "file", accept: "image/*" }); input.hidden = true;
    input.addEventListener("change", function () { var f = input.files && input.files[0]; input.remove(); if (f) photoSheet(f, opts); });
    document.body.appendChild(input);
    input.click();
  }
  function photoOffSheet() {
    var sheet = el("div", { className: "rl-sheet rl-ps", role: "dialog", ariaModal: "true", ariaLabel: "Search by photo" });
    var layer = el("div", { className: "rl-back" }, [sheet]);
    function close() { if (layer.parentNode) layer.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    layer.addEventListener("click", function (e) { if (e.target === layer) close(); });
    document.addEventListener("keydown", onKey);
    [el("h2", { className: "rl-xs-h", text: "Search by photo is off" }),
      el("p", { className: "rl-ps-note", text: "It needs Relay's Anthropic key. In Cloudflare, open Workers & Pages, then relay-square-api2, Settings, Variables and Secrets. Add a secret named ANTHROPIC_API_KEY with the key from console.anthropic.com, then reload Relay." }),
      el("p", { className: "rl-ps-note", text: "The same key turns on the help chat and AI help for receipts." }),
      el("button", { className: "rl-btn", text: "Close", onclick: close })].forEach(function (n) { sheet.appendChild(n); });
    document.body.appendChild(layer);
  }
  function photoSheet(file, opts) {
    var sheet = el("div", { className: "rl-sheet rl-ps", role: "dialog", ariaModal: "true", ariaLabel: "Search by photo" });
    var layer = el("div", { className: "rl-back" }, [sheet]), busy = false;
    function close() { if (layer.parentNode) layer.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    layer.addEventListener("click", function (e) { if (e.target === layer) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(layer);
    sheet.appendChild(el("h2", { className: "rl-xs-h", text: "Search by photo" }));
    var pic = el("img", { className: "rl-ps-pic", alt: "The picture you chose" }); sheet.appendChild(pic);
    var note = el("p", { className: "rl-ps-note", text: "Your picture is sent to Claude, an AI made by Anthropic, to see what's in it and find the closest items from shops on Relay. Relay doesn't keep the picture." });
    var out = el("div"), msg = el("div", { className: "rl-msg" });
    var again = el("button", { className: "rl-btn ghost", text: "Try another photo", onclick: function () { close(); photoSearch(opts); } });
    [note, out, msg].forEach(function (n) { sheet.appendChild(n); });
    var shut = el("button", { className: "rl-btn ghost", text: "Close", onclick: close });
    shrinkPhoto(file).then(function (data) {
      if (!layer.parentNode) return;
      if (!data) { say(msg, PHOTO_ERR.image_unreadable, true); sheet.appendChild(again); sheet.appendChild(shut); return; }
      pic.src = data;
      var seen = false; try { seen = localStorage.getItem(PHOTO_OK_KEY) === "1"; } catch (e) {}
      if (seen) return search(data);
      // The first time on this device: what happens to the picture, before it's sent.
      var go = el("button", { className: "rl-btn", text: "Find it", onclick: function () { try { localStorage.setItem(PHOTO_OK_KEY, "1"); } catch (e) {} go.remove(); search(data); } });
      out.appendChild(go); sheet.appendChild(shut);
    });
    function search(data) {
      if (busy) return; busy = true;
      out.textContent = ""; say(msg, "");
      var grid = el("div", { className: "rl-ps-grid" }); grid.setAttribute("aria-busy", "true");
      for (var i = 0; i < 4; i++) grid.appendChild(el("div", { className: "rl-skel rl-ps-skel" }));
      out.appendChild(grid);
      if (!shut.parentNode) sheet.appendChild(shut);
      api("/relay/my/photo-search", { method: "POST", body: { image: data, test: Boolean(opts.test), web: Boolean(opts.web) } }).then(function (r) {
        busy = false;
        if (!layer.parentNode) return;
        out.textContent = "";
        if (!r.ok) { say(msg, PHOTO_ERR[r.body && r.body.error] || "Couldn't search just now. Please try again.", true); sheet.insertBefore(again, shut); return; }
        var b = r.body || {}, results = b.results || [];
        if (!b.found) {
          out.appendChild(el("div", { className: "rl-empty" }, [el("h3", { text: "Couldn't see a product" }), el("p", { text: "Try a photo or screenshot where the item fills most of the picture." })]));
          sheet.insertBefore(again, shut); return;
        }
        if (b.item) out.appendChild(el("p", { className: "rl-ps-looks", text: "Looks like: " + b.item }));
        if (!results.length) {
          out.appendChild(el("div", { className: "rl-empty" }, [el("h3", { text: "Nothing like it on Relay yet" }),
            el("p", { text: "As more shops join Relay, there's more to find. You can also search by name." })]));
          if (b.item) out.appendChild(el("button", { className: "rl-btn", text: "Search for “" + b.item + "”", onclick: function () { close(); if (window.relaySearchFor) window.relaySearchFor(b.item); } }));
          sheet.insertBefore(again, shut); return;
        }
        var list = el("div", { className: "rl-ps-grid" });
        results.forEach(function (x) {
          var img = el("div", { className: "rl-ps-img" }); img.setAttribute("aria-hidden", "true");
          var draw = function () { var o = { items: [{ name: x.product }], retailer: { name: x.storeName } }; o.category = ILL_KIND[illKey(o)] || "other"; illustrate(img, o, 40); };
          if (x.imageUrl && /^https:\/\//.test(x.imageUrl)) { var ph = el("img", { src: x.imageUrl, alt: "", referrerPolicy: "no-referrer", loading: "lazy" }); ph.onerror = function () { ph.remove(); draw(); }; img.appendChild(ph); } else draw();
          var price = (x.maxPriceMinor ? "From " : "") + money(x.priceMinor, "GBP");
          list.appendChild(el("button", { type: "button", className: "rl-ps-item", ariaLabel: x.product + (x.variation ? ", " + x.variation : "") + ", " + price + ", from " + x.storeName + (x.inStock === false ? ", out of stock" : ""),
            onclick: function () { close(); if (window.relayOpenProduct) window.relayOpenProduct(x.sku, x.product); } },
            [img, el("b", { text: x.product }), el("span", { text: [x.variation, x.storeName].filter(Boolean).join(" · ") }), el("span", { className: "rl-ps-price", text: price + (x.inStock === false ? " · out of stock" : "") })]));
        });
        out.appendChild(list);
        sheet.insertBefore(again, shut);
      }, function () { busy = false; out.textContent = ""; say(msg, "Couldn't reach Relay. Check your connection and try again.", true); sheet.insertBefore(again, shut); });
    }
  }
  // ---- Swap with another shop: send an item back to the shop it came from and get something from another shop on Relay. ----
  // Relay starts the return at the first shop and opens the second shop's own checkout with the new item in the basket. The
  // shopper pays the second shop there, and the first shop refunds them once the item is back: Relay takes no money
  // (worker/cross-swap.js). The second shop's order shows the swap as done once it reaches Relay.
  var CROSS_ERR = { not_your_order: "Relay couldn't match this order to you.", outside_return_window: "It's more than 7 days since you bought this, so Relay can't start a return for it.",
    already_returned: "A return has already been started for this item.", already_exchanged: "This item has already been swapped for another size or colour.",
    retailer_not_supported: "Swaps with another shop work for orders from shops on Relay through Shopify.", reason_needed: "Pick why you're sending it back.",
    not_an_option: "That item isn't available for a swap any more. Pick another.", out_of_stock: "That one has just sold out. Pick another.",
    shop_unavailable: "That shop isn't answering right now. Try again in a minute.", already_swapping: "A swap for this item has just started. Close this and look again." };
  // A picture of an item: the shop's own photo, or a drawing when there isn't one (or it won't load).
  function itemPic(x, px) {
    var box = el("div", { className: "rl-xs-pic" }); box.setAttribute("aria-hidden", "true");
    var draw = function () { illustrate(box, { items: [{ name: x.product || x.title || "" }], retailer: { name: x.shop || "" }, category: "other" }, px || 30); };
    if (x.imageUrl && /^https:\/\//.test(x.imageUrl)) { var im = el("img", { src: x.imageUrl, alt: "" }); im.onerror = function () { im.remove(); draw(); }; box.appendChild(im); } else draw();
    return box;
  }
  // Testing tools only: buys the item at one of Relay's Shopify test shops with a test order (no card, no real money).
  function testBuy(host, toKey, toShop, after) {
    var msg = el("div", { className: "rl-msg" });
    var b = el("button", { className: "rl-btn ghost", text: "Test shop: place this order at " + toShop, onclick: function () {
      b.disabled = true; say(msg, "Placing the test order…");
      api("/relay/my/testing/shopify-order", { method: "POST", body: { variantKey: toKey } }).then(function (r) {
        if (r.ok && r.body && r.body.ok) { say(msg, r.body.message); setTimeout(after, 900); return; }
        b.disabled = false;
        say(msg, testOrderError(r.body && r.body.error), true);
      }, function () { b.disabled = false; say(msg, "Couldn't reach Relay. Please try again.", true); });
    } });
    host.appendChild(b); host.appendChild(msg);
  }
  function testOrderError(e) {
    return e === "too_many_test_orders" ? "That's 5 test orders today. Try again tomorrow."
      : e === "shop_cannot_order" ? "This test shop hasn't let Relay place orders yet. Open Relay in the shop's Shopify admin to update its permissions, then try again."
      : "The test shop didn't take the order. Please try again in a minute.";
  }
  function openCrossSwap(o, it, done) {
    var shopA = o.store || "the shop", started = false, picked = null;
    var sheet = el("div", { className: "rl-sheet rl-xs", role: "dialog", ariaModal: "true", ariaLabel: "Swap with another shop" });
    var layer = el("div", { className: "rl-back" }, [sheet]);
    function close() { if (!layer.parentNode) return; layer.remove(); document.removeEventListener("keydown", onKey); if (started && done) done(); }
    function onKey(e) { if (e.key === "Escape") close(); }
    layer.addEventListener("click", function (e) { if (e.target === layer) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(layer);
    function frame(title, lead) {
      sheet.textContent = ""; try { sheet.scrollTop = 0; } catch (e) {}
      sheet.appendChild(el("h2", { className: "rl-xs-h", text: title }));
      if (lead) sheet.appendChild(el("p", { className: "rl-xs-lead", text: lead }));
    }
    // 1. What other shops on Relay have in stock.
    function pick() {
      frame("Swap it for something from another shop", "Send " + it.title + " back to " + shopA + " and choose something from another shop on Relay instead.");
      var list = el("div", { className: "rl-xs-list" }); list.setAttribute("aria-busy", "true");
      for (var i = 0; i < 4; i++) list.appendChild(el("div", { className: "rl-skel rl-xs-skel" }));
      var msg = el("div", { className: "rl-msg" });
      sheet.appendChild(list); sheet.appendChild(msg);
      sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Close", onclick: close }));
      var draw = function (r) {
        list.textContent = ""; list.removeAttribute("aria-busy");
        if (!r.ok) return say(msg, CROSS_ERR[r.body && r.body.error] || "Couldn't load what other shops have. Check your connection and try again.", true);
        if (!r.body.eligible) return say(msg, CROSS_ERR[r.body.reason] || "This item can't be swapped with another shop.", true);
        var shops = r.body.shops || [];
        if (!shops.length) return list.appendChild(el("div", { className: "rl-empty" }, [el("h3", { text: "Nothing to swap to yet" }),
          el("p", { text: "No other shop on Relay has something in stock right now. You can still return it to " + shopA + " for a refund." })]));
        shops.forEach(function (sh) {
          list.appendChild(el("h3", { className: "rl-xs-shop", text: sh.name }));
          sh.items.forEach(function (x) {
            list.appendChild(el("button", { type: "button", className: "rl-xs-item", ariaLabel: x.product + (x.variant ? ", " + x.variant : "") + ", " + money(x.priceMinor, "GBP") + ", from " + sh.name,
              onclick: function () { picked = { shop: sh.name, item: x }; review(x.priceMinor); } },
              [itemPic({ product: x.product, imageUrl: x.imageUrl, shop: sh.name }, 30), el("span", { className: "rl-xs-name" }, [el("b", { text: x.product }), el("span", { text: x.variant || "One size" })]),
                el("span", { className: "rl-xs-price", text: money(x.priceMinor, "GBP") })]));
          });
        });
      };
      api("/relay/my/cross-swap/options?orderId=" + encodeURIComponent(o.id) + "&lineId=" + encodeURIComponent(it.lineId), { fresh: true })
        .then(function (r) { if (layer.parentNode) draw(r); }, function () { if (layer.parentNode) draw({ ok: false, body: {} }); });
    }
    // 2. Both halves of the swap, what it costs overall, and why it's going back.
    function review(price, note) {
      var x = picked.item, diff = price - (Number(it.priceMinor) || 0), reason = null;
      frame("Check the swap");
      sheet.appendChild(el("div", { className: "rl-xs-leg" }, [el("span", { text: "Send back to " + shopA }), el("b", { text: it.title + (it.variant ? " (" + it.variant + ")" : "") }),
        el("span", { text: money(it.priceMinor, it.currency) + ". " + shopA + " refunds you to how you paid once they get it back." })]));
      sheet.appendChild(el("div", { className: "rl-xs-leg" }, [el("span", { text: "Get from " + picked.shop }), el("b", { text: x.product + (x.variant ? " (" + x.variant + ")" : "") }),
        el("span", { text: money(price, "GBP") + ". You pay " + picked.shop + " at their own checkout." })]));
      sheet.appendChild(el("p", { className: "rl-xs-net", text: diff === 0 ? "Same price: once the refund arrives, you'll have paid the same overall."
        : "Once the refund arrives, you'll have paid " + money(Math.abs(diff), "GBP") + (diff > 0 ? " more" : " less") + " overall." }));
      sheet.appendChild(el("p", { className: "rl-xs-q", text: "Why are you sending it back?" }));
      var group = el("div", { className: "rl-xs-reasons", role: "radiogroup", ariaLabel: "Why are you sending it back?" });
      RETURN_REASONS.forEach(function (rr) {
        var chip = el("button", { type: "button", className: "rl-xs-chip", role: "radio", text: rr[1], onclick: function () {
          reason = rr[0]; group.querySelectorAll("button").forEach(function (n) { n.setAttribute("aria-checked", n === chip ? "true" : "false"); }); say(msg, "");
        } });
        chip.setAttribute("aria-checked", "false"); group.appendChild(chip);
      });
      sheet.appendChild(group);
      sheet.appendChild(el("p", { className: "rl-xs-small", text: "Relay doesn't take any payment: your refund comes from " + shopA + ", and you pay " + picked.shop + " directly." }));
      var msg = el("div", { className: "rl-msg" });
      var go = el("button", { className: "rl-btn", text: "Start the swap", onclick: function () {
        if (!reason) return say(msg, CROSS_ERR.reason_needed, true);
        go.disabled = true; say(msg, "Starting the return with " + shopA + "…");
        api("/relay/my/cross-swap", { method: "POST", body: { orderId: o.id, lineId: it.lineId, toKey: x.key, reason: reason, agreedPriceMinor: price } }).then(function (r) {
          if (!layer.parentNode) return;
          if (r.ok) { started = true; return finished(r.body); }
          var e = r.body && r.body.error;
          if (e === "price_changed" && Number.isInteger(r.body.priceMinor)) return review(r.body.priceMinor, picked.shop + " now charges " + money(r.body.priceMinor, "GBP") + " for it. Check the swap again.");
          go.disabled = false; say(msg, CROSS_ERR[e] || "Couldn't start the swap. Please try again.", true);
        }, function () { go.disabled = false; say(msg, "Couldn't reach Relay. Check your connection and try again.", true); });
      } });
      sheet.appendChild(msg); sheet.appendChild(go);
      sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Back", "data-back": "", onclick: pick }));
      if (note) say(msg, note, true);
    }
    // 3. The return has started; what to do at each shop.
    function finished(b) {
      frame("Return started with " + shopA);
      if (b.labelAvailable && b.trackingNumber) {
        if (b.qrImage && /^data:image\//.test(b.qrImage)) sheet.appendChild(el("img", { className: "rl-xs-qr", src: b.qrImage, alt: "Royal Mail QR code for your return" }));
        sheet.appendChild(el("p", { className: "rl-xs-p", text: "Pack the item and show this QR code at a Post Office counter. Royal Mail tracking number: " + b.trackingNumber + "." }));
      }
      sheet.appendChild(el("div", { className: "rl-xs-ref" }, [el("span", { text: "Relay reference" }), el("b", { text: b.returnRef }),
        el("span", { text: "For your records. It isn't a postage label or tracking number." })]));
      sheet.appendChild(el("p", { className: "rl-xs-p", text: (b.labelAvailable ? (b.shopNotified ? "Relay has emailed " + shopA + " to say it's coming back. " : "")
        : b.shopNotified ? "Relay has emailed " + shopA + " to say it's coming back. Send it back using " + shopA + "'s own returns process. "
        : "Relay couldn't email " + shopA + ", so send it back using their own returns process. ") + "Your refund comes from " + shopA + " once they get it." }));
      sheet.appendChild(el("h3", { className: "rl-xs-shop", text: "Next: buy it from " + b.toShop }));
      sheet.appendChild(el("p", { className: "rl-xs-p", text: b.toTitle + ", " + money(b.toPriceMinor, "GBP") + ". This opens " + b.toShop + "'s own checkout with it in your basket. Use your Relay email there, so Relay can show the swap as done." }));
      if (/^https:\/\//.test(b.buyUrl || "")) sheet.appendChild(el("a", { className: "rl-btn rl-xs-buy", href: b.buyUrl, target: "_blank", rel: "noopener noreferrer" },
        [el("span", { text: "Go to " + b.toShop + "'s checkout" }), jIc("ext", 18)]));
      if (b.testOrders && testingOn() && b.toKey) testBuy(sheet, b.toKey, b.toShop, close);
      sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Done", onclick: close }));
    }
    pick();
  }
  // ---- Test orders at Relay's Shopify test shops (development stores): testing tools only. ----
  function mountShopifyTest(host, done) {
    api("/relay/shopify/catalogue?test=1").then(function (r) {
      var items = ((r.ok && r.body && r.body.products) || []).filter(function (p) { return p.testShop && p.testOrders && Number(p.quantity) > 0 && p.currency === "GBP" && p.sku; });
      if (!items.length) return;
      var card = el("details", { className: "card", style: "padding:14px 16px;margin-top:10px" });
      card.appendChild(el("summary", { text: "Testing: place a test order at a Shopify test shop", style: "font-weight:700;cursor:pointer;min-height:44px;display:flex;align-items:center" }));
      card.appendChild(el("p", { className: "small muted", style: "margin:8px 0 10px", text: "Places an order at one of Relay's Shopify test shops under your Relay email, marked as a test in Shopify. No card, no receipt email and no real money. Up to 5 a day." }));
      var pick = el("select", { ariaLabel: "Item to order", style: "width:100%;min-height:44px;padding:10px;border-radius:12px;border:1px solid var(--rl-line);background:var(--rl-card);color:var(--rl-text);font:inherit;margin-bottom:8px" });
      items.forEach(function (p) { pick.appendChild(el("option", { value: p.sku, text: [p.storeName, p.product, p.variation && !/^default title$/i.test(p.variation) ? p.variation : null, money(p.priceMinor, "GBP")].filter(Boolean).join(" · ") })); });
      var msg = el("div", { className: "rl-msg" });
      var go = el("button", { className: "darkbtn", text: "Place test order", onclick: function () {
        go.disabled = true; say(msg, "Placing the test order…");
        api("/relay/my/testing/shopify-order", { method: "POST", body: { variantKey: pick.value } }).then(function (p) {
          go.disabled = false;
          if (p.ok && p.body && p.body.ok) { say(msg, p.body.message); setTimeout(done, 1200); return; }
          say(msg, testOrderError(p.body && p.body.error), true);
        }, function () { go.disabled = false; say(msg, "Couldn't reach Relay. Please try again.", true); });
      } });
      [pick, go, msg].forEach(function (n) { card.appendChild(n); });
      host.appendChild(card);
    }).catch(function () {});
  }
  // Test shop tools (Square sandbox test orders, test refunds, card-only test payments) only for people testing Relay:
  // switched on with ?testtools=1 or ?testing=1, or by Relay's team in Profile → Team. Shoppers never see them.
  // The Market isn't part of the launch: it shows for people testing Relay and in the ?demo=1 walkthrough.
  // Swap & resell is open to every shopper. It has no tab of its own: Profile, Discover and receipts past their return date
  // lead to it (the Market tab is only among the testing tools).
  function marketOn() { return true; }
  function testingOn() {
    try { return /[?&]testing=1(&|$)/.test(location.search) || localStorage.getItem("relay-testing-tools") === "1"; } catch (e) { return false; }
  }
  function shortDate(d) {
    var t = new Date(d); if (isNaN(t)) return "";
    var o = { day: "numeric", month: "short" }; if (t.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
    return t.toLocaleDateString("en-GB", o);
  }
  // One shop-confirmed item: picture, shop, what it is, price, where it's up to, and what you can do.
  function confirmedCard(o, it, redraw, deadline) {
    var card = el("div", { className: "rl-po" });
    var img = el("div", { className: "rl-po-img" });
    img.setAttribute("aria-hidden", "true");
    // The shop's own product photo; without one, a drawing of the item (never just initials).
    var drawIt = function () { illustrate(img, { items: [{ name: it.title }], retailer: { name: o.store }, category: "other" }, 36); };
    if (it.imageUrl && /^https:\/\//.test(it.imageUrl)) { var ph = el("img", { src: it.imageUrl, alt: "" }); ph.onerror = function () { ph.remove(); drawIt(); }; img.appendChild(ph); } else drawIt();
    // As the email cards: the shop's name and the price, then size and date (and the item's name when there's no photo).
    var hasPhoto = Boolean(it.imageUrl && /^https:\/\//.test(it.imageUrl));
    var info = el("div", { className: "rl-po-info" }, [
      el("div", { className: "rl-po-head" }, [el("h3", { className: "rl-po-brand", text: o.store || "Shop" }), el("div", { className: "rl-po-price", text: money(it.priceMinor, it.currency) })]),
      el("div", { className: "rl-po-meta", text: [hasPhoto ? null : it.title, it.variant, it.quantity > 1 ? "×" + it.quantity : null, shortDate(o.orderedAt)].filter(Boolean).join(" · ") })]);
    if (hasPhoto) info.insertBefore(el("span", { className: "rl-sr", text: it.title }), info.childNodes[1]);
    card.appendChild(el("div", { className: "rl-po-top" }, [img, info]));
    var status = function (text, done) { card.appendChild(el("div", { className: "rl-po-status" + (done ? "" : " wait"), text: text })); };
    var shopName = o.store || "the shop";
    if (deadline) card.appendChild(dueBar(deadline, "Swap or return by ", String(o.orderedAt || "").slice(0, 10)));
    if (it.exchange && it.exchange.status === "awaiting_payment") status("Swapping" + (it.exchange.fromTitle ? " from " + it.exchange.fromTitle : "") + " to " + it.exchange.toTitle + " once you've paid the difference", false);
    else if (it.exchange) status("✓ Swapped" + (it.exchange.fromTitle ? " from " + it.exchange.fromTitle : "") + " to " + it.exchange.toTitle, true);
    var actions = el("div", { className: "rl-po-actions" });
    if (it.exchange && it.exchange.balance) {
      var bal = it.exchange.balance;
      if (bal.paid) status("✓ " + money(bal.owedMinor, it.currency) + " difference paid to " + shopName, true);
      else {
        status(money(bal.owedMinor, it.currency) + " still to pay " + shopName + " for the swap" + (bal.payUrl ? "." : ". Use the link in " + shopName + "'s email."), false);
        if (bal.payUrl && /^https:\/\//.test(bal.payUrl)) actions.appendChild(el("a", { className: "rl-po-primary", href: bal.payUrl, target: "_blank", rel: "noopener noreferrer", text: "Pay " + money(bal.owedMinor, it.currency) + " to " + shopName }));
      }
    }
    if (it.returnInfo) {
      var ri = it.returnInfo, refunded = ri.status === "refunded";
      status(refunded ? "✓ Refunded" + (ri.refundMinor ? " " + money(ri.refundMinor, it.currency) : "") + " by " + shopName + (ri.refundedAt ? " on " + shortDate(ri.refundedAt) : "")
        : "Return started · ref " + ri.ref + (ri.trackingNumber ? " · Royal Mail " + ri.trackingNumber : "") + ". Waiting for " + shopName + " to refund.", refunded);
      if (!refunded && o.testOrder && testingOn()) {
        var tm = el("div", { className: "rl-msg" });
        var tb = el("button", { className: "rl-po-secondary", text: "Test shop: refund it", onclick: function () {
          tb.disabled = true; say(tm, "Asking the test shop to refund it…");
          api("/relay/my/testing/square-refund", { method: "POST", body: { orderId: o.id, lineId: it.lineId } }).then(function (r) {
            tb.disabled = false;
            if (r.ok && r.body && r.body.refunded) { say(tm, "✓ Refunded by the test shop"); setTimeout(redraw, 1000); }
            else if (r.ok) say(tm, "The test shop has started the refund. Press again in a minute, or it'll show within the hour.");
            else say(tm, "The test shop couldn't refund it just now. Please try again in a minute.", true);
          }, function () { tb.disabled = false; say(tm, "Couldn't reach Relay. Please try again.", true); });
        } });
        actions.appendChild(tb); card.appendChild(tm);
      }
    }
    // Swapped for something from another shop on Relay: where it's got to, and that shop's checkout until it's bought.
    var xs = it.crossSwap;
    if (xs && xs.status === "ordered") status("Swapped for " + xs.toTitle + " from " + xs.toShop + (xs.orderedAt ? ", ordered " + shortDate(xs.orderedAt) : "") + ".", true);
    else if (xs) {
      status("Swapping for " + xs.toTitle + " from " + xs.toShop + ". Buy it there with your Relay email to finish.", false);
      if (/^https:\/\//.test(xs.buyUrl || "")) actions.appendChild(el("a", { className: "rl-po-primary", href: xs.buyUrl, target: "_blank", rel: "noopener noreferrer", text: "Buy it from " + xs.toShop }));
      var stopMsg = el("div", { className: "rl-msg" });
      var stopBtn = el("button", { className: "rl-po-secondary", text: "Stop the swap", onclick: function () {
        ask("Stop swapping for " + xs.toTitle + " from " + xs.toShop + "? Your return to " + shopName + " still goes ahead, and " + shopName + " refunds you as usual.", "Stop the swap", function () {
          if (stopBtn.disabled) return;
          stopBtn.disabled = true;
          api("/relay/my/cross-swap/" + xs.id + "/cancel", { method: "POST" }).then(function (r) {
            if (r.ok) return redraw();
            stopBtn.disabled = false;
            say(stopMsg, r.body && r.body.error === "already_ordered" ? "You've already bought it from " + xs.toShop + ", so the swap is done." : "Couldn't stop the swap. Please try again.", true);
          }, function () { stopBtn.disabled = false; say(stopMsg, "Couldn't reach Relay. Check your connection and try again.", true); });
        });
      } });
      actions.appendChild(stopBtn);
      if (xs.testOrders && xs.toKey && testingOn()) { var tbx = el("div", { style: "flex:1 1 100%" }); testBuy(tbx, xs.toKey, xs.toShop, redraw); actions.appendChild(tbx); }
      card.appendChild(stopMsg);
    }
    if (it.boughtInSwap) status("Bought in a swap for " + it.boughtInSwap.fromTitle + " from " + it.boughtInSwap.fromShop + ".", true);
    if (it.exchangeable) actions.appendChild(el("button", { className: "rl-po-primary", text: "Swap", title: "Swap for another size or colour", onclick: function () { openExchange(o, it, redraw); } }));
    if (it.returnable) actions.appendChild(el("button", { className: "rl-po-secondary", text: "Return", onclick: function () { openReturn(o, it, redraw); } }));
    if (it.returnable && it.otherShops) actions.appendChild(el("button", { className: "rl-po-secondary", text: "Swap with another shop", onclick: function () { openCrossSwap(o, it, redraw); } }));
    if (actions.childNodes.length) card.appendChild(actions);
    return card;
  }
  // "Return by 14 Nov · 13 days left", red when it's close.
  // How a date is put: the shop's own ("Return by"), the least the law allows from delivery ("at least"), or one Relay
  // worked out from the order date, which is the safe one to go by ("To be safe, return by").
  function deadlineLead(x, dl, plain) {
    var by = x.returnBy && dl === x.returnBy.date ? x.returnBy : null;
    return !by ? plain : by.estimate ? "To be safe, return by " : plain;
  }
  // A card's return date as a countdown, the way the welcome story drew it: the date, the days left, and a bar that fills
  // as the time to send it back runs out (green, then amber in the last week, then red in the last three days).
  function dueBar(dl, lead, fromDay) {
    var d = daysLeft(dl), day = new Date(dl + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    var left = d === null || d < 0 ? "" : d === 0 ? "Last day" : d === 1 ? "1 day left" : d + " days left";
    var box = el("div", { className: "rl-due " + (d !== null && d <= 3 ? "urgent" : d !== null && d <= 7 ? "soon" : "ok") },
      [el("div", { className: "rl-due-t" }, [el("span", { text: (lead || "Return by ") + day })].concat(left ? [el("b", { text: left })] : []))]);
    var from = /^\d{4}-\d{2}-\d{2}/.test(fromDay || "") ? Date.parse(fromDay.slice(0, 10) + "T00:00:00Z") : NaN, total = (Date.parse(dl + "T00:00:00Z") - from) / 864e5;
    if (d !== null && d >= 0 && total >= 1) {
      var bar = el("div", { className: "rl-due-bar" }, [el("i", { style: "width:" + Math.round(Math.min(1, Math.max(0.05, 1 - d / total)) * 100) + "%" })]);
      bar.setAttribute("aria-hidden", "true"); box.appendChild(bar);
    }
    return box;
  }
  // When a card's return time started: the delivery day when the date counts from delivery, otherwise the order day.
  function dueFrom(x) { return x.returnBy && x.returnBy.from === "delivery" && x.delivery && x.delivery.at ? x.delivery.at : x.orderDate; }
  function deadlineChip(dl, lead) {
    var d = daysLeft(dl), day = new Date(dl + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    var txt = (lead || "Return by ") + day + (d === null ? "" : d === 0 ? " · last day" : d === 1 ? " · 1 day left" : " · " + d + " days left");
    return el("div", { className: "rl-po-status " + (d !== null && d <= 3 ? "urgent" : "wait"), text: txt });
  }
  var label = function (t) { return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); };
  // The item a receipt's card is named after: one of the receipt's own kind (a supermarket shop is named after its food,
  // not its kitchen roll), the one that cost the most, so an order of a denim jacket and a loaf is "Denim Jacket + 1 more".
  // Without prices, the first of them.
  function headlineItem(x) {
    var items = (x.items || []).filter(function (i) { return i && i.name; });
    if (!items.length) return null;
    var cost = function (i) { return Number.isInteger(i.pricePence) ? i.pricePence * (Number(i.qty) > 1 && !i.lineTotal ? Number(i.qty) : 1) : -1; };
    var own = items.filter(function (i) { return !i.category || i.category === x.category; });
    var pool = own.length ? own : items;
    return pool.reduce(function (best, i) { return cost(i) > cost(best) ? i : best; }, pool[0]);
  }
  function receiptTitle(x) {
    var items = (x.items || []).filter(function (i) { return i.name; });
    if (!items.length) return "Order from " + ((x.retailer && x.retailer.name) || "this shop");
    return headlineItem(x).name + (items.length > 1 ? " + " + (items.length - 1) + " more" : "");
  }
  // A purchase found in an email receipt: the shop handles the return, so Relay links to it and shows the deadline and parcel.
  // The card says what it is, where it's from, the price and the time left to send it back; tapping it opens its page
  // (a sheet) with what you can do: start the return, say you're sending it back, see the receipt.
  function emailCard(x, opts) {
    opts = opts || {};
    var who = (x.retailer && (x.retailer.name || x.retailer.domain)) || "Shop";
    var card = el("div", { className: "rl-po rl-tap" });
    var img = el("div", { className: "rl-po-img" });
    img.setAttribute("aria-hidden", "true");
    receiptPic(img, x, 36, 44);
    // One item of a multi-item order gets its own card (opts.item is its position on the receipt).
    var one = opts.item != null ? (x.items || [])[opts.item] : null;
    var first = one || headlineItem(x) || {};
    var date = x.orderDate ? new Date(x.orderDate + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;
    var price = one ? (Number.isInteger(one.pricePence) ? money(one.pricePence * (Number(one.qty) > 1 && !one.lineTotal ? Number(one.qty) : 1), x.currency) : "") : x.totalPence == null ? "" : money(x.totalPence, x.currency);
    var named = (x.items || []).filter(function (i) { return i && i.name; });
    var itemName = one ? one.name : named.length ? receiptTitle(x) : null;
    var count = one && (x.items || []).length > 1 ? x.items.length : 0;
    // What it is, with the price; under it the shop. Without an item name, the shop is the title and the order day goes under.
    var title = itemName || who;
    var under = itemName ? who + (count ? ", 1 of " + count + " in this order" : "") : date ? "Ordered " + date : "";
    var info = el("div", { className: "rl-po-info" }, [
      el("div", { className: "rl-po-head" }, [el("h3", { className: "rl-po-brand", text: title }), el("div", { className: "rl-po-price", text: price })]),
      el("div", { className: "rl-po-meta", text: under })]);
    var dv = x.delivery, showShip = Boolean(dv && dv.status && (dv.status === "delivered" || freshDelivery(x)));
    if (showShip) info.appendChild(shipLine(dv));
    card.appendChild(el("div", { className: "rl-po-top" }, [img, info]));
    var dl = statedDeadline(x);
    if (opts.deadline !== false && dl) card.appendChild(dueBar(dl, deadlineLead(x, dl, "Return by "), dueFrom(x)));
    if (opts.extra) opts.extra(card);
    var portal = x.returns && x.returns.portalUrl;
    if (portal && !/^https:\/\//.test(portal)) portal = null;
    var rp = x.returnPlan;
    var dlDay = dl ? new Date(dl + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) : "";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", [title, itemName ? who : null, price, opts.deadline !== false && dl ? "return by " + dlDay : null].filter(Boolean).join(", "));
    // Its page: the picture and what it is, what you can do, then the return date, the receipt and the order's details.
    var details = function () {
      open(function (sheet) {
        var pic = el("div", { className: "rl-po-img rl-dt-pic" }); pic.setAttribute("aria-hidden", "true"); receiptPic(pic, x, 40, 48);
        sheet.appendChild(el("div", { className: "rl-dt-head" }, [pic, el("div", { className: "rl-dt-name" }, [el("h2", { text: title }), el("p", { className: "rl-dt-sub", text: itemName ? who : date ? "Ordered " + date : "" })])]));
        if (showShip) sheet.appendChild(shipLine(dv));
        var acts = el("div", { className: "rl-dt-acts" });
        // Once the shop's return email has arrived, its QR code (or label) is one tap away. Before that, Start return walks
        // through the shop's own returns page with the order number and email ready to copy.
        if (opts.actions !== false && rp && rp.id && mailRef(rp) && (rp.qrMentioned || rp.carrier || rp.returnId))
          acts.appendChild(el("button", { type: "button", className: "rl-po-primary", text: rp.qrMentioned ? "Show return QR code" : "Show return email", onclick: function () {
            open(function (sh) { originalView(sh, rp.id, close, rp.qrMentioned ? "Your return QR code" : "Your return email"); }); } }));
        else if (opts.actions !== false && portal)
          acts.appendChild(el("button", { type: "button", className: "rl-po-primary", text: "Start return", onclick: function () { open(function (sh) { returnGuide(sh, x, who, portal); }); } }));
        // Tell Relay what's going back, so it moves to Returns & swaps and the rest of the order stays in the wallet.
        if (opts.markable && x.id) {
          var idxs = opts.item != null ? [opts.item] : (x.items || []).map(function (_, i) { return i; });
          if (!idxs.length) idxs = [0];
          var undo = opts.markable === "undo", words = el("span", { text: undo ? "Not sending this back" : "I'm sending this back" });
          var mark = el("button", { type: "button", className: "rl-po-secondary rl-po-mark" }, [jIc(undo ? "back" : "ret", 18), words]);
          mark.onclick = function () {
            if (mark.disabled) return;
            mark.disabled = true; words.textContent = "Saving…";
            markItems(x, idxs, undo ? null : "returning").then(function (ok) {
              if (ok) { close(); if (opts.changed) opts.changed(); } else { mark.disabled = false; words.textContent = "Couldn't save. Try again"; } });
          };
          acts.appendChild(mark);
        }
        if (acts.childNodes.length) sheet.appendChild(acts);
        sheet.appendChild(receiptCard(x, function (kind) { if (opts.changed) opts.changed(); if (kind === "dismiss") setTimeout(close, 900); }, true, { noPortal: Boolean(portal && opts.actions !== false) }));
        // The order's details, one to a line.
        var facts = el("div", { className: "rl-dt-facts" });
        var fact = function (k, v) { if (v) facts.appendChild(el("div", { className: "rl-dt-fact" }, [el("span", { text: k }), el("b", { text: v })])); };
        fact("Price", price);
        if (first.variant) fact("Size or colour", first.variant);
        if (!one && named.length > 1) fact("In this order", named.map(function (i) { return i.name + (i.variant ? " (" + i.variant + ")" : ""); }).join(", "));
        fact("Ordered", x.orderDate ? new Date(x.orderDate + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null);
        fact("Order number", x.orderRef ? String(x.orderRef).replace(/^#/, "") : null);
        if (facts.childNodes.length) sheet.appendChild(facts);
        sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Close", style: "margin-top:14px", onclick: close }));
      });
    };
    card.onclick = details;
    card.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); details(); } };
    return card;
  }
  // ---- Delivery details (worker/delivery.js): kept with the account, and filled in at a shop's checkout when the shopper
  // buys there through Relay. They go only to that shop, only when the shopper taps to buy. Payment is always at the shop.
  var DELIVERY_FIELDS = [
    ["firstName", "First name", "given-name", "Type your first name."],
    ["lastName", "Last name", "family-name", "Type your last name."],
    ["line1", "Address", "address-line1", "Type the first line of your address."],
    ["line2", "Flat, floor or building (optional)", "address-line2", "Check the second line of your address."],
    ["town", "Town or city", "address-level2", "Type your town or city."],
    ["county", "County (optional)", "address-level1", "Check the county."],
    ["postcode", "Postcode", "postal-code", "That isn't a UK postcode. Type it like SW11 1AA."],
    ["phone", "Phone number for the courier (optional)", "tel", "That isn't a UK phone number. Type it like 07700 900123."]];
  function deliveryLine(d) { return [d.line1, d.postcode].filter(Boolean).join(", "); }
  // "+447700900456" → "07700 900456"; "+442079460018" → "020 7946 0018".
  function ukPhone(t) {
    var n = String(t || "").replace(/^\+44/, "0");
    return /^07\d{9}$/.test(n) ? n.slice(0, 5) + " " + n.slice(5) : /^02\d{9}$/.test(n) ? n.slice(0, 3) + " " + n.slice(3, 7) + " " + n.slice(7) : /^0\d{10}$/.test(n) ? n.slice(0, 5) + " " + n.slice(5) : n;
  }
  // The form. opts: onSaved(details), onRemoved(), onCancel(), intro.
  function deliveryForm(box, opts) {
    opts = opts || {};
    box.textContent = "";
    var note = el("div", { className: "rl-msg", role: "status" });
    var body = el("div");
    box.appendChild(body); box.appendChild(note);
    body.appendChild(el("div", { className: "rl-skel", style: "min-height:240px;border-radius:16px" }));
    var draw = function (d) {
      body.textContent = "";
      body.appendChild(el("p", { className: "rl-dl-intro", text: opts.intro || "Relay fills these in at a shop's checkout when you buy through Relay, and gives them only to that shop." }));
      var inputs = {};
      DELIVERY_FIELDS.forEach(function (f) {
        var input = el("input", { id: "rl-dl-" + f[0], className: "rl-field", autocomplete: f[2], value: (d && d[f[0]]) || "", maxLength: f[0] === "postcode" ? 10 : f[0] === "phone" ? 24 : 100 });
        if (f[0] === "phone") { input.type = "tel"; input.inputMode = "tel"; if (d && d.phone) input.value = ukPhone(d.phone); }
        if (f[0] === "postcode") { input.setAttribute("autocapitalize", "characters"); input.setAttribute("enterkeyhint", "next"); }
        if (f[0] === "firstName" || f[0] === "lastName" || f[0] === "town") input.setAttribute("autocapitalize", "words");
        inputs[f[0]] = input;
        body.appendChild(el("label", { htmlFor: input.id, className: "rl-jlabel", text: f[1] }));
        body.appendChild(input);
      });
      var saveBtn = el("button", { type: "button", className: "rl-btn", text: opts.saveLabel || "Save" });
      saveBtn.onclick = function () {
        if (saveBtn.disabled) return;
        var sent = {};
        DELIVERY_FIELDS.forEach(function (f) { sent[f[0]] = inputs[f[0]].value.trim(); });
        var missing = DELIVERY_FIELDS.filter(function (f) { return !/optional/.test(f[1]) && !sent[f[0]]; })[0];
        if (missing) { say(note, missing[3], true); inputs[missing[0]].focus(); return; }
        saveBtn.disabled = true; saveBtn.textContent = "Saving…"; say(note, "");
        api("/relay/my/delivery", { method: "POST", body: sent }).then(function (r) {
          saveBtn.disabled = false; saveBtn.textContent = opts.saveLabel || "Save";
          if (r.ok && r.body && r.body.delivery) { if (opts.onSaved) opts.onSaved(r.body.delivery); else say(note, "Saved."); return; }
          var bad = r.body && r.body.error === "bad_field" && DELIVERY_FIELDS.filter(function (f) { return f[0] === r.body.field; })[0];
          if (bad) { say(note, bad[3], true); inputs[bad[0]].focus(); return; }
          say(note, r.body && r.body.error === "not_for_review_account" ? "This account is shared by Relay's reviewers, so an address can't be added to it." : "Couldn't save your details. Try again.", true);
        }, function () { saveBtn.disabled = false; saveBtn.textContent = opts.saveLabel || "Save"; say(note, "Couldn't reach Relay. Check your connection and try again.", true); });
      };
      body.appendChild(saveBtn);
      if (opts.onCancel) body.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: "Cancel", onclick: opts.onCancel }));
      if (d) {
        var rm = el("button", { type: "button", className: "rl-btn ghost rl-plain", text: "Remove my delivery details" });
        rm.onclick = function () {
          ask("Remove your delivery details from Relay? Shops' checkouts will ask you for them again.", "Remove", function () {
            if (rm.disabled) return;
            rm.disabled = true;
            api("/relay/my/delivery/remove", { method: "POST", body: {} }).then(function (r) {
              rm.disabled = false;
              if (r.ok) { if (opts.onRemoved) opts.onRemoved(); else draw(null); } else say(note, "Couldn't remove them. Try again.", true);
            }, function () { rm.disabled = false; say(note, "Couldn't reach Relay. Check your connection and try again.", true); });
          });
        };
        body.appendChild(rm);
      }
    };
    api("/relay/my/delivery").then(function (r) {
      if (!document.body.contains(body)) return;
      if (!r.ok) { body.textContent = ""; say(note, "Couldn't load your details. Check your connection and try again.", true); return; }
      draw(r.body && r.body.delivery);
    }, function () { body.textContent = ""; say(note, "Couldn't reach Relay. Check your connection and try again.", true); });
  }
  // Buying from a shop's own website (Discover): Relay starts the shop's checkout with the shopper's email and delivery
  // address filled in, then the shopper opens it to choose delivery and pay. p: { sku, title, variation, price, shop, fallbackUrl }.
  function buyAtShop(p) {
    if (!load()) return show();
    open(function (sheet) { buyView(sheet, p); });
  }
  function buyView(sheet, p) {
    sheet.textContent = "";
    sheet.setAttribute("aria-label", "Buy at " + p.shop);
    sheet.appendChild(el("h2", { text: "Buy at " + p.shop }));
    sheet.appendChild(el("div", { className: "rl-dl-item" }, [el("b", { text: p.title }), el("span", { text: [p.variation, p.price].filter(Boolean).join(", ") })]));
    var body = el("div"), note = el("div", { className: "rl-msg", role: "status" });
    sheet.appendChild(body); sheet.appendChild(note);
    body.appendChild(el("div", { className: "rl-skel", style: "min-height:150px;border-radius:16px" }));
    var withoutLink = function (text) {
      return el("a", { className: "rl-btn ghost rl-dl-link", href: p.fallbackUrl, target: "_blank", rel: "noopener noreferrer", text: text || "Go to " + p.shop + " without filling in" });
    };
    api("/relay/my/delivery").then(function (r) {
      if (!document.body.contains(body)) return;
      body.textContent = "";
      var d = r.ok && r.body ? r.body.delivery : null;
      if (!d) {
        body.appendChild(el("p", { text: "Add your delivery details once, and Relay fills them in at shops' checkouts for you." }));
        body.appendChild(el("button", { type: "button", className: "rl-btn", text: "Add delivery details", onclick: function () {
          body.textContent = ""; say(note, "");
          deliveryForm(body, { saveLabel: "Save and continue", onSaved: function () { buyView(sheet, p); }, onCancel: function () { buyView(sheet, p); } });
        } }));
        body.appendChild(withoutLink());
        return;
      }
      // What goes to the shop, and where it's delivered.
      body.appendChild(el("div", { className: "rl-dt-facts rl-dl-to" }, [
        el("div", { className: "rl-dt-fact" }, [el("span", { text: "Deliver to" }), el("b", { text: [d.firstName + " " + d.lastName, d.line1, d.line2, d.town, d.county, d.postcode].filter(Boolean).join("\n") })]),
        el("div", { className: "rl-dt-fact" }, [el("span", { text: "Email" }), el("b", { text: (load() || {}).email || "" })])].concat(d.phone ? [
        el("div", { className: "rl-dt-fact" }, [el("span", { text: "Phone" }), el("b", { text: ukPhone(d.phone) })])] : [])));
      body.appendChild(el("button", { type: "button", className: "rl-btn ghost rl-plain", text: "Change delivery details", onclick: function () {
        body.textContent = ""; say(note, "");
        deliveryForm(body, { saveLabel: "Save and continue", onSaved: function () { buyView(sheet, p); }, onCancel: function () { buyView(sheet, p); } });
      } }));
      body.appendChild(el("p", { className: "rl-dl-intro", text: "Relay fills these in at " + p.shop + "'s checkout. You choose delivery and pay there, not through Relay." }));
      var go = el("button", { type: "button", className: "rl-btn", text: "Continue to " + p.shop });
      go.onclick = function () {
        if (go.disabled) return;
        go.disabled = true; go.textContent = "Filling in " + p.shop + "'s checkout…"; say(note, "");
        api("/relay/my/web-checkout", { method: "POST", body: { sku: p.sku } }).then(function (x) {
          if (!document.body.contains(go)) return;
          if (x.ok && x.body && /^https:\/\//.test(x.body.url || "")) return ready(x.body);
          go.disabled = false; go.textContent = "Continue to " + p.shop;
          var e = x.body && x.body.error;
          say(note, e === "sold_out" ? "It's sold out at " + p.shop + " now." : e === "too_many_checkouts" ? "That's a lot of checkouts for one day. You can still buy it at " + p.shop + " and type your details there."
            : "Couldn't fill in " + p.shop + "'s checkout just now. You can still buy it there and type your details.", true);
          if (e !== "sold_out" && !body.querySelector(".rl-dl-link")) body.appendChild(withoutLink("Go to " + p.shop));
        }, function () { go.disabled = false; go.textContent = "Continue to " + p.shop; say(note, "Couldn't reach Relay. Check your connection and try again.", true); });
      };
      body.appendChild(go);
      body.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: "Cancel", onclick: close }));
    }, function () { body.textContent = ""; say(note, "Couldn't reach Relay. Check your connection and try again.", true); body.appendChild(withoutLink("Go to " + p.shop)); });
    // The checkout is waiting at the shop: say what's been filled in (only what the shop took), then open it.
    function ready(b) {
      sheet.textContent = "";
      sheet.appendChild(el("h2", { text: "Ready at " + (b.shop || p.shop) }));
      var done = el("div", { className: "rl-dl-done" });
      var tick = function (text, ok) { done.appendChild(el("div", { className: "rl-dl-tick" + (ok ? "" : " no") }, [jIc(ok ? "check" : "dot", 18), el("span", { text: text })])); };
      tick(p.title + " is in your basket", true);
      tick("Your email is filled in", true);
      if (b.addressFilled) tick("Your delivery address is filled in", true);
      else tick(p.shop + "'s checkout didn't take your address, so type it there", false);
      sheet.appendChild(done);
      sheet.appendChild(el("p", { className: "rl-dl-intro", text: "Choose delivery and pay at " + (b.shop || p.shop) + ". Your receipt will show up in Relay once it's emailed to you." }));
      sheet.appendChild(el("a", { className: "rl-btn rl-dl-open", href: b.url, target: "_blank", rel: "noopener noreferrer", text: "Open " + (b.shop || p.shop) + "'s checkout", onclick: function () { setTimeout(close, 400); } }));
      sheet.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: "Not now", onclick: close }));
    }
  }
  // Copies text, saying whether it worked (older browsers get a hidden text box to copy from).
  function copyText(text) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); }); } catch (e) {}
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var t = el("textarea", { style: "position:fixed;top:-100px;opacity:0" }); t.value = text; document.body.appendChild(t); t.select();
    var ok = false; try { ok = document.execCommand("copy"); } catch (e) {} t.remove(); return ok;
  }
  // A return through the shop's own returns page, made quick: the order number and email the page asks for, one tap to copy
  // each; the page opens with the order number already copied; and once the shop emails the QR code or label, it shows on
  // the card. Relay doesn't submit the return itself: the shop's page does that.
  function returnGuide(sheet, x, who, portal) {
    sheet.appendChild(el("h2", { text: "Return to " + who, style: "margin:0 0 6px" }));
    var dl = statedDeadline(x);
    if (dl) sheet.appendChild(deadlineChip(dl, deadlineLead(x, dl, "Send it back by ")));
    sheet.appendChild(el("p", { text: who + "'s returns page asks for these. Tap one to copy it.", style: "margin:14px 0 10px;color:var(--rl-text2);font-size:15px;line-height:1.45" }));
    var rows = el("div");
    var copyRow = function (label, value) {
      var c = el("span", { className: "rl-rg-c", text: "Copy" });
      var b = el("button", { type: "button", className: "rl-rg-row" }, [el("span", { className: "rl-rg-l", text: label }), el("b", { text: value }), c]);
      b.setAttribute("aria-label", "Copy your " + label.toLowerCase() + ", " + value);
      b.onclick = function () { copyText(value).then(function (ok) { c.textContent = ok ? "Copied" : "Select it to copy"; }); };
      return b;
    };
    if (x.orderRef) rows.appendChild(copyRow("Order number", String(x.orderRef)));
    sheet.appendChild(rows);
    // The address the shop sent the order to (a Hide My Email address, say), else the inbox Relay reads.
    if (x.sentTo) rows.appendChild(copyRow("Email address", String(x.sentTo)));
    else cachedGet("gmail", "/relay/my/gmail").then(function (g) {
      var addr = g && g.ok && g.body && (g.body.email || g.body.googleEmail);
      if (addr && document.body.contains(rows)) rows.appendChild(copyRow("Email address", String(addr)));
    }, function () {});
    var go = el("a", { className: "rl-po-primary", href: portal, target: "_blank", rel: "noopener noreferrer", style: "display:block;margin-top:14px;box-sizing:border-box",
      text: x.orderRef ? "Copy order number and open " + who : "Open " + who + "'s returns page" });
    go.onclick = function () { if (x.orderRef) copyText(String(x.orderRef)); };
    sheet.appendChild(go);
    // Many shops run their returns page through a returns company (Narvar, Loop, ZigZag…), so the address can look unfamiliar.
    sheet.appendChild(el("p", { text: "This is the returns link from " + who + "'s own email. Some shops use a returns company, such as Narvar, to run the page.", style: "margin:8px 0 0;font-size:13px;color:var(--rl-text2);line-height:1.4" }));
    sheet.appendChild(el("p", { className: "rl-rg-next", text: "What happens next: " + who + " emails you a return QR code or label. Relay shows it on this card, then follows the parcel back and shows when the refund comes through." }));
    sheet.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: "Close", style: "margin-top:12px", onclick: close }));
  }
  function markItems(x, idxs, status) {
    return api("/relay/my/receipts/" + x.id + "/items", { method: "POST", body: { items: idxs.map(function (i) { return { index: i, status: status }; }) } })
      .then(function (r) { memo.receipts = null; return r.ok; }, function () { return false; });
  }
  // The items of an email order, each with whether it's being sent back. Orders with one (or no) named item stay whole.
  function emailItems(x) {
    var named = (x.items || []).map(function (it, i) { return { it: it, i: i }; }).filter(function (e) { return e.it && e.it.name; });
    var marks = x.itemReturns || {};
    return named.map(function (e) { return { index: e.i, returning: marks[e.i] === "returning" }; });
  }
  function loadBoth() {
    var p = memo.purchases || api(purchasesPath());
    return Promise.all([p.then(function (r) { return r.ok ? (r.body && r.body.purchases) || [] : null; }, function () { return null; }),
      api("/relay/my/receipts").then(function (r) { return r.ok ? (r.body && r.body.receipts) || [] : null; }, function () { return null; })]).then(function (both) {
      // Remember what came back, so the next visit shows it straight away.
      if (both[0]) { memo.walletPurchases = both[0]; diskWrite("purchases", both[0]); }
      if (both[1]) { memo.receipts = { rows: both[1], sig: JSON.stringify(both[1]), at: Date.now() }; diskWrite("receipts", both[1]); }
      return [both[0] || memo.walletPurchases || [], both[1] || (memo.receipts && memo.receipts.rows) || []];
    });
  }
  function orderRows(rows) { return rows.filter(function (x) { return x.kind !== "return_instructions" && x.kind !== "delivery_update" && x.kind !== "return_update"; }); }
  function notConfirmed(purchases) {
    var seen = {}; purchases.forEach(function (o) { seen[label(o.store) + "|" + o.amountMinor] = true; });
    return function (x) { return !seen[label(x.retailer && x.retailer.name) + "|" + x.totalPence]; };
  }
  function skeleton(host, n) { for (var i = 0; i < n; i++) host.appendChild(el("div", { className: "rl-po rl-skel" })); }
  // The wallet: everything you can still return or swap, newest deadline first, in one list. Everything else is in Receipts.
  function mountWallet(host, opts) {
    if (!host) return;
    opts = opts || {};
    host.textContent = "";
    var s = load();
    if (!s || !s.token) {
      host.appendChild(el("div", { className: "rl-empty" }, [el("h3", { text: "Sign in to see your purchases" }),
        el("p", { text: "Relay brings together what you've bought at shops on Relay and from your email receipts, so you can return or swap in a couple of taps." }),
        el("button", { className: "rl-po-primary", text: "Sign in", style: "max-width:220px", onclick: show })]));
      return;
    }
    var top = el("div"); host.appendChild(top);
    var refresh = function () { memo.purchases = null; memo.walletPurchases = null; memo.receipts = null; mountWallet(host, opts); };
    mountInstore(top, refresh, "suggest");
    var head = el("div", { className: "sectionhead" }, [el("h2", { text: opts.title || "Still returnable" })]);
    var grid = el("div", { className: "rl-po-grid" }); skeleton(grid, 3);
    host.appendChild(head);
    if (opts.sub) host.appendChild(el("p", { className: "small muted", text: opts.sub, style: "margin:-6px 0 12px" }));
    host.appendChild(grid);
    var foot = el("div"); host.appendChild(foot);
    // A new shopper with no email connected yet: the first thing they see is how to bring their receipts in.
    var start = el("div"); host.insertBefore(start, head);
    if (isReview()) start.appendChild(el("div", { className: "rl-po", style: "margin:0 0 16px;border:1.5px solid #cfe3a6;background:var(--rl-accent-bg)" }, [
      el("h3", { text: "Shop with this email", style: "margin:0;font-size:19px" }),
      el("p", { text: "Orders you place at shops that use Relay with " + (s.email || "this account's email") + " show up here. You can swap a size or colour until the shop sends the order.", style: "margin:0;color:var(--rl-text2);font-size:15px;line-height:1.45;overflow-wrap:anywhere" })]));
    else cachedGet("gmail", "/relay/my/gmail").then(function (g) {
      if (!g.ok || !g.body || g.body.connected || !document.body.contains(start)) return;
      start.appendChild(el("div", { className: "rl-po", style: "margin:0 0 16px;border:1.5px solid #cfe3a6;background:var(--rl-accent-bg)" }, [
        el("h3", { text: "Bring in your receipts", style: "margin:0;font-size:19px" }),
        el("p", { text: "Connect Gmail or Outlook and Relay finds your order emails, keeps track of return deadlines and fills in your wallet.", style: "margin:0;color:var(--rl-text2);font-size:15px;line-height:1.45" }),
        el("button", { className: "rl-po-primary", text: "Connect your email", style: "max-width:280px", onclick: function () { if (window.go) window.go("receipts"); } })]));
    }, function () {});
    // Draws what was loaded last time at once, then again only if something changed.
    var drawn = null;
    var sigOf = function (both) { try { return JSON.stringify(both); } catch (e) { return String(Math.random()); } };
    var drawBoth = function (both) {
      var sg = sigOf(both); if (sg === drawn) return; drawn = sg;
      var oldPill = head.querySelector(".pill"); if (oldPill) oldPill.remove();
      foot.textContent = "";
      var purchases = both[0], receipts = both[1], today = new Date().toISOString().slice(0, 10), items = [];
      purchases.forEach(function (o) { (o.items || []).forEach(function (it) {
        if (!it.returnable && !it.exchangeable) return;
        items.push({ deadline: new Date(Date.parse(o.orderedAt) + 7 * 864e5).toISOString().slice(0, 10), node: function () { return confirmedCard(o, it, refresh, this.deadline); } });
      }); });
      orderRows(receipts).filter(notConfirmed(purchases)).forEach(function (x) {
        if (isCarrier(x)) return;
        // A food order: only the things in it that can go back on their own (a kettle or a jumper in the weekly shop).
        var only = x.returnable === false ? (x.returnableItems || []) : null;
        if (only && !only.length) return;
        var dl = deadlineOf(x), onWay = freshDelivery(x);
        if (!((dl && dl >= today) || (onWay && !dl))) return;
        var parts = emailItems(x);
        if (only) parts = parts.filter(function (p) { return only.indexOf(p.index) >= 0; });
        var anyMarked = parts.some(function (p) { return p.returning; });
        // A return is under way but Relay doesn't know which items: the Returns page asks, and nothing shows here meanwhile.
        if (x.returnProgress && !anyMarked) return;
        if (parts.length > 1 || only) parts.forEach(function (p) { if (!p.returning) items.push({ deadline: dl, node: function () { return emailCard(x, { item: p.index, markable: true, changed: refresh }); } }); });
        else if (!anyMarked) items.push({ deadline: dl, node: function () { return emailCard(x, { markable: true, changed: refresh }); } });
      });
      items.sort(function (a, b) { return (a.deadline || "9999") < (b.deadline || "9999") ? -1 : 1; });
      grid.textContent = "";
      head.appendChild(el("span", { className: "pill rl-count", text: items.length + " item" + (items.length === 1 ? "" : "s") }));
      if (!items.length) grid.appendChild(el("div", { className: "rl-empty", style: "grid-column:1/-1" }, [el("h3", { text: "Nothing to return right now" }),
        el("p", { text: "Anything you can still return or swap shows up here. Everything you've bought is in Receipts." })]));
      items.forEach(function (i) { grid.appendChild(i.node()); });
      // On Home, Receipts and Returns & swaps are tiles under the wallet instead.
      if (!opts.home) foot.appendChild(el("div", { className: "rl-po-actions", style: "margin:14px 0 6px;max-width:520px" }, [
        el("button", { className: "rl-po-secondary", text: "All receipts", onclick: function () { window.go && window.go("receipts"); } }),
        el("button", { className: "rl-po-secondary", text: "Returns & swaps", onclick: function () { window.go && window.go("returns"); } })]));
      var box = el("div", { style: "margin-top:10px" }); foot.appendChild(box); mountInstore(box, refresh, "box");
      if (testingOn()) { var t = el("div", { style: "margin-top:10px" }); foot.appendChild(t); mountSquareTest(t, refresh); mountShopifyTest(t, refresh); }
    };
    if (memo.walletPurchases && memo.receipts) drawBoth([memo.walletPurchases, memo.receipts.rows]);
    loadBoth().then(function (both) { if (document.body.contains(grid)) drawBoth(both); });
  }
  function whichItems(x, parts, done) {
    var who = (x.retailer && x.retailer.name) || "this shop";
    var card = el("div", { className: "rl-po" }, [el("div", { className: "rl-po-shop", text: who }), el("h3", { text: "Which items did you send back?", style: "margin:4px 0 6px" }),
      el("p", { text: "Relay can see a return for this order but not which items were in it. Tick what you sent back and Relay will keep the rest in your wallet.", style: "font-size:14px;color:var(--rl-text2);margin:0 0 10px" })]);
    var picks = {};
    parts.forEach(function (q) {
      var it = x.items[q.index];
      var box = el("input", { type: "checkbox", style: "width:20px;height:20px;accent-color:var(--rl-text)" });
      box.onchange = function () { picks[q.index] = box.checked; save.disabled = !Object.keys(picks).some(function (k) { return picks[k]; }); };
      card.appendChild(el("label", { style: "display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--rl-line);cursor:pointer;font-size:15px" }, [box,
        el("span", { text: it.name + (it.variant ? " · " + it.variant : ""), style: "flex:1" }), el("span", { text: Number.isInteger(it.pricePence) ? money(it.pricePence, x.currency) : "", style: "color:var(--rl-text2)" })]));
    });
    var save = el("button", { className: "rl-po-primary", text: "Save", disabled: true, style: "margin-top:10px", onclick: function () {
      save.disabled = true; save.textContent = "Saving…";
      markItems(x, Object.keys(picks).filter(function (k) { return picks[k]; }).map(Number), "returning").then(function (ok) { if (ok) done(); else { save.disabled = false; save.textContent = "Couldn't save. Try again"; } });
    } });
    card.appendChild(save);
    return card;
  }
  // Returns and swaps you've started, and where each one has got to.
  function mountReturns(host) {
    if (!host) return;
    host.textContent = "";
    var s = load(); if (!s || !s.token) { host.appendChild(el("p", { text: "Sign in to see your returns." })); return; }
    var grid = el("div", { className: "rl-po-grid" }); skeleton(grid, 2); host.appendChild(grid);
    var refresh = function () { memo.purchases = null; mountReturns(host); };
    loadBoth().then(function (both) {
      var items = [];
      both[0].forEach(function (o) { (o.items || []).forEach(function (it) { if (it.returnInfo || it.exchange) items.push({ at: o.orderedAt, node: function () { return confirmedCard(o, it, refresh); } }); }); });
      orderRows(both[1]).forEach(function (x) {
        var p = x.returnProgress, parts = emailItems(x), marked = parts.filter(function (q) { return q.returning; });
        if (!p && !marked.length) return;
        var step = !p ? "You're sending this back. Relay follows it from the shop's emails."
          : p.refundedAt ? "Refunded" + (p.refundPence != null ? " " + money(p.refundPence, p.currency || "GBP") : "")
          : p.receivedAt || (p.parcel && p.parcel.status === "delivered") ? "Back at the shop, waiting for the refund" : "Sent back, on its way to the shop";
        var progress = function (card) { card.appendChild(el("div", { className: "rl-po-status" + (p && p.refundedAt ? "" : " wait"), text: step }));
          if (x.itemReturnsFrom === "refund") card.appendChild(el("div", { text: "Relay matched the refund amount to this item.", style: "font-size:12px;color:var(--rl-text2);margin-top:6px" })); };
        // A return for an order with several items, and Relay can't tell which: ask once.
        if (p && parts.length > 1 && !marked.length) { items.push({ at: x.orderDate, node: function () { return whichItems(x, parts, refresh); } }); return; }
        if (parts.length > 1) marked.forEach(function (q) { items.push({ at: x.orderDate, node: function () { return emailCard(x, { item: q.index, deadline: false, actions: false, extra: progress, markable: p && p.refundedAt ? false : "undo", changed: refresh }); } }); });
        else items.push({ at: x.orderDate, node: function () { return emailCard(x, { deadline: false, actions: false, extra: progress, markable: p ? false : "undo", changed: refresh }); } });
      });
      items.sort(function (a, b) { return String(b.at || "").localeCompare(String(a.at || "")); });
      grid.textContent = "";
      if (!items.length) grid.appendChild(el("div", { className: "rl-empty", style: "grid-column:1/-1" }, [el("h3", { text: "No returns or swaps yet" }),
        el("p", { text: "When you start a return or swap, you can follow it here until the refund arrives." })]));
      items.forEach(function (i) { grid.appendChild(i.node()); });
    });
  }
  // Orders the shop confirmed. opts.limit: show only the newest few (the wallet), with a link to the rest.
  function mountConfirmed(host, opts) {
    if (!host) return;
    opts = opts || {};
    host.textContent = "";
    var s = load(); if (!s || !s.token) return;
    // The wallet can be drawn twice as the page settles: both share one request rather than asking the server twice.
    if (!memo.purchases) memo.purchases = api(purchasesPath()).then(function (r) { setTimeout(function () { memo.purchases = null; }, 1500); return r; }, function (e) { memo.purchases = null; throw e; });
    memo.purchases.then(function (r) {
      var rows = (r.ok && r.body && r.body.purchases) || [];
      var refresh = function () { memo.purchases = null; mountConfirmed(host, opts); };
      var inHost = el("div"); mountInstore(inHost, refresh);
      var testHost = el("div", { style: "margin-top:14px" });
      if (testingOn()) { mountSquareTest(testHost, refresh); mountShopifyTest(testHost, refresh); }
      host.appendChild(inHost);
      if (rows.length) {
        var items = [];
        rows.forEach(function (o) { (o.items || []).forEach(function (it) { items.push([o, it]); }); });
        host.appendChild(el("div", { className: "sectionhead" }, [el("h2", { text: "Confirmed by the shop" }), el("span", { className: "pill", text: items.length + " item" + (items.length === 1 ? "" : "s") })]));
        host.appendChild(el("p", { className: "small muted", text: "Bought with your Relay email at shops on Relay, so you can swap or return them here." }));
        var grid = el("div", { className: "rl-po-grid" }); host.appendChild(grid);
        var shown = opts.limit ? items.slice(0, opts.limit) : items;
        shown.forEach(function (x) { grid.appendChild(confirmedCard(x[0], x[1], refresh)); });
        if (opts.limit && items.length > opts.limit && window.go)
          host.appendChild(el("button", { className: "rl-po-more", text: "See all " + items.length + " in Receipts →", onclick: function () { window.go("receipts"); } }));
      }
      host.appendChild(testHost);
    }).catch(function () {});
  }

  // ---- Bought in a shop: card-only purchases Relay thinks are yours ("Is this yours?"), and adding one from its receipt. ----
  function mountInstore(host, done, part) {
    api("/relay/my/instore/suggestions").then(function (r) {
      if (!r.ok) return;
      var list = part === "box" ? [] : (r.body && r.body.suggestions) || [];
      list.forEach(function (x) {
        var when = x.paidAt ? new Date(x.paidAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
        var card = el("div", { className: "rl-po", style: "margin:0 0 18px;border:2px solid #cfe3a6" });
        card.appendChild(el("div", { className: "eyebrow", text: "IS THIS YOURS?" }));
        card.appendChild(el("h3", { text: money(x.amountMinor, x.currency) + " at " + x.store, style: "margin:4px 0" }));
        card.appendChild(el("p", { className: "small muted", style: "margin:0 0 10px", text: when + (x.last4 ? " · " + (x.brand ? x.brand.charAt(0) + x.brand.slice(1).toLowerCase().replace(/_/g, " ") : "Card") + " ending " + x.last4 : "") +
          ". Paid in the shop with a card you've used there before. Say if it's yours and Relay adds it, with what you bought." }));
        var msg = el("div", { className: "rl-msg", style: "min-height:0;margin:0" });
        var send = function (ans) {
          yes.disabled = no.disabled = true;
          api("/relay/my/instore/suggestions/" + encodeURIComponent(x.id), { method: "POST", body: { answer: ans } }).then(function (a) {
            if (a.ok) { if (ans === "mine") { say(msg, "✓ Added to your purchases"); setTimeout(done, 900); } else card.remove(); }
            else { yes.disabled = no.disabled = false; say(msg, a.body && a.body.error === "already_claimed" ? "Someone else has already added this purchase." : "Couldn't save that. Please try again.", true); }
          }, function () { yes.disabled = no.disabled = false; say(msg, "Couldn't reach Relay. Please try again.", true); });
        };
        var yes = el("button", { className: "rl-po-primary", text: "Yes, it's mine", onclick: function () { send("mine"); } });
        var no = el("button", { className: "rl-po-secondary", text: "Not mine", onclick: function () { send("not_mine"); } });
        card.appendChild(el("div", { className: "rl-po-actions", style: "max-width:440px" }, [yes, no])); card.appendChild(msg);
        host.appendChild(card);
      });
      // Add a purchase from a shop receipt.
      var box = el("details", { className: "card", style: "padding:14px 16px;margin:0 0 12px" });
      box.appendChild(el("summary", { text: "Bought in a shop? Add it from the receipt", style: "font-weight:700;cursor:pointer" }));
      box.appendChild(el("p", { className: "small muted", style: "margin:8px 0 10px", text: "Pick the shop and enter what's on your receipt." }));
      var inp = function (ph, type, mode) { return el("input", { placeholder: ph, type: type || "text", inputMode: mode || "text", style: "width:100%;box-sizing:border-box;padding:10px;border-radius:12px;border:1px solid var(--rl-line);font:inherit;margin-bottom:8px" }); };
      var shopSel = el("select", { style: "width:100%;padding:10px;border-radius:12px;border:1px solid var(--rl-line);font:inherit;margin-bottom:8px" });
      var rn = inp("Receipt number (e.g. #A1b2)"), amt = inp("Amount paid, e.g. 29.99", "text", "decimal"), dt = inp("Date", "date"), l4 = inp("Last 4 digits of your card", "text", "numeric");
      var cmsg = el("div", { className: "rl-msg" });
      var go = el("button", { className: "darkbtn", text: "Find my purchase", onclick: function () {
        var pounds = Number(String(amt.value).replace(/[£,\s]/g, ""));
        if (!(pounds > 0) || !/^\d{4}$/.test(l4.value.trim()) || !dt.value || !rn.value.trim()) return say(cmsg, "Please fill in all four from your receipt.", true);
        go.disabled = true; say(cmsg, "Looking for it…");
        api("/relay/my/instore/claim", { method: "POST", body: { locationId: shopSel.value, receiptNumber: rn.value.trim(), amountMinor: Math.round(pounds * 100), date: dt.value, last4: l4.value.trim() } }).then(function (c) {
          go.disabled = false;
          if (c.ok) { say(cmsg, "✓ Found it and added it to your purchases"); setTimeout(done, 900); return; }
          var e = c.body && c.body.error;
          say(cmsg, e === "no_match" ? "No purchase matches all of those. Check the receipt number, amount, date and card." : e === "already_claimed" ? "That purchase is already in someone else's Relay."
            : e === "too_many_tries" ? "That's 10 tries today. Please try again tomorrow." : "Couldn't look just now. Please try again.", true);
        }, function () { go.disabled = false; say(cmsg, "Couldn't reach Relay. Please try again.", true); });
      } });
      [shopSel, rn, amt, dt, l4, go, cmsg].forEach(function (n) { box.appendChild(n); });
      // Only offered when there are real shops to find a purchase in (Square's test shops are for people testing Relay).
      if (part !== "suggest") cachedGet("instoreShops", "/relay/my/instore/shops").then(function (sh) {
        var list = (sh.ok && sh.body && sh.body.shops) || [];
        if (!list.length || !(sh.body.live || testingOn())) return;
        list.forEach(function (o) { shopSel.appendChild(el("option", { value: o.id, text: o.name })); });
        host.appendChild(box);
      }, function () {});
    }).catch(function () {});
  }

  // ---- Test orders at Relay's Square test shop (only while Relay uses Square's sandbox; no card, no real money). ----
  function mountSquareTest(host, done) {
    api("/relay/my/testing/square-items").then(function (r) {
      var items = (r.ok && r.body && r.body.items) || [];
      if (!items.length) return;
      var card = el("details", { className: "card", style: "padding:14px 16px" });
      card.appendChild(el("summary", { text: "Testing: place a test order", style: "font-weight:700;cursor:pointer" }));
      card.appendChild(el("p", { className: "small muted", style: "margin:8px 0 10px", text: "Places an order at " + (r.body.store || "Relay's test shop") +
        " (a Square test shop) under your Relay email, paid with Square's test payment. No card is needed and no real money moves. Up to 5 a day." }));
      var pick = el("select", { style: "width:100%;padding:10px;border-radius:12px;border:1px solid var(--rl-line);font:inherit;margin-bottom:8px" });
      items.forEach(function (i) {
        pick.appendChild(el("option", { value: i.variationId, text: i.product + (i.variant && !/^(default|regular)$/i.test(i.variant) ? " · " + i.variant : "") + " · " + money(i.priceMinor, "GBP") +
          (i.inStock ? "" : " · out of stock") }));
      });
      var msg = el("div", { className: "rl-msg" });
      var go = el("button", { className: "darkbtn", text: "Place test order", onclick: function () {
        go.disabled = true; say(msg, "Placing your test order…");
        api("/relay/my/testing/square-order", { method: "POST", body: { variationId: pick.value } }).then(function (p) {
          go.disabled = false;
          if (p.ok && p.body && p.body.ok) { say(msg, "✓ " + p.body.message); setTimeout(done, 1200); return; }
          var e = p.body && p.body.error;
          say(msg, e === "too_many_test_orders" ? "That's 5 test orders today. Try again tomorrow." : "The test shop didn't take the order. Please try again in a minute.", true);
        }, function () { go.disabled = false; say(msg, "Couldn't reach Relay. Please try again.", true); });
      } });
      var tapBtn = el("button", { className: "ghostbtn", text: "Pay in the shop with a card (test)", style: "margin-left:8px", onclick: function () {
        tapBtn.disabled = true; say(msg, "Paying at the test shop's till…");
        api("/relay/my/testing/square-tap", { method: "POST", body: { variationId: pick.value } }).then(function (p) {
          tapBtn.disabled = false;
          if (p.ok && p.body && p.body.ok) { say(msg, p.body.message + (p.body.receiptNumber ? " Receipt number: " + p.body.receiptNumber + "." : "")); if (p.body.suggested) setTimeout(done, 1500); return; }
          say(msg, p.body && p.body.error === "too_many_test_orders" ? "That's 5 test orders today. Try again tomorrow." : "The test shop didn't take the payment. Please try again in a minute.", true);
        }, function () { tapBtn.disabled = false; say(msg, "Couldn't reach Relay. Please try again.", true); });
      } });
      card.appendChild(el("p", { className: "small muted", style: "margin:0 0 8px", text: "Or pay at the till with just a card (no email), like most shop purchases. Relay suggests it to you if it knows the card from an earlier order." }));
      card.appendChild(pick); card.appendChild(go); card.appendChild(tapBtn); card.appendChild(msg);
      host.appendChild(card);
    }).catch(function () {});
  }

  // ---- Offers: shops can send Relay watchers a lower price on an item. Shown here while they last (also sent as phone alerts). ----
  function pounds(m) { return "£" + (Number(m) / 100).toFixed(2); }
  function mountOffers(host) {
    var wrap = el("div", { style: "margin-top:16px" }); host.appendChild(wrap);
    api("/relay/my/alerts/offers").then(function (r) {
      var list = r.ok && r.body && r.body.offers || [];
      if (!list.length) return;
      var card = el("div", { className: "card" }); wrap.appendChild(card);
      card.appendChild(el("h3", { text: "Offers for you", style: "margin:0 0 4px" }));
      card.appendChild(el("p", { className: "small muted", style: "margin:0 0 10px", text: "Shops sent these to people watching their items. The shop honours the price; Relay doesn't take payment." }));
      list.forEach(function (o) {
        var ends = new Date(o.endsAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
        var row = el("div", { style: "display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--rl-line)" });
        if (o.imageUrl && /^https:\/\//.test(o.imageUrl)) row.appendChild(el("img", { src: o.imageUrl, alt: "", style: "width:56px;height:56px;border-radius:12px;object-fit:cover;flex:none;background:var(--rl-fill)" }));
        var txt = el("div", { style: "flex:1;min-width:0" });
        txt.appendChild(el("div", { className: "eyebrow", text: String(o.store || "").toUpperCase() }));
        txt.appendChild(el("strong", { text: o.product + (o.variant ? " · " + o.variant : "") }));
        txt.appendChild(el("div", { className: "small", text: pounds(o.offerMinor) + " (usually " + pounds(o.wasMinor) + ") · ends " + ends }));
        if (o.note) txt.appendChild(el("div", { className: "small muted", text: o.note }));
        row.appendChild(txt);
        card.appendChild(row);
      });
    }).catch(function () {});
  }
  function mountAlerts(host) {
    host.textContent = "";
    var box = el("div", { className: "card" }); host.appendChild(box);
    box.appendChild(el("h3", { text: "Phone alerts", style: "margin:0 0 6px" }));
    var s = load();
    if (!s || !s.token) {
      box.appendChild(el("p", { text: "Sign in to get a message on your phone when something you watch drops in price.", className: "sub" }));
      box.appendChild(el("button", { className: "rl-btn", text: "Sign in", style: "max-width:240px", onclick: show }));
      return;
    }
    mountOffers(host);
    if (!pushOk()) {
      box.appendChild(el("p", { className: "sub", text: "This browser can't receive alerts. On an iPhone: open Relay in Safari, tap Share, choose Add to Home Screen, then open Relay from your home screen and come back here." }));
      return;
    }
    var msg = el("p", { className: "small muted", style: "min-height:18px;margin:10px 0 0" });
    var body = el("div", {}, [el("div", { className: "rl-skel", style: "min-height:48px;border-radius:14px" })]);
    box.appendChild(body); box.appendChild(msg);
    function draw() {
      Promise.all([thisDevice(), alertStatus()]).then(function (r) {
        var sub = r[0], st = r[1]; body.textContent = "";
        if (Notification.permission === "denied") { body.appendChild(el("p", { className: "sub", text: "Alerts are blocked for Relay in this browser. Allow notifications for this site in your browser or phone settings, then come back." })); return; }
        var on = Boolean(sub) && st && st.devices > 0;
        if (!on) {
          body.appendChild(el("p", { className: "sub", text: "Get a message on this device when a product you watch (or any product at a shop you choose) drops in price. Nothing is sent unless you turn this on, and you can turn it off any time." }));
          body.appendChild(el("button", { className: "rl-btn", text: "Turn on alerts", style: "max-width:240px", onclick: function () {
            say(msg, "Asking your device…");
            enablePush().then(function (x) { if (x.ok) { say(msg, "Alerts are on. Send yourself a test to make sure they reach you."); draw(); } else say(msg, x.reason === "denied" ? "You said no, so nothing was turned on." : "Couldn't turn alerts on just now. Please try again.", true); });
          } }));
          return;
        }
        body.appendChild(el("p", { className: "sub", text: "✓ Alerts are on for this device. Watching " + st.watches.length + " item" + (st.watches.length === 1 ? "" : "s") + (st.stores.length ? " and every product at: " + st.stores.join(", ") : "") + "." }));
        // Two choices: just the watchlist, or price drops at every connected shop.
        var modes = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 12px" });
        [["watchlist", "Only my watchlist"], ["all", "Price drops at every shop"]].forEach(function (mode) {
          var on = (mode[0] === "all") === Boolean(st.allShops);
          modes.appendChild(el("button", { className: "toggle" + (on ? " on" : ""), text: (on ? "✓ " : "") + mode[1], onclick: function () {
            api("/relay/my/alerts/mode", { method: "POST", body: { mode: mode[0] } }).then(function (x) { if (x.ok) { memoDrop("alerts"); draw(); say(msg, mode[0] === "all" ? "You'll get an alert when anything drops in price at any shop connected to Relay." : "You'll only get alerts for items on your watchlist (and shops you follow)."); } });
          } }));
        });
        body.appendChild(modes);
        var row = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" });
        row.appendChild(el("button", { className: "rl-btn", text: "Send a test alert", style: "width:auto", onclick: function () {
          say(msg, "Sending…");
          api("/relay/my/push/test", { method: "POST" }).then(function (x) { say(msg, x.ok && x.body.sent ? "Sent. It should appear on this device in a few seconds." : x.status === 429 ? "Give it a few seconds, then try again." : "It couldn't be delivered. Try turning alerts off and on again.", !(x.ok && x.body.sent)); });
        } }));
        row.appendChild(el("button", { className: "rl-btn ghost", text: "Check prices now", style: "width:auto", onclick: function () {
          say(msg, "Checking the shops…");
          api("/relay/my/alerts/check", { method: "POST" }).then(function (x) {
            if (x.status === 429) return say(msg, "Just checked. Try again in a few seconds.");
            if (!x.ok) return say(msg, "Couldn't check just now.", true);
            say(msg, "Checked " + x.body.checked + " item" + (x.body.checked === 1 ? "" : "s") + ". " + (x.body.drops ? x.body.drops + " price drop" + (x.body.drops === 1 ? "" : "s") + ", " + x.body.sent + " alert" + (x.body.sent === 1 ? "" : "s") + " sent." : "No price drops."));
          });
        } }));
        row.appendChild(el("button", { className: "rl-btn ghost", text: "Turn off", style: "width:auto", onclick: function () { disablePush().then(function () { say(msg, "Alerts are off for this device."); draw(); }); } }));
        body.appendChild(row);
        body.appendChild(el("p", { className: "small muted", style: "margin-top:10px", text: "Prices are compared whenever a connected shop updates its catalogue, and every hour. Only shops connected to Relay have prices to watch." }));
      });
    }
    draw();
  }
  // Returns due in the next three days: a red number on the Home tab (index.html relayBadge), the way a phone shows it.
  // The wallet on Home lists them first, so nothing floats over the page. Nothing shows when signed out.
  function mountNextUp(host) {
    if (host) { host.hidden = true; host.textContent = ""; }
    var setDue = function (n) { window.__relayDue = n; if (window.relayBadge) window.relayBadge(); };
    var s = load();
    if (!s || !s.token) { setDue(0); return; }
    var draw = function (rows) {
      var today = new Date().toISOString().slice(0, 10), n = 0;
      (rows || []).forEach(function (x) {
        if (!x || x.kind === "return_instructions" || isCarrier(x) || x.returnProgress) return;
        if (x.returnable === false && !(x.returnableItems || []).length) return;
        var dl = statedDeadline(x); if (!dl || dl < today) return;
        var d = daysLeft(dl); if (d !== null && d <= 3) n++;
      });
      setDue(n);
    };
    if (memo.receipts) draw(memo.receipts.rows);
    // (Its own copy: the Receipts page keeps memo.receipts in a different shape.)
    cachedGet("nextUp", "/relay/my/receipts").then(function (r) { if (r.ok && r.body) draw(r.body.receipts || []); }, function () {});
  }
  window.RelayAccount = { mountNextUp: mountNextUp, open: show, testingOn: testingOn, isReview: isReview, mountWallet: mountWallet, mountReturns: mountReturns, email: function () { var x = load(); return (x && x.email) || ""; }, mountConfirmed: mountConfirmed, mountAlerts: mountAlerts, enablePush: enablePush, syncWatch: syncWatch, syncStore: syncStore, alertStatus: alertStatus, tasteRows: function () { return cachedGet("taste", "/relay/my/style").then(function (r) { return r.ok ? (r.body.receipts || []) : []; }); }, mountWrapped: mountWrapped, mountMe: mountMe, drawing: { key: illKey, keys: function () { return Object.keys(ILL); }, draw: illustrate, html: drawingHtml,
    of: function (name) { var k = illKey({ items: [{ name: name }], retailer: {}, category: "other" }); return { key: k, kind: ILL_KIND[k] || "other" }; } }, spendProfile: spendProfile, mountMarket: mountMarket, mountDemoMarket: mountDemoMarket, mountReceipts: mountReceipts, mountProfile: mountProfile, editProfile: editProfile, profile: function () { return profileNow(); }, onProfile: function (f) { profileWatchers.push(f); loadProfile(); }, open: function () { show(); }, signedIn: function () { var s = load(); return Boolean(s && s.token); }, receipts: function () { return api("/relay/my/receipts"); },
    // Wrapped's soundtrack, for listening to it outside the story (the preview and tests).
    storySong: storySong,
    // Pull to refresh (relay-gestures.js through index.html): ask again for everything, know when it's in, check the inbox.
    forget: forget, whenIdle: whenIdle, checkInbox: checkInbox,
    // Orders the shop confirmed (shares the wallet's request when one is already on its way).
    // Swap & resell from anywhere (Discover's row): a sheet over the page, starting on Browse.
    buyAtShop: buyAtShop,
    openMarket: function () { if (!load()) return show(); open(function (sh) { resaleView(sh, close, null, "browse"); }); },
    // Search by photo on Discover: whether it's on (asked once, then remembered), and the search itself.
    photoAvailable: photoAvailable, photoSearch: photoSearch,
    purchases: function () { return (memo.purchases || api(purchasesPath())).then(function (r) { return (r.ok && r.body && r.body.purchases) || []; }, function () { return []; }); } };
  function keyboardWatch() {
    var vv = window.visualViewport; if (!vv || window.__rlKb) return; window.__rlKb = true;
    var fit = function () { var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)); document.documentElement.style.setProperty("--rl-kb", (kb > 60 ? kb : 0) + "px"); };
    vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); fit();
    document.addEventListener("focusin", function (e) {
      var t = e.target; if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      setTimeout(function () { try { t.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (x) {} }, 300);
    });
  }
  function start() {
    keyboardWatch(); if (load()) keepStorage(); bind(); mountWelcome(); completeGoogleNote(); completeLinkSignIn(); completeGmail();
    window.addEventListener("hashchange", function () { completeGoogleNote(); completeLinkSignIn(); completeGmail(); });
    window.addEventListener("relay:session", function () { if (load()) unmountWelcome(); else mountWelcome(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
