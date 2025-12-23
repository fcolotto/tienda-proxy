const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

// ========= AUTH =========
function checkKey(req, res, next) {
  const provided = (req.query.key || req.headers["x-api-key"] || "").trim();
  const expected = (process.env.API_KEY || "").trim();
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: "unauthorized", reason: "bad_key" });
  }
  next();
}

// ========= HELPERS =========
function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tildes
    .replace(/[‐-‒–—−]/g, "-")       // guiones raros -> "-"
    .replace(/[^a-z0-9\s-]/g, " ")   // símbolos -> espacio
    .replace(/\s+/g, " ")
    .trim();
}

function pickLang(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  return obj.es || obj.pt || obj.en || "";
}

function buildBuyUrl(permalink, base) {
  if (!permalink) return null;
  if (typeof permalink !== "string") return null;
  const p = permalink.trim();
  if (!p) return null;
  if (p.startsWith("http")) return p;
  if (!base) return p;
  const b = String(base).replace(/\/+$/, "");
  return `${b}${p.startsWith("/") ? "" : "/"}${p}`;
}

function parsePriceMaybe(x) {
  // Tiendanube a veces devuelve number, a veces string
  if (x === null || x === undefined) return null;
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const v = Number(x.replace(",", "."));
    return Number.isFinite(v) ? v : x;
  }
  return x;
}

// ========= ROUTES =========
app.get("/api/health", (req, res) => res.json({ ok: true }));

/**
 * GET /api/products?q=iuven&limit=20
 * Devuelve productos con: id, name, price, compare_price, buy_url, image, available
 */
app.get("/api/products", checkKey, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 50);

  const headers = {
    Authentication: `bearer ${process.env.TN_ACCESS_TOKEN}`,
    "User-Agent": process.env.TN_USER_AGENT,
  };

  const base = (process.env.STORE_BASE_URL || "").replace(/\/+$/, "");
  const qNorm = normalize(q);
  const words = qNorm.split(" ").filter(w => w.length >= 3);

  try {
    let best = [];
    const maxPages = 20;

    for (let page = 1; page <= maxPages; page++) {
      const r = await fetch(
        `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products?limit=200&page=${page}`,
        { headers }
      );

      const arr = await r.json();
      if (!r.ok) return res.status(r.status).json(arr);
      if (!Array.isArray(arr) || arr.length === 0) break;

      for (const p of arr) {
        const nameRaw = pickLang(p.name);
        const handleRaw = p.handle || "";
        const nameNorm = normalize(nameRaw);
        const handleNorm = normalize(handleRaw);

        // Si no hay query, devolvemos catálogo (paginado)
        // Si hay query, score por match
        let score = 0;

        if (!qNorm) score = 1; // catálogo general
        else {
          if (nameNorm.includes(qNorm)) score += 12;
          if (handleNorm.includes(qNorm)) score += 10;

          for (const w of words) {
            if (nameNorm.includes(w)) score += 2;
            if (handleNorm.includes(w)) score += 1;
          }
        }

        if (score > 0) {
          best.push({ score, p });
        }
      }

      // si ya juntamos bastante para ordenar, seguimos un poco más pero no infinito
      if (best.length > 600) break;
    }

    // Ordena por score y corta
    best.sort((a, b) => b.score - a.score);
    const picked = best.slice(0, Math.max(limit, 10)).map(x => x.p);

    // Para cada producto elegido, pedimos detalle para sacar precio/permalink confiable
    const out = [];
    for (const p of picked) {
      const detResp = await fetch(
        `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products/${p.id}`,
        { headers }
      );
      const data = await detResp.json();
      if (!detResp.ok) continue;

      // Precio: intentar en data.price, sino primera variante
      let price = null;
      const priceLang = pickLang(data.price);
      if (priceLang) price = parsePriceMaybe(priceLang);
      if (price === null && Array.isArray(data.variants) && data.variants[0]?.price != null) {
        price = parsePriceMaybe(data.variants[0].price);
      }

      let comparePrice = null;
      const cmpLang = pickLang(data.compare_at_price);
      if (cmpLang) comparePrice = parsePriceMaybe(cmpLang);

      const buy_url = buildBuyUrl(data.permalink, base);

      out.push({
        id: data.id,
        name: pickLang(data.name) || data.handle || "",
        price,
        compare_price: comparePrice,
        buy_url,
        available: data.published ?? null,
        image: (data.images && data.images.length > 0 ? data.images[0].src : null),
      });

      if (out.length >= limit) break;
    }

    // Si el usuario buscó algo y no encontramos nada, devolver []
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ error: "proxy_error", detail: e.message });
  }
});

module.exports = app;
