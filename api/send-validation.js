// api/send-validation.js
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { randomUUID } = require('crypto');

const BASE_URL = 'https://izimmo-one.vercel.app';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { interventionId } = req.body || {};
  if (!interventionId) return res.status(400).json({ error: 'interventionId requis' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const { data: intervention, error: fetchErr } = await sb
      .from('interventions').select('*').eq('id', interventionId).single();
    if (fetchErr || !intervention) return res.status(404).json({ error: 'Intervention introuvable' });
    if (!intervention.artisan_contact) return res.status(400).json({ error: 'Email artisan manquant' });

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: updateErr } = await sb
      .from('interventions')
      .update({ validation_token: token, token_expires_at: expiresAt })
      .eq('id', interventionId);
    if (updateErr) throw new Error(updateErr.message);

    const confirmUrl = `${BASE_URL}/#confirmer?token=${token}`;
    const date = intervention.date_intervention
      ? new Date(intervention.date_intervention).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      : '—';
    const montant = intervention.montant_ttc
      ? Number(intervention.montant_ttc).toLocaleString('fr-FR') + ' €'
      : 'Non renseigné';

    const { error: emailErr } = await resend.emails.send({
      from: "Iz'Immo <onboarding@resend.dev>",
      to: intervention.artisan_contact,
      subject: `Validation d'intervention — ${intervention.adresse_bien}`,
      html: buildEmail({ artisanNom: intervention.artisan_nom, adresse: intervention.adresse_bien, type: intervention.type_travaux, description: intervention.description, date, montant, confirmUrl }),
    });
    if (emailErr) throw new Error(emailErr.message);

    return res.status(200).json({ success: true, token });
  } catch (err) {
    console.error('[send-validation]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function buildEmail({ artisanNom, adresse, type, description, date, montant, confirmUrl }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F7F3ED;font-family:Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
<tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="background:#1A2B4A;border-radius:14px 14px 0 0;padding:28px 36px;text-align:center;">
  <div style="font-size:22px;font-weight:900;color:white;">IZ<span style="color:#E8683A;">IMMO</span></div>
  <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:4px;text-transform:uppercase;letter-spacing:1px;">Tracabilite certifiee</div>
</td></tr>
<tr><td style="background:white;padding:36px;">
  <p style="font-size:16px;font-weight:700;color:#1A2B4A;margin:0 0 8px;">Bonjour ${artisanNom},</p>
  <p style="font-size:14px;color:#6B7A8D;line-height:1.6;margin:0 0 24px;">Un proprietaire a enregistre une intervention que vous avez realisee. Confirmez-la en un clic.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F3ED;border-radius:10px;padding:20px;margin-bottom:24px;">
    <tr><td colspan="2" style="font-size:11px;font-weight:700;color:#E8683A;text-transform:uppercase;padding-bottom:12px;">Details</td></tr>
    <tr><td style="font-size:12px;color:#6B7A8D;padding:4px 0;width:40%;">Bien</td><td style="font-size:13px;font-weight:700;color:#1A2B4A;">${adresse}</td></tr>
    <tr><td style="font-size:12px;color:#6B7A8D;padding:4px 0;">Type</td><td style="font-size:13px;font-weight:700;color:#1A2B4A;">${type}</td></tr>
    ${description ? `<tr><td style="font-size:12px;color:#6B7A8D;padding:4px 0;">Description</td><td style="font-size:13px;color:#1A2B4A;">${description}</td></tr>` : ''}
    <tr><td style="font-size:12px;color:#6B7A8D;padding:4px 0;">Date</td><td style="font-size:13px;font-weight:700;color:#1A2B4A;">${date}</td></tr>
    <tr><td style="font-size:12px;color:#6B7A8D;padding:4px 0;">Montant TTC</td><td style="font-size:13px;font-weight:700;color:#1A2B4A;">${montant}</td></tr>
  </table>
  <div style="text-align:center;margin-bottom:24px;">
    <a href="${confirmUrl}" style="display:inline-block;background:#E8683A;color:white;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;">Confirmer cette intervention</a>
  </div>
  <p style="font-size:12px;color:#8A9BAB;text-align:center;">Lien valable 7 jours. Si vous n'avez pas realise cette intervention, ignorez cet email.</p>
</td></tr>
<tr><td style="background:#0F1C32;border-radius:0 0 14px 14px;padding:20px;text-align:center;">
  <p style="font-size:11px;color:rgba(255,255,255,0.3);margin:0;">Iz'Immo — Tracabilite certifiee du logement</p>
</td></tr>
</table></td></tr></table>
</body></html>`;
}
