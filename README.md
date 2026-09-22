# fairwaze.app

The Fairwaze platform: homepage at /, the order form at /new, each group's trip at /t/<link>.

Netlify environment variables:
- PLATFORM = 1
- VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (same values as the Myrtle site is fine)
- ORDER_WEBHOOK (optional): a URL that gets a JSON ping for every new trip

Domain: add fairwaze.app to this site (not to the Myrtle site).
