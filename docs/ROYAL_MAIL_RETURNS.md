# Royal Mail return labels (Click & Drop)

Relay can give shoppers a real Royal Mail return label, made on the **shop's own** Royal Mail Click & Drop account.
It is off for every shop until that shop turns it on.

## What the shop needs
- A Royal Mail Click & Drop account with a **returns service** on it (for example Tracked Returns 24 or 48).
  Royal Mail adds returns services to business accounts; if Relay says "no returns services", the shop asks Royal Mail.
- Its Click & Drop API key: Click & Drop › Settings › Integrations › add a "Click & Drop API" integration › copy the key.

## Turning it on
1. Open Relay for shops (in Shopify admin, or the retailer page).
2. Under **Royal Mail return labels**, paste the API key, fill in where returns should go, and press **Check key and turn on**.
3. Relay asks Royal Mail which returns services the account has. If Royal Mail doesn't accept the key, nothing is saved.
4. The key is stored encrypted and is never shown again. **Turn off** deletes it.

The key is typed by the shop into its own dashboard. Nobody should paste it into chat or email.

## What happens on a return
1. The shopper starts a return in Relay (within 7 days, item not already swapped).
2. Relay reads the delivery address from the Shopify order and asks Royal Mail (`POST /returns`) for a label to the shop's return address,
   with the Relay reference as the customer reference.
3. Only if Royal Mail returns a tracking number does the shopper see the label: Royal Mail's QR code (for a Post Office counter),
   a PDF to print if Royal Mail sent one, and the tracking number.
4. The shop gets an email with the tracking number, and the return shows in **Pilot results** with it.
5. Royal Mail charges the postage to the shop's account, the same as a label made in Click & Drop. Relay never refunds anyone.

If anything is missing (shop hasn't turned it on, Royal Mail says no, no UK address on the order), there is no label and the
shopper is told to use the shop's own returns process, exactly as before.

## Data
- The shopper's address goes from Shopify to Royal Mail at the moment the label is made. Relay doesn't keep it.
- The label Royal Mail sends back is kept so the shopper can download it again, and is deleted when the shopper deletes their account.

## Not yet tested
Everything above is tested against stand-ins for Royal Mail and Shopify (`scripts/test-royal-mail.mjs`, `scripts/test-return-label-ui.mjs`).
It has **not** been run against a real Click & Drop account. The request follows Royal Mail's published API
(https://api.parcel.royalmail.com/, Returns section). The first real test should be one return on a pilot shop's account,
checking the label prints and the tracking number appears in Click & Drop.
