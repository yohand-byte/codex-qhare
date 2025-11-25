import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import fetch from "node-fetch";

const BASE = process.env.MCP_BRIDGE_URL || "http://localhost:3000";
const DEFAULT_OUTDIR = process.env.ODOO_OUTDIR || "./odoo_files";

async function post(route, body) {
  const res = await fetch(`${BASE}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${route} failed ${res.status}`);
  return res.json();
}

export async function downloadFolder(link, outDir = DEFAULT_OUTDIR, sessionCookie) {
  await fs.mkdir(outDir, { recursive: true });
  const list = await post("/list_odoo_folder", { url: link, sessionCookie });
  const saved = [];
  for (const item of list) {
    if (!item.url) continue;
    const file = await post("/get_odoo_file", { url: item.url, sessionCookie });
    if (file.error) {
      saved.push({ ...item, status: file.error });
      continue;
    }
    const buf = Buffer.from(file.base64, "base64");
    const name = file.filename || path.basename(new URL(item.url).pathname);
    const target = path.join(outDir, name);
    await fs.writeFile(target, buf);
    saved.push({ ...item, savedAs: target, size_bytes: buf.length });
  }
  return saved;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const link = process.argv[2];
  const outDir = process.argv[3] || DEFAULT_OUTDIR;
  if (!link) {
    console.error("usage: node batch.js <odoo-link> [outDir]");
    process.exit(1);
  }
  downloadFolder(link, outDir, process.env.SESSION_COOKIE)
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => console.error(e));
}
