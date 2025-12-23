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

function pickLang(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  return obj.es || obj.pt || obj.en || "";
}

function getPrice(p) {
  // Tiendanube puede devolver price como obj por idioma o number/string
  if (p?.price != null) {
    if (typeof p.price === "number") return p.price;
    const pl = pickLang(p.price);
    if (pl) return pl;
  }
  // fallback a variantes si vinieran
  if (Array.isArray(p?.variants) && p.variants.length > 0) {
    const v = p.variants[0];
    if (v?.price != null) return v.price;
  }
  return null;
}

export default async function handler(req, res) {
  const provided = (req.query.key || req.headers["x-api-key"] || "").trim();
  const expected = (process.env.API_KEY || "").trim();
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: "unauthorized", reason: "bad_key" });
  }

  const q = String(req.query.q || "").trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 20);

  const headers = {
    Authentication: `bearer ${process.env.TN_ACCESS_TOKEN}`,
    "User-Agent": process.env.TN_USER_AGENT,
  };

  // Usamos MTB porque este endpoint es para productos de María T
  const base = String(process.env.STORE_BASE_URL_MTB || "").replace(/\/+$/, "");

  const qNorm = normalize(q);
  const words = qNorm.split(" ").filter((w) => w.length >= 3);

  try {
    const results = [];
    const maxPages = 30;

    for (let page = 1; page <= maxPages; page++) {
      const r = await fetch(
        `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products?limit=200&page=${page}`,
        { headers }
      );
      const arr = await r.json();

      if (!r.ok) return res.status(r.status).json(arr);
      if (!Array.isArray(arr) || arr.length === 0) break;

      for (const p of arr) {
        const nameRaw = pickLang(p.name) || "";
        const handleRaw = String(p.handle || "");

        const name = normalize(nameRaw);
        const handle = normalize(handleRaw);

        const match =
          !qNorm ||
          name.includes(qNorm) ||
          handle.includes(qNorm) ||
          words.some((w) => name.includes(w) || handle.includes(w));

        if (!match) continue;

        // Para precio y permalink confiables, traemos detalle
        const det = await fetch(
          `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products/${p.id}`,
          { headers }
        );
        const data = await det.json();
        if (!det.ok) continue;

        const permalink = data.permalink || null;
        const buy_url =
          permalink && String(permalink).trim()
            ? permalink.startsWith("http")
              ? permalink
              : base
              ? `${base}${permalink.startsWith("/") ? "" : "/"}${permalink}`
              : permalink
            : null;

        results.push({
          id: data.id,
          name: pickLang(data.name) || data.handle || "",
          price: getPrice(data),
          buy_url,
        });

        if (results.length >= limit) break;
      }

      if (results.length >= limit) break;
    }

    return res.json(results);
  } catch (e) {
    return res.status(500).json({ error: "proxy_error", detail: e.message });
  }
}
