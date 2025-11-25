# codex-qhare
DP Auto Pack – Qualiwatt / Odoo / Claude Bridge (webhooks Qhare, bridge Odoo, FastAPI)

Ce pack contient un squelette complet pour :
- Interroger Odoo Documents (server.js, batch.js)
- Télécharger les fichiers (PDF, PNG, etc.)
- Récupérer une image Google Street View (streetview.js)
- Fusionner des PDF (merge.js)
- Exposer une API FastAPI /generate (main.py)

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
