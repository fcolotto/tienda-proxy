// ====== PRODUCTS SEARCH (devuelve precio + link) ======
app.get("/api/products", checkKey, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 20);

  const headers = {
    Authentication: `bearer ${process.env.TN_ACCESS_TOKEN}`,
    "User-Agent": process.env.TN_USER_AGENT,
  };

  const base = String(process.env.STORE_BASE_URL || "").replace(/\/+$/, "");

  // Normaliza para que "iuven" matchee "Contorno de ojos Iuven"
  const normalize = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[‐-‒–—−]/g, "-")
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const pickLang = (obj) => {
    if (!obj) return "";
    if (typeof obj === "string") return obj;
    return obj.es || obj.pt || obj.en || "";
  };

  const buildBuyUrl = (permalink) => {
    if (!permalink) return null;
    const p = String(permalink).trim();
    if (!p) return null;
    if (p.startsWith("http")) return p;
    if (!base) return p;
    return `${base}${p.startsWith("/") ? "" : "/"}${p}`;
  };

  const qNorm = normalize(q);
  const words = qNorm.split(" ").filter(w => w.length >= 3);

  try {
    const results = [];
    const maxPages = 30; // recorre catálogo real

    for (let page = 1; page <= maxPages; page++) {
      const r = await fetch(
        `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products?limit=200&page=${page}`,
        { headers }
      );
      const arr = await r.json();
      if (!r.ok) return res.status(r.status).json(arr);
      if (!Array.isArray(arr) || arr.length === 0) break;

      for (const p of arr) {
        const name = pickLang(p.name);
        const handle = p.handle || "";
        const nameNorm = normalize(name);
        const handleNorm = normalize(handle);

        // Si no hay q, devolver catálogo
        // Si hay q, match parcial por nombre/handle
        const match =
          !qNorm ||
          nameNorm.includes(qNorm) ||
          handleNorm.includes(qNorm) ||
          words.some(w => nameNorm.includes(w) || handleNorm.includes(w));

        if (!match) continue;

        // Traer detalle para precio + permalink real
        const detResp = await fetch(
          `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}/products/${p.id}`,
          { headers }
        );
        const data = await detResp.json();
        if (!detResp.ok) continue;

        // precio: data.price o primera variante
        let price = null;
        const priceLang = pickLang(data.price);
        if (priceLang) price = priceLang;
        if (!price && Array.isArray(data.variants) && data.variants[0]?.price != null) {
          price = data.variants[0].price;
        }

        results.push({
          id: data.id,
          name: pickLang(data.name) || data.handle || "",
          price,
          buy_url: buildBuyUrl(data.permalink),
        });

        if (results.length >= limit) break;
      }

      if (results.length >= limit) break;
    }

    return res.json(results);
  } catch (e) {
    return res.status(500).json({ error: "proxy_error", detail: e.message });
  }
});
