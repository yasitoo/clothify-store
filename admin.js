const $ = s => document.querySelector(s);
async function request(url, options={}) {
  const r = await fetch(url,{headers:{"Content-Type":"application/json"},...options});
  const data = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
async function refresh() {
  const [products,orders] = await Promise.all([request("/api/products"),request("/api/admin/orders")]);
  $("#admin-products").innerHTML = products.map(p=>`<div class="admin-product"><span><strong>${escapeHtml(p.name)}</strong><br>${p.stock} in stock · ${(p.priceOre/100).toFixed(2)} SEK</span><button data-delete="${p.id}">Delete</button></div>`).join("") || "No products yet.";
  $("#admin-products").querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",async()=>{if(confirm("Delete this product?")){await request(`/api/admin/products/${b.dataset.delete}`,{method:"DELETE"});refresh();}}));
  $("#admin-orders").innerHTML = orders.length ? orders.map(o=>`<div class="admin-product"><span>Order #${o.id} · ${escapeHtml(o.email)}<br>${o.items.map(i=>`${escapeHtml(i.name)} (${escapeHtml(i.size)}) × ${i.quantity}`).join(", ")}</span><strong>${(o.totalOre/100).toFixed(2)} SEK · ${escapeHtml(o.status)}</strong></div>`).join("") : "No orders yet.";
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function checkLogin(){
  const me=await request("/api/admin/me");
  $("#login-panel").classList.toggle("hidden",me.isAdmin);
  $("#dashboard").classList.toggle("hidden",!me.isAdmin);
  if(me.isAdmin) await refresh();
}
$("#login-form").addEventListener("submit",async e=>{
  e.preventDefault();$("#login-error").textContent="";
  try{await request("/api/admin/login",{method:"POST",body:JSON.stringify({password:$("#admin-password").value})});await checkLogin();}
  catch(err){$("#login-error").textContent=err.message;}
});
$("#product-form").addEventListener("submit",async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);
  const payload={name:f.get("name"),description:f.get("description"),priceOre:Math.round(Number(f.get("price"))*100),image:f.get("image"),category:f.get("category"),stock:Number(f.get("stock")),sizes:String(f.get("sizes")).split(",").map(s=>s.trim()).filter(Boolean)};
  try{await request("/api/admin/products",{method:"POST",body:JSON.stringify(payload)});$("#product-message").textContent="Product added.";e.currentTarget.reset();await refresh();}
  catch(err){$("#product-message").textContent=err.message;}
});
$("#logout").addEventListener("click",async()=>{await request("/api/admin/logout",{method:"POST"});checkLogin();});
checkLogin().catch(err=>console.error(err));
