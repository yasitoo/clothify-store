# CLOTHIFY — Full-stack clothing store

A starter e-commerce website built with Node.js, Express, SQLite, vanilla JavaScript and Stripe Checkout.

## Features

- Responsive storefront and product cards
- Category filters and live search
- Product detail modal with size selection
- Shopping cart saved in the browser
- Server-side cart and price validation
- Stripe-hosted checkout (test mode supported)
- SQLite product and order storage
- Admin login, product creation/deletion and order list
- Basic security headers, rate limits and server-side validation

## Requirements

- Node.js 20 or newer
- npm
- A Stripe account for online card payments (use test keys while developing)

## Run locally

1. Extract the project folder.
2. Open a terminal in the project folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Copy `.env.example` to `.env`.
5. Set a strong `SESSION_SECRET` and `ADMIN_PASSWORD`.
6. Start the server:

   ```bash
   npm run dev
   ```

7. Open http://localhost:3000
8. Admin dashboard: http://localhost:3000/admin.html

The database is created automatically at `data/clothify.db`. Demo products are inserted the first time the database is created.

## Configure Stripe test payments

1. Create or sign in to your Stripe account.
2. Find your test secret key in the Stripe Dashboard.
3. Put it in `.env` as `STRIPE_SECRET_KEY=sk_test_...`.
4. Install and run the Stripe CLI, then forward events to the local server:

   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

5. Copy the webhook signing secret printed by the CLI into `.env` as `STRIPE_WEBHOOK_SECRET=whsec_...`.
6. Restart the Node server.
7. Use Stripe's documented test card numbers in test mode. Never use real card details for testing.

If Stripe keys are not configured, the storefront still works, but checkout displays a setup message.

## Admin

Visit `/admin.html` and sign in with `ADMIN_PASSWORD` from `.env`.

You can add and delete products and view recent orders. Product prices are entered in whole SEK in the admin form and stored internally as öre.

## Project structure

```text
clothify/
├── data/                 # SQLite database and session database (created at runtime)
├── public/
│   ├── admin.html        # Admin dashboard
│   ├── admin.js          # Admin dashboard logic
│   ├── app.js            # Storefront, products and cart logic
│   ├── index.html        # Storefront
│   ├── styles.css        # Responsive styling
│   └── success.html      # Stripe return page
├── .env.example          # Environment variable template
├── .gitignore
├── package.json
├── README.md
└── server.js             # Express API, SQLite and Stripe integration
```

## Important before going live

This is a functional starter project, not a finished legally compliant retail operation. Before accepting real payments:

- Deploy behind HTTPS and set `NODE_ENV=production`, `BASE_URL` to your real HTTPS domain, and a long random `SESSION_SECRET`.
- Use live Stripe keys only after completing Stripe account verification and reviewing its requirements.
- Configure a real shipping provider or a clear manual shipping workflow.
- Add tax/VAT handling, shipping rates, returns/refunds, privacy policy, terms, cookie handling where applicable, and customer support contact details.
- Configure transactional email for order confirmations and fulfillment updates.
- Test payment success, cancellation, webhook delivery, stock handling, backups and restore procedures.
- Add CSRF protection for state-changing admin routes and consider stronger admin identity controls before public deployment.
- Do not store card numbers or CVC data on your server. Stripe Checkout hosts the payment page.
- Review local business, consumer, tax and privacy requirements before selling.

## Notes

- Product image URLs in the demo are remote Unsplash images. Replace them with images you own or are licensed to use.
- The newsletter form is a UI placeholder and does not collect/store emails.
- This project does not automatically calculate shipping or VAT.
- Orders are marked paid by a verified Stripe webhook, not merely because a customer visits the success page.
