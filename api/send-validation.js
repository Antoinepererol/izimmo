// api/send-validation.js
// Crée le profil artisan en statut 'sollicite', le lie à l'intervention,
// génère le token et envoie l'email de validation.
// Vérifie d'abord la liste d'exclusion (opposition passée) : si l'email s'y
// trouve, aucun profil n'est créé et aucun email n'est envoyé.
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { randomUUID, createHash } = require('crypto');

const BASE_URL = 'https://izimmo-one.vercel.app';

function normEmail(email) { return String(email || '').trim().toLowerCase(); }
function hashEmail(email) { return createHash('sha256').update(normEmail(email)).digest('hex'); }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { interventionId, artisanNom, artisanEntreprise, artisanSiret, artisanEmail } = req.body || {};
  if (!interventionId) return res.status(400).json({ error: 'interventionId requis' });
  if (!artisanEmail)   return res.status(400).json({ error: 'Email artisan requis' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const resend = new Resend(process.env.RESEND_API_KEY);
  const email = normEmail(artisanEmail);

  try {
    // 1. Liste d'exclusion : l'artisan s'est-il déjà opposé ?
    const { data: oppose } = await sb
      .from('artisans_opposition').select('email_hash').eq('email_hash', hashEmail(email)).limit(1);
    if (oppose && oppose.length) {
      // Réponse neutre : on ne révèle pas l'opposition, on ne crée/n'envoie rien.
      return res.status(200).json({ success: true, emailSent: false, reason: 'non_sollicitable' });
    }

    // 2. Récupérer l'intervention
    const { data: intervention, error: fetchErr } = await sb
      .from('interventions').select('*').eq('id', interventionId).single();
    if (fetchErr || !intervention) return res.status(404).json({ error: 'Intervention introuvable' });

    // 3. Trouver ou créer le profil artisan (statut 'sollicite')
    let artisanId = null;
    const { data: existing } = await sb
      .from('artisans').select('id').eq('email', email).limit(1);
    if (existing && existing.length) {
      artisanId = existing[0].id;
    } else {
      const { data: created, error: createErr } = await sb
        .from('artisans')
        .insert({
          nom: artisanNom || null,
          entreprise: artisanEntreprise || null,
          siret: artisanSiret || null,
          email: email,
          metier: intervention.type_travaux || null,
          statut: 'sollicite'
        })
        .select('id').single();
      if (createErr) throw new Error('Création artisan: ' + createErr.message);
      artisanId = created.id;
    }

    // 4. Token + lien artisan sur l'intervention
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: updateErr } = await sb
      .from('interventions')
      .update({ validation_token: token, token_expires_at: expiresAt, artisan_id: artisanId })
      .eq('id', interventionId);
    if (updateErr) throw new Error(updateErr.message);

    // 5. Email (Resend pour l'instant — migration Brevo + mentions RGPD à l'étape 3)
    const confirmUrl = `${BASE_URL}/#confirmer?token=${token}`;
    const date = intervention.date_intervention
      ? new Date(intervention.date_intervention).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      : '—';
    const montant = intervention.montant_ttc
      ? Number(intervention.montant_ttc).toLocaleString('fr-FR') + ' €'
      : 'Non renseigné';

    const { error: emailErr } = await resend.emails.send({
      from: "Historim <onboarding@resend.dev>",
      to: email,
      subject: `Validation d'intervention — ${intervention.adresse_bien}`,
      html: buildEmail({ artisanNom: artisanNom || '', adresse: intervention.adresse_bien, type: intervention.type_travaux, description: intervention.description, date, montant, confirmUrl }),
    });
    if (emailErr) throw new Error(emailErr.message);

    return res.status(200).json({ success: true, emailSent: true, token });
  } catch (err) {
    console.error('[send-validation]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function buildEmail({ artisanNom, adresse, type, description, date, montant, confirmUrl }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F8F9FA;font-family:Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
<tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="background:#0F1C32;border-radius:14px 14px 0 0;padding:28px 36px;text-align:center;">
  <div style="font-size:22px;font-weight:900;color:white;">Histor<span style="color:#E8683A;font-style:italic;">im</span></div>
  <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:4px;text-transform:uppercase;letter-spacing:1px;">Tracabilite certifiee</div>
</td></tr>
<tr><td style="background:white;padding:36px;">
  <p style="font-size:16px;font-weight:700;color:#0F1C32;margin:0 0 8px;">Bonjour ${artisanNom || ''},</p>
  <p style="font-size:14px;color:#6B7A8D;line-height:1.6;margin:0 0 24px;">Un proprietaire a enregistre une intervention que vous auriez realisee. Confirmez-la en un clic.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FA;border-radius:10px;padding:20px;margin-bottom:24px;">
    <tr><td colspan="2" style="font-size:11px;font-weight:700;color:#E8683A;text-transform:uppercase;padding-bottom:12px;">Details</td></tr>
    <tr><td style="font-size:12px;color:#6B7A8D;padding:4px 0;width:40%;">Bien</td><td style="font-size:13px;font-weight:700;color:#0F1C32;">${adresse}</td></tr>
    <tr><td style="font-size:12px;color:#6B7A8D;padding:4px 0;">Type</td><td style="font-size:13px;font-weight:700;color:#0F1C32;">${type}</td></tr>
    ${description ? `<tr><td style="font-size:12px;color:#6B7A8D;padding:4px 0;">Description</td><td style="font-size:13px;color:#0F1C32;">${description}</td></tr>` : ''}
    <tr><td style="font-size:12px;color:#6B7A8D;padding:4px 0;">Date</td><td style="font-size:13px;font-weight:700;color:#0F1C32;">${date}</td></tr>
    <tr><td style="font-size:12px;color:#6B7A8D;padding:4px 0;">Montant TTC</td><td style="font-size:13px;font-weight:700;color:#0F1C32;">${montant}</td></tr>
  </table>
  <div style="text-align:center;margin-bottom:24px;">
    <a href="${confirmUrl}" style="display:inline-block;background:#E8683A;color:white;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;">Confirmer cette intervention</a>
  </div>
  <p style="font-size:12px;color:#8A9BAB;text-align:center;">Lien valable 7 jours.</p>
</td></tr>
<tr><td style="background:#0A1220;border-radius:0 0 14px 14px;padding:20px;text-align:center;">
  <p style="font-size:11px;color:rgba(255,255,255,0.3);margin:0;">Historim — Tracabilite certifiee du logement</p>
</td></tr>
</table></td></tr></table>
</body></html>`;
}
