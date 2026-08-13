// api/send-validation.js
// Sollicitation d'un artisan pour valider une intervention déclarée.
//
// Déroulé :
//   1. Relit l'intervention en base (source de vérité pour le contenu du mail)
//   2. Vérifie la liste d'exclusion : si l'artisan s'est opposé, on s'arrête là
//   3. Crée le profil artisan en statut 'sollicite' (invisible tant qu'il n'a pas agi)
//   4. Génère un jeton de validation valable 7 jours
//   5. Envoie l'email via Brevo
//
// Variables d'environnement requises sur Vercel :
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   HISTORIM_EMAIL_HASH_SALT   (identique à celui de confirmer.js)
//   BREVO_API_KEY
//   BREVO_SENDER_EMAIL         (adresse vérifiée chez Brevo)
//   SITE_URL                   (ex: https://historim.com — sans slash final)

const { createClient } = require('@supabase/supabase-js');
const { createHash, randomUUID } = require('crypto');

const NAVY = '#28385F';
const ORANGE = '#E8683A';
const SKY = '#CAE4ED';

// Doit rester rigoureusement identique à la fonction de confirmer.js,
// sinon la liste d'exclusion ne matcherait jamais.
function hashEmail(email) {
  const salt = process.env.HISTORIM_EMAIL_HASH_SALT;
  if (!salt || salt.length < 16) {
    throw new Error('HISTORIM_EMAIL_HASH_SALT non configuré ou trop court (min 16 caractères)');
  }
  return createHash('sha256')
    .update(String(email || '').trim().toLowerCase() + salt)
    .digest('hex');
}

// Neutralise le HTML dans les données saisies par le propriétaire.
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  return dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatMontant(m) {
  if (m == null || m === '') return null;
  const n = Number(m);
  if (isNaN(n)) return null;
  return n.toLocaleString('fr-FR') + ' € TTC';
}

// Une ligne du tableau récapitulatif — omise si la donnée est absente.
function ligne(label, valeur) {
  if (!valeur) return '';
  return `<tr>
    <td style="padding:3px 0;width:100px;color:#666666;vertical-align:top;">${esc(label)}</td>
    <td style="padding:3px 0;color:#1a1a1a;">${esc(valeur)}</td>
  </tr>`;
}

function buildEmail(iv, links) {
  const lignes = [
    ligne('Nature', iv.type_travaux),
    ligne('Détail', iv.description),
    ligne('Date', formatDate(iv.date_intervention)),
    ligne('Adresse', iv.adresse_bien),
    ligne('Montant', formatMontant(iv.montant_ttc))
  ].join('');

  const adresse = iv.adresse_bien ? esc(iv.adresse_bien) : 'un bien';

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#E8E6E1;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E8E6E1;">
<tr><td align="center" style="padding:0;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:Arial,Helvetica,sans-serif;">

  <tr><td style="background-color:${NAVY};padding:22px 32px;">
    <span style="font-size:22px;font-weight:bold;color:#ffffff;">Histor<span style="color:${ORANGE};font-style:italic;">im</span></span>
    <div style="font-size:10px;color:${SKY};letter-spacing:1.5px;text-transform:uppercase;margin-top:3px;">Traçabilité certifiée</div>
  </td></tr>

  <tr><td style="padding:32px;">

    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#1a1a1a;">Bonjour,</p>

    <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#1a1a1a;">
      Le propriétaire du bien situé au <strong>${adresse}</strong> a déclaré une intervention réalisée par votre entreprise et vous demande de la confirmer.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F3EF;border-left:3px solid ${ORANGE};margin:0 0 24px;">
      <tr><td style="padding:18px 20px;">
        <div style="font-size:11px;font-weight:bold;color:${ORANGE};text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">L'intervention déclarée</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;">${lignes}</table>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${SKY};margin:0 0 26px;">
      <tr><td style="padding:16px 20px;font-size:14px;line-height:1.55;color:#1B2B4A;">
        <strong>Vous n'apparaissez nulle part pour l'instant.</strong><br>
        Tant que vous n'avez pas répondu à ce message, votre entreprise n'est visible par personne : ni dans l'annuaire Historim, ni dans l'historique de ce bien. C'est votre validation, et elle seule, qui vous rend visible.
      </td></tr>
    </table>

    <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1a1a1a;">
      Cette intervention a-t-elle bien été réalisée par votre entreprise ?
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">
      <tr>
        <td width="48%" style="padding-right:6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" bgcolor="#2A7D5F" style="border-radius:6px;">
              <a href="${links.confirmer}" style="display:block;padding:15px 10px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">Oui, je confirme</a>
            </td></tr>
          </table>
        </td>
        <td width="48%" style="padding-left:6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" bgcolor="#ffffff" style="border-radius:6px;border:2px solid ${NAVY};">
              <a href="${links.refuser}" style="display:block;padding:13px 10px;font-size:15px;font-weight:bold;color:${NAVY};text-decoration:none;">Non, c'est inexact</a>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;">
      <tr>
        <td width="48%" style="padding-right:6px;font-size:12px;line-height:1.45;color:#666666;">
          L'intervention est enregistrée à votre nom et votre fiche est créée.
        </td>
        <td width="48%" style="padding-left:6px;font-size:12px;line-height:1.45;color:#666666;">
          L'intervention est rejetée. Vous restez invisible.
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
      <tr><td style="border-top:1px solid #E0DDD8;font-size:0;line-height:0;">&nbsp;</td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F3EF;">
      <tr><td style="padding:18px 20px;">
        <div style="font-size:14px;line-height:1.55;color:#1a1a1a;margin-bottom:12px;">
          <strong>Vous ne souhaitez pas figurer dans Historim ?</strong><br>
          <span style="color:#555555;">Différent d'un refus : ici, nous supprimons définitivement vos coordonnées et vous ne serez plus jamais sollicité, pour aucune intervention.</span>
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td align="center" bgcolor="#ffffff" style="border-radius:6px;border:1px solid #B0413E;">
            <a href="${links.opposer}" style="display:block;padding:11px 22px;font-size:14px;font-weight:bold;color:#B0413E;text-decoration:none;">Me retirer définitivement</a>
          </td></tr>
        </table>
      </td></tr>
    </table>

    <p style="margin:20px 0 0;font-size:12px;color:#888888;line-height:1.5;">
      Ces liens sont valables 7 jours. Sans réponse de votre part, l'intervention restera non certifiée et votre entreprise n'apparaîtra nulle part.
    </p>

  </td></tr>

  <tr><td style="background-color:#F0EEEA;padding:24px 32px;border-top:1px solid #E0DDD8;">
    <div style="font-size:11px;font-weight:bold;color:${NAVY};text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Informations sur vos données (article 14 RGPD)</div>
    <p style="margin:0 0 10px;font-size:12px;line-height:1.6;color:#555555;">
      <strong style="color:#333333;">Responsable de traitement :</strong> Antoine Pererol, 22 Grande Rue, 92420 Vaucresson — contact@historim.com
    </p>
    <p style="margin:0 0 10px;font-size:12px;line-height:1.6;color:#555555;">
      <strong style="color:#333333;">Pourquoi vous recevez ce message :</strong> pour vous permettre de confirmer ou de contester une intervention déclarée vous concernant. Ce traitement repose sur notre intérêt légitime à garantir la fiabilité des informations publiées.
    </p>
    <p style="margin:0 0 10px;font-size:12px;line-height:1.6;color:#555555;">
      <strong style="color:#333333;">D'où viennent vos données :</strong> votre SIRET et votre raison sociale proviennent de la base publique SIRENE de l'INSEE. Votre adresse email professionnelle nous a été transmise par le propriétaire à l'origine de la déclaration.
    </p>
    <p style="margin:0 0 10px;font-size:12px;line-height:1.6;color:#555555;">
      <strong style="color:#333333;">Vos droits :</strong> vous disposez d'un droit d'accès, de rectification, d'opposition et d'effacement de vos données. Le bouton « Me retirer définitivement » ci-dessus exerce immédiatement vos droits d'opposition et d'effacement. Pour toute autre demande, écrivez à contact@historim.com.
    </p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:#555555;">
      <a href="${links.confidentialite}" style="color:${NAVY};text-decoration:underline;">Politique de confidentialité</a>
    </p>
  </td></tr>

  <tr><td style="background-color:${NAVY};padding:18px 32px;text-align:center;">
    <div style="font-size:12px;color:${SKY};">Historim — Traçabilité certifiée de l'habitat</div>
    <div style="font-size:11px;color:#8A9BB5;margin-top:4px;">historim.com</div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// Version texte, pour les clients qui n'affichent pas le HTML et pour l'anti-spam.
function buildTexte(iv, links) {
  const l = [];
  l.push('Bonjour,');
  l.push('');
  l.push(`Le propriétaire du bien situé au ${iv.adresse_bien || 'un bien'} a déclaré une intervention réalisée par votre entreprise et vous demande de la confirmer.`);
  l.push('');
  l.push("L'INTERVENTION DÉCLARÉE");
  if (iv.type_travaux) l.push('Nature : ' + iv.type_travaux);
  if (iv.description) l.push('Détail : ' + iv.description);
  if (formatDate(iv.date_intervention)) l.push('Date : ' + formatDate(iv.date_intervention));
  if (iv.adresse_bien) l.push('Adresse : ' + iv.adresse_bien);
  if (formatMontant(iv.montant_ttc)) l.push('Montant : ' + formatMontant(iv.montant_ttc));
  l.push('');
  l.push("VOUS N'APPARAISSEZ NULLE PART POUR L'INSTANT");
  l.push("Tant que vous n'avez pas répondu, votre entreprise n'est visible par personne :");
  l.push("ni dans l'annuaire Historim, ni dans l'historique de ce bien.");
  l.push('');
  l.push('Oui, je confirme : ' + links.confirmer);
  l.push("Non, c'est inexact : " + links.refuser);
  l.push('');
  l.push('Vous ne souhaitez pas figurer dans Historim ? Différent d\'un refus :');
  l.push('vos coordonnées sont supprimées et vous ne serez plus jamais sollicité.');
  l.push('Me retirer définitivement : ' + links.opposer);
  l.push('');
  l.push('Ces liens sont valables 7 jours.');
  l.push('');
  l.push('---');
  l.push('INFORMATIONS SUR VOS DONNÉES (article 14 RGPD)');
  l.push('Responsable de traitement : Antoine Pererol, 22 Grande Rue, 92420 Vaucresson, contact@historim.com');
  l.push('Finalité : vous permettre de confirmer ou contester une intervention déclarée vous concernant.');
  l.push('Base légale : intérêt légitime.');
  l.push('Origine des données : SIRET et raison sociale issus de la base publique SIRENE de l\'INSEE ;');
  l.push('email professionnel transmis par le propriétaire déclarant.');
  l.push('Vos droits : accès, rectification, opposition, effacement — contact@historim.com');
  l.push('Politique de confidentialité : ' + links.confidentialite);
  return l.join('\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { interventionId, artisanNom, artisanEntreprise, artisanSiret, artisanEmail } = req.body || {};
  if (!interventionId) return res.status(400).json({ error: 'interventionId requis' });
  if (!artisanEmail)   return res.status(400).json({ error: 'artisanEmail requis' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const siteUrl = (process.env.SITE_URL || 'https://historim.com').replace(/\/+$/, '');

  try {
    // 1. Relire l'intervention : le contenu du mail vient de la base, pas du navigateur.
    const { data: iv, error: ivErr } = await sb
      .from('interventions')
      .select('id, adresse_bien, type_travaux, description, date_intervention, montant_ttc, artisan_id')
      .eq('id', interventionId)
      .single();
    if (ivErr || !iv) return res.status(404).json({ error: 'Intervention introuvable' });

    // 2. Liste d'exclusion : un artisan opposé n'est jamais re-sollicité.
    const emailHash = hashEmail(artisanEmail);
    const { data: exclu } = await sb
      .from('artisans_opposition')
      .select('email_hash')
      .eq('email_hash', emailHash)
      .maybeSingle();

    if (exclu) {
      // L'intervention reste en attente, sans profil artisan rattaché.
      return res.status(200).json({ success: true, emailSent: false, reason: 'opposition' });
    }

    // 3. Profil artisan en statut 'sollicite' : invisible tant qu'il n'a pas agi.
    let artisanId = iv.artisan_id;
    if (!artisanId) {
      const { data: art, error: artErr } = await sb
        .from('artisans')
        .insert({
          nom: artisanNom || 'Artisan',
          entreprise: artisanEntreprise || null,
          siret: artisanSiret || null,
          email: artisanEmail,
          statut: 'sollicite'
        })
        .select('id')
        .single();
      if (artErr) throw new Error('Création artisan : ' + artErr.message);
      artisanId = art.id;
    }

    // 4. Jeton de validation, valable 7 jours.
    const token = randomUUID();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: updErr } = await sb
      .from('interventions')
      .update({ artisan_id: artisanId, validation_token: token, token_expires_at: expires })
      .eq('id', interventionId);
    if (updErr) throw new Error('Mise à jour intervention : ' + updErr.message);

    // 5. Envoi via Brevo.
    const base = `${siteUrl}/#confirmer?token=${encodeURIComponent(token)}`;
    const links = {
      confirmer: `${base}&action=confirmer`,
      refuser:   `${base}&action=refuser`,
      opposer:   `${base}&action=opposer`,
      confidentialite: `${siteUrl}/#confidentialite`
    };

    const apiKey = process.env.BREVO_API_KEY;
    const sender = process.env.BREVO_SENDER_EMAIL;
    if (!apiKey || !sender) {
      // Le jeton existe déjà : l'intervention est exploitable même sans email.
      console.error('[send-validation] BREVO_API_KEY ou BREVO_SENDER_EMAIL manquant');
      return res.status(200).json({ success: true, emailSent: false, reason: 'config' });
    }

    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'Historim', email: sender },
        to: [{ email: artisanEmail, name: artisanNom || undefined }],
        replyTo: { email: 'contact@historim.com', name: 'Historim' },
        subject: 'Une intervention vous est attribuée — confirmation demandée',
        htmlContent: buildEmail(iv, links),
        textContent: buildTexte(iv, links)
      })
    });

    if (!brevoRes.ok) {
      const detail = await brevoRes.text();
      console.error('[send-validation] Brevo', brevoRes.status, detail);
      return res.status(200).json({ success: true, emailSent: false, reason: 'brevo' });
    }

    return res.status(200).json({ success: true, emailSent: true });

  } catch (err) {
    console.error('[send-validation]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
