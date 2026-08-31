const { createClient } = require('@supabase/supabase-js');
const { createHash } = require('crypto');

function hashEmail(email) {
  const salt = process.env.FIDERO_EMAIL_HASH_SALT;
  if (!salt) throw new Error('FIDERO_EMAIL_HASH_SALT manquant');
  return createHash('sha256').update(String(email).toLowerCase().trim() + salt).digest('hex');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { token, action } = req.body || {};
  if (!token || !action) {
    return res.status(400).json({ error: 'Missing token or action' });
  }

  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    
    // Trouver l'intervention par token
    const { data: iv, error: ivErr } = await sb
      .from('interventions')
      .select('*')
      .eq('validation_token', token)
      .single();
    
    if (ivErr || !iv) return res.status(404).json({ error: 'Token not found or expired' });

    // Vérifier expiration
    if (iv.token_expires_at && new Date(iv.token_expires_at) < new Date()) {
      return res.status(400).json({ error: 'Token expired' });
    }

    // Selon l'action
    if (action === 'confirm') {
      // Certifier l'intervention
      const { error: updErr } = await sb
        .from('interventions')
        .update({ statut: 'certifie', validation_token: null, token_expires_at: null })
        .eq('id', iv.id);
      
      if (updErr) throw new Error('Cannot update intervention: ' + updErr.message);
      
      // Mettre l'artisan en statut certifie
      if (iv.artisan_id) {
        await sb
          .from('artisans')
          .update({ statut: 'certifie' })
          .eq('id', iv.artisan_id);
      }

      return res.status(200).json({ success: true, message: 'Intervention confirmée' });
    }
    
    else if (action === 'reject') {
      // Rejeter l'intervention
      const { error: updErr } = await sb
        .from('interventions')
        .update({ statut: 'rejetee', validation_token: null, token_expires_at: null })
        .eq('id', iv.id);
      
      if (updErr) throw new Error('Cannot update intervention: ' + updErr.message);

      return res.status(200).json({ success: true, message: 'Intervention rejetée' });
    }
    
    else if (action === 'oppose') {
      // Artisan s'oppose définitivement
      if (iv.artisan_id) {
        // Récupérer l'email de l'artisan
        const { data: art } = await sb
          .from('artisans')
          .select('email')
          .eq('id', iv.artisan_id)
          .single();
        
        if (art && art.email) {
          const emailHash = hashEmail(art.email);
          
          // Ajouter à la liste d'opposition
          await sb
            .from('artisans_opposition')
            .insert({ artisan_email_hash: emailHash })
            .single();
        }

        // Supprimer l'artisan
        await sb
          .from('artisans')
          .delete()
          .eq('id', iv.artisan_id);
      }

      // Nettoyer l'intervention
      const { error: updErr } = await sb
        .from('interventions')
        .update({ artisan_id: null, statut: 'en_attente', validation_token: null, token_expires_at: null })
        .eq('id', iv.id);
      
      if (updErr) throw new Error('Cannot update intervention: ' + updErr.message);

      return res.status(200).json({ success: true, message: 'Vous êtes retiré de Fidero' });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (err) {
    console.error('[confirmer]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
