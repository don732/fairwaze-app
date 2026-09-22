# fairwaze.app

The Fairwaze platform: homepage at /, the order form at /new, each group's trip at /t/<link>.

Netlify environment variables:
- PLATFORM = 1
- VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (same values as the Myrtle site is fine)
- ORDER_WEBHOOK (optional): a URL that gets a JSON ping for every new trip

Domain: add fairwaze.app to this site (not to the Myrtle site).

## Payments (Stripe)
Nothing about payments switches on until all four STRIPE_ variables are set. Until then every trip stays free and open.

How it works: the card is taken at sign-up (Stripe Checkout, 7-day free trial). Nothing is charged for 7 days; cancel any time in that week and nothing is ever charged. On day 8 Stripe charges automatically: The Season $149 (then yearly, cancel any time), The Weekend $99 (live 30 days, never renews). A trip without a card on file is on hold. One free week per trip.

Stripe setup:
1. Product catalog → Add product
   - The Season: $149, Recurring, Yearly → copy the price ID
   - The Weekend: $99, Recurring, Yearly → copy the price ID
     (Yes, recurring: that's what lets Stripe hold the card through the free week. The site ends it 30 days after its one charge, so it never renews.)
2. Developers → Webhooks → Add endpoint: https://fairwaze.app/api/stripe-webhook
   Events: checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.paid, invoice.payment_failed
3. Settings → Billing → Customer portal: allow cancelling (at end of billing period) and updating payment methods
4. Netlify environment variables on this site:
   STRIPE_SECRET_KEY, STRIPE_PRICE_SEASON, STRIPE_PRICE_WEEKEND, STRIPE_WEBHOOK_SECRET, PUBLIC_ORIGIN=https://fairwaze.app
   then Trigger deploy.
Test in Stripe's Test mode first with card 4242 4242 4242 4242.
