import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { load } from "cheerio";

const LOGIN_URL = "https://qhare.fr/users/sign_in";
const LEAD_URL = id => `https://qhare.fr/leads/${id}/edit`;
const DEFAULT_USER_AGENT =
  process.env.QHARE_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SUMMARY_LABELS = [
  "Type de projets",
  "Utilisation souhaitée de la production",
  "Type de pose",
  "Puissance de l'installation photovoltaïque en kW",
  "Puissance par panneau",
  "Nombre de panneau(x)",
  "Capacité de stockage",
  "Commentaires liés à la commande",
];
const REQUIRED_DP_FIELDS = [
  "nom_client",
  "prenom_client",
  "voie",
  "ville",
  "code_postal",
  "description_installation",
];

class QhareService {
  constructor() {
    this.email = process.env.QHARE_EMAIL;
    this.password = process.env.QHARE_PASSWORD;
    this.jar = new CookieJar();
    this.client = wrapper(
      axios.create({
        jar: this.jar,
        withCredentials: true,
        timeout: 30000,
      }),
    );
    this.lastLogin = 0;
  }

  baseHeaders(extra = {}) {
    return {
      "User-Agent": DEFAULT_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...extra,
    };
  }

  normalizeLabel(label) {
    return (label || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  parseLeadId(identifier) {
    if (!identifier) throw new Error("leadId or leadUrl is required");
    const trimmed = String(identifier).trim();
    const match = trimmed.match(/(\d{4,})/);
    if (!match) {
      throw new Error(`Impossible de détecter l'identifiant dans "${identifier}"`);
    }
    return match[1];
  }

  async ensureLogin(force = false) {
    if (!this.email || !this.password) {
      throw new Error("QHARE_EMAIL / QHARE_PASSWORD manquants dans l'environnement");
    }
    const now = Date.now();
    if (!force && now - this.lastLogin < 10 * 60 * 1000) return;

    const loginPage = await this.client.get(LOGIN_URL, {
      headers: this.baseHeaders({ Referer: LOGIN_URL }),
    });
    const $ = load(loginPage.data);
    const formData = {};
    const $form = $("form")
      .filter((_, el) => {
        const action = $(el).attr("action") || "";
        return action.includes("/sign_in");
      })
      .first();
    if ($form && $form.length) {
      $form.find("input, textarea, select").each((_, el) => {
        const name = $(el).attr("name");
        if (!name) return;
        const type = ($(el).attr("type") || "").toLowerCase();
        if (type === "checkbox" || type === "radio") {
          const checked = $(el).attr("checked") || $(el).prop("checked");
          if (!checked) return;
        }
        const val = $(el).val();
        formData[name] = val == null ? "" : String(val);
      });
    } else {
      const token = $("input[name='authenticity_token']").val();
      if (token) formData.authenticity_token = token;
    }
    formData["user[login]"] = this.email;
    formData["user[email]"] = this.email;
    formData["user[password]"] = this.password;

    const formBody = new URLSearchParams(formData).toString();
    const headers = {
      ...this.baseHeaders({
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://qhare.fr",
        Referer: LOGIN_URL,
      }),
    };
    const res = await this.client.post(LOGIN_URL, formBody, { headers });
    if (res.request?.res?.responseUrl?.includes("/users/sign_in")) {
      throw new Error("Échec de connexion Qhare (vérifier identifiants)");
    }
    this.lastLogin = now;
  }

  collectFields($) {
    const fields = {};
    $("input, textarea, select").each((_, el) => {
      const name = $(el).attr("name");
      if (!name) return;
      const val = $(el).val();
      fields[name] = val == null ? "" : String(val);
    });
    return fields;
  }

  splitAddress(raw) {
    const value = (raw || "").trim();
    if (!value) return { numero: "", voie: "" };
    const match = value.match(/^(\d+[A-Za-z\-]*)\s+(.*)$/);
    if (match) return { numero: match[1], voie: match[2] };
    return { numero: "", voie: value };
  }

  parseValues(raw) {
    if (!raw) return [];
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const normalized = trimmed.replace(/'/g, '"');
        const parsed = JSON.parse(normalized);
        return parsed
          .filter(
            item =>
              item &&
              (item.selected === true ||
                item.selected === "true" ||
                item.selected === 1 ||
                item.selected === "1"),
          )
          .map(item => (item.value || "").toString().trim())
          .filter(Boolean);
      } catch (err) {
        console.warn("parseValues error:", err.message);
        return [];
      }
    }
    return [trimmed];
  }

  parseDynamicAttributes(fields) {
    const entries = {};
    for (const [key, value] of Object.entries(fields)) {
      const match = key.match(/^lead\[lead_attributs_dynamiques_attributes]\[(\d+)]\[(label|values)]$/);
      if (!match) continue;
      const id = match[1];
      entries[id] = entries[id] || {};
      if (match[2] === "label") entries[id].label = value || "";
      else entries[id].rawValues = value || "";
    }
    const dynamic = new Map();
    for (const [id, entry] of Object.entries(entries)) {
      const label = entry.label || `Attribut ${id}`;
      const values = this.parseValues(entry.rawValues);
      dynamic.set(this.normalizeLabel(label), {
        id,
        label: label.trim(),
        raw: entry.rawValues,
        values,
      });
    }
    return dynamic;
  }

  buildSummary(dynamic) {
    const summary = [];
    for (const label of SUMMARY_LABELS) {
      const normalized = this.normalizeLabel(label);
      const entry = dynamic.get(normalized);
      if (!entry || !entry.values.length) continue;
      summary.push({
        label: entry.label || label,
        values: entry.values,
      });
    }
    return summary;
  }

  buildDescription(summary, fallbackText = "") {
    if (summary.length) {
      return summary
        .map(item => `${item.label}: ${item.values.join(", ")}`)
        .join(" | ")
        .slice(0, 900);
    }
    return fallbackText || "Synthèse automatique Qhare";
  }

  pickPuissance(summary) {
    const target = summary.find(item =>
      this.normalizeLabel(item.label).includes("puissance de l'installation"),
    );
    if (target && target.values.length) return target.values[0];
    return "max";
  }

  extractDocuments($, baseUrl) {
    const docs = new Map();
    $("a[href*='/rails/active_storage/']").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const absolute = new URL(href, baseUrl).toString();
      if (docs.has(absolute)) return;
      const label = ($(el).text() || $(el).attr("title") || "").trim();
      const imgSrc = $(el).find("img").attr("src");
      const basename = absolute.split("/").pop() || "";
      const decoded = decodeURIComponent(basename.split("?")[0] || "").trim();
      docs.set(absolute, {
        url: absolute,
        filename: decoded || label || `fichier_${docs.size + 1}.pdf`,
        label: label || null,
        preview: imgSrc ? new URL(imgSrc, baseUrl).toString() : null,
      });
    });
    return Array.from(docs.values());
  }

  async downloadDocuments(documents, limit = 5) {
    const list = [];
    for (const doc of documents.slice(0, limit)) {
      try {
        const res = await this.client.get(doc.url, {
          headers: this.baseHeaders({ Accept: "*/*" }),
          responseType: "arraybuffer",
        });
        const buffer = Buffer.from(res.data);
        list.push({
          filename: doc.filename,
          mime: res.headers["content-type"] || "application/octet-stream",
          bytes: buffer.length,
          base64: buffer.toString("base64"),
          url: doc.url,
        });
      } catch (err) {
        list.push({
          filename: doc.filename,
          url: doc.url,
          error: err.message,
        });
      }
    }
    return list;
  }

  computeMissing(dpPayload) {
    return REQUIRED_DP_FIELDS.filter(key => !dpPayload[key]);
  }

  async fetchLeadBundle(identifier, options = {}) {
    await this.ensureLogin();
    const leadId = this.parseLeadId(identifier);
    const leadUrl = LEAD_URL(leadId);
    const res = await this.client.get(leadUrl, {
      headers: this.baseHeaders({ Referer: leadUrl }),
    });
    const $ = load(res.data);
    const fields = this.collectFields($);
    const { numero, voie } = this.splitAddress(fields["lead[adresse]"]);
    const dynamic = this.parseDynamicAttributes(fields);
    const summary = this.buildSummary(dynamic);
    const commentaireEntry = dynamic.get(this.normalizeLabel("Commentaires liés à la commande"));
    const description = this.buildDescription(summary, commentaireEntry?.values?.join(" "));
    const puissance = this.pickPuissance(summary);
    const documents = this.extractDocuments($, leadUrl);

    const dpPayload = {
      nom_client: fields["lead[nom]"] || "",
      prenom_client: fields["lead[prenom]"] || "",
      numero_adresse: numero,
      voie,
      ville: fields["lead[ville]"] || "",
      code_postal: fields["lead[codepostal]"] || "",
      prefixe_cadastre: "",
      section_cadastre: "",
      numero_cadastre: "",
      superficie_cadastre: "",
      description_installation: description,
      puissance_kwc: puissance,
      lien_odoo: null,
      date_signature: null,
      session_cookie: null,
    };

    const bundle = {
      leadId,
      leadUrl,
      contact: {
        civilite: fields["lead[civilite]"] || "",
        prenom: fields["lead[prenom]"] || "",
        nom: fields["lead[nom]"] || "",
        email: fields["lead[email]"] || "",
        phone: fields["lead[tel]"] || "",
      },
      address: {
        raw: fields["lead[adresse]"] || "",
        numero,
        voie,
        code_postal: fields["lead[codepostal]"] || "",
        ville: fields["lead[ville]"] || "",
      },
      dpPayload,
      summary,
      documents,
      missing: this.computeMissing(dpPayload),
    };

    if (options.downloadDocuments && documents.length) {
      const maxDocs = Number(options.maxDocuments) || 5;
      bundle.inlineDocuments = await this.downloadDocuments(documents, maxDocs);
    }

    return bundle;
  }

  async fetchDocumentPreview(url) {
    if (!url) throw new Error("URL document requis");
    await this.ensureLogin();
    const res = await this.client.get(url, {
      headers: this.baseHeaders({ Accept: "*/*" }),
      responseType: "arraybuffer",
    });
    const buffer = Buffer.from(res.data);
    return {
      mime: res.headers["content-type"] || "application/octet-stream",
      base64: buffer.toString("base64"),
    };
  }
}

const qhareService = new QhareService();
export default qhareService;
