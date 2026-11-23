require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const Stripe = require("stripe");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "clothify.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_ore INTEGER NOT NULL CHECK(price_ore >= 0),
    image TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Clothing',
    sizes TEXT NOT NULL DEFAULT '["S","M","L","XL"]',
    stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    total_ore INTEGER NOT NULL,
    items_json TEXT NOT NULL,
    stripe_session_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const productCount = db.prepare("SELECT COUNT(*) AS count FROM products").get().count;
if (productCount === 0) {
  const insert = db.prepare(`
    INSERT INTO products (name, description, price_ore, image, category, sizes, stock)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const seed = [
    ["Essential Heavyweight Tee", "A relaxed everyday tee with a premium feel.", 24900, "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=900", "Tops", JSON.stringify(["XS","S","M","L","XL"]), 24],
    ["Everyday Hoodie", "Soft fleece hoodie for cooler days.", 54900, "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=900", "Hoodies", JSON.stringify(["S","M","L","XL"]), 12],
    ["Relaxed Cargo Pants", "Utility-inspired trousers with a relaxed fit.", 69900, "https://images.unsplash.com/photo-151五", "Bottoms", JSON.stringify(["S","M","L","XL"]), 8],
    ["Classic Cap", "An adjustable cap with a clean embroidered look.", 19900, "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=900", "Accessories", JSON.stringify(["One size"]), 30]
  ];
  const tx = db.transaction(rows => rows.forEach(row => insert.run(...row)));
  tx(seed);
}

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const storeName = process.env.STORE_NAME || "CLOTHIFY";
const currency = (process.env.CURRENCY || "sek").toLowerCase();

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://js.stripe.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.stripe.com"],
      frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"]
    }
  }
}));
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.db", dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || "development-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use(express.static(path.join(ROOT, "public")));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false });
const checkoutLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: "Admin login required." });
  next();
}
function validText(value, max = 500) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}
function productDto(row) {
  return {
    id: row.id, name: row.name, description: row.description,
    priceOre: row.price_ore, image: row.image, category: row.category,
    sizes: JSON.parse(row.sizes), stock: row.stock
  };
}
function money(ore) { return (ore / 100).toFixed(2); }

// Public API
app.get("/api/config", (req, res) => res.json({ storeName, currency }));
app.get("/api/products", (req, res) => {
  const rows = db.prepare("SELECT * FROM products ORDER BY created_at DESC, id DESC").all();
  res.json(rows.map(productDto));
});
app.get("/api/products/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Product not found." });
  res.json(productDto(row));
});

// Admin authentication
app.post("/api/admin/login", loginLimiter, (req, res) => {
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredPassword || !safeEqual(req.body.password, configuredPassword)) {
    return res.status(401).json({ error: "Incorrect admin password." });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Could not start admin session." });
    req.session.isAdmin = true;
    res.json({ ok: true });
  });
});
app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});
app.get("/api/admin/me", (req, res) => res.json({ isAdmin: Boolean(req.session.isAdmin) }));

app.post("/api/admin/products", requireAdmin, (req, res) => {
  const { name, description = "", priceOre, image = "", category = "Clothing", sizes = ["S","M","L","XL"], stock = 0 } = req.body;
  if (!validText(name, 100) || !Number.isInteger(Number(priceOre)) || Number(priceOre) < 0 ||
      !Number.isInteger(Number(stock)) || Number(stock) < 0 || !Array.isArray(sizes) ||
      sizes.length > 12 || !sizes.every(s => validText(String(s), 20))) {
    return res.status(400).json({ error: "Check product name, price, stock and sizes." });
  }
  if (image && (!validText(image, 1000) || !/^https:\/\/|^\//.test(image))) {
    return res.status(400).json({ error: "Image must be an HTTPS URL or a local path." });
  }
  const result = db.prepare(`
    INSERT INTO products (name, description, price_ore, image, category, sizes, stock)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name.trim(), String(description).slice(0, 1000), Number(priceOre), image, String(category).slice(0, 50), JSON.stringify(sizes), Number(stock));
  res.status(201).json(productDto(db.prepare("SELECT * FROM products WHERE id = ?").get(result.lastInsertRowid)));
});
app.put("/api/admin/products/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!old) return res.status(404).json({ error: "Product not found." });
  const { name, description = "", priceOre, image = "", category = "Clothing", sizes = ["S","M","L","XL"], stock = 0 } = req.body;
  if (!validText(name, 100) || !Number.isInteger(Number(priceOre)) || Number(priceOre) < 0 ||
      !Number.isInteger(Number(stock)) || Number(stock) < 0 || !Array.isArray(sizes) ||
      sizes.length > 12 || !sizes.every(s => validText(String(s), 20))) {
    return res.status(400).json({ error: "Invalid product fields." });
  }
  db.prepare(`UPDATE products SET name=?, description=?, price_ore=?, image=?, category=?, sizes=?, stock=? WHERE id=?`)
    .run(name.trim(), String(description).slice(0,1000), Number(priceOre), image, String(category).slice(0,50), JSON.stringify(sizes), Number(stock), id);
  res.json(productDto(db.prepare("SELECT * FROM products WHERE id = ?").get(id)));
});
app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const result = db.prepare("DELETE FROM products WHERE id = ?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "Product not found." });
  res.json({ ok: true });
});
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200").all();
  res.json(rows.map(o => ({ id: o.id, email: o.email, totalOre: o.total_ore, items: JSON.parse(o.items_json), status: o.status, createdAt: o.created_at })));
});

// Stripe Checkout: prices and stock are always read from the server database.
app.post("/api/checkout", checkoutLimiter, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: "Payments are not configured yet. Add Stripe test keys to .env." });
    const { items, email } = req.body;
    if (!Array.isArray(items) || items.length < 1 || items.length > 30 ||
        typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email and add items to your cart." });
    }

    const normalized = [];
    for (const item of items) {
      const id = Number(item.productId);
      const quantity = Number(item.quantity);
      const size = String(item.size || "");
      if (!Number.isInteger(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
        return res.status(400).json({ error: "Invalid cart item." });
      }
      const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
      if (!product || product.stock < quantity) return res.status(400).json({ error: `${product?.name || "A product"} is out of stock.` });
      const allowedSizes = JSON.parse(product.sizes);
      if (!allowedSizes.includes(size)) return res.status(400).json({ error: "Invalid size selected." });
      normalized.push({ productId: id, name: product.name, unitAmount: product.price_ore, quantity, size });
    }

    const totalOre = normalized.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
    const order = db.prepare("INSERT INTO orders (email, total_ore, items_json) VALUES (?, ?, ?)")
      .run(email.trim(), totalOre, JSON.stringify(normalized));
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email.trim(),
      line_items: normalized.map(item => ({
        quantity: item.quantity,
        price_data: {
          currency,
          unit_amount: item.unitAmount,
          product_data: { name: `${item.name} — Size ${item.size}` }
        }
      })),
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?checkout=cancelled`,
      metadata: { orderId: String(order.lastInsertRowid) }
    });
    db.prepare("UPDATE orders SET stripe_session_id = ? WHERE id = ?").run(checkout.id, order.lastInsertRowid);
    res.json({ url: checkout.url });
  } catch (error) {
    console.error("Checkout error:", error.message);
    res.status(500).json({ error: "Could not start checkout. Please try again." });
  }
});

// Stripe sends a signed event to this endpoint after payment.
app.post("/api/stripe/webhook", (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send("Webhook not configured.");
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature error: ${err.message}`);
  }
  if (event.type === "checkout.session.completed") {
    const checkout = event.data.object;
    const orderId = Number(checkout.metadata?.orderId);
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    if (order && order.status !== "paid") {
      const items = JSON.parse(order.items_json);
      const transaction = db.transaction(() => {
        for (const item of items) {
          const result = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?")
            .run(item.quantity, item.productId, item.quantity);
          if (!result.changes) throw new Error("Stock changed before payment completed.");
        }
        db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(orderId);
      });
      try { transaction(); } catch (err) {
        console.error("Order stock update failed:", err.message);
        db.prepare("UPDATE orders SET status = 'review_required' WHERE id = ?").run(orderId);
      }
    }
  }
  res.json({ received: true });
});

app.get("/success.html", (req, res, next) => res.sendFile(path.join(ROOT, "public", "success.html")));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API route not found." });
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`${storeName} running at http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
    console.warn("Set ADMIN_PASSWORD and SESSION_SECRET in .env before using this outside local development.");
  }
});
