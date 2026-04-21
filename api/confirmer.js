// api/confirmer.js
// Vercel Serverless Function
// Reçoit { token, action } → vérifie le token → met à jour le statut

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, action } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Token requis' });

  try {
    // 1. Trouver l'intervention par token
    const { data: intervention, error: fetchErr } = await sb
      .from('interventions')
      .select('id, statut, token_expires_at, adresse_bien, type_travaux, artisan_nom')
      .eq('validation_token', token)
      .single();

    if (fetchErr || !intervention) {
      return res.status(404).json({ error: 'Lien invalide ou déjà utilisé.' });
    }

    // 2. Vérifier expiration
    if (intervention.token_expires_at && new Date(intervention.token_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Ce lien a expiré (valable 7 jours).' });
    }

    // 3. Vérifier que pas déjà certifiée
    if (intervention.statut === 'certifie') {
      return res.status(200).json({ 
        success: true, 
        already: true,
        message: 'Cette intervention est déjà certifiée.' 
      });
    }

    // 4. Mettre à jour selon l'action
    const nouveauStatut = action === 'refuser' ? 'refuse' : 'certifie';
    const updateData = {
      statut: nouveauStatut,
      validation_token: null,       // invalider le token après usage
      token_expires_at: null,
    };
    if (nouveauStatut === 'certifie') {
      updateData.date_certification = new Date().toISOString();
    }

    const { error: updateErr } = await sb
      .from('interventions')
      .update(updateData)
      .eq('id', intervention.id);

    if (updateErr) throw new Error(updateErr.message);

    return res.status(200).json({
      success: true,
      statut: nouveauStatut,
      intervention: {
        adresse: intervention.adresse_bien,
        type: intervention.type_travaux,
        artisan: intervention.artisan_nom,
      }
    });

  } catch (err) {
    console.error('[confirmer]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
