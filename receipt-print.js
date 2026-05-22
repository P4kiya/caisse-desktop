const { BrowserWindow } = require('electron');

const LOCALE = 'fr-FR';
const CURRENCY_SUFFIX = ' DH';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return '0,00';
  return (
    num.toLocaleString(LOCALE, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + CURRENCY_SUFFIX
  );
}

/** Sans espaces speciaux / locale — lisible sur pilote Generic Text Only */
function formatMoneyPlain(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return '0,00 DH';
  const fixed = Math.abs(num).toFixed(2).replace('.', ',');
  const sign = num < 0 ? '-' : '';
  return `${sign}${fixed} DH`;
}

function formatSavedAt(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(LOCALE, {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

function formatSavedAtPlain(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const THERMAL_FEED_MM_BOTTOM = 18;

function orderTotal(order) {
  if (order.total != null) return Number(order.total);
  return (order.items || []).reduce(
    (sum, item) => sum + Number(item.price) * Number(item.quantity),
    0,
  );
}

function isVirtualPrinterName(name) {
  const n = String(name || '').toLowerCase();
  return (
    n.includes('pdf') ||
    n.includes('xps') ||
    n.includes('onenote') ||
    n.includes('fax') ||
    n.includes('microsoft print') ||
    n.includes('send to') ||
    n.includes('document writer')
  );
}

/** 80 mm thermal ticket printers (ESC/POS via pilote Windows) */
const THERMAL_PRINTER_PATTERNS = [
  'wd8260',
  'wd-8260',
  'wdlink',
  'wdl8260',
  'prp-320',
  'prp320',
  'seypos',
  'sewoo',
  'pos-80',
  'thermal receipt',
];

function printerNameMatchesPatterns(name, patterns) {
  const normalized = String(name || '').toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern));
}

function isThermalReceiptPrinter(name) {
  return printerNameMatchesPatterns(name, THERMAL_PRINTER_PATTERNS);
}

function getPhysicalPrinters(printers) {
  return (printers || []).filter((p) => !isVirtualPrinterName(p.name));
}

function findPrinterByQuery(printers, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) {
    return null;
  }

  const physical = getPhysicalPrinters(printers);
  const exact = physical.find((p) => p.name.toLowerCase() === needle);
  if (exact) {
    return exact.name;
  }

  const partial = physical.find((p) => p.name.toLowerCase().includes(needle));
  if (partial) {
    return partial.name;
  }

  return physical.find((p) => needle.includes(p.name.toLowerCase()))?.name || null;
}

function findAutoReceiptPrinter(printers) {
  const physical = getPhysicalPrinters(printers);
  for (const pattern of THERMAL_PRINTER_PATTERNS) {
    const match = physical.find((p) =>
      p.name.toLowerCase().includes(pattern),
    );
    if (match) {
      return match.name;
    }
  }
  return null;
}

function ticketLayoutCss(thermal) {
  if (thermal) {
    return `
    @page { size: 80mm auto; margin: 0 1mm 8mm 1mm; }
    body { margin: 0; padding: 0; }
    `;
  }
  return `
    @page { size: A5 portrait; margin: 10mm 12mm; }
  `;
}

function thermalTicketStyles() {
  return `
    ${ticketLayoutCss(true)}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      margin: 0;
      padding: 0 3mm;
      font-family: Arial, "Segoe UI", Helvetica, sans-serif;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.45;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .ticket { width: 100%; max-width: 72mm; }
    .shop {
      text-align: center;
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 0.06em;
      margin-bottom: 6px;
    }
    .subtitle {
      font-size: 15px;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .line {
      font-size: 14px;
      font-weight: 700;
      margin: 5px 0;
    }
    .rule {
      border: none;
      border-top: 2px solid #000;
      margin: 10px 0;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 6px;
      font-size: 14px;
      font-weight: 700;
      margin: 6px 0;
    }
    .row .value {
      font-weight: 800;
      white-space: nowrap;
      text-align: right;
      flex-shrink: 0;
    }
    .row-total {
      font-size: 16px;
      font-weight: 800;
      margin-top: 8px;
    }
    .footer {
      text-align: left;
      font-size: 13px;
      font-weight: 700;
      margin-top: 10px;
    }
    .feed-after {
      display: block;
      height: ${THERMAL_FEED_MM_BOTTOM}mm;
      min-height: ${THERMAL_FEED_MM_BOTTOM}mm;
    }
  `;
}

function wrapThermalHtml(ticketBodyHtml) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <style>${thermalTicketStyles()}</style>
</head>
<body>
  <div class="ticket">${ticketBodyHtml}</div>
  <div class="feed-after"></div>
</body>
</html>`;
}

function thermalRowHtml(label, value, extraClass = '') {
  return `<div class="row ${extraClass}"><span>${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`;
}

function buildThermalReceiptHtml(order, options = {}) {
  const shopName = (options.shopName || 'Caisse').toUpperCase();
  const items = order.items || [];
  const total = orderTotal(order);
  const itemsHtml = items
    .map((item) => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.price) || 0;
      const lineTotal = price * qty;
      return thermalRowHtml(
        `${qty} x ${formatMoneyPlain(price)}`,
        formatMoneyPlain(lineTotal),
      );
    })
    .join('');

  return wrapThermalHtml(`
    <p class="shop">${escapeHtml(shopName)}</p>
    <p class="subtitle">TICKET DE VENTE</p>
    <hr class="rule" />
    <p class="line">Vente #${escapeHtml(order.id)}</p>
    <p class="line">${escapeHtml(formatSavedAtPlain(order.savedAt))}</p>
    <hr class="rule" />
    ${itemsHtml}
    <hr class="rule" />
    ${thermalRowHtml('TOTAL', formatMoneyPlain(total), 'row-total')}
    <hr class="rule" />
    <p class="footer">Merci de votre visite</p>
  `);
}

function getSummaryTitles(options = {}) {
  const isMonth = options.summaryKind === 'month';
  return {
    thermalTitle: isMonth ? 'RECAP DU MOIS' : 'RECAP DU JOUR',
    htmlSubtitle: isMonth ? 'Recap du mois' : 'Recap du jour',
  };
}

function buildThermalDaySummaryHtml(orders, options = {}) {
  const shopName = (options.shopName || 'Caisse').toUpperCase();
  const periodLabel = options.periodLabel || "Aujourd'hui";
  const { thermalTitle } = getSummaryTitles(options);
  const list = Array.isArray(orders) ? orders : [];
  const grandTotal = list.reduce((sum, order) => sum + orderTotal(order), 0);
  const timeLine = options.timeLabel
    ? `<p class="line">${escapeHtml(options.timeLabel)}</p>`
    : '';

  return wrapThermalHtml(`
    <p class="shop">${escapeHtml(shopName)}</p>
    <p class="subtitle">${escapeHtml(thermalTitle)}</p>
    <hr class="rule" />
    <p class="line">${escapeHtml(periodLabel)}</p>
    ${timeLine}
    ${thermalRowHtml('Nombre de ventes', String(list.length))}
    ${thermalRowHtml('Recette', formatMoneyPlain(grandTotal), 'row-total')}
    <hr class="rule" />
  `);
}

function getElectronPrintOptions(deviceName) {
  if (isThermalReceiptPrinter(deviceName)) {
    return {
      pageSize: { width: 80000, height: 297000 },
      margins: {
        marginType: 'custom',
        top: 0.05,
        bottom: 0.7,
        left: 0.04,
        right: 0.04,
      },
    };
  }
  return {
    pageSize: 'A5',
    margins: {
      marginType: 'custom',
      top: 0.4,
      bottom: 0.4,
      left: 0.45,
      right: 0.45,
    },
  };
}

async function resolvePhysicalPrinter(webContents, preferredName) {
  const printers = await webContents.getPrintersAsync();
  if (!Array.isArray(printers) || printers.length === 0) {
    throw new Error(
      'Aucune imprimante detectee sur ce PC. Branchez l imprimante USB, puis lancez (admin) : powershell -File C:\\caisse\\setup\\scripts\\Install-Pos80Printer.ps1',
    );
  }

  const fromQuery = findPrinterByQuery(printers, preferredName);
  if (fromQuery) {
    return fromQuery;
  }

  const receiptPrinter = findAutoReceiptPrinter(printers);
  if (preferredName && receiptPrinter) {
    return receiptPrinter;
  }

  if (preferredName) {
    const physical = getPhysicalPrinters(printers);
    const names = physical.map((p) => p.name).join(' | ');
    throw new Error(
      `Imprimante « ${preferredName} » introuvable. Detectees : ${names || 'aucune'}. Mettez PRINT_PRINTER=WD8260 dans .env (nom partiel) ou renommez l imprimante en POS-80.`,
    );
  }

  if (receiptPrinter) {
    return receiptPrinter;
  }

  const defaultPrinter = printers.find((p) => p.isDefault);
  if (defaultPrinter && !isVirtualPrinterName(defaultPrinter.name)) {
    return defaultPrinter.name;
  }

  const physical = getPhysicalPrinters(printers)[0];
  if (physical) {
    return physical.name;
  }

  throw new Error(
    'Imprimante ticket introuvable. Lancez Install-Pos80Printer.ps1 (C:\\caisse\\setup\\scripts), puis definissez PRINT_PRINTER=POS-80 dans .env',
  );
}

function buildReceiptHtml(order, options = {}) {
  if (options.thermal) {
    return buildThermalReceiptHtml(order, options);
  }

  const shopName = options.shopName || 'Caisse';
  const items = order.items || [];
  const total = orderTotal(order);
  const linesHtml = items
    .map((item) => {
      const lineTotal = Number(item.price) * Number(item.quantity);
      return `
        <tr>
          <td class="col-qty">${escapeHtml(item.quantity)}</td>
          <td class="col-desc">${formatMoney(item.price)} × ${escapeHtml(item.quantity)}</td>
          <td class="col-total">${formatMoney(lineTotal)}</td>
        </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>Ticket #${escapeHtml(order.id)}</title>
  <style>
    ${ticketLayoutCss(options.thermal)}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 11pt;
      color: #111;
      line-height: 1.35;
    }
    .ticket {
      max-width: 100%;
    }
    .shop {
      text-align: center;
      font-size: 16pt;
      font-weight: 700;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }
    .subtitle {
      text-align: center;
      font-size: 10pt;
      color: #444;
      margin-bottom: 14px;
    }
    .meta {
      font-size: 10pt;
      margin-bottom: 12px;
      border-bottom: 1px dashed #999;
      padding-bottom: 10px;
    }
    .meta div {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    th {
      text-align: left;
      font-size: 9pt;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #555;
      border-bottom: 1px solid #333;
      padding: 4px 0;
    }
    th.col-total, td.col-total { text-align: right; }
    th.col-qty, td.col-qty { width: 12%; text-align: center; }
    td {
      padding: 6px 0;
      vertical-align: top;
      border-bottom: 1px dotted #ccc;
      font-size: 10.5pt;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 14pt;
      font-weight: 700;
      margin-top: 8px;
      padding-top: 10px;
      border-top: 2px solid #111;
    }
    .footer {
      margin-top: 18px;
      text-align: center;
      font-size: 9.5pt;
      color: #555;
    }
  </style>
</head>
<body>
  <div class="ticket">
    <p class="shop">${escapeHtml(shopName)}</p>
    <p class="subtitle">Ticket de vente</p>
    <div class="meta">
      <div><span>N° vente</span><strong>#${escapeHtml(order.id)}</strong></div>
      <div><span>Date</span><span>${escapeHtml(formatSavedAt(order.savedAt))}</span></div>
    </div>
    <table>
      <thead>
        <tr>
          <th class="col-qty">Qté</th>
          <th>Article</th>
          <th class="col-total">Montant</th>
        </tr>
      </thead>
      <tbody>
        ${linesHtml}
      </tbody>
    </table>
    <div class="total-row">
      <span>TOTAL</span>
      <span>${formatMoney(total)}</span>
    </div>
    <p class="footer">Merci de votre visite</p>
  </div>
</body>
</html>`;
}

function buildDaySummaryReceiptHtml(orders, options = {}) {
  if (options.thermal) {
    return buildThermalDaySummaryHtml(orders, options);
  }

  const shopName = options.shopName || 'Caisse';
  const periodLabel = options.periodLabel || "Aujourd'hui";
  const { htmlSubtitle } = getSummaryTitles(options);
  const list = Array.isArray(orders) ? orders : [];
  const grandTotal = list.reduce((sum, order) => sum + orderTotal(order), 0);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>Recap ${escapeHtml(periodLabel)}</title>
  <style>
    ${ticketLayoutCss(options.thermal)}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 11pt;
      color: #111;
      line-height: 1.35;
    }
    .ticket { max-width: 100%; }
    .shop { font-size: 14pt; font-weight: 700; text-align: center; }
    .subtitle { font-size: 10pt; color: #444; margin: 4px 0 14px; }
    .period { font-weight: 600; margin-bottom: 16px; }
    .summary-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
      font-size: 11pt;
    }
    .summary-row.grand {
      font-size: 14pt;
      font-weight: 700;
      margin-top: 12px;
      padding-top: 10px;
      border-top: 2px solid #111;
    }
  </style>
</head>
<body>
  <div class="ticket">
    <p class="shop">${escapeHtml(shopName)}</p>
    <p class="subtitle">${escapeHtml(htmlSubtitle)}</p>
    <p class="period">${escapeHtml(periodLabel)}</p>
    ${options.timeLabel ? `<p class="period">${escapeHtml(options.timeLabel)}</p>` : ''}
    <div class="summary-row"><span>Nombre de ventes</span><strong>${list.length}</strong></div>
    <div class="summary-row grand"><span>Recette</span><span>${formatMoney(grandTotal)}</span></div>
  </div>
</body>
</html>`;
}

function printHtmlDocument(buildHtml, options = {}) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 280,
      height: 720,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const cleanup = () => {
      if (!win.isDestroyed()) win.destroy();
    };

    const fail = (err) => {
      cleanup();
      reject(err);
    };

    win.webContents.on('did-fail-load', (_event, code, description) => {
      fail(new Error(description || `Chargement ticket (${code})`));
    });

    let printStage = 'init';
    let resolvedDeviceName = '';

    win.webContents.on('did-finish-load', () => {
      if (printStage === 'init') {
        printStage = 'loading';
        setTimeout(async () => {
          try {
            resolvedDeviceName = await resolvePhysicalPrinter(
              win.webContents,
              options.deviceName,
            );
            const forceThermal = process.env.PRINT_THERMAL !== '0';
            const thermal =
              options.thermal === true ||
              (options.thermal !== false &&
                forceThermal &&
                isThermalReceiptPrinter(resolvedDeviceName));

            const html = buildHtml({ ...options, thermal });
            const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
            await win.loadURL(dataUrl);
          } catch (err) {
            fail(err);
          }
        }, 150);
        return;
      }

      if (printStage === 'loading') {
        printStage = 'printing';
        const deviceName = resolvedDeviceName;
        const thermalPrint = isThermalReceiptPrinter(deviceName);
        const printDelayMs = thermalPrint ? 450 : 200;
        setTimeout(() => {
          const layout = getElectronPrintOptions(deviceName);
          const printOptions = {
            silent: true,
            deviceName,
            printBackground: true,
            ...layout,
          };

          win.webContents.print(printOptions, (success, failureReason) => {
            cleanup();
            if (success) {
              resolve({
                ok: true,
                deviceName,
                thermal: isThermalReceiptPrinter(deviceName),
              });
            } else {
              reject(new Error(failureReason || 'Impression annulee'));
            }
          });
        }, printDelayMs);
      }
    });

    win.loadURL('about:blank').catch(fail);
  });
}

function printOrderReceipt(order, options = {}) {
  if (!order || !order.id) {
    return Promise.reject(new Error('Vente invalide pour impression'));
  }
  return printHtmlDocument((opts) => buildReceiptHtml(order, opts), options);
}

function printDaySummaryReceipt(orders, options = {}) {
  const list = Array.isArray(orders) ? orders : [];
  if (!list.length) {
    return Promise.reject(new Error('Aucune vente a imprimer.'));
  }
  return printHtmlDocument(
    (opts) => buildDaySummaryReceiptHtml(list, opts),
    options,
  );
}

module.exports = {
  printOrderReceipt,
  printDaySummaryReceipt,
  buildReceiptHtml,
  buildDaySummaryReceiptHtml,
  resolvePhysicalPrinter,
  isVirtualPrinterName,
  isThermalReceiptPrinter,
  THERMAL_PRINTER_PATTERNS,
};
