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

function formatSavedAt(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(LOCALE, {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

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

/** SEYPOS / Sewoo PRP-320 and similar 80 mm ticket printers */
const THERMAL_PRINTER_PATTERNS = ['prp-320', 'prp320', 'seypos', 'sewoo'];

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
  const match = physical.find((p) => isThermalReceiptPrinter(p.name));
  return match ? match.name : null;
}

function ticketLayoutCss(thermal) {
  if (thermal) {
    return `
    @page { size: 80mm auto; margin: 2mm; }
    body { font-size: 10pt; }
    .shop { font-size: 13pt !important; }
    .total-row { font-size: 12pt !important; }
    `;
  }
  return `
    @page { size: A5 portrait; margin: 10mm 12mm; }
  `;
}

function getElectronPrintOptions(deviceName) {
  if (isThermalReceiptPrinter(deviceName)) {
    return {
      pageSize: { width: 80000, height: 297000 },
      margins: {
        marginType: 'custom',
        top: 0.08,
        bottom: 0.08,
        left: 0.08,
        right: 0.08,
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
    throw new Error('Aucune imprimante detectee sur ce PC.');
  }

  const fromQuery = findPrinterByQuery(printers, preferredName);
  if (fromQuery) {
    return fromQuery;
  }

  if (preferredName) {
    throw new Error(
      `Imprimante « ${preferredName} » introuvable. Verifiez le nom dans Parametres Windows > Imprimantes ou dans PRINT_PRINTER (.env).`,
    );
  }

  const receiptPrinter = findAutoReceiptPrinter(printers);
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
    'Imprimante ticket introuvable. Installez le pilote SEYPOS PRP-320 (80 mm), connectez l imprimante, puis definissez PRINT_PRINTER=PRP-320 dans caisse-desktop\\.env',
  );
}

function buildReceiptHtml(order, options = {}) {
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
  const shopName = options.shopName || 'Caisse';
  const periodLabel = options.periodLabel || "Aujourd'hui";
  const list = Array.isArray(orders) ? orders : [];
  const grandTotal = list.reduce((sum, order) => sum + orderTotal(order), 0);

  const rowsHtml = list
    .map((order) => {
      const total = orderTotal(order);
      return `
        <tr>
          <td class="col-id">#${escapeHtml(order.id)}</td>
          <td class="col-total">${formatMoney(total)}</td>
        </tr>`;
    })
    .join('');

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
    .subtitle { text-align: center; font-size: 10pt; color: #444; margin: 4px 0 14px; }
    .period { text-align: center; font-weight: 600; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 6px 4px; border-bottom: 1px solid #ddd; }
    th { font-size: 9pt; text-transform: uppercase; color: #555; text-align: left; }
    .col-total { text-align: right; font-weight: 600; white-space: nowrap; }
    .summary-footer {
      margin-top: 14px;
      padding-top: 10px;
      border-top: 2px solid #111;
    }
    .summary-footer div {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .summary-footer .grand {
      font-size: 13pt;
      font-weight: 700;
    }
    .footer {
      margin-top: 16px;
      text-align: center;
      font-size: 9.5pt;
      color: #555;
    }
  </style>
</head>
<body>
  <div class="ticket">
    <p class="shop">${escapeHtml(shopName)}</p>
    <p class="subtitle">Recapitulatif des ventes</p>
    <p class="period">${escapeHtml(periodLabel)}</p>
    <table>
      <thead>
        <tr>
          <th>Vente</th>
          <th class="col-total">Total</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="2">Aucune vente</td></tr>'}
      </tbody>
    </table>
    <div class="summary-footer">
      <div><span>Nombre de ventes</span><strong>${list.length}</strong></div>
      <div class="grand"><span>TOTAL</span><span>${formatMoney(grandTotal)}</span></div>
    </div>
    <p class="footer">Totaux uniquement — sans detail articles</p>
  </div>
</body>
</html>`;
}

function printHtmlDocument(buildHtml, options = {}) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 320,
      height: 800,
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
        setTimeout(() => {
          const deviceName = resolvedDeviceName;
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
        }, 200);
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
