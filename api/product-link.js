import fetch from "node-fetch";

// === API KEY ===
function checkKey(req) {
  const provided = (req.query.key || req.headers["x-api-key"] || "").trim();
  const expected = (process.env.API_KEY || "").trim();
  return !!provided && provided === expected;
}

// === NORMALIZE ===
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
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  if (!checkKey(req)) {
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
      if (!r.ok) return res.status(r.status).json(arr);
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

    let buy_url = null;
    if (typeof best.permalink === "string" && best.permalink.trim()) {
      buy_url = best.permalink.startsWith("http")
        ? best.permalink
        : `${base}${best.permalink.startsWith("/") ? "" : "/"}${best.permalink}`;
    }

    return res.json({
      id: best.id,
      name: best.name?.es || best.name?.pt || best.name?.en || best.handle,
      buy_url,
    });

  } catch (e) {
    return res.status(500).json({ error: "proxy_error", detail: e.message });
  }
}
