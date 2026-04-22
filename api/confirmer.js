// api/confirmer.js
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, action } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Token requis' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const { data: intervention, error: fetchErr } = await sb
      .from('interventions')
      .select('id, statut, token_expires_at, adresse_bien, type_travaux, artisan_nom')
      .eq('validation_token', token)
      .single();

    if (fetchErr || !intervention) return res.status(404).json({ error: 'Lien invalide ou deja utilise.' });

    if (intervention.token_expires_at && new Date(intervention.token_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Ce lien a expire (valable 7 jours).' });
    }

    if (intervention.statut === 'certifie') {
      return res.status(200).json({ success: true, already: true, message: 'Intervention deja certifiee.' });
    }

    const nouveauStatut = action === 'refuser' ? 'refuse' : 'certifie';
    const updateData = {
      statut: nouveauStatut,
      validation_token: null,
      token_expires_at: null,
    };
    if (nouveauStatut === 'certifie') {
      updateData.date_certification = new Date().toISOString();
    }

    const { error: updateErr } = await sb
      .from('interventions').update(updateData).eq('id', intervention.id);
    if (updateErr) throw new Error(updateErr.message);

    return res.status(200).json({
      success: true,
      statut: nouveauStatut,
      intervention: { adresse: intervention.adresse_bien, type: intervention.type_travaux, artisan: intervention.artisan_nom }
    });

  } catch (err) {
    console.error('[confirmer]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
