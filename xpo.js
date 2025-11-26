// XPO Connect bridge (slots + booking) via Playwright
// TODO: Remplacer les sélecteurs dans fetchSlots() et bookSlot() avec ceux issus de `npx playwright codegen https://xpoconnecteu.xpo.com/`

import express from "express";
import dotenv from "dotenv";
import { chromium } from "playwright";

dotenv.config();

const {
  XPO_USER,
  XPO_PASS,
  XPO_BASE = "https://xpoconnecteu.xpo.com/",
  XPO_PORT = 4000,
} = process.env;

if (!XPO_USER || !XPO_PASS) {
  console.error("Set XPO_USER and XPO_PASS in .env");
  process.exit(1);
}

const app = express();
app.use(express.json());

async function withPage(fn) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(XPO_BASE, { waitUntil: "networkidle" });

    // TODO: Ajuster les sélecteurs login si besoin
    await page.fill('input[type="email"], input[name="username"]', XPO_USER);
    await page.fill('input[type="password"]', XPO_PASS);
    await page.click('button[type="submit"], button:has-text("Connexion"), button:has-text("Sign in")');
    await page.waitForLoadState("networkidle", { timeout: 15000 });

    return await fn(page);
  } finally {
    await page.context().browser().close();
  }
}

async function fetchSlots(shipment) {
  return withPage(async (page) => {
    // TODO: remplacer par navigation réelle
    // Exemples :
    // await page.click('text=Planifier');
    // await page.fill('[name="shipmentId"]', shipment);
    // await page.click('button:has-text("Rechercher")');
    // const cards = await page.$$('[data-slot-id]');
    // const slots = await Promise.all(cards.map(async c => ({
    //   id: await c.getAttribute('data-slot-id'),
    //   label: await c.innerText(),
    // })));
    const slots = [];
    return { shipment, slots };
  });
}

async function bookSlot({ shipment, slotId, address, contact }) {
  return withPage(async (page) => {
    // TODO: navigation + sélection du créneau + formulaire adresse/contact + confirmation
    // Exemple :
    // await page.click(`[data-slot-id="${slotId}"]`);
    // await page.click('button:has-text("Valider")');
    // const conf = await page.textContent('.confirmation-number');
    const confirmation = { slotId, confNumber: "TBD" };
    return { shipment, confirmation };
  });
}

app.get("/api/xpo/slots", async (req, res) => {
  const { shipment } = req.query;
  if (!shipment) return res.status(400).json({ error: "shipment is required" });
  try {
    const result = await fetchSlots(shipment);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/xpo/book", async (req, res) => {
  const { shipment, slotId, address, contact } = req.body || {};
  if (!shipment || !slotId) return res.status(400).json({ error: "shipment and slotId are required" });
  try {
    const result = await bookSlot({ shipment, slotId, address, contact });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(XPO_PORT, () => {
  console.log(`XPO bridge running on http://localhost:${XPO_PORT}`);
});
