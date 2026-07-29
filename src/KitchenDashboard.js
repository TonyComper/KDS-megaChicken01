import React, { useEffect, useState, useRef } from 'react';

export default function KitchenDashboard() {
  const [restaurantConfig, setRestaurantConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');

  const [orders, setOrders] = useState([]);
  const [accepted, setAccepted] = useState(new Set(JSON.parse(localStorage.getItem('acceptedOrders') || '[]')));
  const [seenOrders, setSeenOrders] = useState(new Set(JSON.parse(localStorage.getItem('seenOrders') || '[]')));
  const [seenMessages, setSeenMessages] = useState(new Set(JSON.parse(localStorage.getItem('seenMessages') || '[]')));
  const [readMessages, setReadMessages] = useState(new Set(JSON.parse(localStorage.getItem('readMessages') || '[]')));
  const [showReadMessages, setShowReadMessages] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [showAccepted, setShowAccepted] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedEntries, setArchivedEntries] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [adjustedTotals, setAdjustedTotals] = useState({});
  const [sendingPaymentLinks, setSendingPaymentLinks] = useState({});
  const [confirmOrder, setConfirmOrder] = useState(null);

  const alarmAudio = useRef(null);
  const messageAudio = useRef(null);
  const paidAudio = useRef(null);
  const paidOrdersRef = useRef(new Set(JSON.parse(localStorage.getItem('paidOrders') || '[]')));

const getLocationIdFromUrl = () => {
  const searchParams = new URLSearchParams(window.location.search);

  const queryLocation = String(
    searchParams.get('location') || ''
  )
    .trim()
    .toUpperCase();

  if (/^[A-Z0-9]{6}$/.test(queryLocation)) {
    return queryLocation;
  }

  const pathParts = String(window.location.pathname || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);

  const pathLocation = String(
    pathParts[pathParts.length - 1] || ''
  )
    .trim()
    .toUpperCase();

  if (/^[A-Z0-9]{6}$/.test(pathLocation)) {
    return pathLocation;
  }

  return '';
};

  const LOCATION_ID = getLocationIdFromUrl();

  // Per-restaurant setting loaded from Firebase.
  // Supported values: VOICE or DASHBOARD.
  const PAYMENT_LINK_MODE = String(
    restaurantConfig?.paymentLinkMode ||
      restaurantConfig?.kitchenDashboard?.paymentLinkMode ||
      'VOICE'
  ).toUpperCase();

  const FIREBASE_ORDERS_URL = 'https://privitipizza41-default-rtdb.firebaseio.com/orders';
  const FIREBASE_ARCHIVE_URL = 'https://privitipizza41-default-rtdb.firebaseio.com/archive';
  const FIREBASE_LOCATIONS_URL = 'https://privitipizza41-default-rtdb.firebaseio.com/locations';
  const CREATE_CHECKOUT_LINK_URL = 'https://createcheckoutlink-u6d6o7mcnq-uc.a.run.app/createCheckoutLink';

  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  const isBlank = (value) => {
    return value === undefined || value === null || String(value).trim() === '';
  };

  const formatPhoneNumber = (value) => {
    if (isBlank(value)) return 'N/A';

    const digits = String(value).replace(/\D/g, '');

    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    if (digits.length === 11 && digits.startsWith('1')) {
      return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
    }

    return String(value);
  };

  const getItemizedItems = (order) => {
    const rawItems =
      order?.itemizedItems ||
      order?.ItemizedItems ||
      order?.['Itemized Items'];

    if (!rawItems) return [];

    if (Array.isArray(rawItems)) {
      return rawItems.filter(Boolean);
    }

    if (typeof rawItems === 'object') {
      return Object.values(rawItems).filter(Boolean);
    }

    if (typeof rawItems === 'string') {
      try {
        const parsed = JSON.parse(rawItems);

        if (Array.isArray(parsed)) {
          return parsed.filter(Boolean);
        }

        if (parsed && typeof parsed === 'object') {
          return Object.values(parsed).filter(Boolean);
        }
      } catch (err) {
        console.warn('Could not parse itemizedItems JSON string:', err);
      }
    }

    return [];
  };

  const formatMoney = (value) => {
    const number = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));

    if (!Number.isFinite(number)) return 'N/A';

    return `$${number.toFixed(2)}`;
  };

  const isCreditDebitOrder = (order) => {
    const orderType = String(order?.['Order Type'] || '').toUpperCase().trim();
    const paymentMethod = String(order?.paymentMethod || '').toUpperCase().trim();

    return orderType === 'PICK UP' && paymentMethod === 'CREDIT/DEBIT';
  };

  const parseMoneyValue = (value) => {
    const cleaned = String(value ?? '').replace(/[^0-9.]/g, '');
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : NaN;
  };

  const getEditableTotal = (order) => {
    return adjustedTotals[order.id] ?? order['Total Price'] ?? '';
  };

  const getOrderAlertKey = (order) => {
    return [
      order.id || '',
      order['Order ID'] || '',
      order['Order Date'] || '',
      order['Customer Contact Number'] || '',
      order['Order Items'] || '',
      order['Total Price'] || ''
    ].join('|');
  };

  const getParsedTimeMs = (rawDateStr) => {
    if (!rawDateStr) return NaN;

    let cleanStr = String(rawDateStr).replace(/\s+at\s+/i, ' ').replace(/\s*\([^)]*\)/g, '').trim();

    const parsed = new Date(cleanStr).getTime();
    return Number.isFinite(parsed) ? parsed : NaN;
  };

  const isPaidOrder = (order) => {
    const status = String(order?.status || order?.Status || '').toUpperCase().trim();
    return status === 'PAID';
  };

  const shouldAutoArchiveOrder = (entry) => {
    if (!entry) return false;
    if (entry['Order Type'] === 'MESSAGE') return false;

    const orderTimeMs = getParsedTimeMs(entry['Order Date']);
    const orderAgeMs = Number.isFinite(orderTimeMs) ? Date.now() - orderTimeMs : 0;

    if (orderAgeMs > TWENTY_FOUR_HOURS_MS) return true;

    const status = String(entry.status || entry.Status || '').toUpperCase().trim();

    if (status === 'PENDING') {
      const pendingStartedRaw =
        entry.paymentLinkSentAt ||
        entry.paymentLinkRequestedAt ||
        entry.pendingAt ||
        entry.createdAt ||
        entry['Order Date'];

      const pendingStartedMs = getParsedTimeMs(pendingStartedRaw);
      const pendingAgeMs = Number.isFinite(pendingStartedMs) ? Date.now() - pendingStartedMs : 0;

      if (pendingAgeMs >TWENTY_FOUR_HOURS_MS) return true;
    }

    return false;
  };

  const sendPaymentLink = async (order, skipConfirm = false) => {
    try {
      if (!isCreditDebitOrder(order)) {
        alert('Only PICK UP orders with CREDIT/DEBIT can send payment links.');
        return;
      }

      const totalInput = getEditableTotal(order);
      const totalPrice = parseMoneyValue(totalInput);

      if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
        alert('Total must be greater than $0.00');
        return;
      }

      if (totalPrice < 0.10) {
        alert('Total must be at least $0.10');
        return;
      }

      const phoneNumber = order['Customer Contact Number'];
      const orderDetails = order['Order Items'];

      if (isBlank(phoneNumber)) {
        alert('Customer phone number is missing.');
        return;
      }

      if (isBlank(orderDetails)) {
        alert('Order details are missing.');
        return;
      }

      if (!skipConfirm) {
        setConfirmOrder({ order, totalPrice });
        return;
      }

      setSendingPaymentLinks((prev) => ({ ...prev, [order.id]: true }));

      await fetch(`${FIREBASE_ORDERS_URL}/${order.id}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          'Total Price': totalPrice,
          status: 'pending',
          paymentLinkStatus: 'sending',
          paymentLinkRequestedAt: new Date().toISOString()
        })
      });

      const payload = {
        orderID: order['Order ID'] || order.id,
        orderId: order['Order ID'] || order.id,
        firebaseOrderId: order.id,
        totalPrice,
        orderDetails,
        phoneNumber,
        locationID: order.locationID || LOCATION_ID
      };

      const res = await fetch(CREATE_CHECKOUT_LINK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      let result = {};
      try {
        result = await res.json();
      } catch (e) {
        result = {};
      }

      if (!res.ok) {
        await fetch(`${FIREBASE_ORDERS_URL}/${order.id}.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'failed',
            paymentLinkStatus: 'failed',
            paymentLinkError: result?.error || result?.message || 'Failed to create payment link',
            paymentLinkFailedAt: new Date().toISOString()
          })
        });

        alert(result?.error || result?.message || 'Failed to send payment link.');
        return;
      }

      await fetch(`${FIREBASE_ORDERS_URL}/${order.id}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          'Total Price': totalPrice,
          status: 'pending',
          paymentLinkSent: true,
          paymentLinkStatus: 'sent',
          paymentLinkSentAt: new Date().toISOString(),
          checkoutSessionId: result?.checkoutSessionId || result?.sessionId || order.checkoutSessionId || '',
          checkoutUrl: result?.checkoutUrl || result?.url || order.checkoutUrl || ''
        })
      });

      setOrders((prev) =>
        prev.map((item) =>
          item.id === order.id
            ? {
                ...item,
                'Total Price': totalPrice,
                status: 'pending',
                paymentLinkSent: true,
                paymentLinkStatus: 'sent',
                paymentLinkSentAt: new Date().toISOString(),
                checkoutSessionId: result?.checkoutSessionId || result?.sessionId || item.checkoutSessionId || '',
                checkoutUrl: result?.checkoutUrl || result?.url || item.checkoutUrl || ''
              }
            : item
        )
      );

      alert('Payment link sent successfully.');
    } catch (err) {
      console.error('❌ Error sending payment link:', err);
      alert('Error sending payment link.');
    } finally {
      setSendingPaymentLinks((prev) => ({ ...prev, [order.id]: false }));
    }
  };

  const isInvalidOrder = (entry) => {
    if (!entry) return true;
    if (entry['Order Type'] === 'MESSAGE') return false;

    const orderNumber = entry['Order ID'];
    const phoneNumber = entry['Customer Contact Number'];

    return isBlank(orderNumber) || isBlank(phoneNumber);
  };

  const deleteInvalidOrderFromFirebase = async (id, entry) => {
    try {
      await fetch(`${FIREBASE_ORDERS_URL}/${id}.json`, {
        method: 'DELETE'
      });

      console.warn('🗑️ Deleted invalid order from Firebase:', {
        id,
        orderId: entry?.['Order ID'],
        phone: entry?.['Customer Contact Number']
      });
    } catch (err) {
      console.warn(`❌ Failed to delete invalid order ${id}:`, err);
    }
  };

  const formatDate = (rawDateStr) => {
    if (!rawDateStr) return '';

    if (rawDateStr instanceof Date) {
      const d = rawDateStr;
      return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
        .getDate()
        .toString()
        .padStart(2, '0')}`;
    }

    let cleanStr = String(rawDateStr);
    cleanStr = cleanStr.replace(/\s+at\s+/i, ' ').replace(/\s*\([^)]*\)/g, '').trim();

    const d = new Date(cleanStr);
    if (isNaN(d)) return 'Invalid date';

    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
      .getDate()
      .toString()
      .padStart(2, '0')}`;
  };

  const getElapsedTime = (rawDateStr) => {
    if (!rawDateStr) return 'Invalid date';

    let cleanStr = String(rawDateStr).replace(/\s+at\s+/i, ' ').replace(/\s*\([^)]*\)/g, '').trim();

    const orderDate = new Date(cleanStr);
    if (isNaN(orderDate)) return 'Invalid date';

    const elapsed = now - orderDate;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);

    return `${minutes}m ${seconds}s ago`;
  };

  const escapeHtml = (s) => {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const buildPickupStatusLine = (order) => {
    const status = (order?.status || '').toUpperCase().trim();

    if (!status || status === 'N/A' || status === 'NOT PAID') return 'NOT PAID';
    if (status === 'PENDING') return 'PENDING (Customer paying)';
    if (status === 'PAID') return 'PAID';
    if (status === 'CANCELED' || status === 'FAILED') return 'PAYMENT FAILED';

    return status;
  };

  const buildReceiptHtml = (entry) => {
    const isMessage = entry?.['Order Type'] === 'MESSAGE';
    const orderType = entry?.['Order Type'] || entry?.orderType || 'N/A';
    const paymentProvider = String(
      entry?.paymentProvider ||
        restaurantConfig?.paymentProvider ||
        ''
    ).toUpperCase();

    const title = isMessage ? 'HEYSUE MESSAGE' : 'HEYSUE PAID ORDER';
    const orderNumber = entry?.['Order ID'] || entry?.orderId || entry?.orderNumber || entry?.id || '';
    const customerName = isMessage
      ? entry?.['Caller_Name']
      : entry?.['Customer Name'] || entry?.customerName;
    const customerPhone = isMessage
      ? entry?.['Caller_Phone']
      : entry?.['Customer Contact Number'] || entry?.customerPhone || entry?.phoneNumber;
    const pickupTime = entry?.['Pickup Time'] || entry?.pickupTime || 'ASAP';
    const orderDate = entry?.['Order Date'] || entry?.['Message Date'] || entry?.createdAt || '';

    const backendSubtotal =
      entry?.backendSubtotal ??
      entry?.Subtotal ??
      entry?.subtotal;

    const backendTax =
      entry?.backendTax ??
      entry?.tax ??
      entry?.Tax;

    const backendTotal =
      entry?.backendTotal ??
      entry?.['Total Price'] ??
      entry?.totalPrice ??
      entry?.total;

    const paymentStatus = isMessage
      ? 'N/A'
      : `${buildPickupStatusLine(entry)}${paymentProvider ? ` - ${paymentProvider}` : ''}`;

    const kitchenNotes =
      entry?.kitchenNotes ||
      entry?.orderInstructions ||
      entry?.['Order Instructions'] ||
      entry?.notes ||
      '';

    const translatedKitchenNote =
      entry?.translatedKitchenNote ||
      entry?.kitchenTranslatedNote ||
      entry?.kitchenTranslatedOrderText ||
      '';

const kitchenLanguageName =
  restaurantConfig?.kitchenLanguageName ||
  restaurantConfig?.kitchen?.languageName ||
  restaurantConfig?.kitchenLanguage ||
  restaurantConfig?.kitchen?.language ||
  '';

    const originalCustomerOrder =
      entry?.originalOrderText ||
      entry?.originalCustomerOrderText ||
      entry?.originalOrderDetails ||
      entry?.['Order Items'] ||
      '';

    const translatedOriginalCustomerOrder =
      entry?.translatedOriginalOrderText ||
      entry?.translatedOriginalCustomerOrderText ||
      entry?.kitchenTranslatedOrderText ||
      '';

    const itemizedItems = getItemizedItems(entry);

    const formatModifierText = (item) => {
      const modifierValue =
        item?.modifiers ||
        item?.modifier ||
        item?.instructions ||
        item?.notes ||
        item?.remark ||
        '';

      if (Array.isArray(modifierValue)) {
        return modifierValue
          .map((value) =>
            typeof value === 'object'
              ? value.name || value.label || value.value || JSON.stringify(value)
              : String(value)
          )
          .filter(Boolean)
          .join(', ');
      }

      if (modifierValue && typeof modifierValue === 'object') {
        return Object.values(modifierValue)
          .map((value) =>
            typeof value === 'object'
              ? value.name || value.label || value.value || JSON.stringify(value)
              : String(value)
          )
          .filter(Boolean)
          .join(', ');
      }

      return String(modifierValue || '').trim();
    };

    const itemsHtml =
      itemizedItems.length > 0
        ? itemizedItems
            .map((item) => {
              const quantity = Number(item?.quantity || 1);
              const name = item?.name || item?.['Item Name'] || 'Item';
              const price = Number(item?.price || 0);
              const lineTotal = Number(
                item?.lineTotal !== undefined
                  ? item.lineTotal
                  : price * quantity
              );
              const modifiers = formatModifierText(item);

              return `
                <div class="itemRow">
                  <div class="itemMain">
                    <span class="qty">${escapeHtml(quantity)} x</span>
                    <span class="itemName">${escapeHtml(name)}</span>
                    <span class="itemPrice">${escapeHtml(formatMoney(lineTotal))}</span>
                  </div>
                  ${
                    modifiers
                      ? `<div class="modifier">- ${escapeHtml(modifiers)}</div>`
                      : ''
                  }
                </div>
              `;
            })
            .join('')
        : String(entry?.['Order Items'] || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => `<div class="itemRow">• ${escapeHtml(value)}</div>`)
            .join('');

    const translatedBlock =
      translatedKitchenNote
        ? `
          <div class="hr"></div>
          <div class="sectionTitle">
            TRANSLATED KITCHEN NOTE${kitchenLanguageName ? ` - ${escapeHtml(String(kitchenLanguageName).toUpperCase())}` : ''}
          </div>
          <div class="note">${escapeHtml(translatedKitchenNote)}</div>
        `
        : '';

    if (isMessage) {
      return `
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>HeySue Message</title>
            <style>
              @page {
                size: 80mm auto;
                margin: 3mm;
              }

              html,
              body {
                width: 80mm;
                margin: 0;
                padding: 0;
                background: #fff;
              }

              body {
                font-family: Arial, sans-serif;
                font-size: 12px;
                line-height: 1.3;
                color: #000;
              }

              .receipt {
                width: 74mm;
                max-width: 74mm;
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }

              .center { text-align: center; }
              .title { font-size: 17px; font-weight: 900; }
              .hr { border-top: 1px dashed #000; margin: 8px 0; }
              .label { font-weight: 900; }
              .wrap {
                overflow-wrap: anywhere;
                word-break: break-word;
                white-space: pre-wrap;
              }

              @media print {
                html,
                body,
                .receipt {
                  width: 74mm;
                  max-width: 74mm;
                }

                * {
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                }
              }
            </style>
          </head>
          <body onload="window.print(); setTimeout(() => window.close(), 300);">
            <div class="receipt">
              <div class="center title">HEYSUE MESSAGE</div>
              <div class="hr"></div>
              <div><span class="label">MESSAGE ID:</span> ${escapeHtml(orderNumber)}</div>
              <div><span class="label">CALLER:</span> ${escapeHtml(customerName || 'N/A')}</div>
              <div><span class="label">PHONE:</span> ${escapeHtml(formatPhoneNumber(customerPhone))}</div>
              <div><span class="label">TIME:</span> ${escapeHtml(orderDate)}</div>
              <div class="hr"></div>
              <div class="label">REASON</div>
              <div class="wrap">${escapeHtml(entry?.['Message_Reason'] || 'N/A')}</div>
              <div class="hr"></div>
              <div class="center">© 2026 HeySue!</div>
            </div>
          </body>
        </html>
      `;
    }

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>HeySue Kitchen Receipt</title>
          <style>
            @page {
              size: 80mm auto;
              margin: 3mm;
            }

            html,
            body {
              width: 80mm;
              margin: 0;
              padding: 0;
              background: #fff;
            }

            body {
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
                "Liberation Mono", "Courier New", monospace;
              font-size: 11px;
              line-height: 1.3;
              color: #000;
            }

            .receipt {
              width: 74mm;
              max-width: 74mm;
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }

            .center { text-align: center; }
            .title { font-size: 17px; font-weight: 900; }
            .orderNo { font-size: 16px; font-weight: 900; margin-top: 5px; }
            .hr { border-top: 1px dashed #000; margin: 8px 0; }
            .sectionTitle { font-weight: 900; margin-bottom: 5px; }
            .row {
              display: flex;
              justify-content: space-between;
              gap: 10px;
              margin: 3px 0;
            }
            .label { font-weight: 900; }
            .itemRow {
              margin: 5px 0;
              break-inside: avoid;
            }
            .itemMain {
              display: grid;
              grid-template-columns: 10mm 1fr auto;
              gap: 2mm;
              align-items: start;
            }
            .qty, .itemName, .itemPrice { font-weight: 800; }
            .itemName,
            .modifier,
            .note,
            .original {
              overflow-wrap: anywhere;
              word-break: break-word;
            }
            .modifier {
              margin-left: 12mm;
              font-size: 10px;
            }
            .note, .original { white-space: pre-wrap; }
            .totalRow { font-size: 13px; font-weight: 900; }
            .footer { text-align: center; font-size: 10px; margin-top: 8px; }

            @media print {
              html,
              body,
              .receipt {
                width: 74mm;
                max-width: 74mm;
              }

              * {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
          </style>
        </head>
        <body onload="window.print(); setTimeout(() => window.close(), 300);">
          <div class="receipt">
            <div class="center title">HEYSUE PAID ORDER</div>
            <div class="center orderNo">ORDER #: ${escapeHtml(orderNumber)}</div>

            <div class="hr"></div>

            <div><span class="label">CUSTOMER:</span> ${escapeHtml(customerName || 'N/A')}</div>
            <div><span class="label">PHONE:</span> ${escapeHtml(formatPhoneNumber(customerPhone))}</div>
            <div><span class="label">PICKUP TIME:</span> ${escapeHtml(pickupTime)}</div>
            <div><span class="label">ORDER TYPE:</span> ${escapeHtml(orderType)}</div>
            <div><span class="label">PAYMENT:</span> ${escapeHtml(paymentStatus)}</div>
            <div><span class="label">ORDER TIME:</span> ${escapeHtml(orderDate)}</div>

            <div class="hr"></div>
            <div class="sectionTitle">ITEMS</div>
            ${itemsHtml || '<div>N/A</div>'}
<div class="hr"></div>
<div class="sectionTitle">ORIGINAL CUSTOMER ORDER</div>
<div class="original">
  ${escapeHtml(originalCustomerOrder || 'N/A')}
</div>

<div class="hr"></div>
<div class="sectionTitle">KITCHEN NOTES</div>
<div class="note">
  ${escapeHtml(kitchenNotes || 'None')}
</div>

${
  translatedOriginalCustomerOrder
    ? `
      <div class="hr"></div>
      <div class="sectionTitle">
        TRANSLATED CUSTOMER ORDER${
          kitchenLanguageName
            ? ` - ${escapeHtml(
                String(kitchenLanguageName).toUpperCase()
              )}`
            : ''
        }
      </div>
      <div class="original">
        ${escapeHtml(translatedOriginalCustomerOrder)}
      </div>
    `
    : ''
}

${translatedBlock}

            <div class="hr"></div>
            <div class="sectionTitle">TOTAL</div>
            <div class="row"><span>Subtotal:</span><span>${escapeHtml(formatMoney(backendSubtotal))}</span></div>
            <div class="row"><span>Tax:</span><span>${escapeHtml(formatMoney(backendTax))}</span></div>
            <div class="row totalRow"><span>Total Paid:</span><span>${escapeHtml(formatMoney(backendTotal))}</span></div>

            <div class="hr"></div>
            <div class="footer">© 2026 HeySue! • ${escapeHtml(LOCATION_ID)}</div>
          </div>
        </body>
      </html>
    `;
  };

  const printEntry = (entry) => {
    try {
      const html = buildReceiptHtml(entry);
      const w = window.open('', '_blank', 'width=400,height=600');

      if (!w) {
        alert('Pop-up blocked. Please allow pop-ups to print.');
        return;
      }

      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (e) {
      console.warn('❌ Print failed:', e);
      alert('Print failed. Check browser settings on the POS device.');
    }
  };

  const archiveOldOrders = async () => {
    const res = await fetch(`${FIREBASE_ORDERS_URL}.json`);
    const data = await res.json();

    if (!data) return;

    const todayStr = formatDate(new Date());

    for (const [id, entry] of Object.entries(data)) {
      if (entry?.locationID !== LOCATION_ID) continue;

      if (isInvalidOrder(entry)) {
        await deleteInvalidOrderFromFirebase(id, entry);
        continue;
      }

      const rawDate = entry['Order Date'] || entry['Message Date'];
      if (!rawDate) continue;

      const entryDateStr = formatDate(rawDate);

      if (entryDateStr === 'Invalid date') {
        console.warn(`⚠️ Skipping archive for ${id} because date could not be parsed:`, rawDate);
        continue;
      }

      const shouldArchive =
        entryDateStr !== todayStr ||
        shouldAutoArchiveOrder(entry);

      if (!shouldArchive) continue;

      const archiveCheck = await fetch(`${FIREBASE_ARCHIVE_URL}/${entryDateStr}/${id}.json`);
      const alreadyArchived = await archiveCheck.json();

      if (alreadyArchived) continue;

      await fetch(`${FIREBASE_ARCHIVE_URL}/${entryDateStr}/${id}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...entry, Archived: true })
      });

      await fetch(`${FIREBASE_ORDERS_URL}/${id}.json`, {
        method: 'DELETE'
      });

      console.log(`📦 Archived ${entry['Order Type'] || 'entry'} ${id} from ${entryDateStr}`);
    }
  };

  useEffect(() => {
    let canceled = false;

    const loadRestaurantConfig = async () => {
      setConfigLoading(true);
      setConfigError('');

      if (!LOCATION_ID) {
        setRestaurantConfig(null);
        setConfigError(
          'Invalid restaurant URL. Use a six-character code, for example /MEGCHK.'
        );
        setConfigLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `${FIREBASE_LOCATIONS_URL}/${LOCATION_ID}.json`
        );

        if (!response.ok) {
          throw new Error(`Firebase returned HTTP ${response.status}`);
        }

        const config = await response.json();

        if (!config) {
          throw new Error(
            `No restaurant configuration was found for ${LOCATION_ID}.`
          );
        }

        if (!canceled) {
          setRestaurantConfig(config);
        }
      } catch (error) {
        console.warn('Could not load restaurant configuration:', error);

        if (!canceled) {
          setRestaurantConfig(null);
          setConfigError(error.message || 'Could not load restaurant configuration.');
        }
      } finally {
        if (!canceled) {
          setConfigLoading(false);
        }
      }
    };

    loadRestaurantConfig();

    return () => {
      canceled = true;
    };
  }, [LOCATION_ID]);

  useEffect(() => {
    alarmAudio.current = new Audio('/alert.mp3');
    alarmAudio.current.load();

    messageAudio.current = new Audio('/message-alert.mp3');
    messageAudio.current.load();

    messageAudio.current.onplay = () => console.log('🔊 message-alert.mp3 is playing');
    messageAudio.current.onerror = (e) => console.warn('❌ message-alert.mp3 failed to play', e);

    paidAudio.current = new Audio('/cash-register-open.wav');
    paidAudio.current.load();

    paidAudio.current.onplay = () => console.log('💵 cash-register-open.wav is playing');
    paidAudio.current.onerror = (e) => console.warn('❌ cash-register-open.wav failed to play', e);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!audioEnabled) return;

    const fetchOrders = async () => {
      try {
        await archiveOldOrders();

        const res = await fetch(`${FIREBASE_ORDERS_URL}.json`);
        const data = await res.json();

        const rawEntries = Object.entries(data || {})
          .map(([id, order]) => ({ id, ...order }))
          .filter((o) => o?.locationID === LOCATION_ID);

        const invalidOrders = rawEntries.filter((order) => isInvalidOrder(order));

        if (invalidOrders.length > 0) {
          await Promise.all(invalidOrders.map((order) => deleteInvalidOrderFromFirebase(order.id, order)));
        }

        let orderArray = rawEntries.filter((order) => !isInvalidOrder(order));

        orderArray.sort(
          (a, b) =>
            new Date(formatDate(b['Order Date'] || b['Message Date'])) -
            new Date(formatDate(a['Order Date'] || a['Message Date']))
        );

        setOrders(orderArray);

        const newUnseenOrder = orderArray.find((order) => {
          if (order['Order Type'] === 'MESSAGE') return false;
          if (!order['Order Items']) return false;

          const alertKey = getOrderAlertKey(order);

          return !seenOrders.has(alertKey);
        });

        if (newUnseenOrder) {
          const alertKey = getOrderAlertKey(newUnseenOrder);

          setSeenOrders((prev) => {
            const updated = new Set(prev).add(alertKey);
            localStorage.setItem('seenOrders', JSON.stringify(Array.from(updated)));
            return updated;
          });

          if (alarmAudio.current) {
            alarmAudio.current.currentTime = 0;
            alarmAudio.current.play().catch((err) => console.warn('❌ alert.mp3 playback failed', err));
          }
        }

        const newUnseenMessage = orderArray.find(
          (order) => order['Order Type'] === 'MESSAGE' && !seenMessages.has(order.id)
        );

        if (newUnseenMessage) {
          setSeenMessages((prev) => {
            const updated = new Set(prev).add(newUnseenMessage.id);
            localStorage.setItem('seenMessages', JSON.stringify(Array.from(updated)));
            return updated;
          });

          if (messageAudio.current) {
            messageAudio.current.currentTime = 0;
            messageAudio.current.play().catch((err) => console.warn('❌ message-alert.mp3 playback failed', err));
          }
        }

        const newlyPaidOrder = orderArray.find((order) => {
          if (order['Order Type'] === 'MESSAGE') return false;

          const status = String(order.status || order.Status || '').toUpperCase().trim();
          const paidKey = order.id;

          return status === 'PAID' && !paidOrdersRef.current.has(paidKey);
        });

        if (newlyPaidOrder) {
          paidOrdersRef.current.add(newlyPaidOrder.id);
          localStorage.setItem('paidOrders', JSON.stringify(Array.from(paidOrdersRef.current)));

          if (paidAudio.current) {
            paidAudio.current.currentTime = 0;
            paidAudio.current
              .play()
              .catch((err) => console.warn('❌ cash-register-open.wav playback failed', err));
          }
        }
      } catch (err) {
        console.warn('❌ Failed to fetch orders:', err);
      }
    };

    fetchOrders();

    const interval = setInterval(fetchOrders, 5000);
    return () => clearInterval(interval);
  }, [audioEnabled, accepted, seenOrders, seenMessages]);

  const acceptOrder = async (id) => {
    const timestamp = new Date().toISOString();

    setAccepted((prev) => {
      const updated = new Set(prev).add(id);
      localStorage.setItem('acceptedOrders', JSON.stringify(Array.from(updated)));
      return updated;
    });

    await fetch(`${FIREBASE_ORDERS_URL}/${id}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'Accepted At': timestamp })
    });
  };

  const markMessageAsRead = (id) => {
    setReadMessages((prev) => {
      const updated = new Set(prev).add(id);
      localStorage.setItem('readMessages', JSON.stringify(Array.from(updated)));
      return updated;
    });
  };

  if (configLoading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'Arial' }}>
        <h1>HeySue Kitchen Dashboard</h1>
        <p>Loading restaurant configuration for {LOCATION_ID || 'unknown location'}...</p>
      </div>
    );
  }

  if (configError) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'Arial' }}>
        <h1>HeySue Kitchen Dashboard</h1>
        <p style={{ color: '#dc3545', fontWeight: 'bold' }}>{configError}</p>
        <p>Example URL: http://localhost:3000/MEGCHK</p>
      </div>
    );
  }

  if (!audioEnabled) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h1>
          {restaurantConfig?.restaurantName ||
            restaurantConfig?.displayName ||
            `HeySue Kitchen Dashboard - ${LOCATION_ID}`}
        </h1>
        <p>Please click the button below to start the dashboard and enable sound alerts.</p>
        <p>(c) 2026 HeySue! - All rights reserved.</p>

        <button
          onClick={async () => {
            try {
              await archiveOldOrders();
              setAudioEnabled(true);

              if (alarmAudio.current) {
                alarmAudio.current.play().then(() => alarmAudio.current.pause());
              }

              if (messageAudio.current) {
                messageAudio.current.play().then(() => messageAudio.current.pause());
              }

              if (paidAudio.current) {
                paidAudio.current.play().then(() => paidAudio.current.pause());
              }
            } catch (err) {
              console.warn('⚠️ Error during dashboard startup:', err);
            }
          }}
          style={{ fontSize: '1.2rem', padding: '0.5rem 1rem' }}
        >
          Start Dashboard
        </button>
      </div>
    );
  }

  const today = new Date();
  const todayStr = formatDate(today.toString());

  const displayedOrders = orders.filter((order) => {
    const isAcceptedOrder = accepted.has(order.id);
    const isInDateRange = formatDate(order['Order Date']) === todayStr;

    return showAccepted
      ? isAcceptedOrder && isInDateRange && order['Order Type'] !== 'MESSAGE' && !isInvalidOrder(order)
      : !isAcceptedOrder && isInDateRange && order['Order Type'] !== 'MESSAGE' && !isInvalidOrder(order);
  });

  const displayedMessages = orders.filter(
    (order) =>
      order['Order Type'] === 'MESSAGE' &&
      formatDate(order['Message Date']) === todayStr &&
      (showReadMessages ? readMessages.has(order.id) : !readMessages.has(order.id))
  );

  return (
    <div style={{ padding: '1rem', fontFamily: 'Arial' }}>
      <h1>
        Orders and Messages -{' '}
        {restaurantConfig?.restaurantName ||
          restaurantConfig?.displayName ||
          LOCATION_ID}
      </h1>

      <p>
        <strong>Date:</strong>{' '}
        {today.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })}
      </p>

      <button
        onClick={() => setShowAccepted((prev) => !prev)}
        style={{ marginRight: '1rem', backgroundColor: 'red', color: 'white', padding: '0.5rem 1rem' }}
      >
        {showAccepted ? 'Hide Accepted Orders' : 'View Accepted Orders'}
      </button>

      <button
        onClick={() => setShowReadMessages((prev) => !prev)}
        style={{ backgroundColor: '#6c757d', color: 'white', padding: '0.5rem 1rem' }}
      >
        {showReadMessages ? 'Hide Read Messages' : 'View Read Messages'}
      </button>

      <button
        onClick={async () => {
          if (!showArchived) {
            const res = await fetch(`${FIREBASE_ARCHIVE_URL}.json`);
            const data = await res.json();

            const allArchived = [];

            Object.entries(data || {}).forEach(([dateKey, entries]) => {
              Object.entries(entries || {}).forEach(([id, entry]) => {
                if (entry?.locationID === LOCATION_ID && !isInvalidOrder(entry)) {
                  allArchived.push({ ...entry, id, archiveDate: dateKey });
                }
              });
            });

            allArchived.sort(
              (a, b) => new Date(b['Order Date'] || b['Message Date']) - new Date(a['Order Date'] || a['Message Date'])
            );

            setArchivedEntries(allArchived);
          }

          setShowArchived((prev) => !prev);
        }}
        style={{ backgroundColor: '#28a745', color: 'white', padding: '0.5rem 1rem', marginLeft: '1rem' }}
      >
        {showArchived ? 'Hide Archived' : 'Archived'}
      </button>

      <button
        onClick={() => {
          if (alarmAudio.current) {
            alarmAudio.current.currentTime = 0;
            alarmAudio.current.play().catch((err) => console.warn('Alert test failed', err));
          }
        }}
        style={{
          backgroundColor: '#ff9800',
          color: 'white',
          padding: '0.5rem 1rem',
          marginLeft: '1rem',
          border: 'none',
          borderRadius: '4px'
        }}
      >
        Test Order Alert
      </button>

      {displayedMessages.map((message) => (
        <div
          key={message.id}
          style={{
            backgroundColor: '#fff3f4',
            border: '2px solid #ff4081',
            padding: '1rem',
            borderRadius: '8px',
            marginTop: '1rem'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>📨 {showReadMessages ? 'Read Message' : 'New Message'}</h2>

            <button
              onClick={() => printEntry(message)}
              style={{
                backgroundColor: '#0d6efd',
                color: 'white',
                padding: '0.4rem 0.8rem',
                border: 'none',
                borderRadius: '4px'
              }}
            >
              PRINT
            </button>
          </div>

          <p>
            <strong>Time:</strong> {message['Message Date'] || 'N/A'}
          </p>

          <p>
            <strong>Caller Name:</strong> {message['Caller_Name'] || 'N/A'}
          </p>

          <p>
            <strong>Caller Phone:</strong> {formatPhoneNumber(message['Caller_Phone'])}
          </p>

          <p>
            <strong>Reason:</strong> {message['Message_Reason'] || 'N/A'}
          </p>

          {!showReadMessages && (
            <button
              onClick={() => markMessageAsRead(message.id)}
              style={{
                marginTop: '0.5rem',
                backgroundColor: '#d6336c',
                color: 'white',
                padding: '0.5rem 1rem',
                border: 'none',
                borderRadius: '4px'
              }}
            >
              Mark As Read
            </button>
          )}
        </div>
      ))}

      <div style={{ display: 'grid', gap: '1rem', marginTop: '2rem' }}>
        {displayedOrders.map((order) => (
          <div
            key={order.id}
            style={{
              backgroundColor: '#e6f9e6',
              border: '1px solid #ccc',
              padding: '1.5rem',
              borderRadius: '8px',
              fontSize: '1.2rem'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Order #{order['Order ID']}</h2>

              <button
                onClick={() => printEntry(order)}
                style={{
                  backgroundColor: '#0d6efd',
                  color: 'white',
                  padding: '0.4rem 0.8rem',
                  border: 'none',
                  borderRadius: '4px'
                }}
              >
                PRINT
              </button>
            </div>

            <p>
              <strong>Customer:</strong> {order['Customer Name']}
            </p>

            <p>
              <strong>Phone:</strong> {formatPhoneNumber(order['Customer Contact Number'])}
            </p>

            <p>
              <strong>Order Type:</strong> {order['Order Type'] || 'N/A'}
            </p>

            <p>
              <strong>Payment Method:</strong> {order.paymentMethod || 'N/A'}
            </p>

            {order['Order Type']?.toLowerCase() === 'delivery' && (
              <>
                <p>
                  <strong>Delivery Address:</strong> {order['Delivery Address'] || 'N/A'}
                </p>

                <p>
                  <strong>Order Instructions:</strong> {order['Order Instructions'] || 'N/A'}
                </p>

                <p>
                  <strong>Status:</strong> {order.status || order.Status || 'N/A'}
                </p>

                <p>
                  <strong>Paid At:</strong> {order.PaidAt || 'N/A'}
                </p>

                <p>
                  <strong>Payment ID:</strong> {order.paymentIntentId || order.paymentIntendId || 'N/A'}
                </p>

                <p>
                  <strong>Checkout Session ID:</strong> {order.checkoutSessionId || 'N/A'}
                </p>
              </>
            )}

            {order['Order Type'] === 'PICK UP' &&
              (() => {
                const status = (order.status || '').toUpperCase().trim();

                let statusMessage = '';
                let statusColor = 'black';
                let badge = '⚪';

                if (!status || status === 'N/A' || status === 'NOT PAID') {
                  statusMessage = 'Order Not Paid';
                  statusColor = '#f0ad4e';
                  badge = '🟡';
                } else if (status === 'PENDING') {
                  statusMessage = 'Customer Completing Payment - Stand By';
                  statusColor = '#ffc107';
                  badge = '🟠';
                } else if (status === 'PAID') {
                  statusMessage = 'Customer Has Completed Payment - Proceed with Order';
                  statusColor = '#28a745';
                  badge = '🟢';
                } else if (status === 'CANCELED' || status === 'FAILED') {
                  statusMessage = 'Payment Failed - Contact the Customer to Confirm Order';
                  statusColor = '#dc3545';
                  badge = '🔴';
                }

                return (
                  <p style={{ color: statusColor, fontWeight: 'bold', marginTop: '0.5rem' }}>
                    <strong>Status:</strong> {badge} {statusMessage}
                  </p>
                );
              })()}

            <p>
              <strong>Order Date:</strong> {order['Order Date']}
            </p>

            {!showAccepted && order['Order Date'] && (
              <p>
                <strong>Elapsed Time:</strong>{' '}
                <span style={{ color: 'goldenrod' }}>{getElapsedTime(order['Order Date'])}</span>
              </p>
            )}

            {showAccepted && order['Accepted At'] && (
              <p style={{ color: 'green', fontWeight: 'bold' }}>
                <strong>Accepted At:</strong> {new Date(order['Accepted At']).toLocaleString()}
              </p>
            )}

            <p style={{ color: 'red', fontWeight: 'bold' }}>
              <strong>Pickup Time:</strong> {order['Pickup Time']}
            </p>

            <div
              style={{
                marginTop: '1rem',
                marginBottom: '1rem',
                padding: '1rem',
                backgroundColor: '#ffffff',
                border: '2px solid #333',
                borderRadius: '8px'
              }}
            >
              <h2
                style={{
                  marginTop: 0,
                  marginBottom: '0.75rem',
                  fontSize: '1.8rem',
                  fontWeight: 'bold',
                  color: '#000'
                }}
              >
                Items Ordered
              </h2>

              {getItemizedItems(order).length > 0 ? (
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                  {getItemizedItems(order).map((item, index) => (
                    <div
                      key={index}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '70px 1fr 120px',
                        gap: '0.75rem',
                        alignItems: 'center',
                        padding: '0.35rem 0',
                        borderBottom: '1px solid #ddd'
                      }}
                    >
                      <span>{item.quantity || 1} x</span>
                      <span>{item.name || 'Item'}</span>
                      <span style={{ textAlign: 'right' }}>{formatMoney(item.lineTotal || item.price)}</span>
                    </div>
                  ))}

                  <div
                    style={{
                      marginTop: '0.75rem',
                      paddingTop: '0.75rem',
                      borderTop: '2px solid #333',
                      display: 'grid',
                      gap: '0.35rem'
                    }}
                  >
                    {(order.backendSubtotal !== undefined || (order.Subtotal !== undefined && order.Subtotal !== '')) && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Subtotal</span>
                        <span>{formatMoney(order.backendSubtotal ?? order.Subtotal)}</span>
                      </div>
                    )}

                    {(order.backendTax !== undefined || order.tax !== undefined || order.Tax !== undefined) && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Tax</span>
                        <span>{formatMoney(order.backendTax ?? order.tax ?? order.Tax)}</span>
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.7rem' }}>
                      <span>Total</span>
                      <span>{formatMoney(order.backendTotal ?? order['Total Price'])}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: '1.5rem',
                    fontSize: '1.8rem',
                    fontWeight: 'bold',
                    lineHeight: '1.5'
                  }}
                >
                  {order['Order Items']?.split(',').map((item, index) => (
                    <li key={index}>{item.trim()}</li>
                  ))}
                </ul>
              )}
            </div>

            <p style={{ fontSize: '1.6rem', fontWeight: 'bold' }}>
              <strong>Total:</strong> {formatMoney(order.backendTotal ?? order['Total Price'])}
            </p>

            {isCreditDebitOrder(order) && PAYMENT_LINK_MODE === 'VOICE' && (
              <div
                style={{
                  marginTop: '1rem',
                  marginBottom: '1rem',
                  padding: '1rem',
                  backgroundColor: '#e7f3ff',
                  border: '2px solid #0d6efd',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  color: '#084298'
                }}
              >
                Payment link is sent by Hey Sue!.
              </div>
            )}

            {isCreditDebitOrder(order) && PAYMENT_LINK_MODE !== 'VOICE' && (
              <div
                style={{
                  marginTop: '1rem',
                  marginBottom: '1rem',
                  padding: '1rem',
                  backgroundColor: '#fff8dc',
                  border: '2px solid #f0ad4e',
                  borderRadius: '8px'
                }}
              >
                <p style={{ marginTop: 0, fontWeight: 'bold' }}>Credit/Debit Payment Link</p>

                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.4rem' }}>
                  Adjust Total Before Sending:
                </label>

                <input
                  type="text"
                  value={getEditableTotal(order)}
                  onChange={(e) =>
                    setAdjustedTotals((prev) => ({
                      ...prev,
                      [order.id]: e.target.value
                    }))
                  }
                  style={{
                    fontSize: '1.2rem',
                    padding: '0.5rem',
                    width: '180px',
                    marginRight: '1rem',
                    border: '1px solid #ccc',
                    borderRadius: '4px'
                  }}
                />

                <button
                  onClick={() => sendPaymentLink(order)}
                  disabled={
                    !!sendingPaymentLinks[order.id] ||
                    !Number.isFinite(parseMoneyValue(getEditableTotal(order))) ||
                    parseMoneyValue(getEditableTotal(order)) <= 0
                  }
                  style={{
                    backgroundColor:
                      !!sendingPaymentLinks[order.id] ||
                      !Number.isFinite(parseMoneyValue(getEditableTotal(order))) ||
                      parseMoneyValue(getEditableTotal(order)) <= 0
                        ? '#6c757d'
                        : '#007bff',
                    color: 'white',
                    padding: '0.6rem 1rem',
                    border: 'none',
                    borderRadius: '4px',
                    fontWeight: 'bold'
                  }}
                >
                  {sendingPaymentLinks[order.id] ? 'SENDING...' : 'SEND PAYMENT LINK'}
                </button>

                <p style={{ marginBottom: 0, fontSize: '0.95rem' }}>
                  <strong>Payment Link Status:</strong> {order.paymentLinkStatus || 'Not sent'}
                </p>
              </div>
            )}

            {!accepted.has(order.id) && (
              <button
                onClick={() => acceptOrder(order.id)}
                style={{
                  marginTop: '1rem',
                  backgroundColor: '#28a745',
                  color: 'white',
                  padding: '0.5rem 1rem',
                  border: 'none',
                  borderRadius: '4px'
                }}
              >
                ACCEPT
              </button>
            )}
          </div>
        ))}
      </div>

      {showArchived && (
        <div style={{ marginTop: '2rem' }}>
          <h2>📦 Archived Orders & Messages</h2>

          <div style={{ display: 'grid', gap: '1rem' }}>
            {archivedEntries.map((entry) => (
              <div
                key={entry.id}
                style={{
                  backgroundColor: '#f0f0f0',
                  border: '1px solid #ccc',
                  padding: '1.5rem',
                  borderRadius: '8px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                  <h3 style={{ margin: 0 }}>
                    {entry['Order Type'] === 'MESSAGE' ? '📨 Message' : `Order #${entry['Order ID'] || entry.id}`}
                  </h3>

                  <button
                    onClick={() => printEntry(entry)}
                    style={{
                      backgroundColor: '#0d6efd',
                      color: 'white',
                      padding: '0.4rem 0.8rem',
                      border: 'none',
                      borderRadius: '4px'
                    }}
                  >
                    PRINT
                  </button>
                </div>

                <p>
                  <strong>Date:</strong> {entry['Order Date'] || entry['Message Date'] || 'N/A'}
                </p>

                {entry['Order Type'] === 'MESSAGE' ? (
                  <>
                    <p>
                      <strong>Caller Name:</strong> {entry['Caller_Name']}
                    </p>

                    <p>
                      <strong>Caller Phone:</strong> {formatPhoneNumber(entry['Caller_Phone'])}
                    </p>

                    <p>
                      <strong>Reason:</strong> {entry['Message_Reason']}
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      <strong>Customer:</strong> {entry['Customer Name']}
                    </p>

                    <p>
                      <strong>Phone:</strong> {formatPhoneNumber(entry['Customer Contact Number'])}
                    </p>

                    <p>
                      <strong>Order Type:</strong> {entry['Order Type']}
                    </p>

                    <p>
                      <strong>Payment Method:</strong> {entry.paymentMethod || 'N/A'}
                    </p>

                    {entry['Order Type']?.toLowerCase() === 'delivery' && (
                      <>
                        <p>
                          <strong>Delivery Address:</strong> {entry['Delivery Address']}
                        </p>

                        <p>
                          <strong>Order Instructions:</strong> {entry['Order Instructions'] || 'N/A'}
                        </p>

                        <p>
                          <strong>Status:</strong> {entry.status || entry.Status || 'N/A'}
                        </p>

                        <p>
                          <strong>Paid At:</strong> {entry.PaidAt || 'N/A'}
                        </p>

                        <p>
                          <strong>Payment ID:</strong> {entry.paymentIntentId || entry.paymentIntendId || 'N/A'}
                        </p>

                        <p>
                          <strong>Checkout Session ID:</strong> {entry.checkoutSessionId || 'N/A'}
                        </p>
                      </>
                    )}

                    {entry['Order Type']?.toLowerCase() !== 'delivery' && entry['Delivery Address'] && (
                      <p>
                        <strong>Delivery Address:</strong> {entry['Delivery Address']}
                      </p>
                    )}

                    <p>
                      <strong>Pickup Time:</strong> {entry['Pickup Time']}
                    </p>

                    <p>
                      <strong>Total:</strong> {entry['Total Price']}
                    </p>

                    <ul>
                      {entry['Order Items']?.split(',').map((item, index) => (
                        <li key={index}>{item.trim()}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {confirmOrder && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999
          }}
        >
          <div
            style={{
              backgroundColor: 'white',
              padding: '2rem',
              borderRadius: '14px',
              width: '90%',
              maxWidth: '600px',
              textAlign: 'center',
              boxShadow: '0 10px 30px rgba(0,0,0,0.35)'
            }}
          >
            <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Confirm Payment Link</h2>

            <p style={{ fontSize: '1.4rem', marginBottom: '1rem' }}>Send payment link for:</p>

            <p style={{ fontSize: '2.4rem', fontWeight: 'bold', marginBottom: '1rem', color: '#28a745' }}>
              ${confirmOrder.totalPrice.toFixed(2)}
            </p>

            <p style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>
              <strong>Customer:</strong> {confirmOrder.order['Customer Name'] || 'N/A'}
            </p>

            <p style={{ fontSize: '1.3rem', marginBottom: '2rem' }}>
              <strong>Phone:</strong> {formatPhoneNumber(confirmOrder.order['Customer Contact Number'])}
            </p>

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                onClick={() => setConfirmOrder(null)}
                style={{
                  padding: '1rem 2rem',
                  fontSize: '1.3rem',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  minWidth: '160px'
                }}
              >
                Cancel
              </button>

              <button
                onClick={() => {
                  const selected = confirmOrder.order;
                  setConfirmOrder(null);
                  sendPaymentLink(selected, true);
                }}
                style={{
                  padding: '1rem 2rem',
                  fontSize: '1.3rem',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  minWidth: '220px'
                }}
              >
                Confirm & Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}