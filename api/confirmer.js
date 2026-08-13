// api/confirmer.js
// Quatre actions, toutes en clé service (bypasse le RLS) :
//   info      → renvoie le contexte de validation (lecture seule)
//   confirmer → certifie + fige l'instantané + active l'artisan
//   refuser   → intervention 'refuse', l'artisan reste 'sollicite'
//   opposer   → suppression du profil + email exclu + anonymisation des instantanés
const { createClient } = require('@supabase/supabase-js');
const { createHash } = require('crypto');

function hashEmail(email) {
  // RGPD : Salt aléatoire unique à Historim, rend force brute non viable
  // Le sel DOIT être en env var sécurisée, jamais en code ni en base
  const salt = process.env.HISTORIM_EMAIL_HASH_SALT;
  if (!salt || salt.length < 16) {
    throw new Error('HISTORIM_EMAIL_HASH_SALT non configuré ou trop court (min 16 caractères)');
  }
  const emailNorm = String(email || '').trim().toLowerCase();
  return createHash('sha256').update(emailNorm + salt).digest('hex');
}

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
      .select('id, statut, token_expires_at, adresse_bien, type_travaux, description, date_intervention, montant_ttc, artisan_id')
      .eq('validation_token', token)
      .single();
    if (fetchErr || !intervention) return res.status(404).json({ error: 'Lien invalide ou déjà utilisé.' });

    // Identité de l'artisan sollicité (lecture service, RLS bypassé)
    let art = { nom: '', entreprise: '', siret: '', email: '' };
    if (intervention.artisan_id) {
      const { data: a } = await sb.from('artisans')
        .select('nom, entreprise, siret, email').eq('id', intervention.artisan_id).single();
      if (a) art = { nom: a.nom || '', entreprise: a.entreprise || '', siret: a.siret || '', email: a.email || '' };
    }

    // ---- info : contexte sans modification ----
    if (action === 'info') {
      if (intervention.token_expires_at && new Date(intervention.token_expires_at) < new Date())
        return res.status(410).json({ error: 'expired' });
      if (intervention.statut === 'certifie')
        return res.status(200).json({ success: true, already: true });
      const date = intervention.date_intervention
        ? new Date(intervention.date_intervention).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
        : '—';
      return res.status(200).json({
        success: true,
        intervention: {
          adresse: intervention.adresse_bien, type: intervention.type_travaux,
          description: intervention.description, date, montant: intervention.montant_ttc, statut: intervention.statut
        },
        artisan: { nom: art.nom, entreprise: art.entreprise }
      });
    }

    // Actions modifiantes : vérifier expiration + statut
    if (intervention.token_expires_at && new Date(intervention.token_expires_at) < new Date())
      return res.status(410).json({ error: 'Ce lien a expiré (valable 7 jours).' });
    if (intervention.statut === 'certifie')
      return res.status(200).json({ success: true, already: true, message: 'Intervention déjà certifiée.' });

    // ---- confirmer ----
    if (action === 'confirmer' || !action) {
      const { error: updErr } = await sb.from('interventions').update({
        statut: 'certifie',
        date_certification: new Date().toISOString(),
        validation_token: null, token_expires_at: null,
        snapshot_artisan_raison_sociale: art.entreprise || null,
        snapshot_artisan_siret: art.siret || null
      }).eq('id', intervention.id);
      if (updErr) throw new Error(updErr.message);

      if (intervention.artisan_id) {
        // Action positive → l'artisan devient visible (n'écrase pas si déjà actif)
        await sb.from('artisans')
          .update({ statut: 'actif', activated_at: new Date().toISOString() })
          .eq('id', intervention.artisan_id).eq('statut', 'sollicite');
      }
      return res.status(200).json({ success: true, statut: 'certifie' });
    }

    // ---- refuser l'intervention (l'artisan reste sollicite) ----
    if (action === 'refuser') {
      const { error: updErr } = await sb.from('interventions')
        .update({ statut: 'refuse', validation_token: null, token_expires_at: null })
        .eq('id', intervention.id);
      if (updErr) throw new Error(updErr.message);
      return res.status(200).json({ success: true, statut: 'refuse' });
    }

    // ---- s'opposer au traitement (effacement + exclusion) ----
    if (action === 'opposer') {
      if (art.email) {
        await sb.from('artisans_opposition').upsert({ email_hash: hashEmail(art.email) }, { onConflict: 'email_hash' });
      }
      if (intervention.artisan_id) {
        // Droit à l'effacement : anonymiser les instantanés déjà figés
        await sb.from('interventions')
          .update({ snapshot_artisan_raison_sociale: null, snapshot_artisan_siret: null })
          .eq('artisan_id', intervention.artisan_id).eq('statut', 'certifie');
        // Supprimer le profil (les artisan_id repassent à null via ON DELETE SET NULL)
        await sb.from('artisans').delete().eq('id', intervention.artisan_id);
      }
      await sb.from('interventions')
        .update({ statut: 'refuse', validation_token: null, token_expires_at: null })
        .eq('id', intervention.id);
      return res.status(200).json({ success: true, statut: 'oppose' });
    }

    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (err) {
    console.error('[confirmer]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
