import fetch from "node-fetch";
import fs from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.GOOGLE_STREET_KEY;

export async function fetchStreetView(address, outDir = "./streetview") {
  if (!API_KEY) throw new Error("GOOGLE_STREET_KEY env var is required");
  await fs.mkdir(outDir, { recursive: true });
  const encoded = encodeURIComponent(address);
  const url = `https://maps.googleapis.com/maps/api/streetview?size=1024x768&location=${encoded}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`StreetView failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const file = path.join(outDir, "streetview.jpg");
  await fs.writeFile(file, buf);
  return file;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const addr = process.argv.slice(2).join(" ");
  if (!addr) {
    console.error("usage: node streetview.js "<full address>"");
    process.exit(1);
  }
  fetchStreetView(addr)
    .then((f) => console.log("saved:", f))
    .catch((e) => console.error(e));
}