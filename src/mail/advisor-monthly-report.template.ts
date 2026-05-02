/**
 * Advisor Monthly Report Email Template
 * Generates a rich HTML email matching the CIM Amplify design.
 * All styles are inlined for email-client compatibility.
 */

export interface ReportBuyer {
  buyerId: string;
  fullName: string;
  companyName: string;
  interestedSince: string; // formatted date
  flagInactiveUrl?: string;
  flaggedInactive?: boolean;
}

export interface BuyerMovement {
  buyerName: string;
  buyerCompany: string;
  fromStatus: string; // "Pending" | "Active"
  toStatus: string;   // "Active" | "Passed"
  date: string;       // formatted date
}

export interface ReportDeal {
  id: string;
  title: string;
  revenue: string;  // formatted, e.g. "$30M"
  ebitda: string;
  listedDate: string;
  status: 'active' | 'loi';
  activeBuyerCount: number;
  passedCount: number;
  activeBuyers: ReportBuyer[];
  movements: BuyerMovement[];
  loiUrl?: string;
  offMarketUrl?: string;
}

export interface AdvisorReportData {
  advisorName: string;
  advisorCompany: string;
  monthYear: string;       // e.g. "March 2026"
  activeDealsCount: number;
  totalBuyerInterest: number;
  movementsThisMonth: number;
  deals: ReportDeal[];
  frontendUrl: string;
  newBuyersLastMonth?: number;
}

// Colors (inlined since emails don't support CSS vars)
const C = {
  navy: '#17252A',
  tealPrimary: '#2B7A78',
  tealSecondary: '#3AAFA9',
  tealLight: '#DEF2F1',
  tealPale: '#f0faf9',
  white: '#FEFFFF',
  border: '#d4ecea',
  textPrimary: '#17252A',
  textSecondary: '#3d6065',
  textMuted: '#7ba5a8',
  activeBg: '#e8f9f8',
  activeText: '#0f5a58',
  passedText: '#999',
  loiBg: '#fff3cd',
  loiText: '#7a4f00',
  flagBg: '#fff3f0',
  flagBorder: '#f0b8ac',
  flagText: '#a02808',
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusPill(label: string, type: 'from' | 'active' | 'passed' | 'loi'): string {
  const styles: Record<string, string> = {
    from: `background:#f0f0f0;color:#666;`,
    active: `background:${C.activeBg};color:${C.activeText};`,
    passed: `background:#f5f5f5;color:#666;`,
    loi: `background:${C.loiBg};color:${C.loiText};`,
  };
  return `<span style="display:inline-block;padding:2px 9px;border-radius:4px;font-size:11px;font-weight:500;${styles[type]}">${escapeHtml(label)}</span>`;
}

function renderBuyersTable(buyers: ReportBuyer[], dealId: string, frontendUrl: string): string {
  if (buyers.length === 0) {
    return `<div style="padding:16px 20px;font-size:13px;color:${C.textMuted};text-align:center;">No active buyers</div>`;
  }

  const rows = buyers.map(b => {
    // Pre-fill the email body so the advisor just clicks send
    const emailSubject = encodeURIComponent(`Inactive Buyer: ${b.fullName} — ${b.companyName}`);
    const emailBody = encodeURIComponent(
      `Hi CIM Amplify Team,\n\nI'd like to flag that the following buyer does not appear to be actively engaging:\n\nName: ${b.fullName}\nCompany: ${b.companyName}\nInterested Since: ${b.interestedSince}\nDeal ID: ${dealId}\n\nPlease review.\n\nThank you`
    );
    const reportLink = `mailto:deals@amp-ven.com?subject=${emailSubject}&body=${emailBody}`;

    return `
    <tr style="border-bottom:1px solid #f0f7f6;">
      <td style="padding:10px 16px;font-size:13px;color:${C.textPrimary};vertical-align:middle;">
        <span style="font-weight:500;color:${C.navy};display:block;font-size:13px;">${escapeHtml(b.fullName)}</span>
        <span style="font-size:11px;color:${C.textMuted};display:block;">${escapeHtml(b.companyName)}</span>
      </td>
      <td style="padding:10px 16px;font-size:13px;color:${C.textPrimary};vertical-align:middle;">${escapeHtml(b.interestedSince)}</td>
    <td style="padding:10px 16px;text-align:right;vertical-align:middle;">
        ${(b.flaggedInactive ? `<span style="display:inline-block;margin-right:8px;padding:5px 10px;border-radius:999px;font-size:11px;font-weight:600;background:#fff1f0;color:#a02808;border:1px solid #f0b8ac;vertical-align:middle;">Flagged Inactive</span>` : '')}
        ${b.flaggedInactive ? '' : `<a href="${(b as any).flagInactiveUrl || reportLink}" style="display:inline-block;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;background:${C.flagBg};border:1.5px solid ${C.flagBorder};color:${C.flagText};text-decoration:none;white-space:nowrap;">Flag as Inactive</a>`}
      </td>
    </tr>
  `}).join('');

  return `
    <div style="padding:11px 20px 9px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:${C.textMuted};background:#fafcfc;border-bottom:1px solid ${C.border};">Active Buyers</div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#f7fafa;border-bottom:1px solid ${C.border};">
          <th style="padding:8px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:${C.textMuted};text-align:left;">Buyer</th>
          <th style="padding:8px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:${C.textMuted};text-align:left;">Interested Since</th>
          <th style="padding:8px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:${C.textMuted};text-align:right;">Action</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderMovementsTable(movements: BuyerMovement[], monthYear: string): string {
  if (movements.length === 0) return '';

  const rows = movements.map(m => {
    const fromType = m.fromStatus === 'Active' ? 'active' : 'from';
    const toType = m.toStatus === 'Active' ? 'active' : m.toStatus === 'Passed' ? 'passed' : 'loi';
    return `
      <tr style="border-bottom:1px solid #f0f7f6;">
        <td style="padding:10px 16px;font-size:13px;color:${C.textPrimary};vertical-align:middle;">
          <span style="font-weight:500;color:${C.navy};display:block;font-size:13px;">${escapeHtml(m.buyerName)}</span>
          <span style="font-size:11px;color:${C.textMuted};display:block;">${escapeHtml(m.buyerCompany)}</span>
        </td>
        <td style="padding:10px 16px;vertical-align:middle;">
          ${statusPill(m.fromStatus, fromType)}
          <span style="color:#bbb;margin:0 4px;">&rarr;</span>
          ${statusPill(m.toStatus, toType)}
        </td>
        <td style="padding:10px 16px;font-size:12px;color:${C.textMuted};white-space:nowrap;vertical-align:middle;">${escapeHtml(m.date)}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="padding:11px 20px 9px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:${C.textMuted};background:#fafcfc;border-top:1px solid ${C.border};border-bottom:1px solid ${C.border};">Buyer Movements &mdash; ${escapeHtml(monthYear)}</div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#f2f8f7;border-bottom:1px solid ${C.border};">
          <th style="padding:8px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:${C.textMuted};text-align:left;">Buyer</th>
          <th style="padding:8px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:${C.textMuted};text-align:left;">Movement</th>
          <th style="padding:8px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:${C.textMuted};text-align:left;">Date</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderDealCard(deal: ReportDeal, monthYear: string, frontendUrl: string): string {
  const isLoi = deal.status === 'loi';
  const badgeStyle = isLoi
    ? `background:${C.loiBg};color:${C.loiText};`
    : `background:${C.activeBg};color:${C.activeText};`;
  const badgeLabel = isLoi ? 'Under LOI' : 'Active Listing';

  const loiUrl = deal.loiUrl || `${frontendUrl}/seller-action/${encodeURIComponent(deal.id)}?action=loi`;
  const offMarketUrl = deal.offMarketUrl || `${frontendUrl}/seller-action/${encodeURIComponent(deal.id)}?action=off-market`;

  const loiBtnStyle = isLoi
    ? `opacity:0.5;cursor:default;background:${C.loiBg};border:1px solid #e8c84e;color:${C.loiText};`
    : `background:${C.loiBg};border:1px solid #e8c84e;color:${C.loiText};`;
  const loiBtnLabel = isLoi ? 'Currently Under LOI' : 'Mark as Under LOI';

  return `
    <div style="margin:0 36px 28px;background:${C.white};border-radius:12px;border:1px solid ${C.border};overflow:hidden;">
      <!-- Deal Header -->
      <div style="background:${C.tealPale};border-bottom:1px solid ${C.border};padding:16px 20px;">
        <table style="width:100%;">
          <tr>
            <td style="vertical-align:top;">
              <div style="font-family:'Georgia',serif;font-size:16px;color:${C.navy};line-height:1.3;margin-bottom:6px;">${escapeHtml(deal.title)}</div>
              <div style="font-size:12px;color:${C.textSecondary};">
                Revenue: <strong style="color:${C.textPrimary};">${escapeHtml(deal.revenue)}</strong>
                &nbsp;&nbsp;EBITDA: <strong style="color:${C.textPrimary};">${escapeHtml(deal.ebitda)}</strong>
                &nbsp;&nbsp;Listed: <strong style="color:${C.textPrimary};">${escapeHtml(deal.listedDate)}</strong>
              </div>
            </td>
            <td style="vertical-align:top;text-align:right;white-space:nowrap;">
              <span style="display:inline-block;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;letter-spacing:0.04em;${badgeStyle}">
                ${badgeLabel}
              </span>
            </td>
          </tr>
        </table>
      </div>

      <!-- Stats Row -->
      <table style="width:100%;border-collapse:collapse;border-bottom:1px solid ${C.border};">
        <tr>
          <td style="width:50%;padding:14px 20px;border-right:1px solid ${C.border};">
            <div style="font-family:'Georgia',serif;font-size:30px;line-height:1;margin-bottom:3px;color:${C.activeText};">${deal.activeBuyerCount}</div>
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;font-weight:500;color:${C.activeText};">Active Buyers</div>
          </td>
          <td style="width:50%;padding:14px 20px;">
            <div style="font-family:'Georgia',serif;font-size:30px;line-height:1;margin-bottom:3px;color:${C.passedText};">${deal.passedCount}</div>
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;font-weight:500;color:${C.passedText};">Passed</div>
          </td>
        </tr>
      </table>

      <!-- CTA Buttons — use table layout for email client compatibility (no flexbox) -->
      <div style="padding:12px 20px;background:#fafefe;border-bottom:1px solid ${C.border};">
        <table style="border-collapse:collapse;">
          <tr>
            <td style="padding-right:8px;">
              <a href="${loiUrl}" style="display:inline-block;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;${loiBtnStyle}">${loiBtnLabel}</a>
            </td>
            <td>
              <a href="${offMarketUrl}" style="display:inline-block;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;background:#f5f5f5;border:1px solid #ccc;color:#444;">Mark as Off Market</a>
            </td>
          </tr>
        </table>
      </div>

      <!-- Active Buyers Table -->
      ${renderBuyersTable(deal.activeBuyers, deal.id, frontendUrl)}

      <!-- Buyer Movements -->
      ${renderMovementsTable(deal.movements, monthYear)}
    </div>
  `;
}

export function advisorMonthlyReportTemplate(data: AdvisorReportData): string {
  const dealCards = data.deals.map(d => renderDealCard(d, data.monthYear, data.frontendUrl)).join('');
  const dealCount = data.deals.length;

  const htmlContent = `
    <p style="font-size:13px;color:${C.textMuted};margin-bottom:4px;">${escapeHtml(data.advisorCompany)} &middot; ${escapeHtml(data.monthYear)}</p>

    <!-- SUMMARY STRIP -->
    <div style="background:${C.tealPrimary};border-radius:8px;padding:16px;margin:16px 0;">
      <table style="width:100%;">
        <tr>
          <td style="text-align:center;border-right:1px solid #5f9795;width:33%;">
            <div style="font-size:28px;font-weight:600;color:#fff;line-height:1;">${data.activeDealsCount}</div>
            <div style="font-size:11px;color:${C.tealLight};margin-top:3px;text-transform:uppercase;letter-spacing:0.1em;">Active Deals</div>
          </td>
          <td style="text-align:center;border-right:1px solid #5f9795;width:34%;">
            <div style="font-size:28px;font-weight:600;color:#fff;line-height:1;">${data.totalBuyerInterest}</div>
            <div style="font-size:11px;color:${C.tealLight};margin-top:3px;text-transform:uppercase;letter-spacing:0.1em;">Buyer Interest</div>
          </td>
          <td style="text-align:center;width:33%;">
            <div style="font-size:28px;font-weight:600;color:#fff;line-height:1;">${data.movementsThisMonth}</div>
            <div style="font-size:11px;color:${C.tealLight};margin-top:3px;text-transform:uppercase;letter-spacing:0.1em;">Movements</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- SECTION HEADING -->
    <table style="width:100%;margin-top:20px;"><tr>
      <td><span style="font-size:16px;font-weight:600;color:${C.navy};">Your Active Listings</span></td>
      <td style="text-align:right;"><span style="font-size:12px;color:${C.tealPrimary};font-weight:500;background:${C.tealPale};border:1px solid ${C.border};border-radius:20px;padding:3px 12px;">${dealCount} deal${dealCount !== 1 ? 's' : ''}</span></td>
    </tr></table>

    <!-- DEAL CARDS -->
    ${dealCards}

    ${dealCount === 0 ? `
      <div style="margin-top:16px;padding:28px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;text-align:center;">
        <p style="margin:0;font-size:16px;font-weight:600;color:${C.navy};">We would love to host your new deals!</p>
        <p style="margin:12px 0 20px;color:#6b7280;font-size:14px;line-height:1.6;">Last month we added <strong style="color:${C.tealPrimary};">${data.newBuyersLastMonth || 0} new buyers</strong> to the CIM Amplify platform. Your next great buyer could be among them.</p>
        <a href="${data.frontendUrl}/seller/seller-form" style="display:inline-block;padding:12px 28px;border-radius:6px;font-size:14px;font-weight:600;background:${C.tealSecondary};color:#fff;text-decoration:none;">Add a Deal</a>
      </div>
    ` : ''}

    <!-- Dashboard CTA -->
    <div style="margin-top:20px;text-align:center;padding:16px;border:0.5px dashed #ccc;border-radius:10px;">
      <div><a href="${data.frontendUrl}/seller/dashboard" style="display:inline-block;font-size:13px;font-weight:500;background:${C.tealPrimary};color:#fff;padding:10px 28px;border-radius:6px;text-decoration:none;">Go to Advisor Dashboard</a></div>
    </div>
  `;

  const { genericEmailTemplate } = require('./generic-email.template');
  return genericEmailTemplate(
    'Your Monthly Deal Activity Report',
    data.advisorName.split(' ')[0] || data.advisorName,
    htmlContent,
  );
}
