// Made-up airline and travel-site emails for the flight tests (scripts/test-flights.mjs, test-wrapped-travel-ui.mjs).
// Written for these tests in the usual shapes of such emails; none is a copy of a real one, and every name, reference
// and amount is invented.
const mail = ({ from, subject, date, html, text }) => [
  "From: " + from, "Subject: " + subject, "Date: " + date, "MIME-Version: 1.0",
  html ? 'Content-Type: text/html; charset="utf-8"' : 'Content-Type: text/plain; charset="utf-8"', "", html || text, ""].join("\r\n");
const p = (lines) => lines.map((l) => "<p>" + l + "</p>").join("\n");

export const BA = mail({
  from: '"British Airways" <BA@email.ba.com>', subject: "Your e-ticket receipt X7KQPZ: 14 Mar 2026", date: "Tue, 20 Jan 2026 09:12:00 +0000",
  html: "<html><body>" + p(["Thank you for booking with British Airways", "Booking reference: X7KQPZ", "Passenger: Mr C Example",
    "<b>Outbound</b>", "BA0478 Sat 14 Mar 2026", "London Heathrow (LHR) to Barcelona (BCN)", "Depart 07:25 Arrive 10:35",
    "<b>Return</b>", "BA0479 Sat 21 Mar 2026", "Barcelona (BCN) to London Heathrow (LHR)", "Depart 11:30 Arrive 12:50",
    "Fare GBP 248.00", "Taxes, fees and charges GBP 64.40", "Total paid £312.40", "Payment card ending 0000"]) + "</body></html>",
});
export const RYANAIR = mail({
  from: '"Ryanair" <itinerary@ryanair.com>', subject: "Ryanair Travel Itinerary", date: "Mon, 02 Feb 2026 18:40:00 +0000",
  text: ["Your booking is confirmed", "Reservation number: KQ7ZRB", "", "Flight details", "STN → FAO Thu 07 May 2026 FR8352", "Departs 06:15 London Stansted",
    "Arrives 09:05 Faro", "", "Passengers: 1 Adult", "Total paid: GBP 89.98", "Manage your booking at any time in the app."].join("\n"),
});
export const EASYJET = mail({
  from: '"easyJet" <donotreply@easyjet.com>', subject: "Your easyJet booking EJY4KP2", date: "Tue, 10 Feb 2026 20:05:00 +0000",
  text: ["Thanks for booking with easyJet", "Booking reference: EJY4KP2", "", "Flight 1", "Manchester to Alicante", "EZY1931", "Fri 3 Jul", "Dep 06:00 Arr 09:45",
    "", "Flight 2", "Alicante to Manchester", "EZY1932", "Fri 10 Jul", "Dep 10:30 Arr 12:20", "", "Seats 2 x £8.99", "Total £256.47"].join("\n"),
});
export const JET2 = mail({
  from: '"Jet2.com" <noreply@jet2.com>', subject: "Your Jet2.com booking confirmation", date: "Sat, 14 Mar 2026 11:00:00 +0000",
  html: "<html><body>" + p(["Your booking is confirmed", "Booking ref: 59XKQ2", "Departing flight", "Leeds Bradford (LBA) &rarr; Palma (PMI)", "LS1203 Sun 9 Aug 2026 07:00",
    "Return flight", "Palma (PMI) &rarr; Leeds Bradford (LBA)", "LS1204 Sun 16 Aug 2026 10:40", "22kg bag x 2", "Total price £1,104.00",
    "Jet2.com, Low Fare Way, Leeds LS1 4AB"]) + "</body></html>",
});
export const EXPEDIA = mail({
  from: '"Expedia" <Expedia@eg.expedia.co.uk>', subject: "Expedia travel confirmation - Dubai - Apr 12 (Itinerary # 72811043915)", date: "Wed, 18 Feb 2026 21:30:00 +0000",
  html: "<html><body>" + p(["Your trip is booked!", "Itinerary # 72811043915", "Flight: London to Dubai", "Departure Sun, Apr 12, 2026",
    "London (LGW) to Dubai (DXB)", "Emirates EK 16, 7h 05m", "Return Sun, Apr 19, 2026", "Dubai (DXB) to London (LGW)", "Emirates EK 15, 7h 50m",
    "Price summary", "Traveller 1: Adult £598.18", "Taxes and fees £44.00", "Total: £642.18"]) + "</body></html>",
});
// Not flights bought: a sale, a check-in reminder, a boarding pass, a train ticket with station codes.
export const SALE = mail({
  from: '"Ryanair" <news@ryanair.com>', subject: "Sale on flights to Spain from £19.99", date: "Thu, 05 Mar 2026 08:00:00 +0000",
  text: ["Spring seat sale", "STN - AGP from £19.99", "MAN - ALC from £24.99", "LBA - PMI from £29.99", "Book by midnight Sunday."].join("\n"),
});
export const CHECK_IN = mail({
  from: '"easyJet" <donotreply@easyjet.com>', subject: "It's time to check in for your flight to Alicante", date: "Fri, 26 Jun 2026 06:00:00 +0000",
  text: ["Check in now", "Booking reference: EJY4KP2", "Manchester to Alicante", "EZY1931", "Fri 3 Jul", "Your boarding pass will be in the app."].join("\n"),
});
export const BOARDING = mail({
  from: '"British Airways" <BA@email.ba.com>', subject: "Your boarding pass for BA0478", date: "Fri, 13 Mar 2026 07:30:00 +0000",
  text: ["Boarding pass", "Booking reference: X7KQPZ", "BA0478 Sat 14 Mar 2026", "London Heathrow (LHR) to Barcelona (BCN)", "Seat 14C", "Gate closes 06:55"].join("\n"),
});
export const TRAIN = mail({
  from: '"Trainline" <auto-confirm@info.thetrainline.com>', subject: "Your booking confirmation for Manchester Piccadilly to Bristol Temple Meads", date: "Mon, 06 Apr 2026 12:00:00 +0000",
  text: ["Thanks for booking with Trainline", "Booking reference: TL8K2QX9", "Manchester Piccadilly (MAN) to Bristol Temple Meads (BRI)", "Mon 13 Apr 2026 09:27",
    "1 Adult Advance Single", "Total £45.20"].join("\n"),
});
