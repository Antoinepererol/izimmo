// api/extract.js
// Reçoit un document (image ou PDF en base64) → extraction via Claude → JSON structuré

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { fileBase64, mediaType } = req.body || {};
  if (!fileBase64 || !mediaType) {
    return res.status(400).json({ error: 'fileBase64 et mediaType requis' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API manquante côté serveur' });

  // Construire le bloc document selon le type (image vs PDF)
  let docBlock;
  if (mediaType === 'application/pdf') {
    docBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 }
    };
  } else {
    // image/jpeg, image/png, image/webp...
    docBlock = {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: fileBase64 }
    };
  }

  const prompt = `Tu analyses un document immobilier français (facture, devis, DPE, diagnostic, attestation...).
Extrais les informations et réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises Markdown.

Structure EXACTE à respecter :
{
  "document_type": "<facture|devis|dpe|diagnostic|attestation|autre>",
  "histor_event_type": "<intervention_travaux|diagnostic|attestation|transaction|autre>",
  "category": "<Plomberie|Électricité|Chauffage|Toiture|Maçonnerie|Isolation|Rénovation énergétique|Menuiserie|Carrelage|Peinture / Revêtements|Autre>",
  "confidence": "<high|medium|low>",
  "common": {
    "date": "<YYYY-MM-DD ou null>",
    "montant_ttc": <nombre ou null>,
    "montant_ht": <nombre ou null>,
    "tva": <nombre ou null>,
    "adresse_bien": "<adresse complète ou null>",
    "artisan_nom": "<nom de la personne ou null>",
    "artisan_entreprise": "<raison sociale ou null>",
    "artisan_siret": "<14 chiffres ou null>"
  },
  "description": "<résumé court de la prestation, max 120 caractères>",
  "specifics": {}
}

Règles :
- histor_event_type : "intervention_travaux" pour une facture/devis de travaux, "diagnostic" pour un DPE ou diagnostic, "attestation" pour une assurance/garantie, "transaction" pour un acte/mandat, sinon "autre".
- Mets null pour tout champ absent ou illisible. N'invente jamais.
- "specifics" : mets-y les champs propres au type (ex pour un DPE : {"classe_energie":"D","conso_kwh":180}). Laisse {} si rien de spécifique.
- montant_ttc, montant_ht, tva : nombres sans symbole ni espace.
- confidence : "high" si le document est clair et complet, "low" si illisible ou ambigu.`;

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [ docBlock, { type: 'text', text: prompt } ]
        }]
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('[extract] API error:', apiRes.status, errText);
      return res.status(502).json({ error: 'Erreur analyse document', detail: apiRes.status });
    }

    const data = await apiRes.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    let raw = textBlock ? textBlock.text : '';

    // Nettoyer d'éventuelles balises Markdown
    raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.error('[extract] JSON parse failed:', raw.slice(0, 300));
      return res.status(200).json({
        success: false,
        error: 'Extraction illisible',
        rawText: raw.slice(0, 500)
      });
    }

    return res.status(200).json({ success: true, extraction: parsed });

  } catch (err) {
    console.error('[extract]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
