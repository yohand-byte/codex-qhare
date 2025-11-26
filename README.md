# codex-qhare
DP Auto Pack – Qualiwatt / Odoo / Claude Bridge (webhooks Qhare, bridge Odoo, FastAPI)

Ce pack contient un squelette complet pour :
- Interroger Odoo Documents (server.js, batch.js)
- Télécharger les fichiers (PDF, PNG, etc.)
- Récupérer une image Google Street View (streetview.js)
- Fusionner des PDF (merge.js)
- Exposer une API FastAPI /generate (main.py)
- Fournir un bridge XPO Connect (xpo.js) pour récupérer / réserver des créneaux (Playwright)

## 1. Installation Node

```bash
cd dp_auto_pack
npm install
```

## 2. Installation Python

```bash
pip install -r requirements.txt
```

## 3. Configuration

Copier le fichier `.env.example` vers `.env` et renseigner :

- GOOGLE_STREET_KEY : ta clé Google Street View Static
- API_KEY : la clé utilisée par tes appels /generate
- SESSION_COOKIE : optionnel, si Odoo nécessite une session
- QHARE_EMAIL / QHARE_PASSWORD : identifiants Qhare (lecture lead + documents)
- FASTAPI_URL : URL de l’API FastAPI (défaut http://127.0.0.1:8000)
- OUTPUT_DIR : répertoire de sortie des DP
- MCP_BRIDGE_URL : URL du bridge Odoo (par défaut http://localhost:3000)

## 4. Lancer le bridge Odoo (MCP)

```bash
node server.js
```

Test rapide :

```bash
curl -X POST http://localhost:3000/list_odoo_folder \
  -H "content-type: application/json" \
  --data '{"url":"http://solaire.qualiwatt.com/odoo/documents/XXXX"}'
```

## 5. Lancer l’API DP

```bash
uvicorn main:app --reload --port 8000
```

Test :

```bash
curl -X POST http://127.0.0.1:8000/generate \
  -H "X-API-Key: Hashem0409@" \
  -H "Content-Type: application/json" \
  -d '{
    "nom_client": "Nedjar",
    "prenom_client": "Georges",
    "numero_adresse": "17",
    "voie": "Rue Jaumé",
    "ville": "Châteauneuf-les-Martigues",
    "code_postal": "13220",
    "prefixe_cadastre": "",
    "section_cadastre": "",
    "numero_cadastre": "",
    "superficie_cadastre": "",
    "description_installation": "Puissance max, surimposition, 500W RECOM, tri, revente totale",
    "puissance_kwc": "max",
    "lien_odoo": "https://solaire.qualiwatt.com/odoo/documents/XXXX",
    "date_signature": null
  }'
```

Le squelette actuel :
- Télécharge les fichiers Odoo (batch.js)
- Enregistre la demande en JSON
- Prépare le terrain pour brancher Claude / ton LLM afin de générer le PDF final style SANAA.

Tu peux maintenant brancher ta logique existante de génération de DP (Claude, Codex, etc.) à l’intérieur de `main.py` et utiliser `merge.js` pour fusionner tes pièces PDF.

## 6. Bridge XPO Connect (slots + booking)

Un service Node/Playwright permet de lister et réserver des créneaux XPO Connect :

```bash
# .env
XPO_USER=ton_login
XPO_PASS=ton_mdp
XPO_PORT=4000

npm run xpo   # ou node xpo.js

# Lister les créneaux
curl "http://127.0.0.1:4000/api/xpo/slots?shipment=REF123"

# Réserver un créneau
curl -X POST http://127.0.0.1:4000/api/xpo/book \
  -H "Content-Type: application/json" \
  -d '{"shipment":"REF123","slotId":"SLOTID","address":{"street":"..."},"contact":{"name":"...","phone":"..."}}'
```

⚠️ Les sélecteurs Playwright dans `xpo.js` sont à compléter (TODO) avec `npx playwright codegen https://xpoconnecteu.xpo.com/` lors d’une session connectée.

## 6. Mode Qhare → DP (nouveau)

- Onglet `Flux Qhare → DP` du `dashboard.html` : saisis l’URL (ou l’ID) d’un lead Qhare pour rapatrier les champs (nom, adresse, dynamiques…).
- Bouton `Remplir formulaire` : pré-remplit la section “Générer un DP” avec les données Qhare.
- Bouton `Auto /generate (Qhare)` : appelle `/qhare/generate` (bridge Node) qui :
  1. se connecte à Qhare (credentials env),
  2. récupère les documents `/rails/active_storage/...`,
  3. les encodent en base64,
  4. appelle ensuite `/generate` FastAPI avec un enveloppe `{ payload, inline_documents }`.

> Important : l’API FastAPI accepte toujours l’ancien schéma DPRequest. L’enveloppe `{ payload, inline_documents }` est optionnelle et ne casse pas les intégrations existantes.

## 7. Snippet Solar API intégré

- Renseigne `GOOGLE_SOLAR_API_KEY` dans `.env`.
- Dans le dashboard, la carte “Solar API” pilote maintenant :
  - `dataLayers:get` (résumé visuel + liens DSM/RGB/Mask/Flux),
  - `buildingInsights:findClosest` (synthèse sur la toiture : surface exploitable, panneaux max, énergie annuelle),
  - `geoTiff:get` (génération d’une URL signée pour télécharger les rasters sans erreur 403).
- Côté backend (`server.js`), trois routes assurent le proxy sécurisé :
  - `POST /solar/data` → `dataLayers:get`
  - `POST /solar/building_insights` → `buildingInsights:findClosest`
  - `POST /solar/geotiff` → fournit une URL `geoTiff:get?id=...&key=...`

> Les requêtes front passent toujours par ces routes locales pour ne jamais exposer la clé Google dans le navigateur.
