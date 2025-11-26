from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Union
import os
import subprocess
import json
from pathlib import Path
from datetime import datetime
import re
import requests
import base64

API_KEY = os.getenv("API_KEY", "Hashem0409@")
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "./dp_final")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="DP Generator API")
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class DPRequest(BaseModel):
    nom_client: str
    prenom_client: str
    numero_adresse: str
    voie: str
    ville: str
    code_postal: str
    prefixe_cadastre: Optional[str] = ""
    section_cadastre: Optional[str] = ""
    numero_cadastre: Optional[str] = ""
    superficie_cadastre: Optional[str] = ""
    description_installation: str
    puissance_kwc: str
    lien_odoo: Optional[str] = None
    date_signature: Optional[str] = None
    session_cookie: Optional[str] = None

class InlineDocument(BaseModel):
    filename: Optional[str] = None
    content: Optional[str] = None
    base64: Optional[str] = None
    data: Optional[str] = None

class GenerateEnvelope(BaseModel):
    payload: DPRequest
    extra_urls: Optional[List[str]] = None
    inline_documents: Optional[List[InlineDocument]] = None

def download_urls(urls, dest_dir: Path):
    dest_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for url in urls:
        try:
            with requests.get(url, timeout=15, stream=True) as r:
                if not r.ok:
                    saved.append({"url": url, "status": f"http {r.status_code}"})
                    continue
                ct = r.headers.get("content-type", "")
                ext = Path(url.split("?")[0]).suffix.lower()
                if not ext:
                    if "pdf" in ct:
                        ext = ".pdf"
                    elif "jpeg" in ct or "jpg" in ct:
                        ext = ".jpg"
                    elif "png" in ct:
                        ext = ".png"
                    else:
                        ext = ".bin"
                fname = f"att_{len(saved)+1}{ext}"
                target = dest_dir / fname
                with open(target, "wb") as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                saved.append({"url": url, "saved_as": str(target), "bytes": target.stat().st_size})
        except Exception as e:
            saved.append({"url": url, "status": f"error: {e}"})
    return saved


def save_inline_documents(documents, dest_dir: Path):
    """Sauvegarde des documents envoyés en base64 ou en URL dans payload.documents."""
    if not documents:
        return None
    dest_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for idx, doc in enumerate(documents, start=1):
        try:
            if isinstance(doc, str):
                # si c'est une URL, on laisse download_urls s'en charger ailleurs
                saved.append({"index": idx, "status": "skip_string"})
                continue
            if not isinstance(doc, dict):
                saved.append({"index": idx, "status": "unsupported"})
                continue
            filename = doc.get("filename") or doc.get("name") or f"doc_{idx}"
            content = doc.get("content") or doc.get("base64") or doc.get("data")
            if not content:
                saved.append({"index": idx, "status": "missing_content"})
                continue
            # si data URL
            if content.startswith("data:"):
                head, b64 = content.split(",", 1)
            else:
                b64 = content
            data = base64.b64decode(b64)
            target = dest_dir / filename
            with open(target, "wb") as f:
                f.write(data)
            saved.append({"index": idx, "saved_as": str(target), "bytes": len(data)})
        except Exception as e:
            saved.append({"index": idx, "status": f"error: {e}"})
    return saved


def process_dp_request(payload: DPRequest, extra_urls=None, inline_documents=None):
    """Pipeline partagé pour /generate et webhook Qhare."""
    base_name = f"DP_{payload.prenom_client}{payload.nom_client}".replace(" ", "")
    request_dir = OUTPUT_DIR / base_name
    odoo_dir = request_dir / "odoo_files"
    attachments_dir = request_dir / "attachments"
    request_dir.mkdir(parents=True, exist_ok=True)

    downloaded = None
    if payload.lien_odoo:
        try:
            env = {
                **os.environ,
                "ODOO_OUTDIR": str(odoo_dir),
            }
            if payload.session_cookie:
                env["SESSION_COOKIE"] = payload.session_cookie
            subprocess.run(
                ["node", "batch.js", payload.lien_odoo, str(odoo_dir)],
                check=True,
                env=env,
                capture_output=True,
                text=True,
            )
            downloaded = "ok"
        except Exception as e:
            print("batch.js error:", e)
            downloaded = f"error: {e}"

    out_json = request_dir / f"{base_name}.json"

    with out_json.open("w", encoding="utf-8") as f:
        json.dump(payload.dict(), f, indent=2, ensure_ascii=False)

    attachments = None
    if extra_urls:
        attachments = download_urls(extra_urls, attachments_dir)
    inline_saved = save_inline_documents(inline_documents, attachments_dir) if inline_documents else None

    fake_pdf_path = str(OUTPUT_DIR / f"{base_name}_PLACEHOLDER.pdf")
    return {
        "status": "success",
        "file": os.path.basename(fake_pdf_path),
        "path": fake_pdf_path,
        "odoo_download": downloaded,
        "request_dir": str(request_dir),
        "attachments": attachments,
        "inline_documents": inline_saved,
    }


@app.post("/generate")
async def generate_dp(payload: Union[DPRequest, GenerateEnvelope], x_api_key: str = Header(None)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

    if isinstance(payload, DPRequest):
        return process_dp_request(payload)

    inline_docs = None
    if payload.inline_documents:
        inline_docs = [
            doc.model_dump(exclude_none=True)
            for doc in payload.inline_documents
        ]
    return process_dp_request(
        payload.payload,
        extra_urls=payload.extra_urls,
        inline_documents=inline_docs,
    )


# --- Webhook Qhare ---
QHARE_AUTOGENERATE = os.getenv("QHARE_AUTOGENERATE", "false").lower() == "true"


def map_qhare_payload(raw: dict) -> dict:
    """Essaye de mapper un payload Qhare lead/client vers DPRequest."""
    get = raw.get
    prenom = get("first_name") or get("firstname") or get("prenom") or get("prenom_client")
    nom = get("last_name") or get("lastname") or get("nom") or get("name") or get("nom_client")
    numero = get("street_number") or get("numero") or get("streetNumber") or ""
    voie = (
        get("street")
        or get("address_line1")
        or get("address")
        or get("adresse")
        or get("voie")
        or get("street1")
        or ""
    )
    ville = get("city") or get("ville") or get("ville_travaux") or ""
    cp = get("zip") or get("postal_code") or get("code_postal") or get("code_postal_travaux") or ""
    desc = (
        get("project_description")
        or get("description_installation")
        or get("description")
        or get("notes")
        or get("comment")
        or get("categorie")
        or ""
    )
    puissance = (
        get("power_kwc")
        or get("puissance_kwc")
        or get("power")
        or get("power_kw")
        or "max"
    )
    lien = get("odoo_link") or get("lien_odoo") or get("documents_url")
    session_cookie = get("session_cookie") or get("odoo_session_cookie")

    mapped = {
        "nom_client": nom,
        "prenom_client": prenom,
        "numero_adresse": numero or "",
        "voie": voie or "",
        "ville": ville or "",
        "code_postal": cp or "",
        "prefixe_cadastre": "",
        "section_cadastre": "",
        "numero_cadastre": "",
        "superficie_cadastre": "",
        "description_installation": desc or "",
        "puissance_kwc": puissance,
        "lien_odoo": lien,
        "date_signature": None,
        "session_cookie": session_cookie,
    }
    missing = [k for k, v in mapped.items() if k in {
        "nom_client",
        "prenom_client",
        "voie",
        "ville",
        "code_postal",
        "description_installation",
    } and not v]
    return mapped, missing


def extract_urls(obj):
    urls = set()
    if isinstance(obj, dict):
        for v in obj.values():
            urls.update(extract_urls(v))
    elif isinstance(obj, list):
        for v in obj:
            urls.update(extract_urls(v))
    elif isinstance(obj, str):
        found = re.findall(r"https?://[^\s\"']+", obj)
        urls.update(found)
    return urls


@app.post("/webhooks/qhare")
async def qhare_webhook(request: Request):
    """Réception des webhooks Qhare. Loggue toujours, déclenche /generate si complet et autorisé."""
    payload = await request.json()
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    log_path = OUTPUT_DIR / f"qhare_{ts}.json"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    mapped, missing = map_qhare_payload(payload)
    raw_urls = extract_urls(payload)
    dl_urls = [
        u for u in raw_urls
        if re.search(r"\.(pdf|png|jpe?g|webp)(\\?|$)", u, re.IGNORECASE)
    ]
    inline_docs = payload.get("documents")
    if missing or not QHARE_AUTOGENERATE:
        return {
            "status": "stored",
            "autogenerate_enabled": QHARE_AUTOGENERATE,
            "missing_fields": missing,
            "log": str(log_path),
        }

    dp_request = DPRequest(**mapped)
    result = process_dp_request(dp_request, extra_urls=dl_urls or None, inline_documents=inline_docs)
    result.update({
        "log": str(log_path),
        "source": "qhare_webhook",
        "found_urls": list(raw_urls),
        "inline_documents_count": len(inline_docs) if inline_docs else 0,
    })
    return result
