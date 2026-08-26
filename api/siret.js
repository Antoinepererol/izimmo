// api/siret.js
// Vérification d'un SIRET via l'API publique INSEE SIRENE (pas d'auth requise pour les requêtes simples)
// Retourne : { actif: bool, siret: string, nom: string, adresse: string, ... }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const siret = (req.query.siret || '').trim();

  // Validation basique : 14 chiffres
  if (!siret || !/^\d{14}$/.test(siret)) {
    return res.status(400).json({ error: 'SIRET invalide (14 chiffres requis)' });
  }

  try {
    // Appel API INSEE SIRENE (données publiques, pas de clé requise)
    // Documentation : https://api.insee.fr/catalogue/site/themes/sirene
    const inseeRes = await fetch(
      `https://api.insee.fr/entreprises/sirene/V3/siren/${siret.slice(0, 9)}`,
      { headers: { 'Accept': 'application/json' }, timeout: 5000 }
    );

    if (!inseeRes.ok) {
      // SIRET non trouvé ou API erreur
      if (inseeRes.status === 404) {
        return res.status(200).json({
          actif: false,
          siret: siret,
          nom: null,
          adresse: null,
          error: 'SIRET introuvable'
        });
      }
      // Erreur API
      return res.status(200).json({
        actif: null,
        siret: siret,
        error: 'Service temporairement indisponible'
      });
    }

    const data = await inseeRes.json();
    const etablissement = data.etablissements && data.etablissements[0];
    
    if (!etablissement) {
      return res.status(200).json({
        actif: false,
        siret: siret,
        error: 'Établissement non trouvé'
      });
    }

    // Extraction des données
    const nom = etablissement.uniteLegale?.denominationUniteLegale || 
                etablissement.nomCommercialEtablissement ||
                'Entreprise sans dénomination';
    const adresse = [
      etablissement.numeroVoieEtablissement,
      etablissement.typeVoieEtablissement,
      etablissement.libelleVoieEtablissement,
      etablissement.codePostalEtablissement,
      etablissement.libelleCommuneEtablissement
    ].filter(Boolean).join(' ');

    return res.status(200).json({
      actif: etablissement.etatAdministratifEtablissement === 'A',
      siret: siret,
      siren: etablissement.siren,
      nom: nom,
      adresse: adresse || 'Adresse non disponible',
      codePostal: etablissement.codePostalEtablissement,
      commune: etablissement.libelleCommuneEtablissement
    });

  } catch (err) {
    console.error('[siret]', err.message);
    return res.status(200).json({
      actif: null,
      siret: siret,
      error: 'Erreur lors de la vérification'
    });
  }
};
