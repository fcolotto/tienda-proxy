import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// === MIDDLEWARE API KEY ===
function checkKey(req, res, next) {
  const provided = (req.query.key || req.headers["x-api-key"] || "").trim();
  const expected = (process.env.API_KEY || "").trim();
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// === HEALTH ===
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Normaliza strings para evitar fallos por guiones raros, tildes, símbolos, etc.
function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tildes
    .replace(/[‐-‒–—−]/g, "-")       // guiones raros → "-"
    .replace(/[^a-z0-9\s-]/g, " ")   // símbolos → espacio
    .replace(/\s+/g, " ")            // colapsa espacios
    .trim();
}

// ====== PRODUCTS SEARCH (para Actions: searchProducts) ======
app.get("/api/products", checkKey, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 200);
  const pageMax = 20;

  try {
    const headers = {
      Authentication: `bearer ${process.env.TN_ACCESS_TOKEN}`,
      "User-Agent": process.env.TN_USER_AGENT,
    };

    const qNorm = normalize(q);
    const out = [];

    for (let page = 1; page <= pageMax; page++) {
      const r = await fetch(
        `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products?limit=200&page=${page}`,
        { headers }
      );

      const arr = await r.json();
      if (!r.ok) return res.status(r.status).json(arr);
      if (!Array.isArray(arr) || arr.length === 0) break;

      for (const p of arr) {
        const nameRaw = p.name?.es || p.name?.pt || p.name?.en || "";
        const nameNorm = normalize(nameRaw);
        const handleNorm = normalize(p.handle || "");

        if (!qNorm || nameNorm.includes(qNorm) || handleNorm.includes(qNorm)) {
          out.push({
            id: p.id,
            name: nameRaw || p.handle || "",
            handle: p.handle || null,
            permalink: p.permalink || null,
            published: p.published ?? null,
          });
        }

        if (out.length >= limit) break;
      }

      if (out.length >= limit) break;
    }

    return res.json(out.slice(0, limit));
  } catch (e) {
    return res.status(500).json({ error: "proxy_error", detail: e.message });
  }
});

// ====== PRODUCT LINK DIRECT ======
app.get("/api/product-link", checkKey, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "missing_q" });

  try {
    const headers = {
      Authentication: `bearer ${process.env.TN_ACCESS_TOKEN}`,
      "User-Agent": process.env.TN_USER_AGENT,
    };

    const base = (process.env.STORE_BASE_URL || "").replace(/\/+$/, "");
    const qNorm = normalize(q);

    let best = null;
    let bestScore = -1;

    for (let page = 1; page <= 20; page++) {
      const listResp = await fetch(
        `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products?limit=200&page=${page}`,
        { headers }
      );

      const arr = await listResp.json();
      if (!listResp.ok) return res.status(listResp.status).json(arr);
      if (!Array.isArray(arr) || arr.length === 0) break;

      for (const p of arr) {
        const nameRaw = p.name?.es || p.name?.pt || p.name?.en || "";
        const nameNorm = normalize(nameRaw);
        const handleNorm = normalize(p.handle || "");

        let score = 0;
        if (nameNorm.includes(qNorm)) score += 10;
        if (handleNorm.includes(qNorm)) score += 8;

        const words = qNorm.split(" ").filter(w => w.length >= 3);
        for (const w of words) {
          if (nameNorm.includes(w)) score += 2;
          if (handleNorm.includes(w)) score += 1;
        }

        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }

      if (bestScore >= 10) break;
    }

    if (!best || bestScore < 3) {
      return res.status(404).json({ error: "not_found" });
    }

    const detResp = await fetch(
      `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products/${best.id}`,
      { headers }
    );
    const data = await detResp.json();
    if (!detResp.ok) return res.status(detResp.status).json(data);

    let buy_url = null;
    const apiPermalink = data.permalink || null;

    if (typeof apiPermalink === "string" && apiPermalink.trim()) {
      buy_url = apiPermalink.startsWith("http")
        ? apiPermalink
        : `${base}${apiPermalink.startsWith("/") ? "" : "/"}${apiPermalink}`;
    } else {
      const handle = (data.handle || "").replace(/^\/+/, "");
      if (base && handle) buy_url = `${base}/productos/${handle}/`;
    }

    return res.json({
      id: data.id,
      name: data.name?.es || data.name?.pt || data.name?.en || data.handle,
      buy_url,
    });
  } catch (e) {
    return res.status(500).json({ error: "proxy_error", detail: e.message });
  }
});

export default app;
