export function computeCalepinage(targetKw, wattsPerModule = 500) {
  const panneaux = Math.floor((targetKw * 1000) / wattsPerModule);
  const colonnes = 10;
  const lignes = Math.ceil(panneaux / colonnes);
  return { panneaux, lignes, colonnes };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const kw = parseFloat(process.argv[2] || "20");
  console.log(computeCalepinage(kw));
}