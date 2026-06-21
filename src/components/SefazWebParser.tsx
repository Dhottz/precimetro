import React, { useRef, useState } from 'react';
import {
  View,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Text,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { SefazResult } from '../services/sefaz';
import { colors, spacing, radius, shadow } from '../theme';

interface Props {
  url: string;
  onSuccess: (data: SefazResult) => void;
  onError: (msg: string) => void;
}

// Injetado quando o usuário confirma — extrai os dados do DOM já renderizado
const EXTRACT_SCRIPT = `
(function() {
  if (window.__sefazParserRunning) return;
  window.__sefazParserRunning = true;

  function parseNum(text) {
    if (!text) return 0;
    var s = (text || '').replace(/[^\\d,.]/g, '');
    if (!s) return 0;
    if (s.match(/,\\d{2}$/)) s = s.replace(/\\./g, '').replace(',', '.');
    return parseFloat(s) || 0;
  }
  function cleanText(el) {
    return ((el && (el.textContent || el.innerText)) || '').replace(/\\s+/g, ' ').trim();
  }
  function extractCNPJ(text) {
    var m = (text || '').match(/(\\d{2})[.\\s]?(\\d{3})[.\\s]?(\\d{3})[\\/\\s]?(\\d{4})[-\\s]?(\\d{2})/);
    return m ? (m[1]+m[2]+m[3]+m[4]+m[5]) : '';
  }
  function extractDate(text) {
    var m1 = (text || '').match(/(\\d{2})\\/(\\d{2})\\/(\\d{4})[\\s,T]+(\\d{2}:\\d{2})/);
    if (m1) return m1[3]+'-'+m1[2]+'-'+m1[1]+'T'+m1[4]+':00';
    var m2 = (text || '').match(/(\\d{2})\\/(\\d{2})\\/(\\d{4})/);
    if (m2) return m2[3]+'-'+m2[2]+'-'+m2[1]+'T00:00:00';
    return new Date().toISOString();
  }

  function extractData() {
    var body = document.body;
    if (!body) return null;
    var bodyText = body.innerText || body.textContent || '';
    var result = {
      storeName: '', cnpj: '', address: '', city: '', state: '',
      date: extractDate(bodyText), accessKey: '', total: 0, items: []
    };

    var nameSels = ['#u20','#nomeEmit','.nomeEmit','.txtTopo','.NomeEmit',
      '.razaoSocial','.nomeEmitente','.empresa','.emitente',
      '[id*="nomeEmit"]','[id*="razao"]','[class*="nomeEmit"]','[class*="razao"]'];
    for (var i = 0; i < nameSels.length; i++) {
      try { var el = document.querySelector(nameSels[i]);
        if (el) { var t = cleanText(el); if (t.length > 2) { result.storeName = t; break; } }
      } catch(e) {}
    }
    if (!result.storeName) {
      var heads = document.querySelectorAll('h1,h2,h3,.titulo');
      for (var i = 0; i < heads.length; i++) {
        var t = cleanText(heads[i]);
        if (t.length > 3 && !/nota|fiscal|nfc|consumidor|sefaz|consulta/i.test(t)) { result.storeName = t; break; }
      }
    }

    result.cnpj = extractCNPJ(bodyText);

    var addrSels = ['#u30','.endEmit','.Endereco','.enderecoEmitente','.endereco',
      '[id*="endereco"]','[class*="Endereco"]','[class*="endereco"]'];
    for (var i = 0; i < addrSels.length; i++) {
      try { var el = document.querySelector(addrSels[i]);
        if (el) { var t = cleanText(el); if (t.length > 3) { result.address = t; break; } }
      } catch(e) {}
    }

    var totalSels = ['#linhaTotal .nfcTotaisConteudo','#linhaTotal','.totalNF','.vlrTotal','#totalNota',
      '[id*="totalNota"]','[id*="vlrTotal"]','[class*="vlrTotal"]','[class*="totalNota"]'];
    for (var i = 0; i < totalSels.length; i++) {
      try { var el = document.querySelector(totalSels[i]);
        if (el) { var v = parseNum(cleanText(el)); if (v > 0) { result.total = v; break; } }
      } catch(e) {}
    }
    if (!result.total) {
      var tm = bodyText.match(/[Vv]alor\\s*[Tt]otal[^\\d]{0,10}([\\d.,]+)/);
      if (tm) result.total = parseNum(tm[1]);
    }

    // Estratégia 1: spans padrão NFC-e
    var titEls = document.querySelectorAll('.txtTit');
    if (titEls.length > 0) {
      for (var i = 0; i < titEls.length; i++) {
        var c = titEls[i].closest('.item') || titEls[i].parentElement;
        if (!c) continue;
        var name = cleanText(c.querySelector('.txtTit'));
        if (!name || name.length < 2) continue;
        var qty = parseNum(cleanText(c.querySelector('.Quant,[class*="Quant"],[class*="qtd"]'))) || 1;
        var unit = cleanText(c.querySelector('.unidCom,[class*="unid"]')) || 'un';
        var vu = parseNum(cleanText(c.querySelector('.vUnCom,[class*="vUn"],[class*="unit"]')));
        var vt = parseNum(cleanText(c.querySelector('.vProd,[class*="vProd"],[class*="Total"],[class*="total"]')));
        vt = vt || vu * qty; vu = vu || (qty > 0 ? vt / qty : vt);
        if (vt > 0) result.items.push({ code:'', name:name, quantity:qty, unit:unit||'un', unitPrice:vu, totalPrice:vt });
      }
    }

    // Estratégia 2: tabela com cabeçalho
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
        var iName=-1,iQty=-1,iUnit=-1,iVun=-1,iVtot=-1;
        for (var h=0;h<headers.length;h++) {
          var hh=headers[h];
          if(iName<0&&(hh.includes('descri')||hh.includes('produto')||hh==='item'||hh==='nome'))iName=h;
          if(iQty<0&&(hh.includes('qtd')||hh.includes('quant')))iQty=h;
          if(iUnit<0&&(hh==='un'||hh==='und'||hh==='unid'))iUnit=h;
          if(iVun<0&&(hh.includes('unit')||hh.includes('vl. un')||hh.includes('v.unit')))iVun=h;
          if(iVtot<0&&(hh.includes('total')||hh.includes('vl. tot')||hh.includes('v.tot')))iVtot=h;
        }
        if(iName<0)continue;
        var added=0;
        for(var r=headerRow+1;r<rows.length;r++){
          var cells=rows[r].querySelectorAll('td');
          if(cells.length<2)continue;
          var name=iName<cells.length?cleanText(cells[iName]):'';
          if(!name||name.length<2)continue;
          if(/^(descri|produto|item|c.d|qtd|valor|total|vl\.)/i.test(name))continue;
          var qty=(iQty>=0&&iQty<cells.length)?parseNum(cleanText(cells[iQty]))||1:1;
          var unit=(iUnit>=0&&iUnit<cells.length)?cleanText(cells[iUnit])||'un':'un';
          var vu=(iVun>=0&&iVun<cells.length)?parseNum(cleanText(cells[iVun])):0;
          var vt=(iVtot>=0&&iVtot<cells.length)?parseNum(cleanText(cells[iVtot])):0;
          vt=vt||vu*qty; vu=vu||(qty>0?vt/qty:vt);
          if(vt>0){result.items.push({code:'',name:name,quantity:qty,unit:unit||'un',unitPrice:vu,totalPrice:vt});added++;}
        }
        if(added>0)break;
      }
    }

    // Estratégia 3: varredura de <tr> sem cabeçalho
    if (result.items.length === 0) {
      var allRows = document.querySelectorAll('tr');
      for (var r=0;r<allRows.length;r++) {
        var tds=allRows[r].querySelectorAll('td');
        if(tds.length<3)continue;
        var rowText=cleanText(allRows[r]);
        if(!/\\d+[.,]\\d{2}/.test(rowText))continue;
        var tdPrices=[];
        for(var c=0;c<tds.length;c++){
          var ct=cleanText(tds[c]);
          if(/^[\\d.,]+$/.test(ct)&&ct.includes(','))tdPrices.push(parseNum(ct));
        }
        if(tdPrices.length===0)continue;
        var nameIdx=-1,maxLen=0;
        for(var c=0;c<tds.length;c++){
          var ct=cleanText(tds[c]);
          if(/^[\\d.]+$/.test(ct))continue;
          if(/^(UN|KG|LT|CX|PC|GR|ML|L|G|M|MT)$/i.test(ct))continue;
          if(/^[\\d]+[.,][\\d]{2}$/.test(ct))continue;
          if(/^(total|valor|descri|c.d|qtd|vl\.)/i.test(ct))continue;
          if(ct.length>maxLen){maxLen=ct.length;nameIdx=c;}
        }
        if(nameIdx<0||maxLen<2)continue;
        var name=cleanText(tds[nameIdx]);
        var vt=tdPrices[tdPrices.length-1]||0;
        var vu=tdPrices.length>1?tdPrices[tdPrices.length-2]:vt;
        var qty=1;
        for(var c=0;c<nameIdx;c++){
          var v=parseNum(cleanText(tds[c]));
          if(v>0&&v<9999&&!cleanText(tds[c]).includes(',')){qty=v;break;}
        }
        var unit='un';
        for(var c=0;c<tds.length;c++){
          if(/^(UN|KG|LT|CX|PC|GR|ML|L|G|M|MT)$/i.test(cleanText(tds[c]).trim())){unit=cleanText(tds[c]).toUpperCase();break;}
        }
        if(vt>0)result.items.push({code:'',name:name,quantity:qty||1,unit:unit,unitPrice:vu||vt,totalPrice:vt});
      }
    }

    // Estratégia 4: parsing linha a linha do texto
    if (result.items.length === 0) {
      var lines=bodyText.split('\\n').map(function(l){return l.trim();}).filter(Boolean);
      var itemRe=/^(.+?)\\s+(\\d+[.,]?\\d*)\\s+(UN|KG|LT|CX|PC|GR|ML|L|G|M|MT)\\s+[R$\\s]*(\\d+[.,]\\d+)\\s+[R$\\s]*(\\d+[.,]\\d+)/i;
      for(var i=0;i<lines.length;i++){
        var m=lines[i].match(itemRe);
        if(!m)continue;
        var name=m[1].trim();
        if(name.length<2)continue;
        result.items.push({code:'',name:name,quantity:parseNum(m[2])||1,unit:m[3].toUpperCase(),unitPrice:parseNum(m[4]),totalPrice:parseNum(m[5])});
      }
    }

    return result;
  }

  var data = extractData();
  window.ReactNativeWebView.postMessage(JSON.stringify({ ok: true, data: data || {} }));
  true;
})();
`;

// Injetado ANTES do JS da página — faz o WebView parecer um Chrome real para o TSPD/F5
const CHROME_SPOOF = `
(function() {
  if (!window.chrome) {
    window.chrome = {
      app: { isInstalled: false, InstallState: {}, RunningState: {} },
      runtime: { id: undefined, connect: function(){}, sendMessage: function(){} },
      loadTimes: function() { return { requestTime: Date.now()/1000 }; },
      csi: function() { return { startE: Date.now(), onloadT: Date.now(), pageT: 1.0, tran: 15 }; },
    };
  }
  // Remove indícios de WebView/automação
  try { Object.defineProperty(navigator, 'webdriver', { get: function(){ return false; } }); } catch(e) {}
  // Plugins falsos (Chrome real tem plugins, WebView não)
  try {
    if (navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        get: function() {
          var p = [{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }];
          p.item = function(i){ return p[i]; };
          p.namedItem = function(n){ return null; };
          p.refresh = function(){};
          p.length = 1;
          return p;
        }
      });
    }
  } catch(e) {}
  // languages
  try {
    if (!navigator.languages || navigator.languages.length === 0) {
      Object.defineProperty(navigator, 'languages', { get: function(){ return ['pt-BR','pt','en-US','en']; } });
    }
  } catch(e) {}
})();
`;

// Script leve injetado no onLoadEnd — só detecta se é bloqueio de IP ou nota real
const DETECT_SCRIPT = `
(function() {
  var text = document.body ? (document.body.innerText || document.body.textContent || '') : '';
  var isBlocked =
    text.includes('bloqueia acessos') ||
    text.includes('IP atual esteja listado') ||
    text.includes('N\\u00famero de ID \\u00e9:') ||
    text.includes('endere\\u00e7os IP usados por servi\\u00e7os residenciais');
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'detected', isBlocked: isBlocked }));
  true;
})();
`;

type Phase = 'loading' | 'confirm' | 'blocked' | 'extracting';

export default function SefazWebParser({ url, onSuccess, onError }: Props) {
  const ref = useRef<WebView>(null);
  const done = useRef(false);
  const [phase, setPhase] = useState<Phase>('loading');

  function resolve(data: SefazResult) {
    if (done.current) return;
    done.current = true;
    onSuccess(data);
  }

  function reject(msg: string) {
    if (done.current) return;
    done.current = true;
    onError(msg);
  }

  function handleNavigationStateChange(_navState: WebViewNavigation) {}

  function handleLoadEnd() {
    // Injeta script de detecção — resultado chega via onMessage
    ref.current?.injectJavaScript(DETECT_SCRIPT);
  }

  function handleConfirm() {
    setPhase('extracting');
    ref.current?.injectJavaScript(EXTRACT_SCRIPT);
  }

  function handleManual() {
    reject('IP bloqueado');
  }

  function handleCancel() {
    reject('Cancelado pelo usuário');
  }

  function handleMessage(event: { nativeEvent: { data: string } }) {
    try {
      const payload = JSON.parse(event.nativeEvent.data);

      // Resultado da detecção inicial
      if (payload.type === 'detected') {
        if (payload.isBlocked) {
          setPhase('blocked');
        } else {
          setPhase('confirm');
        }
        return;
      }

      // Resultado da extração (após o usuário confirmar)
      if (payload.ok) {
        resolve(payload.data as SefazResult);
      } else {
        reject(payload.error || 'Erro ao extrair dados');
      }
    } catch {
      reject('Resposta inválida do parser');
    }
  }

  function handleError() {
    reject('Não foi possível carregar o portal da SEFAZ');
  }

  return (
    <Modal visible transparent={false} animationType="slide" statusBarTranslucent>
      <SafeAreaView style={styles.container}>

        {/* Barra superior */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleCancel} style={styles.cancelBtn}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Nota Fiscal</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* WebView com a página real */}
        <View style={styles.webviewContainer}>
          <WebView
            ref={ref}
            source={{ uri: url }}
            style={StyleSheet.absoluteFill}
            onLoadEnd={handleLoadEnd}
            onNavigationStateChange={handleNavigationStateChange}
            onError={handleError}
            onMessage={handleMessage}
            javaScriptEnabled
            domStorageEnabled
            // Faz o WebView se passar por Chrome real antes do JS da página rodar
            injectedJavaScriptBeforeContentLoaded={CHROME_SPOOF}
            // UA idêntico ao Chrome Android para não ser detectado como WebView
            userAgent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36"
            // Permite cookies de sessão (necessário para o TSPD validar)
            thirdPartyCookiesEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>Carregando portal da SEFAZ...</Text>
              </View>
            )}
          />

          {/* Overlay de extração (após confirmar) */}
          {phase === 'extracting' && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Extraindo itens da nota...</Text>
            </View>
          )}
        </View>

        {/* Rodapé: confirmação da nota */}
        {phase === 'confirm' && (
          <View style={styles.footer}>
            <Text style={styles.footerQuestion}>Esta é a sua nota fiscal?</Text>
            <View style={styles.footerButtons}>
              <TouchableOpacity style={styles.btnCancel} onPress={handleCancel}>
                <Ionicons name="close-circle-outline" size={20} color={colors.danger} />
                <Text style={styles.btnCancelText}>Não</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnConfirm} onPress={handleConfirm}>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.btnConfirmText}>Sim, puxar dados</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Rodapé: IP bloqueado pela SEFAZ-RJ */}
        {phase === 'blocked' && (
          <View style={styles.footer}>
            <View style={styles.blockedBanner}>
              <Ionicons name="warning-outline" size={20} color="#92400e" />
              <Text style={styles.blockedText}>
                Seu IP está bloqueado pela SEFAZ-RJ. Isso ocorre com alguns IPs de operadoras móveis.
                Tente via Wi-Fi ou adicione os itens manualmente.
              </Text>
            </View>
            <View style={styles.footerButtons}>
              <TouchableOpacity style={styles.btnCancel} onPress={handleCancel}>
                <Text style={styles.btnCancelText}>Fechar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnConfirm} onPress={handleManual}>
                <Ionicons name="create-outline" size={20} color="#fff" />
                <Text style={styles.btnConfirmText}>Digitar itens</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cancelBtn: { padding: 6 },
  topTitle: { fontSize: 16, fontWeight: '700', color: colors.text },

  webviewContainer: { flex: 1, position: 'relative' },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: { fontSize: 15, color: colors.textMuted },

  footer: {
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  footerQuestion: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  footerButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  btnCancel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  btnCancelText: { color: colors.danger, fontWeight: '600', fontSize: 15 },
  btnConfirm: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  btnConfirmText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  blockedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fef3c7',
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  blockedText: { flex: 1, fontSize: 13, color: '#92400e', lineHeight: 18 },
});
