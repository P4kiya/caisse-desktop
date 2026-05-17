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

async function resolvePhysicalPrinter(webContents, preferredName) {
  const printers = await webContents.getPrintersAsync();
  if (!Array.isArray(printers) || printers.length === 0) {
    throw new Error('Aucune imprimante detectee sur ce PC.');
  }

  if (preferredName) {
    const preferred = printers.find((p) => p.name === preferredName);
    if (preferred) {
      if (isVirtualPrinterName(preferred.name)) {
        throw new Error(
          `L'imprimante « ${preferred.name} » est une imprimante PDF virtuelle. Utilisez une imprimante physique.`,
        );
      }
      return preferred.name;
    }
  }

  const defaultPrinter = printers.find((p) => p.isDefault);
  if (defaultPrinter && !isVirtualPrinterName(defaultPrinter.name)) {
    return defaultPrinter.name;
  }

  const physical = printers.find((p) => !isVirtualPrinterName(p.name));
  if (physical) {
    return physical.name;
  }

  throw new Error(
    'Imprimante physique introuvable. Dans Windows : Parametres > Bluetooth et appareils > Imprimantes, definissez votre imprimante ticket (pas « Microsoft Print to PDF ») comme imprimante par defaut. Vous pouvez aussi ajouter PRINT_PRINTER=nom exact dans caisse-desktop\\.env',
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
    @page {
      size: A5 portrait;
      margin: 10mm 12mm;
    }
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

function printOrderReceipt(order, options = {}) {
  if (!order || !order.id) {
    return Promise.reject(new Error('Vente invalide pour impression'));
  }

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 420,
      height: 595,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const html = buildReceiptHtml(order, options);
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

    const cleanup = () => {
      if (!win.isDestroyed()) win.destroy();
    };

    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const deviceName = await resolvePhysicalPrinter(
            win.webContents,
            options.deviceName,
          );

          const printOptions = {
            silent: true,
            deviceName,
            printBackground: true,
            pageSize: 'A5',
            margins: {
              marginType: 'custom',
              top: 0.4,
              bottom: 0.4,
              left: 0.45,
              right: 0.45,
            },
          };

          win.webContents.print(printOptions, (success, failureReason) => {
            cleanup();
            if (success) {
              resolve({ ok: true, deviceName });
            } else {
              reject(new Error(failureReason || 'Impression annulee'));
            }
          });
        } catch (err) {
          cleanup();
          reject(err);
        }
      }, 200);
    });

    win.webContents.once('did-fail-load', (_event, code, description) => {
      cleanup();
      reject(new Error(description || `Chargement ticket (${code})`));
    });

    win.loadURL(dataUrl).catch((err) => {
      cleanup();
      reject(err);
    });
  });
}

module.exports = {
  printOrderReceipt,
  buildReceiptHtml,
  resolvePhysicalPrinter,
  isVirtualPrinterName,
};
