const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';

// Proteção básica por API key
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ ok: false, error: 'Não autorizado' });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// Debug: retorna o HTML bruto da página (só usar para diagnóstico)
app.get('/debug', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).json({ error: 'url obrigatório' });
  const url = decodeURIComponent(rawUrl);
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process','--no-zygote'],
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 8000));
    const html = await page.content();
    const text = await page.evaluate(() => document.body.innerText);
    res.json({ html: html.substring(0, 5000), text: text.substring(0, 3000), url: page.url() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

app.get('/scrape', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).json({ ok: false, error: 'Parâmetro url obrigatório' });

  const url = decodeURIComponent(rawUrl);

  // Aceita só URLs de portais fiscais do governo
  if (!url.includes('.gov.br') || !/nfce|nfe|fazenda|sefaz|sefa\.|sefin/i.test(url)) {
    return res.status(400).json({ ok: false, error: 'URL inválida' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36'
    );
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // Aguarda AJAX do JSF terminar — tenta detectar quando os itens aparecem no DOM
    try {
      await page.waitForFunction(
        () => {
          // Considera carregado quando há .txtTit (spans padrão NFC-e)
          // OU quando uma tabela tem mais de 2 linhas com preços
          const spans = document.querySelectorAll('.txtTit');
          if (spans.length > 0) return true;
          const rows = document.querySelectorAll('table tr');
          if (rows.length > 3) {
            const text = document.body.innerText || '';
            return /\d+[.,]\d{2}/.test(text) && text.length > 500;
          }
          return false;
        },
        { timeout: 12000, polling: 500 }
      );
    } catch (_) {
      // Timeout — aguarda mais 5s fixos como fallback
      await new Promise((r) => setTimeout(r, 5000));
    }

    const data = await page.evaluate(() => {
      function parseNum(text) {
        if (!text) return 0;
        var s = (text || '').replace(/[^\d,.]/g, '');
        if (!s) return 0;
        if (s.match(/,\d{2}$/)) s = s.replace(/\./g, '').replace(',', '.');
        return parseFloat(s) || 0;
      }
      function cleanText(el) {
        return ((el && (el.textContent || el.innerText)) || '').replace(/\s+/g, ' ').trim();
      }
      function extractCNPJ(text) {
        var m = (text || '').match(/(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})[\/\s]?(\d{4})[-\s]?(\d{2})/);
        return m ? m[1] + m[2] + m[3] + m[4] + m[5] : '';
      }
      function extractDate(text) {
        var m1 = (text || '').match(/(\d{2})\/(\d{2})\/(\d{4})[\s,T]+(\d{2}:\d{2})/);
        if (m1) return m1[3] + '-' + m1[2] + '-' + m1[1] + 'T' + m1[4] + ':00';
        var m2 = (text || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (m2) return m2[3] + '-' + m2[2] + '-' + m2[1] + 'T00:00:00';
        return new Date().toISOString();
      }

      var body = document.body;
      var bodyText = body ? body.innerText || body.textContent || '' : '';

      var result = {
        storeName: '', cnpj: '', address: '', city: '', state: '',
        date: extractDate(bodyText), accessKey: '', total: 0, items: [],
      };

      // Nome da loja
      var nameSels = ['#u20', '#nomeEmit', '.nomeEmit', '.txtTopo', '.NomeEmit',
        '.razaoSocial', '.nomeEmitente', '[id*="nomeEmit"]', '[class*="nomeEmit"]'];
      for (var i = 0; i < nameSels.length; i++) {
        try {
          var el = document.querySelector(nameSels[i]);
          if (el) { var t = cleanText(el); if (t.length > 2) { result.storeName = t; break; } }
        } catch (e) {}
      }
      if (!result.storeName) {
        var heads = document.querySelectorAll('h1,h2,h3,.titulo');
        for (var i = 0; i < heads.length; i++) {
          var t = cleanText(heads[i]);
          if (t.length > 3 && !/nota|fiscal|nfc|consumidor|sefaz|consulta/i.test(t)) { result.storeName = t; break; }
        }
      }

      result.cnpj = extractCNPJ(bodyText);

      // Endereço
      var addrSels = ['#u30', '.endEmit', '.Endereco', '.enderecoEmitente', '[class*="Endereco"]'];
      for (var i = 0; i < addrSels.length; i++) {
        try {
          var el = document.querySelector(addrSels[i]);
          if (el) { var t = cleanText(el); if (t.length > 3) { result.address = t; break; } }
        } catch (e) {}
      }

      // Total
      var totalSels = ['#linhaTotal .nfcTotaisConteudo', '#linhaTotal', '.totalNF', '.vlrTotal',
        '[id*="totalNota"]', '[id*="vlrTotal"]', '[class*="vlrTotal"]'];
      for (var i = 0; i < totalSels.length; i++) {
        try {
          var el = document.querySelector(totalSels[i]);
          if (el) { var v = parseNum(cleanText(el)); if (v > 0) { result.total = v; break; } }
        } catch (e) {}
      }
      if (!result.total) {
        var tm = bodyText.match(/[Vv]alor\s*[Tt]otal[^\d]{0,10}([\d.,]+)/);
        if (tm) result.total = parseNum(tm[1]);
      }

      // Itens — spans padrão NFC-e
      var titEls = document.querySelectorAll('.txtTit');
      if (titEls.length > 0) {
        for (var i = 0; i < titEls.length; i++) {
          var c = titEls[i].closest('.item') || titEls[i].parentElement;
          if (!c) continue;
          var name = cleanText(c.querySelector('.txtTit'));
          if (!name || name.length < 2) continue;
          var qty = parseNum(cleanText(c.querySelector('.Quant,[class*="Quant"]'))) || 1;
          var unit = cleanText(c.querySelector('.unidCom,[class*="unid"]')) || 'un';
          var vu = parseNum(cleanText(c.querySelector('.vUnCom,[class*="vUn"]')));
          var vt = parseNum(cleanText(c.querySelector('.vProd,[class*="vProd"],[class*="Total"]')));
          vt = vt || vu * qty; vu = vu || (qty > 0 ? vt / qty : vt);
          if (vt > 0) result.items.push({ code: '', name, quantity: qty, unit: unit || 'un', unitPrice: vu, totalPrice: vt });
        }
      }

      // Itens — tabela com cabeçalho
      if (result.items.length === 0) {
        var tables = document.querySelectorAll('table');
        for (var t = 0; t < tables.length; t++) {
          var rows = tables[t].querySelectorAll('tr');
          if (rows.length < 2) continue;
          var headerRow = -1, headers = [];
          for (var r = 0; r < Math.min(rows.length, 4); r++) {
            var cells = rows[r].querySelectorAll('th,td');
            var txts = [];
            for (var c = 0; c < cells.length; c++) txts.push(cleanText(cells[c]).toLowerCase());
            var joined = txts.join(' ');
            if (joined.includes('descri') || joined.includes('produto') || joined.includes('item')) {
              headerRow = r; headers = txts; break;
            }
          }
          var iName = -1, iQty = -1, iUnit = -1, iVun = -1, iVtot = -1;
          for (var h = 0; h < headers.length; h++) {
            var hh = headers[h];
            if (iName < 0 && (hh.includes('descri') || hh.includes('produto') || hh === 'item')) iName = h;
            if (iQty < 0 && (hh.includes('qtd') || hh.includes('quant'))) iQty = h;
            if (iUnit < 0 && (hh === 'un' || hh === 'und' || hh === 'unid')) iUnit = h;
            if (iVun < 0 && (hh.includes('unit') || hh.includes('vl. un'))) iVun = h;
            if (iVtot < 0 && (hh.includes('total') || hh.includes('vl. tot'))) iVtot = h;
          }
          if (iName < 0) continue;
          var added = 0;
          for (var r = headerRow + 1; r < rows.length; r++) {
            var cells = rows[r].querySelectorAll('td');
            if (cells.length < 2) continue;
            var name = iName < cells.length ? cleanText(cells[iName]) : '';
            if (!name || name.length < 2) continue;
            if (/^(descri|produto|item|qtd|valor|total)/i.test(name)) continue;
            var qty = (iQty >= 0 && iQty < cells.length) ? parseNum(cleanText(cells[iQty])) || 1 : 1;
            var unit = (iUnit >= 0 && iUnit < cells.length) ? cleanText(cells[iUnit]) || 'un' : 'un';
            var vu = (iVun >= 0 && iVun < cells.length) ? parseNum(cleanText(cells[iVun])) : 0;
            var vt = (iVtot >= 0 && iVtot < cells.length) ? parseNum(cleanText(cells[iVtot])) : 0;
            vt = vt || vu * qty; vu = vu || (qty > 0 ? vt / qty : vt);
            if (vt > 0) { result.items.push({ code: '', name, quantity: qty, unit: unit || 'un', unitPrice: vu, totalPrice: vt }); added++; }
          }
          if (added > 0) break;
        }
      }

      // Itens — varredura de <tr> sem cabeçalho (coluna mais longa = nome)
      if (result.items.length === 0) {
        var allRows = document.querySelectorAll('tr');
        for (var r = 0; r < allRows.length; r++) {
          var tds = allRows[r].querySelectorAll('td');
          if (tds.length < 3) continue;
          var rowText = cleanText(allRows[r]);
          if (!/\d+[.,]\d{2}/.test(rowText)) continue;
          var tdPrices = [];
          for (var c = 0; c < tds.length; c++) {
            var ct = cleanText(tds[c]);
            if (/^[\d.,]+$/.test(ct) && ct.includes(',')) tdPrices.push(parseNum(ct));
          }
          if (tdPrices.length === 0) continue;
          var nameIdx = -1, maxLen = 0;
          for (var c = 0; c < tds.length; c++) {
            var ct = cleanText(tds[c]);
            if (/^[\d.]+$/.test(ct)) continue;
            if (/^(UN|KG|LT|CX|PC|GR|ML|L|G|M|MT)$/i.test(ct)) continue;
            if (/^[\d]+[.,][\d]{2}$/.test(ct)) continue;
            if (/^(total|valor|descri|qtd)/i.test(ct)) continue;
            if (ct.length > maxLen) { maxLen = ct.length; nameIdx = c; }
          }
          if (nameIdx < 0 || maxLen < 2) continue;
          var name = cleanText(tds[nameIdx]);
          var vt = tdPrices[tdPrices.length - 1] || 0;
          var vu = tdPrices.length > 1 ? tdPrices[tdPrices.length - 2] : vt;
          var qty = 1;
          for (var c = 0; c < nameIdx; c++) {
            var v = parseNum(cleanText(tds[c]));
            if (v > 0 && v < 9999 && !cleanText(tds[c]).includes(',')) { qty = v; break; }
          }
          var unit = 'un';
          for (var c = 0; c < tds.length; c++) {
            if (/^(UN|KG|LT|CX|PC|GR|ML|L|G|M|MT)$/i.test(cleanText(tds[c]).trim())) { unit = cleanText(tds[c]).toUpperCase(); break; }
          }
          if (vt > 0) result.items.push({ code: '', name, quantity: qty || 1, unit, unitPrice: vu || vt, totalPrice: vt });
        }
      }

      return result;
    });

    res.json({ ok: true, data });
  } catch (err) {
    console.error('[scrape error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

app.listen(PORT, () => console.log(`Precímetro scraper na porta ${PORT}`));
