// api/send-validation.js
// Vercel Serverless Function
// Reçoit { interventionId } → génère un token → l'enregistre en Supabase → envoie l'email via Resend
 
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { randomUUID } from 'crypto';
 
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // clé service (pas la clé publique) pour bypass RLS
);
 
const resend = new Resend(process.env.RESEND_API_KEY);
 
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://izimmo-one.vercel.app';
 
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
 
  const { interventionId } = req.body || {};
  if (!interventionId) {
    return res.status(400).json({ error: 'interventionId requis' });
  }
 
  try {
    // 1. Récupérer l'intervention depuis Supabase
    const { data: intervention, error: fetchErr } = await sb
      .from('interventions')
      .select('*')
      .eq('id', interventionId)
      .single();
 
    if (fetchErr || !intervention) {
      return res.status(404).json({ error: 'Intervention introuvable' });
    }
 
    if (!intervention.artisan_contact) {
      return res.status(400).json({ error: 'Email artisan manquant' });
    }
 
    // 2. Générer un token unique + expiration 7 jours
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
 
    // 3. Enregistrer le token en Supabase
    const { error: updateErr } = await sb
      .from('interventions')
      .update({ validation_token: token, token_expires_at: expiresAt })
      .eq('id', interventionId);
 
    if (updateErr) throw new Error(updateErr.message);
 
    // 4. Construire le lien de confirmation
    const confirmUrl = `${BASE_URL}/#confirmer?token=${token}`;
 
    // 5. Formater les données pour l'email
    const date = intervention.date_intervention
      ? new Date(intervention.date_intervention).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      : '—';
    const montant = intervention.montant_ttc
      ? Number(intervention.montant_ttc).toLocaleString('fr-FR') + ' €'
      : 'Non renseigné';
 
    // 6. Envoyer l'email via Resend
    const { error: emailErr } = await resend.emails.send({
      from: 'Iz\'Immo <noreply@izimmo.fr>',  // à remplacer par ton domaine vérifié dans Resend
      to: intervention.artisan_contact,
      subject: `Validation d'intervention — ${intervention.adresse_bien}`,
      html: buildEmailHtml({
        artisanNom:    intervention.artisan_nom,
        adresse:       intervention.adresse_bien,
        type:          intervention.type_travaux,
        description:   intervention.description,
        date,
        montant,
        confirmUrl,
      }),
    });
 
    if (emailErr) throw new Error(emailErr.message);
 
    return res.status(200).json({ success: true, token });
 
  } catch (err) {
    console.error('[send-validation]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
 
function buildEmailHtml({ artisanNom, adresse, type, description, date, montant, confirmUrl }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F7F3ED;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F3ED;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
 
        <!-- Header -->
        <tr><td style="background:#1A2B4A;border-radius:14px 14px 0 0;padding:28px 36px;text-align:center;">
          <div style="font-size:22px;font-weight:900;color:white;letter-spacing:-0.5px;">
            IZ<span style="display:inline-block;width:1px;background:#E8683A;margin:0 8px;height:1em;vertical-align:middle;"></span><span style="color:#1A2B4A;">IMMO</span>
          </div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:4px;letter-spacing:1px;text-transform:uppercase;">Traçabilité certifiée</div>
        </td></tr>
 
        <!-- Corps -->
        <tr><td style="background:white;padding:36px;">
          <p style="font-size:16px;font-weight:700;color:#1A2B4A;margin:0 0 8px;">Bonjour ${artisanNom},</p>
          <p style="font-size:14px;color:#6B7A8D;line-height:1.6;margin:0 0 24px;">
            Un propriétaire a enregistré une intervention que vous avez réalisée sur son bien. 
            Confirmez-la en un clic pour qu'elle soit <strong style="color:#1A2B4A;">certifiée sur Iz'Immo</strong> 
            et booste votre score de transparence.
          </p>
 
          <!-- Détails intervention -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F3ED;border-radius:10px;padding:20px;margin-bottom:24px;">
            <tr><td colspan="2" style="font-size:11px;font-weight:700;color:#E8683A;text-transform:uppercase;letter-spacing:1px;padding-bottom:12px;">Détails de l'intervention</td></tr>
            <tr>
              <td style="font-size:12px;color:#6B7A8D;padding:5px 0;width:40%;">Bien</td>
              <td style="font-size:13px;font-weight:700;color:#1A2B4A;padding:5px 0;">${adresse}</td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#6B7A8D;padding:5px 0;">Type de travaux</td>
              <td style="font-size:13px;font-weight:700;color:#1A2B4A;padding:5px 0;">${type}</td>
            </tr>
            ${description ? `<tr>
              <td style="font-size:12px;color:#6B7A8D;padding:5px 0;">Description</td>
              <td style="font-size:13px;color:#1A2B4A;padding:5px 0;">${description}</td>
            </tr>` : ''}
            <tr>
              <td style="font-size:12px;color:#6B7A8D;padding:5px 0;">Date</td>
              <td style="font-size:13px;font-weight:700;color:#1A2B4A;padding:5px 0;">${date}</td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#6B7A8D;padding:5px 0;">Montant TTC</td>
              <td style="font-size:13px;font-weight:700;color:#1A2B4A;padding:5px 0;">${montant}</td>
            </tr>
          </table>
 
          <!-- CTA -->
          <div style="text-align:center;margin-bottom:24px;">
            <a href="${confirmUrl}" style="display:inline-block;background:#E8683A;color:white;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;letter-spacing:-0.2px;">
              ✓ Confirmer cette intervention
            </a>
          </div>
 
          <p style="font-size:12px;color:#8A9BAB;text-align:center;line-height:1.6;margin:0;">
            Ce lien est valable 7 jours. Si vous n'avez pas réalisé cette intervention,<br>
            vous pouvez ignorer cet email ou 
            <a href="${confirmUrl}&action=refuser" style="color:#E8683A;">signaler une erreur</a>.
          </p>
        </td></tr>
 
        <!-- Footer -->
        <tr><td style="background:#0F1C32;border-radius:0 0 14px 14px;padding:20px 36px;text-align:center;">
          <p style="font-size:11px;color:rgba(255,255,255,0.3);margin:0;line-height:1.6;">
            Iz'Immo — Traçabilité certifiée du logement<br>
            Vous recevez cet email car votre SIRET a été associé à une intervention.
          </p>
        </td></tr>
 
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
