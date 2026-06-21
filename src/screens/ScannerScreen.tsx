import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Timestamp } from 'firebase/firestore';
import { RootStackParamList, Store } from '../types';
import { SefazResult, isValidQRUrl, normalizeCNPJ, formatCNPJ, extractFromAccessKey } from '../services/sefaz';
import { scrapeReceipt, scraperConfigured } from '../services/scraper';
import { getStore, saveStore, saveReceipt } from '../services/receipts';
import { colors, spacing, radius, shadow } from '../theme';
import SefazWebParser from '../components/SefazWebParser';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ScannerScreen() {
  const navigation = useNavigation<Nav>();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [webParserUrl, setWebParserUrl] = useState<string | null>(null);
  const webParserCallbacks = useRef<{
    onSuccess: (data: SefazResult) => void;
    onError: (msg: string) => void;
  } | null>(null);
  const [nicknameModal, setNicknameModal] = useState<{
    visible: boolean;
    cnpj: string;
    officialName: string;
    qrUrl: string;
  }>({ visible: false, cnpj: '', officialName: '', qrUrl: '' });
  const [nickname, setNickname] = useState('');
  const cooldown = useRef(false);

  // Tenta o servidor Railway primeiro; cai no WebView se não configurado
  async function parseReceipt(url: string): Promise<SefazResult> {
    if (scraperConfigured()) {
      return scrapeReceipt(url);
    }
    return parseViaWebView(url);
  }

  // WebView como fallback quando servidor não está configurado
  function parseViaWebView(url: string): Promise<SefazResult> {
    return new Promise((resolve, reject) => {
      webParserCallbacks.current = { onSuccess: resolve, onError: reject };
      setWebParserUrl(url);
    });
  }

  function handleWebParserSuccess(data: SefazResult) {
    setWebParserUrl(null);
    webParserCallbacks.current?.onSuccess(data);
    webParserCallbacks.current = null;
  }

  function handleWebParserError(msg: string) {
    setWebParserUrl(null);
    webParserCallbacks.current?.onError(new Error(msg));
    webParserCallbacks.current = null;
  }

  async function handleBarcodeScanned({ data }: { data: string }) {
    if (cooldown.current || processing) return;
    cooldown.current = true;
    setTimeout(() => { cooldown.current = false; }, 3000);

    if (!isValidQRUrl(data)) {
      Alert.alert('QR inválido', 'Este QR code não parece ser de uma nota fiscal eletrônica.');
      return;
    }

    setProcessing(true);
    try {
      const sefazData = await parseReceipt(data);
      const cnpjClean = normalizeCNPJ(sefazData.cnpj);

      let store = await getStore(cnpjClean);

      if (!store) {
        setNicknameModal({
          visible: true,
          cnpj: cnpjClean,
          officialName: sefazData.storeName,
          qrUrl: data,
        });
        setNickname(sefazData.storeName);
        setProcessing(false);
        return;
      }

      if (isParsedDataBad(sefazData)) {
        setProcessing(false);
        navigation.navigate('ManualItems', {
          store,
          date: sefazData.date,
          total: sefazData.total,
          qrUrl: data,
        });
        return;
      }

      const receiptId = await saveReceipt(sefazData, store);
      setProcessing(false);
      navigation.navigate('ReceiptDetail', { receiptId });
    } catch (err: any) {
      setProcessing(false);
      const msg: string = err.message ?? '';
      if (msg === 'Cancelado pelo usuário') return;

      if (msg === 'IP bloqueado') {
        // Portal bloqueou o acesso — extrai CNPJ da chave de acesso no QR
        const { cnpj: rawCnpj, date } = extractFromAccessKey(data);
        const cnpjClean = normalizeCNPJ(rawCnpj);
        if (!cnpjClean) return;
        const store = await getStore(cnpjClean);
        if (store) {
          navigation.navigate('ManualItems', { store, date, total: 0, qrUrl: data });
        } else {
          // Loja desconhecida — pede apelido antes de ir para entrada manual
          setNicknameModal({ visible: true, cnpj: cnpjClean, officialName: 'Novo estabelecimento', qrUrl: data });
          setNickname('');
        }
        return;
      }

      Alert.alert('Erro ao processar nota', msg || 'Tente novamente.');
    }
  }

  async function handleSaveNickname() {
    if (!nickname.trim()) return;
    setProcessing(true);

    const store: Store = {
      id: nicknameModal.cnpj,
      cnpj: formatCNPJ(nicknameModal.cnpj),
      officialName: nicknameModal.officialName,
      nickname: nickname.trim(),
    };

    try {
      await saveStore(store);
      const sefazData = await parseReceipt(nicknameModal.qrUrl);
      setNicknameModal({ visible: false, cnpj: '', officialName: '', qrUrl: '' });
      setProcessing(false);

      if (isParsedDataBad(sefazData)) {
        navigation.navigate('ManualItems', {
          store,
          date: sefazData.date,
          total: sefazData.total,
          qrUrl: nicknameModal.qrUrl,
        });
        return;
      }

      const receiptId = await saveReceipt(sefazData, store);
      navigation.navigate('ReceiptDetail', { receiptId });
    } catch (err: any) {
      setProcessing(false);
      const msg: string = err.message ?? '';
      if (msg === 'Cancelado pelo usuário') {
        setNicknameModal({ visible: false, cnpj: '', officialName: '', qrUrl: '' });
        return;
      }
      if (msg === 'IP bloqueado') {
        setNicknameModal({ visible: false, cnpj: '', officialName: '', qrUrl: '' });
        const { date } = extractFromAccessKey(nicknameModal.qrUrl);
        navigation.navigate('ManualItems', { store, date, total: 0, qrUrl: nicknameModal.qrUrl });
        return;
      }
      Alert.alert('Erro', msg || 'Tente novamente.');
    }
  }

  // Detecta quando o parser retornou dados claramente inválidos
  function isParsedDataBad(data: { items: Array<{ name: string; totalPrice: number; quantity: number }>, storeName: string, total: number }): boolean {
    if (data.items.length === 0) return true;
    if (data.storeName === 'Estabelecimento') return true;
    const badItems = data.items.filter((item) => {
      // Nome com maioria de números/vírgulas é lixo do parser
      const letters = (item.name.match(/[a-zA-ZÀ-ú]/g) || []).length;
      const total = item.name.length;
      if (total > 0 && letters / total < 0.3) return true;
      // Quantidade absurda
      if (item.quantity > 9999) return true;
      // Preço absurdo (> R$ 10.000 por unidade)
      if (item.totalPrice > 10000) return true;
      return false;
    });
    return badItems.length > 0 && badItems.length >= data.items.length;
  }

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Ionicons name="camera-outline" size={64} color={colors.textMuted} />
        <Text style={styles.permText}>Permissão de câmera necessária</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Permitir acesso</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        onBarcodeScanned={scanning ? handleBarcodeScanned : undefined}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      />

      {/* Overlay escuro com janela de scan */}
      <View style={styles.overlay}>
        <View style={styles.topOverlay} />
        <View style={styles.middleRow}>
          <View style={styles.sideOverlay} />
          <View style={styles.scanWindow}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
          </View>
          <View style={styles.sideOverlay} />
        </View>
        <View style={styles.bottomOverlay}>
          <Text style={styles.hint}>Aponte para o QR code da nota fiscal</Text>
          <TouchableOpacity
            style={[styles.scanBtn, scanning && styles.scanBtnActive]}
            onPress={() => setScanning((v) => !v)}
          >
            <Ionicons
              name={scanning ? 'stop-circle' : 'scan-circle'}
              size={72}
              color={scanning ? colors.danger : colors.primary}
            />
            <Text style={[styles.scanLabel, scanning && { color: colors.danger }]}>
              {scanning ? 'Parar' : 'Escanear'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Loading (só mostra quando não tem WebView modal ativo) */}
      {processing && !webParserUrl && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Carregando nota fiscal...</Text>
          </View>
        </View>
      )}

      {/* WebView oculto para parsing automático do portal SEFAZ */}
      {webParserUrl && (
        <SefazWebParser
          url={webParserUrl}
          onSuccess={handleWebParserSuccess}
          onError={handleWebParserError}
        />
      )}

      {/* Modal de apelido */}
      <Modal visible={nicknameModal.visible} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <Ionicons name="storefront" size={40} color={colors.primary} style={{ alignSelf: 'center', marginBottom: 8 }} />
            <Text style={styles.modalTitle}>Novo mercado encontrado!</Text>
            <Text style={styles.modalStoreName}>{nicknameModal.officialName}</Text>
            <Text style={styles.modalSubtitle}>
              CNPJ: {formatCNPJ(nicknameModal.cnpj)}
            </Text>
            <Text style={styles.modalLabel}>Dê um apelido para este mercado:</Text>
            <TextInput
              style={styles.input}
              value={nickname}
              onChangeText={setNickname}
              placeholder="Ex: Mercado do Bairro, Zaffari..."
              placeholderTextColor={colors.textMuted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSaveNickname}
            />
            <TouchableOpacity
              style={[styles.btn, !nickname.trim() && styles.btnDisabled]}
              onPress={handleSaveNickname}
              disabled={!nickname.trim()}
            >
              <Text style={styles.btnText}>Salvar e ver nota</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const SCAN_SIZE = 260;
const OVERLAY_COLOR = 'rgba(0,0,0,0.55)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.xl },
  permText: { fontSize: 16, color: colors.text, marginTop: spacing.md, marginBottom: spacing.lg, textAlign: 'center' },
  overlay: { flex: 1 },
  topOverlay: { flex: 1, backgroundColor: OVERLAY_COLOR },
  middleRow: { flexDirection: 'row', height: SCAN_SIZE },
  sideOverlay: { flex: 1, backgroundColor: OVERLAY_COLOR },
  scanWindow: {
    width: SCAN_SIZE,
    height: SCAN_SIZE,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: '#fff',
    borderWidth: 3,
  },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: radius.md },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: radius.md },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: radius.md },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: radius.md },
  bottomOverlay: {
    flex: 1,
    backgroundColor: OVERLAY_COLOR,
    alignItems: 'center',
    paddingTop: spacing.xl,
  },
  hint: { color: '#fff', fontSize: 14, marginBottom: spacing.lg, opacity: 0.85 },
  scanBtn: { alignItems: 'center' },
  scanBtnActive: {},
  scanLabel: { color: colors.primary, fontWeight: '700', marginTop: 4, fontSize: 15 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    ...shadow.md,
  },
  loadingText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: 40,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 4 },
  modalStoreName: { fontSize: 15, color: colors.primary, fontWeight: '600', textAlign: 'center' },
  modalSubtitle: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.lg },
  modalLabel: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.sm },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    color: colors.text,
    marginBottom: spacing.md,
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  btnDisabled: { backgroundColor: colors.textMuted },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
