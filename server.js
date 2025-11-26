import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import { Buffer } from "node:buffer";
import * as cheerio from "cheerio";
import path from "path";
import { fileURLToPath } from "url";
import qhareService from "./qhare-service.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const SESSION_COOKIE = process.env.SESSION_COOKIE || null;
const GOOGLE_SOLAR_API_KEY = process.env.GOOGLE_SOLAR_API_KEY || null;
const SOLAR_BASE_URL = "https://solar.googleapis.com/v1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sanitizeUrl(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    throw new Error("Invalid URL");
  }
  return url.trim();
}

async function fetchHtml(url, sessionCookie) {
  const safeUrl = sanitizeUrl(url);
  const headers = { "User-Agent": "mcp-odoo-bridge/1.0" };
  if (sessionCookie) headers["Cookie"] = sessionCookie;
  else if (SESSION_COOKIE) headers["Cookie"] = SESSION_COOKIE;

  const res = await fetch(safeUrl, { method: "GET", redirect: "follow", headers });
  if (!res.ok) throw new Error(`fetchHtml failed: ${res.status} ${res.statusText}`);

  const html = await res.text();
  const finalUrl = res.url || safeUrl;
  return { html, finalUrl };
}

function extractDocuments(html, baseUrl) {
  const $ = cheerio.load(html);
  const docs = [];
  $("a").each((_, el) => {
    const href = $(el).attr("href");
    const text = ($(el).text() || "").trim();
    if (!href) return;
    if (href.includes("/documents/content/") || href.includes("/web/content/")) {
      let url = href;
      if (href.startsWith("/")) {
        const u = new URL(baseUrl);
        url = `${u.protocol}//${u.host}${href}`;
      }
      docs.push({
        filename: text || href.split("/").slice(-1)[0],
        url,
      });
    }
  });
  return docs;
}

async function downloadFile(url, sessionCookie) {
  const safeUrl = sanitizeUrl(url);
  const headers = { "User-Agent": "mcp-odoo-bridge/1.0" };
  if (sessionCookie) headers["Cookie"] = sessionCookie;
  else if (SESSION_COOKIE) headers["Cookie"] = SESSION_COOKIE;

  const res = await fetch(safeUrl, { method: "GET", redirect: "follow", headers });
  if (!res.ok) throw new Error(`downloadFile failed: ${res.status} ${res.statusText}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const disposition = res.headers.get("content-disposition") || "";
  let filename = safeUrl.split("/").slice(-1)[0];
  const m = disposition.match(/filename="?([^"]+)"?/i);
  if (m && m[1]) filename = m[1];
  return { buf, mime: contentType, filename };
}

app.post("/list_odoo_folder", async (req, res) => {
  try {
    const { url, sessionCookie } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing url" });
    const { html, finalUrl } = await fetchHtml(url, sessionCookie);
    const docs = extractDocuments(html, finalUrl);
    return res.json(docs);
  } catch (err) {
    console.error("list_odoo_folder error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/get_odoo_file", async (req, res) => {
  try {
    const { url, sessionCookie } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing url" });
    const { buf, mime, filename } = await downloadFile(url, sessionCookie);
    const base64 = buf.toString("base64");
    return res.json({ filename, mime, size_bytes: buf.length, base64 });
  } catch (err) {
    console.error("get_odoo_file error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/qhare/lead", async (req, res) => {
  try {
    const { leadUrl, leadId } = req.body || {};
    const identifier = leadId || leadUrl;
    if (!identifier) return res.status(400).json({ error: "Missing leadUrl or leadId" });
    const bundle = await qhareService.fetchLeadBundle(identifier, { downloadDocuments: false });
    return res.json(bundle);
  } catch (err) {
    console.error("qhare/lead error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/qhare/generate", async (req, res) => {
  try {
    const { leadUrl, leadId, apiKey, maxDocuments } = req.body || {};
    if (!apiKey) return res.status(400).json({ error: "Missing apiKey (X-API-Key)" });
    const identifier = leadId || leadUrl;
    if (!identifier) return res.status(400).json({ error: "Missing leadUrl or leadId" });

    const bundle = await qhareService.fetchLeadBundle(identifier, {
      downloadDocuments: true,
      maxDocuments: maxDocuments || 5,
    });

    const inlineDocuments = (bundle.inlineDocuments || [])
      .filter(doc => doc && doc.base64)
      .map(doc => ({ filename: doc.filename, content: doc.base64 }));

    const payload = {
      payload: bundle.dpPayload,
      inline_documents: inlineDocuments.length ? inlineDocuments : undefined,
    };

    const apiRes = await fetch(`${FASTAPI_URL}/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(payload),
    });
    const data = await apiRes.json();
    return res.status(apiRes.status).json({
      ...data,
      qhare: {
        leadId: bundle.leadId,
        leadUrl: bundle.leadUrl,
        contact: bundle.contact,
        address: bundle.address,
        summary: bundle.summary,
        documents: bundle.documents,
        missing: bundle.missing,
      },
      inline_documents_count: inlineDocuments.length,
    });
  } catch (err) {
    console.error("qhare/generate error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/qhare/document_preview", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing url" });
    const data = await qhareService.fetchDocumentPreview(url);
    return res.json(data);
  } catch (err) {
    console.error("qhare/document_preview error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/solar/data", async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      radiusMeters = 80,
      view = "IMAGERY_AND_ANNUAL_FLUX_LAYERS",
      pixelSizeMeters = 0.25,
    } = req.body || {};
    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: "latitude et longitude requis" });
    }
    const data = await callSolarEndpoint("/dataLayers:get", {
      "location.latitude": String(latitude),
      "location.longitude": String(longitude),
      radiusMeters: String(radiusMeters),
      view,
      pixelSizeMeters: String(pixelSizeMeters),
    });
    return res.json(data);
  } catch (err) {
    console.error("solar/data error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/solar/building_insights", async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      requiredQuality = "HIGH",
    } = req.body || {};
    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: "latitude et longitude requis" });
    }
    const data = await callSolarEndpoint("/buildingInsights:findClosest", {
      "location.latitude": String(latitude),
      "location.longitude": String(longitude),
      requiredQuality,
    });
    return res.json(data);
  } catch (err) {
    console.error("solar/building_insights error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/solar/geotiff", async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "id requis" });
    const url = buildGeoTiffUrl(id);
    return res.json({ url });
  } catch (err) {
    console.error("solar/geotiff error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Dashboard statique
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.listen(PORT, () => {
  console.log(`MCP Odoo bridge listening on http://0.0.0.0:${PORT}`);
});

function ensureSolarKey() {
  if (!GOOGLE_SOLAR_API_KEY) {
    throw new Error("GOOGLE_SOLAR_API_KEY manquant côté serveur");
  }
}

async function callSolarEndpoint(path, params = {}) {
  ensureSolarKey();
  const url = new URL(`${SOLAR_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, value);
  }
  url.searchParams.set("key", GOOGLE_SOLAR_API_KEY);
  const apiRes = await fetch(url.toString(), {
    headers: { "User-Agent": "dp-auto-pack/solar-proxy" },
  });
  const data = await apiRes.json();
  if (!apiRes.ok) {
    const message = data?.error?.message || `Solar API error ${apiRes.status}`;
    throw new Error(message);
  }
  return data;
}

function buildGeoTiffUrl(id) {
  ensureSolarKey();
  const url = new URL(`${SOLAR_BASE_URL}/geoTiff:get`);
  url.searchParams.set("id", id);
  url.searchParams.set("key", GOOGLE_SOLAR_API_KEY);
  return url.toString();
}
