/* What one line on a receipt is: Relay's one place for that (Connor, 18 Nov 2026: "Rowntree's 130g Fruit Pastilles Sweets
 * Sharing Bag Lollies" opened his Wrapped as clothing). The server (receipt-category.js, wrapped.js, item-kinds.js) and the
 * app (relay-recommendation-engine.js) both use this file, so a thing is the same kind everywhere.
 *
 * classify(name, { shop, shopKind, ai }) → { kind, sub, group, confidence, lasting, reasons }
 *   kind:       one of KIND_LIST (food_drink, household, beauty_health, clothing, footwear, accessories, home, electronics,
 *               toys_hobbies, books_media, sport_outdoor, pets, travel, digital, services, gift_cards, other).
 *   group:      the receipts list's group for it (fashion, electronics, food, home, beauty, travel, digital, experiences, other).
 *   confidence: "high" (the thing's own name says so), "medium" (a pack size, a flavour word or the kind of shop says so),
 *               "ai" (Claude said so, for shoppers who switched AI on), or "low" (nothing says: kind is "other", never a guess).
 *   lasting:    a thing that is kept rather than used up (clothes, shoes, a bag, tech, something for the home, a toy, a book,
 *               sports kit). Only these can open Wrapped, and only when sure.
 *   reasons:    the words that decided it.
 *
 * How a line is read, strongest first:
 *  1. Pack sizes and weights (130g, 4x2L, 500ml, 6 pack, x12, kg) say it gets used up.
 *  2. The head noun: the last word or phrase that names a thing, before "for", "with" or a " - " variant. Words that say how
 *     it is packed ("sharing bag", "bag of", "multipack", "tub", "case of 12") are never the thing itself, so a sharing bag
 *     of sweets is sweets. Colour and flavour words (chocolate, mocha, oatmeal) count only when nothing else does.
 *  3. The kind of shop: a supermarket's or takeaway's line that names nothing else is food and drink; a supermarket's own
 *     clothing ranges (Tu, F&F, George, Nutmeg) count only with a clothing word.
 *  4. Brands: Rowntree's, Haribo, Cadbury, Walkers, Pringles, Yorkshire Tea, Calpol, Fairy… say what a thing is when no
 *     noun does.
 * A confident AI answer (worker/item-kinds.js) wins over all of this.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RelayItemKind = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // The fixed list. `group` is the receipts list's group; `lasting` the kinds that are kept rather than used up.
  const KIND_LIST = {
    food_drink: { label: "Food & drink", group: "food", lasting: false },
    household: { label: "Household", group: "home", lasting: false },
    beauty_health: { label: "Beauty & health", group: "beauty", lasting: false },
    clothing: { label: "Clothing", group: "fashion", lasting: true },
    footwear: { label: "Footwear", group: "fashion", lasting: true },
    accessories: { label: "Bags & accessories", group: "fashion", lasting: true },
    home: { label: "Home & furniture", group: "home", lasting: true },
    electronics: { label: "Electronics", group: "electronics", lasting: true },
    toys_hobbies: { label: "Toys & hobbies", group: "other", lasting: true },
    books_media: { label: "Books & media", group: "other", lasting: true },
    sport_outdoor: { label: "Sport & outdoor", group: "other", lasting: true },
    pets: { label: "Pets", group: "home", lasting: false },
    travel: { label: "Travel", group: "travel", lasting: false },
    digital: { label: "Digital & apps", group: "digital", lasting: false },
    services: { label: "Services", group: "other", lasting: false },
    gift_cards: { label: "Gift cards", group: "digital", lasting: false },
    other: { label: "Other", group: "other", lasting: false },
  };
  const KINDS = Object.keys(KIND_LIST);
  // Sub-kinds whose group differs from their kind's, and sub-kinds of a lasting kind that still get used up.
  const SUB_GROUP = { toiletries: "beauty", batteries: "electronics", event: "experiences", personal_care: "beauty", stationery: "other" };
  const USED_UP_SUB = new Set(["candles", "plants", "garden_care", "paint", "party"]);
  // Kinds that are used up (eaten, drunk, washed with) and kinds that are kept: the two must never be mistaken for each other.
  const CONSUMABLE = new Set(["food_drink", "household", "beauty_health", "pets"]);

  // ---- The words ----------------------------------------------------------------------------------------------------
  // kind → sub → words. A plain word or phrase names the thing (a noun that can be the head). Marks in front:
  //   ~ a colour or flavour word: counts only when nothing else names the thing ("Chocolate Brown Jumper" is a jumper)
  //   @ a brand or product line: says what it is when no noun does ("Haribo Starmix", "Nike Air Force 1")
  //   # how it is packed ("sharing bag", "tub", "case of"): never the thing when anything else is named
  //   % something food is served in (bowl, box, basket, bucket): food when food is named with it or the shop serves food
  // Plurals are added automatically.
  const LEX = {
    food_drink: {
      sweets: "sweet, sweets, pastille, pastilles, fruit pastilles, fruit gums, wine gums, jelly babies, jelly beans, gummy, gummies, gummy bears, lolly, lollies, ice lolly, lollipop, chew, chews, toffee, toffees, fudge, mints, humbugs, marshmallow, marshmallows, liquorice, licorice, candy, candy floss, bonbons, sherbet, jelly sweets, chocolate bar, chocolate bars, chocolate buttons, chocolate coins, chocolates, truffles, selection box, advent calendar, easter egg, praline, pralines, nougat, brittle, @celebrations, @cadbury roses, @cadbury heroes, " +
        "@rowntrees, @haribo, @cadbury, @cadburys, @dairy milk, @kitkat, @kit kat, @aero, @smarties, @milkybar, @quality street, @rolo, @yorkie, @lion bar, @munchies, @maltesers, @snickers, @twix, @galaxy ripple, @galaxy chocolate, @galaxy smooth, @bounty bar, @bounty, @mars bar, @milky way, @skittles, @starburst, @m and ms, @mandms, @kinder, @kinder bueno, @kinder surprise, @bueno, @ferrero, @ferrero rocher, @lindt, @lindor, @toblerone, @terrys, @heroes, @wispa, @crunchie, @twirl, @flake, @freddo, @double decker, @curly wurly, @fudge bar, @mini eggs, @creme egg, @galaxy, @percy pig, @percy pigs, @colin the caterpillar, @swizzels, @love hearts, @drumstick, @chewits, @fruit tella, @polo, @trebor, @extra gum, @wrigleys, @tic tac, @tangfastics, @starmix, @maoam, @bassetts, @maynards, @fox's glacier, @hotel chocolat, @thorntons, @green and blacks, @tonys chocolonely, @reeses, @hersheys, @jelly belly, @nerds, @millions, @squashies, @drumstick squashies, @foxs, @werthers, @werthers original, @chupa chups, @mentos, @fruit pastilles, @jelly tots, @randoms, @tooty frooties, @fruit gums",
      snacks: "crisp, crisps, chip, chips, tortilla chips, popcorn, pretzel, pretzels, nachos, rice cakes, crackers, cream crackers, oatcakes, breadsticks, biscuit, biscuits, cookie, cookies, shortbread, digestives, hobnobs, flapjack, flapjacks, shortcrust pastry, puff pastry, cereal bar, cereal bars, protein bar, protein bars, snack, snacks, nuts, peanuts, cashews, almonds, pistachios, trail mix, dried fruit, raisins, jaffa cakes, wafer, wafers, mini cheddars, twiglets, pork scratchings, scampi fries, " +
        "@walkers, @pringles, @doritos, @quavers, @wotsits, @monster munch, @hula hoops, @french fries, @frazzles, @sensations, @kettle chips, @tyrrells, @mccoys, @tyrells, @pom bears, @popchips, @propercorn, @butterkist, @mcvities, @hobnob, @jacobs, @ritz, @tuc, @fox's, @maryland, @oreo, @oreos, @lotus biscoff, @biscoff, @tunnocks, @penguin, @club biscuit, @breakaway, @kitkat chunky, @belvita, @nature valley, @nakd, @graze, @eat natural, @alpen, @grenade, @carb killa, @fulfil, @nutri grain, @go ahead, @ryvita, @kallo, @jordans, @mr kipling, @cadbury mini rolls, @soreen",
      drink: "water, still water, sparkling water, spring water, mineral water, juice, orange juice, apple juice, smoothie, smoothies, squash, cordial, lemonade, cola, coke, diet coke, coke zero, fizzy drink, soft drink, energy drink, sports drink, tonic, tonic water, ginger ale, ginger beer, milkshake, kombucha, iced tea, hot chocolate, cocoa, drinking chocolate, " +
        "@coca cola, @pepsi, @pepsi max, @fanta, @sprite, @7up, @dr pepper, @irn bru, @tango, @lucozade, @ribena, @robinsons, @fruit shoot, @volvic, @evian, @highland spring, @smartwater, @buxton, @harrogate spa, @innocent, @tropicana, @red bull, @monster energy, @monster, @relentless, @rockstar, @prime hydration, @oasis, @capri sun, @vimto, @schweppes, @fever tree, @fevertree, @belvoir, @san pellegrino, @appletiser, @j2o, @frijj, @yazoo, @ovaltine, @horlicks, @galaxy hot chocolate, @options hot chocolate, @nesquik, @alpro, @oatly",
      alcohol: "beer, beers, lager, lagers, ale, ales, ipa, stout, cider, ciders, wine, wines, red wine, white wine, rose wine, sparkling wine, prosecco, champagne, cava, gin, vodka, rum, whisky, whiskey, bourbon, tequila, brandy, cognac, liqueur, port, sherry, vermouth, spritz, cocktail, cocktails, moscow mule, mojito, margarita, pina colada, espresso martini, hard seltzer, alcohol free beer, " +
        "@heineken, @stella artois, @stella, @peroni, @corona, @budweiser, @carling, @fosters, @carlsberg, @san miguel, @birra moretti, @moretti, @madri, @cobra, @guinness, @brewdog, @punk ipa, @camden hells, @beavertown, @kopparberg, @rekorderlig, @strongbow, @thatchers, @magners, @bulmers, @old mout, @gordons, @tanqueray, @bombay sapphire, @hendricks, @whitley neill, @smirnoff, @absolut, @grey goose, @bacardi, @captain morgan, @kraken, @jack daniels, @jameson, @famous grouse, @glenfiddich, @johnnie walker, @baileys, @pimms, @aperol, @malibu, @disaronno, @jagermeister, @echo falls, @yellow tail, @hardys, @jacobs creek, @barefoot, @casillero del diablo, @blossom hill, @isla negra, @whispering angel, @mumm, @moet, @veuve clicquot, @laurent perrier, @freixenet, @white claw",
      coffee_tea: "tea, teas, tea bags, teabags, loose leaf tea, green tea, herbal tea, peppermint tea, chamomile tea, earl grey, english breakfast, chai, matcha, coffee beans, ground coffee, instant coffee, coffee pods, coffee capsules, espresso, latte, cappuccino, flat white, americano, mocha latte, decaf, coffee bags, " +
        "@yorkshire tea, @yorkshire gold, @pg tips, @twinings, @tetley, @typhoo, @clipper, @pukka, @teapigs, @taylors, @nescafe, @kenco, @lavazza, @illy, @douwe egberts, @carte noire, @starbucks coffee, @costa coffee, @taylors of harrogate, @dolce gusto, @tassimo, @nespresso, @vertuo, @ispirazione, @pact coffee, @percol, @cafedirect, @lyons, @melozio, @barista creations, @arpeggio, @kazaar, @volluto",
      grocery: "bread, loaf, sourdough, bagel, bagels, croissant, croissants, crumpet, crumpets, muffin, muffins, scone, scones, teacake, tea cakes, hot cross buns, bun, buns, roll, rolls, bread rolls, wrap, wraps, tortilla wraps, tortilla, pitta, naan, garlic bread, baguette, brioche, pancakes, waffles, cereal, cereals, granola, muesli, porridge, oats, porridge oats, cornflakes, " +
        "milk, semi skimmed, skimmed milk, whole milk, oat milk, almond milk, soya milk, butter, spread, margarine, cheese, cheddar, mozzarella, parmesan, brie, camembert, halloumi, feta, stilton, cream cheese, cottage cheese, yoghurt, yogurt, yoghurts, greek yoghurt, fromage frais, double cream, single cream, whipping cream, clotted cream, sour cream, soured cream, squirty cream, custard, eggs, free range eggs, egg, " +
        "chicken, chicken breast, chicken thighs, chicken drumsticks, chicken fillets, chicken wings, beef, mince, beef mince, steak, pork, pork chops, short rib, short ribs, lamb, bacon, ham, sausage, sausages, sausage rolls, salami, chorizo, pepperoni, turkey, duck, gammon, burger patties, meatballs, fish, salmon, cod, haddock, tuna, prawns, mackerel, sardines, fish fingers, fish cakes, scampi, " +
        "apple, apples, banana, bananas, orange, oranges, satsumas, clementines, easy peelers, easy peeler, grapes, strawberries, raspberries, blueberries, blackberries, cherries, pear, pears, plums, peach, peaches, nectarines, mango, mangoes, pineapple, melon, watermelon, kiwi, lemons, limes, avocado, avocados, fruit, berries, " +
        "potato, potatoes, baking potatoes, jacket potato, jacket potatoes, sweet potato, carrot, carrots, onion, onions, red onions, spring onions, garlic, ginger, broccoli, cauliflower, cabbage, lettuce, salad, salad leaves, spinach, kale, rocket, cucumber, tomato, tomatoes, cherry tomatoes, peppers, courgette, mushrooms, sweetcorn, peas, garden peas, beans, green beans, baked beans, beanz, chickpeas, lentils, leeks, celery, parsnips, swede, beetroot, asparagus, herbs, basil, coriander, parsley, veg, vegetables, " +
        "pasta, spaghetti, penne, fusilli, linguine, tagliatelle, lasagne, lasagne sheets, macaroni, ravioli, tortellini, gnocchi, noodles, rice, basmati, risotto, couscous, quinoa, flour, sugar, icing sugar, baking powder, yeast, salt, pepper, black pepper, spices, olive oil, vegetable oil, sunflower oil, vinegar, " +
        "sauce, sauces, pasta sauce, bolognese sauce, curry sauce, soy sauce, ketchup, tomato ketchup, mayonnaise, mayo, mustard sauce, salad cream, gravy, gravy granules, stock cubes, stock, passata, chopped tomatoes, tomato puree, pesto, hummus, houmous, dip, dips, salsa, guacamole, chutney, pickle, jam, marmalade, honey, peanut butter, nutella, spreads, syrup, golden syrup, " +
        "soup, soups, beans on toast, pizza, pizzas, margherita, pepperoni pizza, lasagna, curry, chilli, chilli con carne, pie, pies, pasty, pasties, quiche, ready meal, ready meals, meal deal, sandwich, sandwiches, baguettes, toastie, sushi, ramen, pad thai, stir fry, kebab, doner, shawarma, falafel, burger, burgers, cheeseburger, big mac, nuggets, chicken nuggets, wings, fries, chips and, onion rings, garlic naan, poppadoms, bhaji, bhajis, samosa, samosas, spring rolls, dumplings, gyoza, bao, bao buns, dim sum, katsu, katsu curry, teriyaki, biryani, korma, tikka, tikka masala, jalfrezi, vindaloo, rogan josh, dhal, dal, paneer, burrito, burritos, tacos, taco, quesadilla, enchiladas, fajitas, nachos, hot dog, wrap meal, breakfast, full english, brunch, lunch, dinner, meal, meals, combo, dessert, mac and cheese, mac n cheese, macaroni cheese, party rings, pineapple rings, poke bowl, buddha bowl, acai bowl, burrito bowl, bento, bento box, meal box, box meal, hamper, food hamper, protein powder, chia seeds, sunflower seeds, pumpkin seeds, @mug shot, desserts, " +
        "cake, cakes, cupcakes, cupcake, brownie, brownies, doughnut, doughnuts, donut, donuts, cheesecake, tart, tarts, trifle, mousse, pudding, puddings, sticky toffee pudding, crumble, ice cream, ice creams, gelato, sorbet, frozen yogurt, cones, choc ices, " +
        "tofu, quorn, plant based, frozen veg, oven chips, hash browns, yorkshire puddings, pigs in blankets, stuffing, cranberry sauce, mince pies, christmas pudding, stollen, panettone, baby food, baby milk, formula, first infant milk, puree, rusks, " +
        "@heinz, @warburtons, @hovis, @kingsmill, @allinson, @roberts, @kelloggs, @weetabix, @shreddies, @cheerios, @coco pops, @rice krispies, @frosties, @special k, @crunchy nut, @shredded wheat, @quaker, @oatso simple, @ready brek, @dorset cereals, @lurpak, @anchor, @flora, @clover, @country life, @philadelphia, @dairylea, @babybel, @cathedral city, @pilgrims choice, @seriously, @muller, @mullerlight, @yeo valley, @onken, @activia, @danone, @actimel, @yakult, @frubes, @petits filous, @arla, @cravendale, @skyr, @fage, @the collective, @birds eye, @youngs, @quorn, @richmond, @wall's, @mr kipling, @bisto, @oxo, @knorr, @hellmanns, @branston, @marmite, @bovril, @nutella, @lyles, @tate and lyle, @silver spoon, @uncle bens, @bens original, @tilda, @napolina, @dolmio, @loyd grossman, @old el paso, @pot noodle, @batchelors, @cup a soup, @baxters, @covent garden, @ambrosia, @gu, @ben and jerrys, @ben jerrys, @magnum, @cornetto, @carte dor, @walls, @haagen dazs, @haagen-dazs, @mackies, @mr freeze, @calippo, @twister, @fab lolly, @mccain, @aunt bessies, @goodfellas, @chicago town, @dr oetker, @ristorante, @pizza express, @gousto, @hello fresh, @mindful chef, @charlie bigham, @bigham, @ella's kitchen, @ellas kitchen, @cow and gate, @aptamil, @sma, @kendamil, @hipp, @organix, @huel, @myprotein, @whey, @impact whey, @nandos peri peri, @patak, @pataks, @sharwoods, @blue dragon, @amoy, @kikkoman, @lea and perrins, @hp sauce, @french's, @tabasco, @encona, @cauldron, @linda mccartney, @beyond meat, @tesco finest, @finest, @sainsburys taste the difference, @taste the difference, @extra special, @the best",
      meal_kit: "meal kit, recipe box, veg box, fruit box, grocery box, groceries, grocery, food shop, weekly shop",
      weak: "~chocolate, ~coffee, ~mocha, ~caramel, ~toffee, ~honey, ~vanilla, ~cinnamon, ~mint, ~peppermint, ~lemon, ~lime, ~cherry, ~berry, ~raspberry, ~strawberry, ~blueberry, ~peach, ~apricot, ~plum, ~olive, ~oatmeal, ~oat, ~biscuit, ~latte, ~cream, ~creme, ~wine, ~champagne, ~pistachio, ~truffle, ~mustard, ~aubergine, ~melon, ~coconut, ~mango, ~sorbet, ~cocoa, ~espresso, ~chai, ~matcha, ~rhubarb, ~fig, ~salted caramel, ~sage, ~ginger, ~butterscotch, ~bubblegum, ~bbq, ~smoky bbq, ~sugar free, ~fat free, ~gluten free, ~dairy free, ~no added sugar, ~fragrance free, ~unscented, ~perfume free, ~cola, ~orange, ~fruit, ~food, ~drink, ~drinks, ~delivery food, ~cake, ~pie, ~sweet, ~vegan, ~vegetarian, ~organic",
      pack: "#sharing bag, #share bag, #sharing pouch, #sharing pack, #sharing box, #grab bag, #big bag, #family bag, #treat bag, #bag of, #gift bag of, #box of, #tin of, #tub of, #jar of, #pack of, #packet of, #bottle of, #can of, #case of, #crate of, #carton of, #pouch of, #multipack, #multi pack, #variety pack, #selection pack, #party pack, #snack pack, #treat size, #fun size, #share size, #king size bar, #duo, #tub, #tubs, #tin, #tins, #jar, #jars, #packet, #packets, #pouch, #pouches, #carton, #cartons, #punnet, #punnets, #bunch, #bottle, #bottles, #can, #cans, #pint, #pints, #tube, #sachet, #sachets, #crate, #bag, #bags, #box, #boxes, #pack, #packs, #pot, #pots, #case, #bar, #bars, #slices, #slice, #portion, #portions, #fillets, #loose, #each",
      served: "%bowl, %bowls, %basket, %bucket, %platter, %tray, %board, %cup, %cups, %plate, %plates",
    },
    household: {
      cleaning: "washing up liquid, washing-up liquid, dish soap, fairy liquid, surface spray, antibacterial spray, kitchen spray, bathroom spray, multi surface spray, multi surface cleaner, cleaner, cleaners, cleaning spray, bleach, disinfectant, limescale remover, oven cleaner, glass cleaner, toilet cleaner, toilet gel, toilet blocks, rim block, rim blocks, descaler, polish, furniture polish, wipes, cleaning wipes, antibacterial wipes, disinfectant wipes, surface wipes, sponge, sponges, scourer, scourers, dish cloth, dish cloths, dishcloth, microfibre cloths, cloths, cleaning cloths, rubber gloves, marigolds, mop head, dishwasher tablets, dishwasher tabs, dishwasher salt, rinse aid, dishwasher pods, air freshener, air fresheners, plug in air freshener, plug in refill, room spray, drain unblocker, drain cleaner, shoe care, shoe care kit, shoe cleaner, shoe polish, trainer cleaner, protector spray, protect spray, waterproofing spray, " +
        "@crep protect, @kiwi shoe polish, " +
        "@fairy, @fairy platinum, @finish quantum, @finish powerball, @domestos, @dettol, @flash, @cif, @harpic, @zoflora, @ecover, @astonish, @mr muscle, @pledge, @mr sheen, @vanish, @dylon, @glade, @febreze, @air wick, @airwick, @toilet duck, @bloo, @jif, @viakal, @elbow grease, @the pink stuff, @pink stuff, cleaning paste, @minky, @spontex, @scotch brite, @marigold",
      laundry: "laundry liquid, laundry detergent, laundry powder, laundry pods, laundry capsules, washing powder, washing liquid, washing capsules, washing pods, fabric conditioner, fabric softener, non bio, bio liquid, stain remover, colour catcher, dryer sheets, tumble dryer sheets, " +
        "@persil, @bold, @ariel, @comfort, @lenor, @surf, @daz, @fairy non bio, @smol, @tide, @purex",
      paper: "toilet roll, toilet rolls, toilet tissue, toilet paper, loo roll, kitchen roll, kitchen rolls, kitchen paper, kitchen towel, kitchen towels, paper towels, paper towel, tissues, facial tissues, tissue, napkins, serviettes, paper plates, paper cups, plastic cups, straws, paper straws, " +
        "@andrex, @cushelle, @charmin, @plenty, @regina, @kleenex, @velvet, @nicky",
      kitchen_consumables: "foil, tin foil, kitchen foil, aluminium foil, cling film, clingfilm, cling wrap, baking paper, greaseproof paper, baking parchment, sandwich bags, freezer bags, food bags, zip lock bags, food storage bags, bin bags, bin liners, refuse sacks, rubbish bags, pedal bin liners, compost bags, cake cases, muffin cases, cocktail sticks, birthday candles, matches, firelighters, charcoal, lighter, lighters, bag for life, bags for life, carrier bag, carrier bags, carrier bag charge, plastic bag, paper bag, reusable bag, shopping bag, shopping bags, bag charge, gift wrap, wrapping paper, gift bag, gift bags, gift tags, tissue paper, sellotape, cellotape, tape, parcel tape, bubble wrap, vacuum bags, hoover bags, " +
        "@bacofoil, @lakeland foil, @tuffy, @handy bags, @glad",
      batteries: "batteries, battery, aa batteries, aaa batteries, light bulb, light bulbs, led bulb, bulb, bulbs, " +
        "@duracell, @energizer, @varta",
      toiletries: "shower gel, body wash, bubble bath, bath foam, soap, hand soap, hand wash, handwash, bar soap, toothpaste, toothbrush, toothbrushes, manual toothbrush, toothbrush heads, mouthwash, floss, dental floss, interdental brushes, deodorant, antiperspirant, roll on, body spray, shampoo, conditioner, hair conditioner, dry shampoo, 2 in 1, razor, razors, razor blades, disposable razors, shaving foam, shaving gel, shave gel, cotton buds, cotton wool, cotton pads, baby wipes, wet wipes, flushable wipes, nappies, nappy, nappy sacks, pull ups, sanitary towels, sanitary pads, pads, tampons, panty liners, liners, period pants, incontinence pads, hand sanitiser, hand gel, talc, " +
        "@colgate, @sensodyne, @aquafresh, @macleans, @oral b, @oralb, @listerine, @corsodyl, @dove, @imperial leather, @radox, @original source, @carex, @sanex, @palmolive, @lynx, @sure, @rexona, @right guard, @mitchum, @soft and gentle, @head and shoulders, @head shoulders, @pantene, @tresemme, @herbal essences, @aussie, @alberto balsam, @vo5, @batiste, @gillette, @wilkinson sword, @bic, @king of shaves, @always, @tampax, @bodyform, @lil lets, @pampers, @huggies, @johnsons, @johnson's, @tena, @childs farm, @simple wipes, @waterwipes, @cussons",
    },
    beauty_health: {
      skincare: "moisturiser, moisturizer, moisturising cream, face cream, day cream, night cream, eye cream, hand cream, foot cream, heel cream, heel balm, body lotion, body cream, body butter, shea butter, body oil, lotion, serum, serums, cleanser, face wash, micellar water, cleansing water, micellar cleansing water, mist, face mist, setting mist, pillow mist, pillow spray, sleep spray, toner, face mask, sheet mask, clay mask, exfoliator, scrub, lip scrub, body scrub, sugar scrub, face scrub, sunscreen, sun cream, suncream, sun lotion, spf, after sun, tan, fake tan, self tan, tanning, retinol, hyaluronic acid, niacinamide, vitamin c serum, eye gel, balm, lip balm, cleansing balm, barrier cream, nappy cream, bath salts, bath bomb, bath bombs, bath oil, makeup remover, make up remover, cleansing wipes, facial wipes, " +
        "@cerave, @la roche posay, @the ordinary, @the inkey list, @inkey list, @nivea, @e45, @aveeno, @vaseline, @simple, @garnier, @neutrogena, @olay, @no7, @no 7, @clinique, @elemis, @kiehls, @drunk elephant, @paulas choice, @glow recipe, @bio oil, @palmers, @soap and glory, @sol de janeiro, @cetaphil, @eucerin, @bioderma, @nuxe, @sudocrem, @scholl, @carmex, @blistex, @burts bees, @lush, @the body shop, @rituals, @neom, @aesop, @soltan, @ambre solaire, @hawaiian tropic, @piz buin, @st tropez, @bondi sands, @tanologist",
      makeup: "makeup, make up, foundation, concealer, powder, setting powder, blusher, blush, bronzer, highlighter, primer, setting spray, mascara, eyeliner, eye liner, eyeshadow, eye shadow, eyeshadow palette, palette, brow pencil, brow gel, lipstick, lip gloss, gloss, butter gloss, lip liner, lip oil, lip tint, nail polish, nail varnish, gel polish, nail file, false lashes, lashes, press on nails, false nails, nail clippers, tweezers, insoles, gel insoles, makeup brushes, beauty blender, makeup sponge, " +
        "@maybelline, @loreal, @l oreal, @rimmel, @max factor, @revlon, @nyx, @e l f, @mac, @benefit, @charlotte tilbury, @fenty, @fenty beauty, @rare beauty, @huda beauty, @urban decay, @too faced, @nars, @bareminerals, @estee lauder, @makeup revolution, @barry m, @catrice, @bourjois, @kiko, @glossier, @milk makeup, @tarte",
      fragrance: "perfume, fragrance, eau de parfum, eau de toilette, edp, edt, parfum, aftershave, cologne, body mist, " +
        "@jo malone, @chanel, @dior, @ysl, @yves saint laurent, @armani, @hugo boss, @paco rabanne, @carolina herrera, @lancome, @gucci bloom, @marc jacobs, @viktor and rolf, @tom ford, @calvin klein, @jean paul gaultier, @britney spears, @ariana grande, @zara perfume",
      hair: "hair oil, hair mask, hair serum, leave in conditioner, heat protection spray, hair spray, hairspray, hair gel, styling gel, hair wax, hair dye, hair colour, hair mousse, styling mousse, root touch up, hair clay, mousse, " +
        "@olaplex, @kerastase, @redken, @moroccanoil, @elvive, @schwarzkopf, @got2b, @l oreal elvive, @wella, @bleach london, @color wow, @k18",
      health: "throat pastilles, paracetamol, ibuprofen, aspirin, painkillers, painkiller, cold and flu, cold flu, cough syrup, cough mixture, cough sweets, throat sweets, throat lozenges, lozenges, decongestant, nasal spray, antihistamine, antihistamines, hay fever tablets, hayfever, allergy tablets, indigestion tablets, antacid, rehydration sachets, vitamins, vitamin, multivitamin, multivitamins, vitamin c, vitamin d, vitamin d3, supplements, supplement, probiotics, omega 3, cod liver oil, fish oil, omega 3 fish oil, magnesium, zinc, iron tablets, folic acid, collagen, melatonin, plasters, plaster, bandage, bandages, first aid kit, antiseptic cream, antiseptic, savlon, thermometer, pregnancy test, ovulation test, contact lenses, contact lens solution, eye drops, prescription, medicine, medication, tablets, capsules, caplets, gummies vitamins, cold sore cream, " +
        "@calpol, @nurofen, @lemsip, @beechams, @strepsils, @benylin, @piriton, @clarityn, @gaviscon, @rennie, @imodium, @germolene, @elastoplast, @vicks, @olbas, @berocca, @seven seas, @centrum, @vitabiotics, @wellwoman, @wellman, @pregnacare, @holland and barrett, @solgar, @boots pharmaceuticals, @anadin, @sudafed, @otrivine, @optrex, @zovirax, @bonjela, @dioralyte, @canesten, @bazuka, @deep heat, @voltarol, @tiger balm",
    },
    clothing: {
      tops: "top, tops, vest top, tank top, crop top, cami, camisole, bodysuit, blouse, t shirt, tshirt, t shirts, tee, tees, polo, polo shirt, shirt, shirts, overshirt, shacket, jersey, long sleeve top, rugby shirt, football shirt, home shirt, away shirt, kit shirt, base layer, baselayer, tunic",
      knitwear: "jumper, jumpers, sweater, sweaters, cardigan, cardi, pullover, knit, knitted jumper, roll neck, turtleneck, half zip, quarter zip, 1/4 zip, sweatshirt, crewneck sweatshirt, hoodie, hoodies, hooded top, zip hoodie, fleece, scuba",
      outerwear: "jacket, jackets, coat, coats, raincoat, rain jacket, parka, puffer, puffer jacket, down jacket, gilet, bodywarmer, blazer, anorak, windbreaker, trench, trench coat, overcoat, bomber, bomber jacket, denim jacket, leather jacket, waterproof jacket, shell jacket, softshell, cagoule, poncho, cape, mac",
      bottoms: "jeans, trousers, chinos, joggers, jogging bottoms, trackies, tracksuit bottoms, sweatpants, track pants, cargo trousers, cargos, leggings, legging, tights, shorts, cycling shorts, running shorts, swim shorts, board shorts, skirt, skirts, mini skirt, midi skirt, maxi skirt, culottes, pants, pant, short, flares, wide leg trousers, dungarees",
      dresses: "dress, dresses, midi dress, maxi dress, mini dress, wrap dress, shirt dress, tea dress, slip dress, jumpsuit, playsuit, romper, co ord, co-ord, two piece, suit, suits, waistcoat, tracksuit, onesie",
      underwear: "underwear, boxers, boxer shorts, trunks, briefs, knickers, thong, thongs, bra, bras, sports bra, bralette, lingerie, socks, sock, trainer socks, ankle socks, crew socks, boot socks, hold ups, stockings, slip, shapewear, vest, vests, thermal",
      nightwear: "pyjamas, pajamas, pjs, pyjama set, nightie, nightdress, nightshirt, dressing gown, robe, loungewear, lounge set",
      swimwear: "swimsuit, swimming costume, bikini, bikini top, bikini bottoms, swimwear, swim trunks, rash vest, cover up, kaftan",
      baby_kids: "babygrow, baby grow, sleepsuit, romper suit, school uniform, school jumper, school trousers, school shirt, pinafore",
      ranges: "@tu, @f and f, @fandf, @george, @nutmeg, @lululemon, @gymshark, @uniqlo, @zara, @asos design, @primark, @nike sportswear, @nike dri fit, @dri fit, @align, @define, @scuba, @wunder, @abc, @everyday, @heattech, @airism",
    },
    footwear: {
      trainers: "trainer, trainers, sneaker, sneakers, running shoes, running shoe, gym shoes, football boots, astro turf boots, studs, spikes, plimsolls, high tops, " +
        "@air max, @air force, @air force 1, @af1, @jordan 1, @jordan 4, @air jordan, @jordan retro, @dunk, @dunk low, @dunks, @blazer mid, @cortez, @vomero, @pegasus, @invincible, @samba, @gazelle, @spezial, @campus, @stan smith, @superstar, @new balance 574, @new balance 9060, @ultraboost, @nmd, @forum low, @handball spezial, @gel kayano, @gel nimbus, @gel 1130, @gel lyte, @gel cumulus, @novablast, @clifton, @bondi, @speedgoat, @cloudmonster, @cloudnova, @cloud 5, @cloudsurfer, @old skool, @sk8 hi, @chuck taylor, @all star, @chuck 70, @run star, @club c, @classic leather, @suede classic, @speedcat, @palermo, @new balance 550, @new balance 530, @new balance 990, @new balance 9060, @nb 550, @2002r, @air huarache, @air presto, @shox, @foam runner, @yeezy",
      boots: "boot, boots, ankle boots, chelsea boots, knee high boots, walking boots, hiking boots, wellies, wellington boots, wellingtons, snow boots, work boots, safety boots, biker boots, cowboy boots, " +
        "@dr martens, @1460, @1461, @jadon, @timberland, @hunter, @tasman, @ugg, @uggs",
      shoes: "shoe, shoes, loafers, loafer, brogues, oxfords, derby shoes, court shoes, heels, heel, high heels, stilettos, kitten heels, wedges, mules, mule, ballet flats, ballet pumps, pumps, flats, sandals, sandal, sliders, slides, flip flops, espadrilles, clogs, clog, slippers, slipper, moccasins, boat shoes, deck shoes, school shoes, " +
        "@birkenstock, @arizona, @crocs, @classic clog, @havaianas, @adilette, @wallabee, @kurt geiger, @clarks, @skechers, @vans, @converse, @toms",
    },
    accessories: {
      bags: "handbag, handbags, tote, bucket bag, bowling bag, saddle bag, hobo bag, glasses case, sunglasses case, tote bag, backpack, backpacks, rucksack, rucksacks, holdall, duffle bag, duffel bag, crossbody, crossbody bag, cross body bag, shoulder bag, clutch, clutch bag, bum bag, belt bag, waist bag, messenger bag, laptop bag, gym bag, weekender, washbag, wash bag, toiletry bag, makeup bag, cosmetic bag, changing bag, satchel, purse, wallet, card holder, cardholder, coin purse, suitcase, luggage, cabin bag, carry on, hand luggage, " +
        "@longchamp, @le pliage, @kanken, @herschel, @eastpak, @jansport, @samsonite, @antler",
      wear: "hat, hats, cap, caps, baseball cap, bucket hat, beanie, beanies, scarf, scarves, snood, gloves, glove, mittens, belt, belts, tie, ties, bow tie, braces, sunglasses, sunnies, reading glasses, glasses frames, umbrella, hair clip, hair clips, claw clip, scrunchie, scrunchies, hair bobbles, headband, hairband, hair accessories, key ring, keyring, keychain, lanyard, bag charm",
      jewellery: "jewellery, jewelry, necklace, necklaces, pendant, chain, bracelet, bracelets, bangle, earrings, earring, studs earrings, hoops, hoop earrings, ring, rings, engagement ring, charm, charms, brooch, anklet, cufflinks, watch, watches, watch strap, " +
        "@pandora, @swarovski, @monica vinader, @missoma, @daniel wellington, @casio, @seiko, @rolex, @fossil",
    },
    home: {
      furniture: "sofa, sofas, settee, corner sofa, sofa bed, armchair, chair, chairs, dining chair, office chair, gaming chair, stool, stools, bar stool, bench, table, tables, dining table, coffee table, side table, bedside table, desk, desks, bookcase, shelf, shelves, shelving, shelving unit, wardrobe, wardrobes, chest of drawers, drawers, sideboard, cabinet, tv stand, tv unit, media unit, console table, dressing table, mirror, mirrors, bed, beds, bed frame, tv bed, ottoman bed, divan, divan bed, bunk bed, cabin bed, headboard, mattress, mattresses, mattress topper, futon, bean bag, beanbag, footstool, pouffe, ottoman, room divider, table top, tabletop, worktop, worktops, door, doors, cabinet door, kitchen door, bistro set, garden set, patio set, " +
        "@ikea kallax, @kallax, @billy, @malm, @hemnes, @emma mattress, @simba",
      bedding_textiles: "duvet, duvets, duvet cover, duvet set, bedding, bedding set, bed linen, pillow, pillows, pillowcase, pillowcases, pillow case, fitted sheet, flat sheet, bed sheet, sheets, throw, throws, blanket, blankets, electric blanket, cushion, cushions, cushion cover, bedspread, quilt, towel, towels, bath towel, hand towel, bath sheet, beach towel, tea towel, tea towels, bath mat, curtains, curtain, blinds, blind, rug, rugs, runner, doormat, door mat, oven glove, oven gloves, apron, table cloth, tablecloth, placemats, coasters",
      kitchenware: "mug, mugs, cup and saucer, teacup, glass, glasses, wine glass, wine glasses, champagne flutes, tumbler, tumblers, plate, plates, dinner plates, side plates, bowl, bowls, cereal bowl, pasta bowl, mixing bowl, fruit bowl, salad bowl, serving bowl, dinner set, dinner service, cutlery, cutlery set, knife, knives, knife block, chopping board, cheese board, saucepan, saucepans, frying pan, pan, pans, wok, casserole dish, roasting tin, espresso cup, espresso cups, coffee cup, coffee cups, tea cup, tea cups, butter dish, baking dish, pie dish, soap dish, dish rack, dish drainer, salad spinner, spice rack, gravy boat, cake stand, pasta maker, soup maker, pizza stone, baking tray, baking tin, cake tin, loaf tin, tray, utensils, spatula, whisk, ladle, grater, colander, sieve, peeler, tongs, rolling pin, measuring jug, jug, teapot, cafetiere, french press, coffee grinder, grinder, kettle, toaster, blender, food processor, stand mixer, hand mixer, microwave, air fryer, slow cooker, pressure cooker, rice cooker, coffee machine, espresso machine, coffee maker, bean to cup, milk frother, frother, aeroccino, juicer, machine, rapid cooker, multi cooker, kitchen scales, scales, airer, heated airer, sandwich maker, waffle maker, ice cream maker, bread maker, toastie maker, soda maker, sodastream, water filter jug, flask, flasks, travel mug, water bottle, reusable bottle, lunch box, lunchbox, lunch bag, cool bag, storage jar, storage jars, storage box, storage boxes, storage containers, food containers, tupperware, lidded storage, storage set, bread bin, pedal bin, kitchen bin, bin, egg cup, ice cube tray, wine rack, pizza cutter, ice cream scoop, corkscrew, bottle opener, decanter, " +
        "@le creuset, @joseph joseph, @tefal, @ninja, @ninja air fryer, @nutribullet, @breville, @russell hobbs, @morphy richards, @delonghi, @kenwood, @kitchenaid, @smeg, @sage barista, @stanley, @chilly's, @chillys, @contigo, @ember mug, @lakeland, @pyrex, @denby, @emma bridgewater",
      decor: "lamp, lamps, table lamp, floor lamp, desk lamp, ceiling light, lampshade, lamp shade, light fitting, fairy lights, string lights, candle holder, vase, vases, frame, frames, photo frame, picture frame, wall art, print, prints, poster, canvas, clock, wall clock, ornament, ornaments, figurine, basket, baskets, storage basket, laundry basket, hanger, hangers, coat hooks, coat stand, shoe rack, clothes airer, airer, ironing board, iron, steam iron, garment steamer, vacuum, vacuum cleaner, hoover, cordless vacuum, cordless vacuum cleaner, robot vacuum, robot vacuum cleaner, stick vacuum cleaner, mop, steam mop, bucket and mop, dustpan, broom, fan, desk fan, tower fan, heater, oil heater, dehumidifier, humidifier, air purifier, christmas tree, wreath, bauble, baubles, christmas decorations, tree topper, doorstop, " +
        "@dyson v8, @dyson v11, @dyson v15, @shark, @henry hoover, @vax",
      candles: "candle, candles, scented candle, tealights, tea lights, reed diffuser, diffuser, wax melts, " +
        "@yankee candle, @yankee, @neom candle, @jo malone candle",
      plants: "plant, plants, roses, rose bush, house plant, houseplant, flowers, bouquet, roses bouquet, tulips, orchid, succulent, cactus, herb plant, basil plant, seeds, bulbs for planting, flower bulbs",
      garden_care: "compost, soil, potting compost, lawn feed, plant food, weed killer, slug pellets, bird seed, bird food, fat balls, grass seed, mulch, bark chippings",
      garden: "plant pot, plant pots, planter, planters, garden furniture, garden chair, parasol, bbq, barbecue, hose, hosepipe, lawn mower, lawnmower, strimmer, hedge trimmer, watering can, wheelbarrow, garden shed, shed, greenhouse, bird feeder, bird box, trowel, spade, rake, secateurs, garden gloves, fire pit, patio heater, solar lights",
      diy: "drill, cordless drill, screwdriver, screwdrivers, hammer, spanner, wrench, saw, tool kit, toolkit, toolbox, tool box, tape measure, spirit level, ladder, step ladder, stepladder, wallpaper, paint brush, paint brushes, paint roller, sander, workbench, screws, nails, wall plugs, rawlplugs, sealant, silicone sealant, filler, polyfilla, glue, superglue, wood glue, adhesive, grab adhesive, no more nails, expanding foam, cable ties, repair kit, puncture repair kit, wood primer, metal primer, paint primer, " +
        "@stanley fatmax, @fatmax, @bosch, @dewalt, @makita, @black and decker, @ryobi",
      paint: "paint, emulsion, gloss paint, primer, undercoat, wood stain, varnish, " +
        "@dulux, @crown paint, @ronseal, @cuprinol, @valspar",
    },
    electronics: {
      phones: "phone, phones, mobile phone, smartphone, iphone, android phone, sim free, " +
        "@samsung galaxy, @galaxy buds, @galaxy s24, @galaxy s23, @galaxy a, @galaxy z, @pixel, @google pixel, @oneplus, @xiaomi, @motorola, @nokia",
      phone_accessories: "phone case, phone cover, iphone case, case for iphone, screen protector, tempered glass, phone holder, phone stand, phone grip, popsocket, phone charm, magsafe, " +
        "@otterbox, @spigen, @mous, @casetify",
      computing: "laptop, laptops, macbook, macbook air, macbook pro, chromebook, notebook pc, imac, mac mini, desktop pc, pc, computer, monitor, monitors, keyboard, keyboards, mouse, mice, gaming mouse, wireless mouse, magic mouse, mouse mat, mousepad, webcam, printer, printers, scanner, router, wifi router, mesh wifi, modem, hard drive, external hard drive, ssd, usb stick, memory stick, flash drive, sd card, micro sd, micro sd card, microsd, microsd card, memory card, graphics card, ram, processor, motherboard, docking station, usb hub, tablet, tablets, ipad, ipad air, ipad pro, ipad mini, kindle, kindle paperwhite, e reader, ereader, apple pencil, stylus, " +
        "@logitech, @razer, @corsair, @steelseries, @hp laptop, @dell, @lenovo, @asus, @acer, @microsoft surface, @surface pro, @surface laptop, @galaxy tab, @fire hd, @fire tablet, @anker",
      audio_tv: "headphones, headphone, earphones, earbuds, ear buds, airpods, airpods pro, airpods max, wireless earbuds, noise cancelling headphones, headset, gaming headset, speaker, speakers, bluetooth speaker, smart speaker, soundbar, sound bar, subwoofer, record player, turntable, radio, dab radio, tv, tvs, television, televisions, smart tv, oled, qled, 4k tv, projector, streaming stick, fire tv stick, fire stick, chromecast, apple tv 4k, roku, tv aerial, " +
        "@bose, @sony wh, @sony, @sennheiser, @jbl, @beats, @beats studio, @sonos, @sonos era, @marshall, @bang and olufsen, @ue boom, @echo dot, @amazon echo, echo show, echo pop, echo, @alexa, @homepod, @nest mini, @google nest, @nest hub, @lg oled, @samsung qled, @hisense, @tcl, @philips hue",
      gaming: "console, consoles, games console, controller, controllers, gamepad, joy con, joy cons, playstation, playstation 5, ps5, ps4, xbox, xbox series x, xbox series s, nintendo switch, switch oled, switch lite, steam deck, vr headset, meta quest, quest 3, dualsense, charging dock",
      cameras_wearables: "camera, cameras, digital camera, action camera, gopro, dashcam, dash cam, lens, camera lens, tripod, drone, drones, ring light, smartwatch, smart watch, apple watch, fitness tracker, fitbit, garmin, galaxy watch, oura ring, smart ring, airtag, air tag, tile tracker, doorbell, video doorbell, smart plug, smart bulb, security camera, baby monitor, " +
        "@ring, @ring doorbell, @blink, @arlo, @nest cam, @gopro hero, @canon, @nikon, @fujifilm, @instax, @dji",
      power: "charger, chargers, phone charger, wall charger, wireless charger, charging pad, charging cable, cable, cables, usb cable, usb c cable, usb-c cable, lightning cable, hdmi cable, hdmi, ethernet cable, extension lead, extension cable, adapter, adaptor, plug adapter, travel adapter, power bank, powerbank, power adapter, surge protector",
      personal_care: "hair dryer, hairdryer, straighteners, hair straighteners, curling wand, curling tongs, hair curler, air styler, airwrap, electric toothbrush, electric shaver, shaver, beard trimmer, trimmer, hair clippers, clippers, epilator, ipl, " +
        "@ghd, @babyliss, @remington, @braun, @philips sonicare, @sonicare, @oral b io, @dyson airwrap, @dyson supersonic, @foreo",
      appliances: "washing machine, tumble dryer, dishwasher, fridge, freezer, fridge freezer, oven, cooker, hob, extractor hood, range cooker, chest freezer, wine cooler",
      brand: "@apple, @samsung, @google, @huawei, @philips, @panasonic, @lg, @nintendo, @xbox, @playstation, @microsoft",
    },
    toys_hobbies: {
      toys: "toy, toys, soft toy, teddy, teddy bear, plush, plushie, doll, dolls, action figure, figure, figures, play set, playset, building set, building blocks, blocks, puzzle, jigsaw, jigsaw puzzle, board game, card game, games, game, family game, playing cards, rubiks cube, fidget toy, slime, play doh, playdough, toy car, remote control car, rc car, train set, scooter, kids scooter, balance bike, trampoline, paddling pool, water gun, water pistol, nerf gun, kite, bubbles, colouring book, sticker book, stickers, craft kit, crafts, model kit, magnetic tiles, " +
        "@lego, @duplo, @barbie, @hot wheels, @playmobil, @nerf, @play-doh, @play doh, @squishmallow, @squishmallows, @jellycat, @sylvanian families, @paw patrol, @peppa pig, @bluey, @pokemon cards, @pokemon tcg, @funko pop, @funko, @hatchimals, @lol surprise, @my little pony, @monopoly, @cluedo, @scrabble, @jenga, @uno, @hungry hippos, @connect 4, @warhammer, @games workshop, @vtech, @fisher price, @little tikes, @melissa and doug, @tonies, @toniebox, @yoto",
      hobbies: "yarn, wool, embroidery hoop, pom poms, paint pens, glue gun, glue sticks, craft kit, felt, beads, knitting needles, crochet hook, sewing kit, sewing machine, fabric, fat quarters, embroidery kit, cross stitch, paints, acrylic paints, watercolours, watercolour paints, paintbrushes, sketchbook, sketch pad, canvas board, easel, colouring pencils, felt tips, markers, crayons, felt tip, felt tip pens, felt pens, colouring pens, clay, air dry clay, guitar, guitar strings, ukulele, keyboard piano, violin, drum sticks, plectrums, fishing rod, fishing tackle, telescope, binoculars, microscope, " +
        "@cricut, @posca, @crayola, @winsor and newton",
      party: "balloons, balloon, party bags, party poppers, banner, bunting, christmas crackers, crackers box, party decorations, birthday banner, confetti",
    },
    books_media: {
      books: "book, books, paperback, hardback, hardcover, novel, cookbook, cook book, recipe book, picture book, childrens book, boxset, box set, graphic novel, manga, comic, comics, magazine, magazines, diary, journal, calendar, wall calendar, atlas, dictionary, textbook, revision guide, " +
        "@penguin books, @harper collins, @waterstones",
      media: "dvd, dvds, blu ray, bluray, 4k blu ray, cd, cds, album, vinyl, vinyl record, lp, record, game for ps5, ps5 game, switch game, xbox game, video game, physical game, " +
        "@ea sports fc, @fifa 24, @fc 25, @call of duty, @mario kart, @zelda, @minecraft, @hogwarts legacy, @gta",
    },
    sport_outdoor: {
      fitness: "yoga mat, yoga block, yoga blocks, yoga brick, exercise mat, gym mat, dumbbell, dumbbells, kettlebell, kettlebells, weights, weight plates, barbell, resistance bands, resistance band, skipping rope, jump rope, foam roller, massage gun, pull up bar, exercise bike, treadmill, rowing machine, gym gloves, lifting straps, weight belt, protein shaker, shaker bottle, " +
        "@theragun",
      sports: "football, footballs, rugby ball, basketball, netball, tennis racket, tennis balls, badminton racket, shuttlecocks, squash racket, padel racket, golf balls, golf club, golf clubs, golf bag, golf glove, cricket bat, hockey stick, shin pads, shin guards, goalkeeper gloves, boxing gloves, punch bag, swimming goggles, goggles, swim cap, wetsuit, paddleboard, paddle board, surfboard, skateboard, roller skates, ice skates, helmet, bike helmet, cycling helmet, bike, bicycle, mountain bike, ebike, e bike, bike lock, bike light, bike lights, bike pump, inner tube, dartboard, darts, snooker cue, table tennis bats, " +
        "@wilson, @spalding, @titleist, @callaway, @slazenger",
      outdoor: "tent, tents, sleeping bag, sleeping bags, sleeping mat, camping chair, camping stove, gas canister, head torch, torch, lantern, walking poles, trekking poles, hiking poles, compass, cool box, picnic blanket, picnic set, camping, hammock, " +
        "@coleman, @vango, @jetboil",
    },
    pets: {
      pet_food: "dog food, cat food, puppy food, kitten food, pet food, dog biscuits, dog treats, cat treats, dog chews, dental sticks, dental chews, wet food, dry food, kibble, cat pouches, dog pouches, fish food, rabbit food, guinea pig food, hamster food, bird food for pets, " +
        "@pedigree, @whiskas, @felix, @purina, @purina one, @iams, @bakers, @harringtons, @lilys kitchen, @butternut box, @webbox, @wainwrights, @royal canin, @hills science, @james wellbeloved, @dreamies, @sheba, @dentastix, @good boy, @bonio, @winalot, @cesar, @applaws, @tails",
      pet_supplies: "cat litter, litter, fish tank, aquarium, dog bed, cat bed, pet bed, dog lead, lead, dog collar, collar, harness, dog harness, cat toy, dog toy, chew toy, ball launcher, scratching post, cat tree, pet carrier, dog crate, poo bags, dog poo bags, litter tray, pet bowl, dog bowl, cat bowl, flea treatment, wormer, worming tablets, " +
        "@frontline, @advocate, @kong, @catsan, @worlds best cat litter",
    },
    travel: {
      rail: "train ticket, train tickets, rail ticket, railcard, 16 25 railcard, 26 30 railcard, two together railcard, senior railcard, family railcard, network railcard, anytime return, anytime single, anytime day return, anytime day single, off peak return, off-peak return, off peak single, off peak day return, super off peak return, super off peak single, super off peak day return, advance single, advance ticket, day return, open return, period return, season ticket, travelcard, day travelcard, plusbus, first class upgrade, first class, coach card, coachcard, check in bag, check in bags, cabin bags, seat reservation, flexi season",
      local: "bus ticket, bus pass, coach ticket, tram ticket, metro ticket, oyster, oyster top up, contactless journey, tube fare, ferry ticket, ferry, taxi, taxi fare, uber trip, trip with uber, ride, bolt ride, journey fare, trip fare, car hire, car rental, van hire, parking, car park, parking fee, parking session, congestion charge, ulez, toll, bike hire, e scooter, scooter hire, airport transfer, ev charging, fuel, petrol, diesel, unleaded",
      stays: "flight, flights, return flight, one way flight, airfare, checked bag, hold luggage, extra baggage, seat selection, priority boarding, boarding pass, hotel, hotel room, hotel stay, room only, bed and breakfast, b and b, hostel, apartment stay, holiday cottage, night stay, nights stay, accommodation, package holiday, holiday",
      brands: "@trainline, @lner, @avanti, @gwr, @thameslink, @southeastern, @eurostar, @megabus, @national express, @flixbus, @tfl, @ryanair, @easyjet, @jet2, @british airways, @premier inn, @travelodge, @airbnb, @booking com",
    },
    digital: {
      subscriptions: "subscription, subscriptions, monthly subscription, annual subscription, membership, premium, premium plan, premium individual, premium family, premium duo, standard plan, standard with ads, basic plan, pro plan, plus plan, family plan, monthly plan, annual plan, renewal, licence, license, software licence, licence key, cloud storage, storage plan, vpn, streaming, " +
        "@netflix, @spotify, @spotify premium, @disney plus, @disney+, @prime video, @amazon prime, @prime membership, @apple music, @apple tv plus, @apple one, @icloud, @icloud plus, @youtube premium, @youtube music, @audible, @kindle unlimited, @now tv, @now membership, @paramount plus, @britbox, @dazn, @crunchyroll, @tidal, @deezer, @microsoft 365, @office 365, @adobe, @creative cloud, @dropbox, @google one, @chatgpt, @chatgpt plus, @claude pro, @claude max, @duolingo, @duolingo super, @headspace, @calm, @strava, @notion, @canva, @canva pro, @nordvpn, @expressvpn, @surfshark, @1password, @grammarly, @patreon, @substack, @tinder, @hinge, @bumble, @linkedin premium, @xbox game pass, @game pass, @playstation plus, @ps plus, @nintendo switch online, @ea play, @ubisoft plus, @the times, @the guardian, @the economist, @ft digital",
      apps: "app, apps, in app purchase, in-app purchase, app purchase, game credits, credits, coins, gems, gold bars, diamonds, v bucks, vbucks, robux, battle pass, season pass, dlc, download, digital download, digital edition, ebook, e book, kindle edition, audiobook, audio book, digital code, digital game, top up, mobile top up, airtime, data bundle, data add on, sim only, sim plan, e sim, esim, " +
        "@candy crush, @clash of clans, @roblox, @fortnite, @minecraft coins, @pokemon go, @royal match, @monopoly go, @steam wallet, @app store, @google play",
    },
    services: {
      delivery: "delivery, standard delivery, next day delivery, express delivery, nominated day delivery, delivery charge, delivery fee, delivery pass, postage, postage and packing, p and p, shipping, click and collect, service fee, service charge, small order fee, bag fee, booking fee, admin fee, card fee, transaction fee, tip, driver tip, gratuity",
      care: "tv licence, removal, recycling, hire, rental, installation, assembly, assembly service, fitting, extended warranty, warranty, care plan, applecare, applecare+, protection plan, insurance, gadget insurance, repair, screen repair, alterations, alteration, tailoring, dry cleaning, key cutting, engraving, personalisation, gift wrapping, haircut, hair cut, blow dry, manicure, pedicure, massage, facial, eyebrow threading, wax, lash lift, consultation, eye test, cleaning service, car wash, mot, servicing, lesson, lessons, class, classes, course, workshop, session, appointment",
      event: "event ticket, concert ticket, gig ticket, theatre ticket, cinema ticket, standard ticket, adult ticket, child ticket, adult admission, admission, entry ticket, entry, standing ticket, general admission, festival ticket, day pass, match ticket, museum entry, gallery entry, escape room, bowling, mini golf, crazy golf, go karting, karting, experience day, tour, tickets, ticket, " +
        "@odeon, @cineworld, @vue, @everyman, @ticketmaster",
    },
    gift_cards: {
      gift_cards: "gift card, gift cards, e gift card, egift card, e-gift card, egift, gift voucher, gift vouchers, e voucher, evoucher, voucher, gift certificate, gift experience voucher, " +
        "@love2shop, @one4all, @amazon gift card, @itunes gift card, @app store gift card, @google play gift card",
    },
    other: {
      stationery: "pen, pens, pencil, pencils, pencil case, notebook, notepad, note book, diary planner, planner, envelopes, stamps, greetings card, birthday card, card, cards, christmas cards, thank you cards, gift card holder, ruler, rubber, eraser, highlighters, post it notes, sticky notes, stapler, folder, ring binder, printer paper, a4 paper, paper, printer toner, toner cartridge, paint palette, ink, ink cartridge, ink cartridges, toner, label maker, " +
        "@moleskine, @paperchase, @sharpie, @stabilo, @bic pens",
      car: "car mat, car mats, wiper blades, engine oil, screenwash, de icer, car shampoo, air freshener car, phone mount, dash mount, roof box, tyre, tyres",
    },
  };

  // ---- Building the word index ------------------------------------------------------------------------------------
  function plurals(w) {
    const out = [w];
    const last = w.split(" ").pop(), head = w.slice(0, w.length - last.length);
    if (/[^aeiou]y$/.test(last)) out.push(head + last.slice(0, -1) + "ies");
    else if (/(s|x|z|ch|sh)$/.test(last)) out.push(head + last + "es");
    else if (/fe?$/.test(last)) { out.push(head + last.replace(/fe?$/, "ves")); out.push(head + last + "s"); }
    else out.push(head + last + "s");
    return out;
  }
  // Lower case, accents, apostrophes and the shops' fancy dashes off; & is "and", + is "plus"; then words.
  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[‐-―−]/g, "-").replace(/[‘’'`´]/g, "").replace(/&/g, " and ").replace(/\+/g, " plus ")
      .replace(/\be-(?=gift|book|voucher|reader|bike|scooter|sim)/g, "e ");
  }
  const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
  const INDEX = new Map(); // "w1 w2" → entry
  // When two lists spell a word the same: something food is served in, then a thing, then the rest (first listing wins).
  const RANK = { served: 3, noun: 2, brand: 1, weak: 1, pack: 1 };
  let MAXLEN = 1;
  for (const kind of KINDS) {
    const subs = LEX[kind] || {};
    for (const sub of Object.keys(subs)) {
      for (let raw of subs[sub].split(",")) {
        raw = raw.trim(); if (!raw) continue;
        let role = "noun";
        const mark = raw[0];
        if (mark === "~") role = "weak"; else if (mark === "@") role = "brand"; else if (mark === "#") role = "pack"; else if (mark === "%") role = "served";
        if (role !== "noun") raw = raw.slice(1);
        const words = tokens(raw).join(" ");
        if (!words) continue;
        // Brands and packing words keep their spelling; things and flavours get their plurals too.
        const forms = role === "brand" || role === "pack" ? [words] : plurals(words);
        for (const f of forms) {
          const e = { kind, sub, role, words: f };
          const old = INDEX.get(f);
          if (!old || RANK[role] > RANK[old.role]) INDEX.set(f, e);
          MAXLEN = Math.max(MAXLEN, f.split(" ").length);
        }
      }
    }
  }

  // Words that end the part of a line that names the thing ("Case for iPhone 15", "Dog food with chicken", "Tee in Black").
  const CUT = new Set(["for", "with", "in", "featuring", "inc", "incl", "including", "suitable", "compatible", "fits"]);
  // Pack sizes and weights: these say a thing gets used up.
  const WEIGHT = /(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s?(g|gm|gr|grams?|kg|kilos?|mg|ml|cl|l|ltr|litres?|liters?|oz|lb)(?![a-z])/;
  const MULTI = /(?:^|[^a-z0-9])\d+\s?x\s?\d+(?:\.\d+)?\s?(g|kg|ml|cl|l)?(?![a-z])/;
  const COUNT = /(?:^|[^a-z0-9])(\d+\s?(pk|pack|pcs|pieces|count|ct)|pack of \d+|x\s?\d+|\d+\s?x)(?![a-z])/;
  // A journey ("London Euston to Manchester Piccadilly (Return)").
  const JOURNEY = /^\s*(?:from\s+)?\p{Lu}[\p{L}0-9 .'’&()-]{1,48}?\s+(?:to|→|->)\s+\p{Lu}[\p{L}0-9 .'’&()-]{1,48}?\s*$/u;
  // Kinds of shop whose lines are nearly all one kind, when the line itself names nothing.
  const GROCER_NAME = /\b(sainsburys?|tesco|asda|morrisons|waitrose|ocado|lidl|aldi|iceland|co ?op|cooperative|spar|budgens|londis|nisa|costco|farmfoods|heron foods|booths|amazon fresh|getir|gorillas|zapp|m and s food|one stop|whole foods|planet organic|abel and cole|riverford|oddbox|milk and more)\b/;
  const EATERY_NAME = /\b(deliveroo|just eat|justeat|uber eats|ubereats|bolt food|wolt|dominos|pizza hut|papa johns|mcdonalds|kfc|burger king|nandos|wagamama|five guys|greggs|pret|leon|itsu|wasabi|yo sushi|subway|costa|starbucks|caffe nero|wetherspoons?|pub|restaurant|cafe|takeaway|pizzeria|grill|diner|bistro|tavern|chippy|kebab|curry house|noodle bar|sushi bar)\b/;
  // What a box, jar or pack is at a shop that sells one kind of lasting thing.
  const SHOP_KIND = { home: "home", electronics: "electronics" };
  const SHOP_HINT = { food: "food_drink", grocer: "food_drink", eatery: "food_drink", digital: "digital", travel: "travel", experiences: "services" };
  function readShop(opts) {
    const o = opts || {}, n = norm(o.shop || "");
    if (o.shopKind === "grocer" || o.shopKind === "eatery") return o.shopKind;
    if (GROCER_NAME.test(n)) return "grocer";
    if (EATERY_NAME.test(n)) return "eatery";
    return typeof o.shopKind === "string" ? o.shopKind : null;
  }

  const COUNT_NOUNS = new Set(["roll", "rolls", "sheet", "sheets", "pc", "pcs", "piece", "pieces", "stick", "sticks", "bar", "bars", "tablet", "tablets", "tabs",
    "capsule", "capsules", "caplets", "pods", "sachets", "slices", "rashers", "portions", "fillets", "cans", "bottles", "packs", "wipes", "bags", "pairs"]);
  // Every word or phrase Relay knows in a line, longest first at each place: [{ kind, sub, role, words, at, end }].
  function matches(toks) {
    const out = [];
    for (let i = 0; i < toks.length;) {
      let hit = null;
      for (let n = Math.min(MAXLEN, toks.length - i); n >= 1 && !hit; n--) {
        const e = INDEX.get(toks.slice(i, i + n).join(" "));
        if (e) hit = { ...e, at: i, end: i + n };
      }
      if (hit) {
        // "9 Rolls", "10 Sheets", "90 Tablets", "10 pcs": how many come in the pack, not what it is.
        if (hit.role === "noun" && COUNT_NOUNS.has(hit.words) && i > 0 && /^(\d+|x\d+)$/.test(toks[i - 1])) hit.role = "pack";
        out.push(hit); i = hit.end;
      } else i++;
    }
    return out;
  }

  function result(kind, sub, confidence, reasons, extra) {
    const k = KIND_LIST[kind] ? kind : "other";
    const group = (sub && SUB_GROUP[sub]) || KIND_LIST[k].group;
    const lasting = KIND_LIST[k].lasting && !USED_UP_SUB.has(sub) && confidence !== "low";
    return { kind: k, sub: sub || null, group, confidence, lasting, reasons: [...new Set(reasons || [])], ...(extra || {}) };
  }

  const PHONEISH = new Set(["iphone", "phone", "phones", "samsung", "galaxy", "pixel", "ipad", "airpods", "smartphone", "android", "oneplus", "xiaomi", "motorola", "magsafe"]);
  const PET_WORD = /\b(dogs?|cats?|pupp(y|ies)|kittens?|pets?|rabbits?|hamsters?|guinea pigs?)\b/;
  const MEDICINE_WORD = /\b(\d+\s?mg|paracetamol|ibuprofen|aspirin|vitamins?|multivitamins?|hay ?fever|allergy|antihistamines?|indigestion|iron|zinc|magnesium|caplets|soluble|effervescent|chewable|headache|migraine|cold|flu|sleep|melatonin|probiotics?)\b/;
  const CLEANING_WORD = /\b(dishwasher|finish|fairy|cleaning|toilet|washing machine|descaler|limescale|laundry|washing|bio|persil|ariel|bold|surf|daz)\b/;
  const COFFEE_WORD = /\b(coffee|nespresso|vertuo|dolce gusto|tassimo|espresso|lungo|ristretto|starbucks|lavazza|kenco|illy)\b/;
  // Colours that are also foods: at the end of a clothes line ("Jumper Oatmeal", "Dress Salmon") they are the colour.
  const COLOURISH = new Set(["orange", "lemon", "lime", "peach", "cherry", "plum", "mango", "apricot", "olive", "melon", "coconut", "avocado", "salmon",
    "berry", "berries", "latte", "espresso", "ginger", "honey", "mustard", "aubergine", "pistachio", "biscuit", "toffee", "caramel", "chocolate", "coffee",
    "mocha", "cream", "oatmeal", "oat", "sage", "cinnamon", "rose", "wine", "champagne", "raspberry", "strawberry", "mint", "fruit", "tan", "chai", "matcha", "fig"]);
  // Words for what something is made into ("Wrapping Paper Roll", "Ring Video Doorbell Battery"): the thing named first counts.
  const FORM_OF = (m) => m.words === "roll" || m.words === "rolls" || (m.kind === "household" && m.sub === "batteries");
  // Names that could be food or a toiletry (water, oil, butter, powder): a brand of another kind says which.
  const AMBIG = new Set(["water", "waters", "oil", "oils", "butter", "milk", "powder", "powders", "cream", "sugar", "salt", "honey", "gel"]);
  const TOY_BRAND = (b) => b.kind === "toys_hobbies";
  const FASHION_BRAND = (b) => b.kind === "clothing" || b.kind === "footwear" || b.kind === "accessories";

  // The same lines come up again and again (the weekly shop), so each answer is remembered for a while.
  const SEEN = new Map();
  function classifyRules(name, opts) {
    const o = opts || {}, k = String(name == null ? "" : name) + "\u0000" + (o.shop || "") + "\u0000" + (o.shopKind || "");
    if (SEEN.has(k)) { const r = SEEN.get(k); return { ...r, reasons: r.reasons.slice() }; }
    if (SEEN.size >= 5000) SEEN.clear();
    const r = readLine(name, o);
    SEEN.set(k, r);
    return { ...r, reasons: r.reasons.slice() };
  }
  function readLine(name, opts) {
    const raw = String(name == null ? "" : name).trim();
    if (!raw) return result("other", null, "low", []);
    const shop = readShop(opts);
    const text = norm(raw);
    const all = tokens(raw);
    const reasons = [];
    const weight = WEIGHT.exec(text), multi = MULTI.exec(text), count = COUNT.exec(text);
    const packed = Boolean(weight || multi);
    if (weight) reasons.push(weight[0].trim()); else if (multi) reasons.push(multi[0].trim());
    const ms = matches(all);

    // A journey, written like one ("London Euston to York (Return)"), when nothing else in the line is a thing.
    if (JOURNEY.test(raw.replace(/\s*\((return|single|open return|outward|inward)\)\s*$/i, "")) && !ms.some((m) => (m.role === "noun" || m.role === "brand") && m.kind !== "travel"))
      return result("travel", "rail", "high", ["journey"]);

    // The part that names the thing: up to "for", "with", "in", or a " - " variant, when something is named before it.
    const named = (m) => m.role === "noun" || m.role === "served";
    let cutAt = all.length;
    for (let i = 1; i < all.length; i++) if (CUT.has(all[i]) && ms.some((m) => m.end <= i && named(m))) { cutAt = i; break; }
    const dash = raw.search(/\s[-–|/]\s|\s\(|,\s/);
    if (dash > 0) {
      const d = tokens(raw.slice(0, dash)).length;
      if (d < cutAt && ms.some((m) => m.end <= d && (named(m) || m.role === "brand"))) cutAt = d;
    }
    const zone = ms.filter((m) => m.end <= cutAt), rest = ms.filter((m) => m.at >= cutAt);
    const nouns = zone.filter(named);
    const brands = ms.filter((m) => m.role === "brand");
    const weak = ms.filter((m) => m.role === "weak");
    const packs = zone.filter((m) => m.role === "pack");
    const foodBrand = brands.some((m) => m.kind === "food_drink");
    const foodNamed = nouns.some((m) => m.role === "noun" && m.kind === "food_drink") || foodBrand;

    let head = nouns[nouns.length - 1] || null;
    if (head && FORM_OF(head)) {
      const before = nouns.slice(0, -1).filter((m) => m.role === "noun" && m.kind !== "food_drink" && !FORM_OF(m)).pop();
      if (before && (head.kind !== "household" || before.kind === "electronics")) head = before;
    }
    if (head && AMBIG.has(head.words)) {
      const other = brands.filter((b) => b.kind !== head.kind && CONSUMABLE.has(b.kind)).pop();
      if (other) head = { ...head, kind: other.kind, sub: other.sub };
    }
    if (head && head.role === "noun" && head.kind === "food_drink" && COLOURISH.has(head.words)) {
      // "Jumper Oatmeal": the colour of a jumper. Only when a thing of another kind is named before it.
      const before = nouns.slice(0, -1).filter((m) => m.role === "noun" && m.kind !== "food_drink").pop();
      if (before) head = before;
    }
    if (head) {
      const w = head.words;
      if (head.role === "served") {
        // A bowl, a basket, a cup: what's in it when food is named or the shop serves food; otherwise the thing itself.
        if (foodNamed || shop === "eatery") {
          const f = nouns.filter((m) => m.role === "noun" && m.kind === "food_drink").pop() || brands.find((m) => m.kind === "food_drink");
          return result("food_drink", f ? f.sub : "grocery", "high", [f ? f.words : w].concat(reasons));
        }
        head = { ...head, kind: "home", sub: "kitchenware" };
      } else if (/^tablets?$/.test(w)) {
        if (CLEANING_WORD.test(text)) head = { ...head, kind: "household", sub: "cleaning" };
        else if (MEDICINE_WORD.test(text) || count || brands.some((b) => b.kind === "beauty_health")) head = { ...head, kind: "beauty_health", sub: "health" };
        else head = { ...head, kind: "electronics", sub: "computing" };
      } else if (/^(capsules?|caplets?)$/.test(w)) {
        if (CLEANING_WORD.test(text)) head = { ...head, kind: "household", sub: "laundry" };
        else if (COFFEE_WORD.test(text) || foodBrand) head = { ...head, kind: "food_drink", sub: "coffee_tea" };
      } else if (w === "glass" || w === "glasses") {
        if (/\b(reading|sun|optical|blue light|frames?|prescription)\b/.test(text)) head = { ...head, kind: "accessories", sub: "wear" };
      } else if (w === "tan" && nouns.length > 1) {
        head = nouns[nouns.length - 2];
      } else if ((w === "games" || w === "game") && shop === "digital") {
        head = { ...head, kind: "digital", sub: "apps" };
      } else if (/^tickets?$/.test(w) && shop === "travel") {
        head = { ...head, kind: "travel", sub: "rail" };
      } else if (w === "record" && !/\b(vinyl|lp|album|player)\b/.test(text)) {
        head = nouns.length > 1 ? nouns[nouns.length - 2] : null;
      }
      // Shampoo for a dog, chicken for a puppy and a dog's coat are for the pet.
      const petBrand = brands.find((b) => b.kind === "pets");
      if (head && (CONSUMABLE.has(head.kind) && head.kind !== "pets") && (petBrand || PET_WORD.test(text.replace(/\bhot dogs?\b/g, ""))))
        head = { ...head, kind: "pets", sub: head.kind === "food_drink" ? "pet_food" : "pet_supplies" };
      else if (head && (head.kind === "clothing" || head.kind === "accessories") && head.at > 0 && PET_WORD.test(all[head.at - 1])) head = { ...head, kind: "pets", sub: "pet_supplies" };
      // A puppy's bed or blanket is the puppy's (a cushion with a dog printed on it isn't).
      else if (head && head.kind === "home" && PET_WORD.test(text) && !/\b(dogs?|cats?|pupp(y|ies)|kittens?|pets?)\s+(print|prints|pattern|design|motif|tooth|portrait|lover|lovers|eye)\b/.test(text)) head = { ...head, kind: "pets", sub: "pet_supplies" };
      // A food brand on a weighed or counted pack: food, whatever a flavour is called ("Graze Smoky BBQ Crunch 4 Pack").
      if (head && KIND_LIST[head.kind].lasting && foodBrand && (packed || count)) head = { ...head, kind: "food_drink", sub: brands.find((b) => b.kind === "food_drink").sub };
      // Milligrams are a supplement or a medicine.
      if (head && head.kind === "food_drink" && /\d\s?mg\b/.test(text)) head = { ...head, kind: "beauty_health", sub: "health" };
      // A toy maker's car wash or ice cream truck is a toy (but its pasta shapes, weighed, are food).
      if (head && brands.some(TOY_BRAND) && !packed && ["food_drink", "services", "travel", "household", "home"].includes(head.kind)) head = { ...head, kind: "toys_hobbies", sub: "toys" };
      // A game for a console is the game.
      if (head && head.kind === "electronics" && head.sub === "gaming" && brands.some((b) => b.kind === "books_media")) head = { ...head, kind: "books_media", sub: "media" };
      // A game or film bought as a download is digital; a cabin bag on an airline's receipt is the bag allowance.
      if (head && head.kind === "books_media" && (shop === "digital" || /\bdigital\b/.test(text))) head = { ...head, kind: "digital", sub: "apps" };
      if (head && shop === "travel" && head.kind === "accessories" && head.sub === "bags") head = { ...head, kind: "travel", sub: "stays" };
      // A DIY maker's tape is a tape measure; its filler is for the walls.
      if (head && head.kind === "household" && brands.some((b) => b.kind === "home" && (b.sub === "diy" || b.sub === "paint"))) head = { ...head, kind: "home", sub: "diy" };
      // A reusable, silicone or steel version of something usually thrown away is a kitchen thing that lasts.
      if (head && head.kind === "household" && head.sub === "kitchen_consumables" && /\b(reusable|silicone|stainless|steel|glass|bamboo)\b/.test(text)) head = { ...head, kind: "home", sub: "kitchenware" };
      // On a travel company's receipt, a class or an upgrade is part of the journey.
      if (head && shop === "travel" && head.kind === "services" && head.sub === "care") head = { ...head, kind: "travel", sub: "rail" };
      // Paper towels come in rolls, not sets: a set of kitchen towels is tea towels.
      if (head && head.kind === "household" && head.sub === "paper" && /\bsets?\b/.test(text)) head = { ...head, kind: "home", sub: "bedding_textiles" };
    }
    // "iPhone 15 Case": the case, not the phone.
    if (head && head.kind === "electronics" && head.sub === "phones" && packs.some((p) => p.words === "case" && p.at > head.at)) head = { ...head, sub: "phone_accessories", words: head.words + " case" };
    if (head) return result(head.kind, head.sub, "high", [head.words].concat(reasons));

    // No thing named before "for": "Case for iPhone 15" is a phone case; otherwise what's named after it.
    const phoneAnywhere = all.some((t) => PHONEISH.has(t));
    const caseWord = packs.some((p) => p.words === "case") || /\b(case|cover)\b/.test(text);
    if (caseWord && phoneAnywhere && !packed) return result("electronics", "phone_accessories", "high", ["phone case"]);
    const later = rest.filter(named).pop();
    if (later && !packs.length) return result(later.kind, later.sub, "medium", [later.words].concat(reasons));

    // A bag with nothing in it named is a bag (not at a supermarket, and not with a weight or a food brand on it).
    const bag = packs.find((p) => p.words === "bag" || p.words === "bags");
    if (bag && !packed && !foodBrand && shop !== "grocer" && shop !== "eatery" && !brands.some((b) => !FASHION_BRAND(b)))
      return result("accessories", "bags", brands.length ? "high" : "medium", ["bag"].concat(brands.map((b) => b.words)));

    // A brand or product line. A maker of many things (Apple, Samsung) or a shop's own range (Tu, F&F) is only a hint.
    const brand = brands.filter((b) => !(b.kind === "electronics" && b.sub === "brand") && !(b.kind === "clothing" && b.sub === "ranges")).pop();
    if (brand) return result(brand.kind, brand.sub, "high", [brand.words].concat(reasons));
    const maker = brands.find((b) => b.kind === "electronics");
    if (maker && !packed) return result("electronics", null, "medium", [maker.words].concat(reasons));

    // How it is packed, or what it tastes of: something used up.
    const flavour = weak.filter((m) => m.kind === "food_drink").pop();
    if (packed || packs.length || flavour) {
      if (shop === "travel") return result("travel", "stays", "medium", ["shop"].concat(packs.map((p) => p.words)));
      // (A 22 litre box at a home shop is for storage; a 500g one there is still food.)
      const litreBox = weight && /^(l|ltr|litres?|liters?)$/.test(weight[2]) && packs.some((p) => /^(box|boxes|tub|tubs)$/.test(p.words));
      if (SHOP_KIND[shop] && !flavour && !foodBrand && (!packed || litreBox)) return result(SHOP_KIND[shop], null, "medium", ["shop"].concat(packs.map((p) => p.words)));
      if (shop === "beauty") return result("beauty_health", null, "medium", reasons.concat(packs.map((p) => p.words)));
      if (packed || flavour || shop === "grocer" || shop === "eatery" || shop === "food")
        return result("food_drink", "grocery", "medium", reasons.concat(flavour ? [flavour.words] : packs.map((p) => p.words)));
    }
    // Only the kind of shop: a supermarket's or a takeaway's line is food, an app shop's an app, a rail shop's a journey.
    if (shop && SHOP_HINT[shop]) {
      const k = SHOP_HINT[shop];
      return result(k, k === "services" ? "event" : null, "medium", ["shop"]);
    }
    return result("other", null, "low", reasons);
  }

  // The AI's answer ({ type, sure }) for this name, when there is one and it is sure.
  const nameKey = (s) => String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
  function classify(name, opts) {
    const o = opts || {};
    const ai = o.ai && typeof o.ai === "object" ? (o.ai[nameKey(name)] || null) : null;
    const rules = classifyRules(name, o);
    if (ai && typeof ai.type === "string" && KIND_LIST[ai.type] && ai.sure === true) {
      const sub = typeof ai.sub === "string" && /^[a-z_]{2,30}$/.test(ai.sub) ? ai.sub : (rules.kind === ai.type ? rules.sub : null);
      return result(ai.type, sub, "ai", ["ai"], { rules: rules.kind });
    }
    return rules;
  }
  // A thing kept rather than used up, and sure enough to open Wrapped with or to suggest more of.
  const isLasting = (c) => Boolean(c && c.lasting && (c.confidence === "high" || c.confidence === "ai"));
  const isConsumable = (kind) => CONSUMABLE.has(kind);

  return Object.freeze({ KIND_LIST, KINDS, CONSUMABLE: [...CONSUMABLE], classify, classifyRules, isLasting, isConsumable, nameKey, norm, tokens });
});
