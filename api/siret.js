module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { siret } = req.query;
  if (!siret || !/^\d{14}$/.test(siret)) {
    return res.status(400).json({ error: 'Invalid SIRET format (14 digits)' });
  }

  try {
    // API INSEE SIRENE (public, pas de clé)
    const inseeRes = await fetch(
      `https://api.insee.fr/entreprises/sirene/V3/etablissements/${siret}`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    if (!inseeRes.ok) {
      return res.status(404).json({ 
        error: 'SIRET not found or invalid',
        valid: false 
      });
    }

    const data = await inseeRes.json();
    
    return res.status(200).json({
      valid: true,
      siret: data.etablissement?.siret,
      nom: data.etablissement?.uniteLegale?.nomCommercial || data.etablissement?.uniteLegale?.denomination,
      statut: data.etablissement?.uniteLegale?.etatAdministratifUniteLegale,
      naf: data.etablissement?.activitePrincipaleEtablissement
    });

  } catch (err) {
    console.error('[siret]', err.message);
    return res.status(500).json({ error: 'INSEE API error', valid: false });
  }
};
