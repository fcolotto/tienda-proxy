import fetch from "node-fetch";

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‐-‒–—−]/g, "-")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(req, res) {
  const provided = (req.query.key || req.headers["x-api-key"] || "").trim();
  const expected = (process.env.API_KEY || "").trim();
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }

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
      const r = await fetch(
        `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products?limit=200&page=${page}`,
        { headers }
      );
      const arr = await r.json();
      if (!Array.isArray(arr) || arr.length === 0) break;

      for (const p of arr) {
        const name =
          normalize(p.name?.es || p.name?.pt || p.name?.en || "");
        const handle = normalize(p.handle || "");

        let score = 0;
        if (name.includes(qNorm)) score += 10;
        if (handle.includes(qNorm)) score += 8;

        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }

      if (bestScore >= 10) break;
    }

    if (!best) {
      return res.status(404).json({ error: "not_found" });
    }

    const det = await fetch(
      `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products/${best.id}`,
      { headers }
    );
    const data = await det.json();

    const permalink = data.permalink;
    const buy_url = permalink
      ? permalink.startsWith("http")
        ? permalink
        : `${base}${permalink}`
      : null;

    return res.json({
      id: data.id,
      name: data.name?.es || data.name?.pt || data.name?.en,
      buy_url,
    });
  } catch (e) {
    return res.status(500).json({ error: "proxy_error", detail: e.message });
  }
}
