// === CONFIGURACIÓN ===
// require('dotenv').config({ path: __dirname + '/.env', debug: true });
console.log('API_KEY loaded?', (process.env.API_KEY || '').length);

const express = require('express');
const app = express();

// === MIDDLEWARE: Validar API Key ===
function checkKey(req, res, next) {
  const provided = (req.query.key || req.headers['x-api-key'] || '').trim();
  const expected = (process.env.API_KEY || '').trim();

  console.log('provided:', JSON.stringify(provided), 'len:', provided.length);
  console.log('expected:', JSON.stringify(expected), 'len:', expected.length);

  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'unauthorized', reason: 'bad_key' });
  }
  next();
}

// === RUTA DE PRUEBA ===
app.get('/api/health', (req, res) => res.json({ ok: true }));

// === PEDIDOS ===

// Buscar pedido (por ID o número visible del cliente)
app.get('/api/orders/:id', checkKey, async (req, res) => {
  const { id } = req.params;
  try {
    // Intento por ID interno
    let r = await fetch(`https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/orders/${id}`, {
      headers: {
        Authentication: `bearer ${process.env.TN_ACCESS_TOKEN}`,
        'User-Agent': process.env.TN_USER_AGENT,
      },
    });

    if (r.status === 404) {
      // Fallback: búsqueda por número visible
      r = await fetch(
        `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/orders?number=${encodeURIComponent(id)}&limit=1`,
        {
          headers: {
            Authentication: `bearer ${process.env.TN_ACCESS_TOKEN}`,
            'User-Agent': process.env.TN_USER_AGENT,
          },
        }
      );
      const arr = await r.json();
      if (!r.ok) return res.status(r.status).json(arr);
      if (!Array.isArray(arr) || arr.length === 0) {
        return res.status(404).json({ code: 404, message: 'Not Found', description: 'Order not found' });
      }
      const data = arr[0];
      return res.json({
        id: data.id,
        number: data.number,
        status: data.status,
        shipping_company: data.shipping_company || data.shipping?.shipping_company || null,
        tracking: data.shipping_tracking_number || data.shipping?.tracking_number || null,
        shipping_status: data.shipping_status || data.shipping?.status || null,
        created_at: data.created_at,
        updated_at: data.updated_at,
      });
    }

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json({
      id: data.id,
      number: data.number,
      status: data.status,
      shipping_company: data.shipping_company || data.shipping?.shipping_company || null,
      tracking: data.shipping_tracking_number || data.shipping?.tracking_number || null,
      shipping_status: data.shipping_status || data.shipping?.status || null,
      created_at: data.created_at,
      updated_at: data.updated_at,
    });
  } catch (e) {
    res.status(500).json({ error: 'proxy_error', detail: e.message });
  }
});

// Ítems de una orden
app.get('/api/orders/:id/items', checkKey, async (req, res) => {
  const { id } = req.params;
  try {
    const r = await fetch(`https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/orders/${id}`, {
      headers: {
        Authentication: `bearer ${process.env.TN_ACCESS_TOKEN}`,
        'User-Agent': process.env.TN_USER_AGENT,
      },
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    const items = (data.products || []).map((p) => ({
      product_id: p.product_id,
      variant_id: p.variant_id,
      name: p.name,
      sku: p.sku,
      quantity: p.quantity,
      price: p.price,
      total: p.total,
    }));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: 'proxy_error', detail: e.message });
  }
});

// Dirección / Envío de una orden
app.get('/api/orders/:id/shipping', checkKey, async (req, res) => {
  const { id } = req.params;
  try {
    const r = await fetch(`https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/orders/${id}`, {
      headers: {
        Authentication: `bearer ${process.env.TN_ACCESS_TOKEN}`,
        'User-Agent': process.env.TN_USER_AGENT,
      },
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    const addr = data.shipping_address || {};
    res.json({
      name: `${addr.first_name || ''} ${addr.last_name || ''}`.trim() || data.customer?.name || null,
      email: data.customer?.email || null,
      phone: addr.phone || data.customer?.phone || null,
      address: {
        line1: [addr.address, addr.number].filter(Boolean).join(' '),
        line2: addr.floor || addr.comment || null,
        city: addr.city || null,
        province: addr.province || null,
        zip: addr.zipcode || null,
        country: addr.country || null,
      },
      shipping_company: data.shipping_company || data.shipping?.shipping_company || null,
      tracking: data.shipping_tracking_number || data.shipping?.tracking_number || null,
      status: data.shipping_status || data.shipping?.status || null,
    });
  } catch (e) {
    res.status(500).json({ error: 'proxy_error', detail: e.message });
  }
});

// === PRODUCTOS ===

// Búsqueda por nombre o SKU (con filtro local, detalles ampliados y precio completo)
app.get('/api/products', checkKey, async (req, res) => {
  const { q = '', limit = 20, page = 1 } = req.query;
  try {
    const url = `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products?limit=200&page=${page}`;
    const r = await fetch(url, {
      headers: {
        Authentication: `bearer ${process.env.TN_ACCESS_TOKEN}`,
        'User-Agent': process.env.TN_USER_AGENT,
      },
    });
    const arr = await r.json();
    if (!r.ok) return res.status(r.status).json(arr);

    // 🔍 Filtro local (por nombre o handle)
    const term = q.toLowerCase().trim();
    const filtered = arr.filter(p => {
      const nameRaw = p.name && (p.name.es || p.name.pt || p.name.en) || '';
      const name = typeof nameRaw === 'string' ? nameRaw.toLowerCase() : '';
      const handle = typeof p.handle === 'string' ? p.handle.toLowerCase() : '';
      return !term || name.includes(term) || handle.includes(term);
    });

    const list = filtered.slice(0, limit).map(p => {
      // 💰 Obtener precio desde distintos posibles campos
      let price = null;
      if (p.price) {
        if (typeof p.price === 'number') price = p.price;
        else if (p.price.es || p.price.pt || p.price.en) {
          price = p.price.es || p.price.pt || p.price.en;
        }
      }
      // Si no hay precio directo, buscar en variantes
      if (!price && Array.isArray(p.variants) && p.variants.length > 0) {
        const firstVar = p.variants[0];
        if (firstVar.price) price = firstVar.price;
      }

      let comparePrice = null;
      if (p.compare_at_price) {
        if (typeof p.compare_at_price === 'number') comparePrice = p.compare_at_price;
        else if (p.compare_at_price.es || p.compare_at_price.pt || p.compare_at_price.en) {
          comparePrice = p.compare_at_price.es || p.compare_at_price.pt || p.compare_at_price.en;
        }
      }

      return {
        id: p.id,
        name: (p.name && (p.name.es || p.name.pt || p.name.en)) || p.handle || '',
        price,
        compare_price: comparePrice,
        sku: p.sku || null,
        available: p.published,
        permalink: p.permalink || null,
        description: (p.description && (p.description.es || p.description.pt || p.description.en)) || null,
        image: (p.images && p.images.length > 0 ? p.images[0].src : null),
      };
    });

    res.json(list);
  } catch (e) {
    res.status(500).json({ error: 'proxy_error', detail: e.message });
  }
});


// Detalle de producto
app.get('/api/products/:id', checkKey, async (req, res) => {
  const { id } = req.params;
  try {
    const r = await fetch(`https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products/${id}`, {
      headers: {
        Authentication: `bearer ${process.env.TN_ACCESS_TOKEN}`,
        'User-Agent': process.env.TN_USER_AGENT,
      },
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'proxy_error', detail: e.message });
  }
});

// Variantes y stock
app.get('/api/products/:id/variants', checkKey, async (req, res) => {
  const { id } = req.params;
  try {
    const r = await fetch(`https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products/${id}/variants`, {
      headers: {
        Authentication: `bearer ${process.env.TN_ACCESS_TOKEN}`,
        'User-Agent': process.env.TN_USER_AGENT,
      },
    });
    const arr = await r.json();
    if (!r.ok) return res.status(r.status).json(arr);

    const out = arr.map((v) => ({
      id: v.id,
      sku: v.sku,
      options: v.values,
      price: v.price,
      available: v.available,
      stock: v.stock,
    }));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: 'proxy_error', detail: e.message });
  }
});

// === PROMOS / DESCUENTOS ===
app.get("/api/promos", checkKey, async (req, res) => {
  try {
    // Promo fija (controlada por la marca)
    const firstPurchase = {
      code: "PRIMERACOMPRA",
      discount: "10%",
      applies_to: "primera compra",
    };

    // (Opcional) Hint interno: si hay productos con precio promocional hoy
    // Esto NO expone cupones ni reglas, solo indica si existen promos puntuales.
    const headers = {
      Authentication: `bearer ${process.env.TN_ACCESS_TOKEN}`,
      "User-Agent": process.env.TN_USER_AGENT,
    };

    let promotional_products_hint = { has_any: null };
    try {
      const promoProdResp = await fetch(
        `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products?has_promotional_price=true&limit=1&page=1`,
        { headers }
      );
      if (promoProdResp.ok) {
        const arr = await promoProdResp.json();
        promotional_products_hint = { has_any: Array.isArray(arr) && arr.length > 0 };
      }
    } catch (_) {
      // si falla, no pasa nada
      promotional_products_hint = { has_any: null };
    }

    return res.json({
      policy: "fixed_only",
      message:
        `Tenemos un ${firstPurchase.discount} OFF para primera compra con el cupón ${firstPurchase.code}. ` +
        `Las promociones puntuales y cupones temporales los publicamos en nuestro Instagram @mariat.boticario ✨`,
      first_purchase_coupon: firstPurchase,
      instagram: "@mariat.boticario",
      promotional_products_hint, // podés borrarlo si no lo querés ni como hint
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: "proxy_error", detail: e.message });
  }
});

// === INICIO DEL SERVIDOR ===
module.exports = app;

