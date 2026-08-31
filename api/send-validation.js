const { createClient } = require('@supabase/supabase-js');
const { createHash, randomUUID } = require('crypto');

function hashEmail(email) {
  const salt = process.env.FIDERO_EMAIL_HASH_SALT;
  if (!salt) throw new Error('FIDERO_EMAIL_HASH_SALT manquant');
  return createHash('sha256').update(String(email).toLowerCase().trim() + salt).digest('hex');
}

function esc(v) {
  return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { interventionId, artisanNom, artisanEmail } = req.body || {};
  if (!interventionId || !artisanEmail) {
    return res.status(400).json({ error: 'Missing interventionId or artisanEmail' });
  }

  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    
    // Récupérer l'intervention
    const { data: iv, error: ivErr } = await sb
      .from('interventions')
      .select('*')
      .eq('id', interventionId)
      .single();
    
    if (ivErr || !iv) return res.status(404).json({ error: 'Intervention not found' });

    // Vérifier opposition
    const emailHash = hashEmail(artisanEmail);
    const { data: opposed } = await sb
      .from('artisans_opposition')
      .select('id')
      .eq('artisan_email_hash', emailHash)
      .maybeSingle();

    if (opposed) {
      return res.status(200).json({ success: true, reason: 'opposition' });
    }

    // Créer artisan si absent
    let artisanId = iv.artisan_id;
    if (!artisanId) {
      const { data: art, error: artErr } = await sb
        .from('artisans')
        .insert({
          email: artisanEmail,
          raison_sociale: artisanNom || 'Artisan',
          statut: 'sollicite'
        })
        .select('id')
        .single();
      if (artErr) throw new Error('Cannot create artisan: ' + artErr.message);
      artisanId = art.id;
    }

    // Créer token
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const { error: updErr } = await sb
      .from('interventions')
      .update({ artisan_id: artisanId, validation_token: token, token_expires_at: expiresAt })
      .eq('id', interventionId);
    
    if (updErr) throw new Error('Cannot update intervention: ' + updErr.message);

    // Envoyer email via Brevo
    const siteUrl = (process.env.SITE_URL || 'https://fidero.fr').replace(/\/$/, '');
    const confirmUrl = `${siteUrl}/#confirmer?token=${encodeURIComponent(token)}&action=confirm`;
    const rejectUrl = `${siteUrl}/#confirmer?token=${encodeURIComponent(token)}&action=reject`;

    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'Fidero', email: 'contact@fidero.fr' },
        to: [{ email: artisanEmail, name: artisanNom }],
        subject: 'Confirmez votre intervention',
        htmlContent: `
          <h2>Confirmez votre intervention</h2>
          <p><strong>Adresse :</strong> ${esc(iv.adresse_bien)}</p>
          <p><strong>Travaux :</strong> ${esc(iv.type_travaux)}</p>
          <p><strong>Montant :</strong> ${iv.montant_ttc ? iv.montant_ttc.toLocaleString('fr-FR') + ' €' : '—'}</p>
          <p style="margin-top: 20px;">
            <a href="${confirmUrl}" style="background: #00A878; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              ✓ Confirmer
            </a>
            &nbsp; &nbsp;
            <a href="${rejectUrl}" style="background: #DC2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              ✗ Refuser
            </a>
          </p>
          <p style="margin-top: 40px; font-size: 12px; color: #666;">
            Ce lien expire dans 7 jours.
          </p>
        `
      })
    });

    const brevoData = await brevoRes.json();
    
    if (!brevoRes.ok) {
      console.error('[send-validation] Brevo error:', brevoRes.status, brevoData);
      return res.status(200).json({ success: true, emailSent: false, reason: 'brevo_error' });
    }

    return res.status(200).json({ success: true, emailSent: true });

  } catch (err) {
    console.error('[send-validation]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
