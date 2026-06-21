import { parse, HTMLElement } from 'node-html-parser';

export interface SefazResult {
  storeName: string;
  cnpj: string;
  address: string;
  city: string;
  state: string;
  date: string;
  accessKey: string;
  total: number;
  items: ReceiptItem[];
}

export interface ReceiptItem {
  code: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

export async function parseReceiptFromQR(qrUrl: string): Promise<SefazResult> {
  const isRJ = qrUrl.toLowerCase().includes('fazenda.rj.gov.br');

  let html: string;
  try {
    html = isRJ
      ? await fetchRJPortal(qrUrl)
      : await fetchSimple(qrUrl);
  } catch (err: any) {
    throw new Error(`Não foi possível acessar o portal da SEFAZ: ${err.message}`);
  }

  return parseNFCeHTML(html, qrUrl);
}

// Fetch simples para portais com HTML estático
async function fetchSimple(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Android 14; Mobile; rv:109.0) Gecko/109.0 Firefox/119.0',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

// Fetch em dois passos para o portal RJ (JSF/AJAX)
async function fetchRJPortal(url: string): Promise<string> {
  // Passo 1: GET para obter sessão e ViewState
  const resp1 = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Android 14; Mobile; rv:109.0) Gecko/109.0 Firefox/119.0',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
  });
  if (!resp1.ok) throw new Error(`HTTP ${resp1.status}`);

  const html1 = await resp1.text();

  // Extrai cookie de sessão
  const setCookie = resp1.headers.get('set-cookie') || '';
  const sessionMatch = setCookie.match(/JSESSIONID=([^;]+)/i);
  const session = sessionMatch ? `JSESSIONID=${sessionMatch[1]}` : '';

  // Extrai ViewState
  const vsMatch = html1.match(/id="javax\.faces\.ViewState"[^>]*value="([^"]+)"/i)
    || html1.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/i);
  const viewState = vsMatch ? vsMatch[1] : '';

  // Extrai ID do formulário
  const formMatch = html1.match(/<form[^>]+id="([^"]+)"/i);
  const formId = formMatch ? formMatch[1] : 'j_idt13';

  if (!viewState) {
    // Sem ViewState — provavelmente já retornou conteúdo (não JSF)
    return html1;
  }

  // Passo 2: POST com partial AJAX do JSF
  const body = [
    `javax.faces.partial.ajax=true`,
    `javax.faces.source=${encodeURIComponent(formId)}`,
    `javax.faces.partial.execute=%40all`,
    `javax.faces.partial.render=%40all`,
    `${encodeURIComponent(formId)}=${encodeURIComponent(formId)}`,
    `javax.faces.ViewState=${encodeURIComponent(viewState)}`,
  ].join('&');

  const resp2 = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Android 14; Mobile; rv:109.0) Gecko/109.0 Firefox/119.0',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/xml, text/xml, */*; q=0.01',
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
      ...(session ? { Cookie: session } : {}),
    },
    body,
  });

  const xml = await resp2.text();

  // Resposta JSF partial: extrai HTML do CDATA dentro de <update>
  const updates: string[] = [];
  const updateRe = /<update[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/update>/g;
  let m;
  while ((m = updateRe.exec(xml)) !== null) updates.push(m[1]);

  return updates.length > 0 ? updates.join('\n') : xml;
}

function parseNFCeHTML(html: string, url: string): SefazResult {
  const root = parse(html);
  const uf = detectState(url);

  const storeName =
    clean(root.querySelector('#u20, .nomeEmit, .txtTopo, .NomeEmit, .nomeEmitente, .razaoSocial')?.text) ||
    extractRegex(html, /Razão Social[:\s]*([^\n<]{3,80})/i) ||
    extractRegex(html, /class="[^"]*nome[^"]*"[^>]*>([^<]{3,80})/i) ||
    'Estabelecimento';

  const cnpj = extractCNPJ(html);
  const address = clean(root.querySelector('#u30, .endEmit, .Endereco, .enderecoEmitente, .endereco')?.text) || '';
  const date = extractDate(html);
  const total = extractTotal(root, html);

  // Tenta todos os parsers em ordem de confiança
  const items =
    parseItemsRJ(root, html) ||
    parseItemsSpans(root) ||
    parseItemsTable(root) ||
    parseItemsDivs(root) ||
    parseItemsRegex(html) ||
    [];

  const parts = address.split('-');
  const city = parts.length > 1 ? clean(parts[parts.length - 1]) : '';

  return {
    storeName,
    cnpj,
    address,
    city,
    state: uf,
    date: date || new Date().toISOString(),
    accessKey: extractAccessKey(html),
    total,
    items,
  };
}

// ── Parser específico para o portal RJ (resultadoQRCode2.faces / JSF) ─────────
// O portal RJ usa tabelas com colunas: Cód | Descrição | Qtd | Un | Vl.Unit | Vl.Total
function parseItemsRJ(root: HTMLElement, html: string): ReceiptItem[] | null {
  const items: ReceiptItem[] = [];

  // Tenta encontrar a tabela de produtos — o portal RJ usa h:dataTable do JSF
  // que renderiza como <table> com linhas de dados
  const tables = root.querySelectorAll('table');
  for (const table of tables) {
    const rows = table.querySelectorAll('tr');
    if (rows.length < 2) continue;

    // Verifica se parece uma tabela de produtos (cabeçalho com "Descrição" ou "Produto")
    const header = clean(rows[0].text).toLowerCase();
    if (!header.includes('descri') && !header.includes('produto') && !header.includes('item')) continue;

    // Detecta índice de cada coluna pelo cabeçalho
    const headers = rows[0].querySelectorAll('th, td').map((h) => clean(h.text).toLowerCase());
    const iDesc = headers.findIndex((h) => h.includes('descri') || h.includes('produto'));
    const iQtd  = headers.findIndex((h) => h.includes('qtd') || h.includes('quant'));
    const iUn   = headers.findIndex((h) => h.includes('un') && !h.includes('unit') && !h.includes('unid') || h === 'un');
    const iVun  = headers.findIndex((h) => h.includes('unit') || h.includes('vl. un') || h.includes('v. unit'));
    const iVtot = headers.findIndex((h) => h.includes('total') || h.includes('vl. tot') || h.includes('v. tot'));

    if (iDesc < 0) continue;

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].querySelectorAll('td');
      if (cells.length < 2) continue;

      const getText = (idx: number) => idx >= 0 && idx < cells.length ? clean(cells[idx].text) : '';

      const name = getText(iDesc);
      if (!name || isHeaderText(name)) continue;

      const qty       = iQtd  >= 0 ? parseNum(getText(iQtd))  : 1;
      const unit      = iUn   >= 0 ? getText(iUn) || 'un'     : 'un';
      const unitPrice = iVun  >= 0 ? parseNum(getText(iVun))  : 0;
      const totalPrice= iVtot >= 0 ? parseNum(getText(iVtot)) : 0;

      const q = qty || 1;
      const vUnit  = unitPrice  || (totalPrice / q);
      const vTotal = totalPrice || (unitPrice * q);

      if (name && vTotal > 0) {
        items.push({ code: '', name, quantity: q, unit: unit || 'un', unitPrice: vUnit, totalPrice: vTotal });
      }
    }

    if (items.length > 0) return items;
  }

  // Fallback RJ: alguns layouts usam divs com outputText JSF
  // Padrão: label "Descrição" seguido de valor em span/div irmão
  const descLabels = root.querySelectorAll('[id*="descricao"], [id*="Descricao"], [id*="produto"], [id*="nomeProd"]');
  if (descLabels.length > 0) {
    for (const el of descLabels) {
      const name = clean(el.text);
      if (!name || name.length < 2) continue;
      // Tenta pegar quantidade e preço de elementos adjacentes no mesmo bloco pai
      const parent = el.parentNode;
      if (!parent) continue;
      const siblings = (parent as HTMLElement).querySelectorAll('span, td, div');
      const nums = siblings.map((s) => parseNum(s.text)).filter((n) => n > 0);
      const qty = nums[0] || 1;
      const unitPrice = nums.length > 1 ? nums[nums.length - 2] : nums[0] || 0;
      const totalPrice = nums.length > 0 ? nums[nums.length - 1] : 0;
      if (totalPrice > 0) {
        items.push({ code: '', name, quantity: qty, unit: 'un', unitPrice, totalPrice });
      }
    }
    if (items.length > 0) return items;
  }

  return null;
}

// ── Parser 1: spans com classes padrão NFC-e (mais comum entre estados) ───────
// Padrão: <span class="txtTit">, <span class="Quant">, <span class="vUnCom">, etc.
function parseItemsSpans(root: HTMLElement): ReceiptItem[] | null {
  // Cada item costuma estar dentro de um container .item ou .col-xs-12
  const containers = root.querySelectorAll(
    '.item, .col-xs-12.col-sm-12.col-md-10, [class*="item"]'
  );

  const items: ReceiptItem[] = [];

  for (const container of containers) {
    const name =
      clean(container.querySelector('.txtTit, .NomeProduto, [class*="Tit"]')?.text) ||
      clean(container.querySelector('span')?.text);

    if (!name || name.length < 2 || isHeaderText(name)) continue;

    const qty = parseNum(
      container.querySelector('.Quant, .qtd, [class*="Quant"]')?.text || ''
    );
    const unit =
      clean(container.querySelector('.unidCom, .un, [class*="unid"]')?.text) || 'un';
    const unitPrice = parseNum(
      container.querySelector('.vUnCom, .vlUnit, [class*="vUn"]')?.text || ''
    );
    const totalPrice = parseNum(
      container.querySelector('.vProd, .vlTotal, [class*="vProd"], [class*="Total"]')?.text || ''
    );

    if (name && (qty > 0 || totalPrice > 0)) {
      const q = qty || 1;
      const vUnit = unitPrice || (totalPrice / q);
      const vTotal = totalPrice || (unitPrice * q);
      items.push({ code: '', name, quantity: q, unit, unitPrice: vUnit, totalPrice: vTotal });
    }
  }

  return items.length > 0 ? items : null;
}

// ── Parser 2: tabela HTML (SP e alguns outros estados) ────────────────────────
function parseItemsTable(root: HTMLElement): ReceiptItem[] | null {
  const rows = root.querySelectorAll('table#tabResult tr, table tr');
  const items: ReceiptItem[] = [];

  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 4) continue;

    const texts = cells.map((c) => clean(c.text));
    const name = texts[0] || texts[1];
    if (!name || isHeaderText(name)) continue;

    // Extrai todos os números das células restantes
    const nums = texts.slice(1).map(parseNum).filter((n) => n > 0);
    if (nums.length < 1) continue;

    const qty = nums[0] || 1;
    const unitPrice = nums.length >= 2 ? nums[nums.length - 2] : nums[0];
    const totalPrice = nums[nums.length - 1];
    const unit = texts[2] && isNaN(Number(texts[2].replace(',', '.'))) ? texts[2] : 'un';

    items.push({ code: '', name, quantity: qty, unit, unitPrice, totalPrice });
  }

  return items.length > 0 ? items : null;
}

// ── Parser 3: divs genéricas com padrões de layout de NFC-e ──────────────────
function parseItemsDivs(root: HTMLElement): ReceiptItem[] | null {
  const items: ReceiptItem[] = [];

  // Tenta encontrar blocos de produto por padrão de layout
  const allDivs = root.querySelectorAll('div, li');
  for (const div of allDivs) {
    const text = clean(div.text);
    if (!text || text.length < 5 || text.length > 200) continue;

    // Verifica se parece um item de produto: tem nome + preço
    const priceMatch = text.match(/R?\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/g);
    if (!priceMatch || priceMatch.length < 1) continue;

    // Evita blocos que são totais/cabeçalhos
    if (/total|subtotal|desconto|troco|pagamento|cpf|cnpj/i.test(text)) continue;

    const lines = text.split(/\n|\s{3,}/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 1) continue;

    const name = lines[0];
    if (!name || name.length < 3 || isHeaderText(name)) continue;

    const prices = priceMatch.map(parseNum).filter((n) => n > 0);
    if (prices.length === 0) continue;

    const totalPrice = prices[prices.length - 1];
    const unitPrice = prices.length > 1 ? prices[prices.length - 2] : totalPrice;

    items.push({ code: '', name, quantity: 1, unit: 'un', unitPrice, totalPrice });
  }

  // Remove duplicatas pelo nome
  const seen = new Set<string>();
  return items.filter((i) => {
    if (seen.has(i.name)) return false;
    seen.add(i.name);
    return true;
  }).length > 0 ? items : null;
}

// ── Parser 4: regex direto no HTML bruto (último recurso) ────────────────────
// Funciona extraindo padrões de "nome \n quantidade x preço = total"
function parseItemsRegex(html: string): ReceiptItem[] | null {
  const items: ReceiptItem[] = [];

  // Padrão: texto entre tags com qtd x preço unitário
  // Ex: "FEIJAO CARIOCA 1 KG\n1 UN x R$ 7,99"
  const pattern = /([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][A-ZÁÉÍÓÚÀÂÊÔÃÕÇa-z0-9\s.,%-]{3,60})\s+(\d{1,4}(?:[.,]\d{3})?(?:[.,]\d+)?)\s*(?:un|kg|lt|pc|cx|g|ml|un\.|pç)?[\s\S]{0,30}?R?\$?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/gi;

  let match;
  while ((match = pattern.exec(html)) !== null) {
    const name = clean(match[1]);
    if (!name || isHeaderText(name) || name.length < 3) continue;

    const qty = parseNum(match[2]) || 1;
    const price = parseNum(match[3]);
    if (price <= 0) continue;

    items.push({ code: '', name, quantity: qty, unit: 'un', unitPrice: price, totalPrice: price * qty });
    if (items.length >= 50) break; // limite de segurança
  }

  // Remove duplicatas
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    if (seen.has(i.name)) return false;
    seen.add(i.name);
    return true;
  });

  return unique.length > 0 ? unique : null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractCNPJ(text: string): string {
  const m = text.match(/\d{2}[\.\s]?\d{3}[\.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2}/);
  return m ? m[0].replace(/\D/g, '') : '';
}

function extractAccessKey(html: string): string {
  const m = html.match(/\d{44}/);
  return m ? m[0] : '';
}

function extractDate(html: string): string {
  const m1 = html.match(/(\d{2})\/(\d{2})\/(\d{4})[T\s,]+(\d{2}:\d{2})/);
  if (m1) return new Date(`${m1[3]}-${m1[2]}-${m1[1]}T${m1[4]}:00`).toISOString();
  const m2 = html.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return new Date(`${m2[3]}-${m2[2]}-${m2[1]}`).toISOString();
  return new Date().toISOString();
}

function extractTotal(root: HTMLElement, html: string): number {
  const selectors = [
    '#linhaTotal .nfcTotaisConteudo',
    '.totalNF', '.vlrTotal', '#totalNota',
    '[class*="total"] [class*="valor"]',
    '[class*="Total"] [class*="Valor"]',
  ];
  for (const sel of selectors) {
    const val = parseNum(root.querySelector(sel)?.text || '');
    if (val > 0) return val;
  }
  // Regex: "Valor Total R$ 99,99" ou "TOTAL R$99,99"
  const m = html.match(/[Vv]alor\s*[Tt]otal[^0-9]*(\d[\d.,]+)/);
  if (m) return parseNum(m[1]);
  const m2 = html.match(/TOTAL[^0-9R$]*R?\$?\s*(\d[\d.,]+)/);
  if (m2) return parseNum(m2[1]);
  return 0;
}

function isHeaderText(text: string): boolean {
  return /^(descrição|produto|item|código|qtd|quantidade|un\b|unid|valor|preço|total|subtotal|nr\.|no\.|cód)/i.test(
    text.trim()
  );
}

function detectState(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('.sp.') || u.includes('sefaz.sp') || u.includes('fazenda.sp')) return 'SP';
  if (u.includes('.rs.') || u.includes('sefaz.rs')) return 'RS';
  if (u.includes('.rj.') || u.includes('sefaz.rj') || u.includes('fazenda.rj')) return 'RJ';
  if (u.includes('.pr.') || u.includes('sefa.pr')) return 'PR';
  if (u.includes('.mg.') || u.includes('fazenda.mg')) return 'MG';
  if (u.includes('.sc.') || u.includes('sef.sc')) return 'SC';
  if (u.includes('.ba.') || u.includes('sefaz.ba')) return 'BA';
  if (u.includes('.ce.') || u.includes('sefaz.ce')) return 'CE';
  if (u.includes('.pe.') || u.includes('sefaz.pe')) return 'PE';
  if (u.includes('.go.') || u.includes('sefaz.go')) return 'GO';
  if (u.includes('.df.') || u.includes('sefaz.df')) return 'DF';
  if (u.includes('.am.') || u.includes('sefaz.am')) return 'AM';
  if (u.includes('.mt.') || u.includes('sefaz.mt')) return 'MT';
  if (u.includes('.ms.') || u.includes('dfe.ms')) return 'MS';
  if (u.includes('.es.') || u.includes('sefaz.es')) return 'ES';
  return 'BR';
}

function parseNum(text: string): number {
  if (!text) return 0;
  // Remove tudo exceto dígitos, vírgula e ponto
  let s = text.replace(/[^\d,\.]/g, '');
  // Se tem vírgula como decimal (padrão BR): 1.234,56 → 1234.56
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  return parseFloat(s) || 0;
}

function clean(text: string | undefined): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').replace(/[\r\n\t]/g, ' ').trim();
}

function extractRegex(text: string, regex: RegExp): string {
  const m = text.match(regex);
  return m ? clean(m[1]) : '';
}

// ── Utilitários exportados ────────────────────────────────────────────────────

export function normalizeCNPJ(cnpj: string): string {
  return cnpj.replace(/\D/g, '');
}

export function formatCNPJ(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '');
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STATE_CODE: Record<string, string> = {
  '11':'RO','12':'AC','13':'AM','14':'RR','15':'PA','16':'AP','17':'TO',
  '21':'MA','22':'PI','23':'CE','24':'RN','25':'PB','26':'PE','27':'AL',
  '28':'SE','29':'BA','31':'MG','32':'ES','33':'RJ','35':'SP','41':'PR',
  '42':'SC','43':'RS','50':'MS','51':'MT','52':'GO','53':'DF',
};

/**
 * Extrai CNPJ, data e estado diretamente da chave de acesso embutida na URL do QR.
 * Não requer nenhuma chamada de rede.
 * Chave NF-e: cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1) = 44 dígitos
 */
export function extractFromAccessKey(qrUrl: string): { cnpj: string; date: string; state: string } {
  const match = qrUrl.match(/[?&]p=(\d{44})/);
  if (!match) return { cnpj: '', date: new Date().toISOString(), state: '' };
  const key = match[1];
  const cuf  = key.substring(0, 2);
  const aamm = key.substring(2, 6);
  const cnpj = key.substring(6, 20);
  const year  = 2000 + parseInt(aamm.substring(0, 2), 10);
  const month = parseInt(aamm.substring(2, 4), 10);
  const date  = new Date(year, month - 1, 1).toISOString();
  return { cnpj, date, state: STATE_CODE[cuf] || '' };
}

export function isValidQRUrl(url: string): boolean {
  try {
    const lower = url.toLowerCase();
    const isGovBr = lower.includes('.gov.br');
    const isFiscal =
      lower.includes('nfce') ||
      lower.includes('nfe') ||
      lower.includes('sefaz') ||
      lower.includes('fazenda') ||
      lower.includes('sefa.') ||
      lower.includes('sefin') ||
      lower.includes('sat.');
    return isGovBr && isFiscal;
  } catch {
    return false;
  }
}
