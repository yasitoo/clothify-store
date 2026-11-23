const state = { products: [], category: "All", query: "", cart: loadCart(), selectedProduct: null };
const $ = selector => document.querySelector(selector);
const money = ore => new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(ore / 100);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));

function loadCart() {
  try { return JSON.parse(localStorage.getItem("clothify-cart") || "[]"); }
  catch { return []; }
}
function saveCart() { localStorage.setItem("clothify-cart", JSON.stringify(state.cart)); }
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}
async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
async function loadProducts() {
  try {
    state.products = await api("/api/products");
    renderCategories(); renderProducts(); renderCart();
  } catch (error) {
    $("#product-grid").innerHTML = `<p class="loading">Could not load products: ${escapeHtml(error.message)}</p>`;
  }
}
function renderCategories() {
  const categories = ["All", ...new Set(state.products.map(p => p.category))];
  $("#categories").innerHTML = categories.map(c => `<button class="category ${state.category === c ? "active" : ""}" data-category="${escapeHtml(c)}">${escapeHtml(c === "All" ? "All pieces" : c)}</button>`).join("");
  $("#categories").querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
    state.category = button.dataset.category; renderCategories(); renderProducts();
  }));
}
function renderProducts() {
  const filtered = state.products.filter(p =>
    (state.category === "All" || p.category === state.category) &&
    `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(state.query.toLowerCase())
  );
  $("#product-grid").innerHTML = filtered.length ? filtered.map(p => `
    <article class="product-card" data-id="${p.id}" tabindex="0" aria-label="View ${escapeHtml(p.name)}">
      <div class="product-image"><img src="${escapeHtml(p.image || "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=900")}" alt="${escapeHtml(p.name)}" loading="lazy"><span class="product-tag">${p.stock > 0 ? "IN STOCK" : "SOLD OUT"}</span></div>
      <div class="product-info"><div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.category)}</p></div><span class="price">${money(p.priceOre)}</span></div>
    </article>`).join("") : `<p class="loading">No products found. Try another search.</p>`;
  $("#product-grid").querySelectorAll(".product-card").forEach(card => {
    const open = () => showProduct(Number(card.dataset.id));
    card.addEventListener("click", open);
    card.addEventListener("keydown", event => { if (event.key === "Enter") open(); });
  });
}
function showProduct(id) {
  const p = state.products.find(item => item.id === id);
  if (!p) return;
  state.selectedProduct = p;
  $("#product-detail").innerHTML = `
    <div class="product-detail-grid">
      <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}">
      <div class="product-detail-copy">
        <p class="eyebrow">${escapeHtml(p.category)}</p><h2>${escapeHtml(p.name)}</h2>
        <div class="detail-price">${money(p.priceOre)}</div>
        <p>${escapeHtml(p.description)}</p>
        <label class="field-label" for="product-size">SELECT SIZE</label>
        <select class="size-select" id="product-size">${p.sizes.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}</select>
        <p>${p.stock} available</p>
        <button class="button button-dark full-width" id="add-to-cart" ${p.stock < 1 ? "disabled" : ""}>Add to bag →</button>
      </div>
    </div>`;
  $("#product-dialog").showModal();
  $("#add-to-cart").addEventListener("click", () => {
    addToCart(p.id, $("#product-size").value); $("#product-dialog").close(); openCart();
  });
}
function addToCart(productId, size) {
  const product = state.products.find(p => p.id === productId);
  if (!product || product.stock < 1) return toast("This item is currently sold out.");
  const existing = state.cart.find(i => i.productId === productId && i.size === size);
  if (existing) {
    if (existing.quantity >= Math.min(product.stock, 10)) return toast("Maximum available quantity reached.");
    existing.quantity++;
  } else state.cart.push({ productId, size, quantity: 1 });
  saveCart(); renderCart(); toast("Added to your bag.");
}
function renderCart() {
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  $("#cart-count").textContent = count; $("#drawer-count").textContent = `(${count})`;
  const rows = state.cart.map(item => ({ ...item, product: state.products.find(p => p.id === item.productId) })).filter(i => i.product);
  const total = rows.reduce((sum, item) => sum + item.product.priceOre * item.quantity, 0);
  $("#cart-subtotal").textContent = money(total);
  $("#cart-items").innerHTML = rows.length ? rows.map(item => `
    <div class="cart-row">
      <img src="${escapeHtml(item.product.image)}" alt="">
      <div><h3>${escapeHtml(item.product.name)}</h3><p>Size: ${escapeHtml(item.size)} · ${money(item.product.priceOre)}</p>
        <div class="qty-controls"><button data-action="minus" data-id="${item.productId}" data-size="${escapeHtml(item.size)}" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button data-action="plus" data-id="${item.productId}" data-size="${escapeHtml(item.size)}" aria-label="Increase quantity">+</button></div>
      </div>
      <button class="remove-item" data-action="remove" data-id="${item.productId}" data-size="${escapeHtml(item.size)}">Remove</button>
    </div>`).join("") : `<p class="empty-cart">Your bag is waiting for something good.</p>`;
  $("#cart-items").querySelectorAll("button").forEach(button => button.addEventListener("click", () => updateCart(button.dataset.action, Number(button.dataset.id), button.dataset.size)));
}
function updateCart(action, id, size) {
  const item = state.cart.find(i => i.productId === id && i.size === size);
  const product = state.products.find(p => p.id === id);
  if (!item) return;
  if (action === "remove") state.cart = state.cart.filter(i => i !== item);
  if (action === "minus") item.quantity--;
  if (action === "plus") {
    if (item.quantity >= Math.min(product?.stock || 0, 10)) return toast("Maximum available quantity reached.");
    item.quantity++;
  }
  state.cart = state.cart.filter(i => i.quantity > 0);
  saveCart(); renderCart();
}
function openCart() {
  $("#overlay").classList.add("show"); $("#cart-drawer").classList.add("open");
  $("#cart-drawer").setAttribute("aria-hidden", "false");
}
function closeCart() {
  $("#overlay").classList.remove("show"); $("#cart-drawer").classList.remove("open");
  $("#cart-drawer").setAttribute("aria-hidden", "true");
}
$("#cart-open").addEventListener("click", openCart);
$("#cart-close").addEventListener("click", closeCart);
$("#overlay").addEventListener("click", closeCart);
$("#product-close").addEventListener("click", () => $("#product-dialog").close());
$("#checkout-close").addEventListener("click", () => $("#checkout-dialog").close());
$("#search-toggle").addEventListener("click", () => {
  $("#search-box").scrollIntoView({ behavior: "smooth", block: "center" }); $("#search-input").focus();
});
$("#search-input").addEventListener("input", event => { state.query = event.target.value; renderProducts(); });
$("#menu-toggle").addEventListener("click", () => $(".main-nav").classList.toggle("open"));
$(".main-nav").querySelectorAll("a").forEach(a => a.addEventListener("click", () => $(".main-nav").classList.remove("open")));
$("#checkout-button").addEventListener("click", () => {
  if (!state.cart.length) return toast("Your bag is empty.");
  closeCart(); $("#checkout-dialog").showModal();
});
$("#checkout-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const error = $("#checkout-error"); error.textContent = ""; button.disabled = true; button.textContent = "Preparing secure checkout…";
  try {
    const result = await api("/api/checkout", {
      method: "POST",
      body: JSON.stringify({
        email: $("#checkout-email").value.trim(),
        items: state.cart.map(({ productId, size, quantity }) => ({ productId, size, quantity }))
      })
    });
    window.location.href = result.url;
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false; button.textContent = "Go to secure checkout →";
  }
});
$("#newsletter-form").addEventListener("submit", event => {
  event.preventDefault(); $("#newsletter-note").textContent = "Thanks! Connect an email marketing provider to collect subscriptions."; event.currentTarget.reset();
});
$("#year").textContent = new Date().getFullYear();
loadProducts();
