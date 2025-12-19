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

    const listResp = await fetch(
      `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products?limit=200&page=1`,
      { headers }
    );

    const arr = await listResp.json();
    console.log("DEBUG products sample:", arr.slice(0, 10).map(p => ({
      id: p.id,
      name: p.name,
      handle: p.handle
    })));

    const term = q.toLowerCase();

    let best = arr.find(p => {
      const name =
        (p.name?.es || p.name?.pt || p.name?.en || "").toLowerCase();
      return name.includes(term);
    });

    if (!best) {
      best = arr.find(p =>
        (p.handle || "").toLowerCase().includes(term)
      );
    }

    if (!best) return res.status(404).json({ error: "not_found" });

    const detResp = await fetch(
      `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products/${best.id}`,
      { headers }
    );
    const data = await detResp.json();

    let buy_url = data.permalink?.startsWith("http")
      ? data.permalink
      : `${base}${data.permalink}`;

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
