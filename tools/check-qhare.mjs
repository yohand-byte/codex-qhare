import qhareService from "../qhare-service.js";

const leadIdOrUrl = process.argv[2] || "566980";
const ident = leadIdOrUrl.startsWith("http") ? leadIdOrUrl : "https://qhare.fr/leads/" + leadIdOrUrl + "/edit";

try {
  const bundle = await qhareService.fetchLeadBundle(ident, { downloadDocuments: false });
  console.log(JSON.stringify({
    leadId: bundle.leadId,
    contact: bundle.contact,
    address: bundle.address,
    summary: bundle.summary,
    documents: bundle.documents?.slice(0, 5) || [],
    missing: bundle.missing,
  }, null, 2));
} catch (err) {
  console.error("check-qhare error:", err.message);
  process.exit(1);
}
