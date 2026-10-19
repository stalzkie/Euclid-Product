/**
 * The chrome every Euclid email shares.
 *
 * Ported from the design system in the marketing repo (`emails/EMAILS.md`),
 * which is the source of truth for the tokens and the client workarounds.
 * The rules that look odd are all client rules rather than taste:
 *
 *   - Tables for layout, every one `role="presentation"`. No flexbox, no grid.
 *   - Styles inline. The `<style>` block holds only media queries, link
 *     colours and dark-mode locks, because Gmail strips much of the rest.
 *   - `border-collapse: separate`, or WebKit and Gmail drop border radii.
 *   - No SVG; Gmail strips it. The mark is a PNG and icons are entities.
 *   - A hidden preheader padded with zero-width characters, so body copy does
 *     not leak into the inbox preview line.
 *
 * Kept as string builders rather than React Email components because the app
 * sends from a background job and a webhook, where pulling in a renderer to
 * assemble four hundred bytes of markup would be the larger cost. When the
 * other emails move over, this is the file they share.
 */

export const TOKENS = {
  page: "#F4F5F8",
  card: "#FFFFFF",
  line: "#E7E7EC",
  ink: "#17171A",
  body: "#4A4A52",
  meta: "#6B6B73",
  footer: "#8A8A93",
  blue: "#3D5AFE",
  blueInk: "#2E44D6",
  blueLine: "#CDD5FF",
  stone: "#F8F8F7",
  washFallback: "#EEF1FF",
} as const;

const SANS =
  "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** HTML-escape anything interpolated. Codes and names are not markup. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Vertical rhythm. A spacer div, because margins collapse unevenly. */
export function gap(px: number): string {
  return `<div style="height:${px}px;line-height:${px}px;font-size:0;">&nbsp;</div>`;
}

export function heading(text: string): string {
  return `<h1 class="h1 ink-lock" style="margin:0;font-family:${SANS};font-size:34px;line-height:40px;font-weight:500;letter-spacing:-0.03em;color:${TOKENS.ink};">${esc(text)}</h1>`;
}

export function paragraph(html: string): string {
  return `<p class="meta-lock" style="margin:0;font-family:${SANS};font-size:15px;line-height:24px;color:${TOKENS.body};">${html}</p>`;
}

/** The one primary action. Bulletproof: a bgcolor td around a padded anchor. */
export function button(href: string, label: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
  <td class="btn" align="center" bgcolor="${TOKENS.ink}" style="background:${TOKENS.ink};border:1px solid ${TOKENS.ink};border-radius:11px;mso-padding-alt:14px 22px;">
    <a href="${esc(href)}" target="_blank" style="display:block;padding:14px 22px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:500;color:#FFFFFF;text-decoration:none;border-radius:11px;">${esc(label)}</a>
  </td>
</tr></table>`;
}

/** A value worth copying — a code, a link. Monospace in a stone box. */
export function codeBox(value: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
  <td align="center" style="background:${TOKENS.stone};border:1px solid ${TOKENS.line};border-radius:11px;padding:16px 14px;font-family:${MONO};font-size:20px;line-height:26px;letter-spacing:0.06em;font-weight:500;color:${TOKENS.ink};word-break:break-all;">${esc(value)}</td>
</tr></table>`;
}

export function pill(text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td class="pill-lock" style="background:#FFFFFF;border:1px solid ${TOKENS.blueLine};border-radius:999px;padding:5px 12px;font-family:${SANS};font-size:12.5px;line-height:16px;font-weight:500;color:${TOKENS.blueInk};"><span style="display:inline-block;width:6px;height:6px;border-radius:3px;background:${TOKENS.blue};vertical-align:middle;margin-right:7px;"></span><span style="vertical-align:middle;">${esc(text)}</span></td>
</tr></table>`;
}

export interface Email {
  subject: string;
  /** The inbox preview line. Never left to chance — see the preheader below. */
  preheader: string;
  /** Shown in the wash hero, above the headline. */
  badge: string;
  title: string;
  /** Pre-built HTML for the card body. */
  body: string;
  /** Who signs it. A person, not a team — see sendPartnerCode. */
  signOff: string;
  /** One line saying why this email exists. Not an unsubscribe. */
  why: string;
  origin: string;
}

/**
 * Wrap a body in the shared chrome.
 *
 * Deliberately **no unsubscribe link and no List-Unsubscribe header**. Those
 * belong on bulk mail, and Gmail reads their presence as a bulk signal — on a
 * receipt for something the recipient just paid for they would both invite
 * the Promotions tab and offer to unsubscribe someone from their own
 * purchase.
 */
export function render(email: Email): string {
  const mark = `${email.origin}/logos/icon.png`;
  // Zero-width padding, so the client takes the preheader as the preview line
  // rather than the first sentence of the body.
  const pad = "&#847;&zwnj;&nbsp;".repeat(40);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(email.subject)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>table,td,div,h1,h2,p,a,span {font-family: 'Segoe UI', Arial, sans-serif !important;}</style>
<![endif]-->
<style>
  :root { color-scheme: light; supported-color-schemes: light; }
  body { margin:0 !important; padding:0 !important; width:100% !important; background:${TOKENS.page}; -webkit-text-size-adjust:100%; }
  table { border-collapse: separate; border-spacing: 0; mso-table-lspace: 0; mso-table-rspace: 0; }
  img { border:0; outline:none; text-decoration:none; display:block; }
  a { color: ${TOKENS.blue}; }
  a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
  u + #body a { color: inherit; text-decoration: none; }
  /* The hero is a gradient. No client inverts a background-image, but several
     invert the text on it, which leaves light text on a light surface. Pin
     the two together so the panel stays as drawn. */
  @media (prefers-color-scheme: dark) {
    .wash-lock { background-color: ${TOKENS.washFallback} !important; }
    .ink-lock, .ink-lock * { color: ${TOKENS.ink} !important; }
    .meta-lock, .meta-lock * { color: ${TOKENS.body} !important; }
    .pill-lock, .pill-lock * { color: ${TOKENS.blueInk} !important; background-color: #FFFFFF !important; }
  }
  [data-ogsc] .wash-lock { background-color: ${TOKENS.washFallback} !important; }
  [data-ogsc] .ink-lock, [data-ogsc] .ink-lock * { color: ${TOKENS.ink} !important; }
  [data-ogsc] .meta-lock, [data-ogsc] .meta-lock * { color: ${TOKENS.body} !important; }
  [data-ogsc] .pill-lock, [data-ogsc] .pill-lock * { color: ${TOKENS.blueInk} !important; }
  [data-ogsb] .pill-lock { background-color: #FFFFFF !important; }
  @media only screen and (max-width: 600px) {
    .container { width: 100% !important; }
    .px { padding-left: 22px !important; padding-right: 22px !important; }
    .hero { padding-top: 30px !important; padding-bottom: 28px !important; }
    .h1 { font-size: 28px !important; line-height: 34px !important; }
    .outer { padding-left: 10px !important; padding-right: 10px !important; }
  }
</style>
</head>
<body id="body" style="margin:0;padding:0;background:${TOKENS.page};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(email.preheader)}${pad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${TOKENS.page};">
  <tr>
    <td class="outer" align="center" style="padding:32px 16px 40px;">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
        <tr>
          <td style="background:${TOKENS.card};border:1px solid ${TOKENS.line};border-radius:18px;overflow:hidden;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="px hero wash-lock" bgcolor="${TOKENS.washFallback}" style="background:${TOKENS.washFallback};background-image:linear-gradient(135deg, #DCE3FF 0%, #EEE7FF 52%, #FFE6D5 100%);padding:36px 40px 34px;border-bottom:1px solid #F0F0F3;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td style="padding-right:9px;vertical-align:middle;"><img src="${esc(mark)}" width="28" height="28" alt="" style="width:28px;height:28px;border-radius:7px;"></td>
                    <td class="ink-lock" style="vertical-align:middle;font-family:${SANS};font-size:16px;line-height:20px;font-weight:600;color:${TOKENS.ink};letter-spacing:-0.01em;">Euclid</td>
                  </tr></table>
                  ${gap(30)}
                  ${pill(email.badge)}
                  ${gap(14)}
                  ${heading(email.title)}
                </td>
              </tr>
              <tr>
                <td class="px" style="padding:30px 40px 36px;font-family:${SANS};">
                  ${email.body}
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:28px 0;"><div style="height:1px;line-height:1px;font-size:0;background:${TOKENS.line};">&nbsp;</div></td></tr></table>
                  <p style="margin:0;font-family:${SANS};font-size:15px;line-height:24px;color:${TOKENS.body};">Talk soon,</p>
                  <p style="margin:0;font-family:${SANS};font-size:15px;line-height:24px;color:${TOKENS.ink};font-weight:500;">${esc(email.signOff)}</p>
                  ${gap(10)}
                  <p style="margin:0;font-family:${SANS};font-size:13px;line-height:20px;color:${TOKENS.meta};">Reply to this email if you have questions. A real person reads every reply.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:24px 40px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td align="center" style="padding-bottom:12px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td style="padding-right:7px;vertical-align:middle;"><img src="${esc(mark)}" width="18" height="18" alt="" style="width:18px;height:18px;border-radius:5px;"></td>
                  <td style="vertical-align:middle;font-family:${SANS};font-size:13px;line-height:18px;font-weight:600;color:${TOKENS.ink};">Euclid</td>
                </tr></table>
              </td></tr>
              <tr><td align="center" style="font-family:${SANS};font-size:12.5px;line-height:20px;color:${TOKENS.footer};">
                The feedback board that briefs your coding agent.<br>
                ${esc(email.why)}
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;
}
