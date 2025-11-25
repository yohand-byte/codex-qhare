import express from "express";
import fetch from "node-fetch";
import { Buffer } from "node:buffer";
import * as cheerio from "cheerio";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = process.env.SESSION_COOKIE || null;
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

// Dashboard statique
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.listen(PORT, () => {
  console.log(`MCP Odoo bridge listening on http://0.0.0.0:${PORT}`);
});
