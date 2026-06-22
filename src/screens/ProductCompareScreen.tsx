import React, { useEffect, useState, useLayoutEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Dimensions,
  TouchableOpacity, Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LineChart } from 'react-native-chart-kit';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { RootStackParamList, Product, ProductPrice } from '../types';
import { getAllProducts, renameProduct, mergeProducts } from '../services/receipts';
import { normalizeProductName } from '../services/sefaz';
import { colors, spacing, radius, shadow } from '../theme';

type Route = RouteProp<RootStackParamList, 'ProductCompare'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

interface StoreGrouped {
  storeId: string;
  storeName: string;
  prices: ProductPrice[];        // desc por data
  sortedPrices: ProductPrice[];  // asc por data (para o gráfico)
  currentPrice: number;
  lowestPrice: number;
  highestPrice: number;
  color: string;
}

interface TimelineEvent {
  date: Date;
  storeId: string;
  storeName: string;
  price: number;
  color: string;
}

// Paleta de cores por loja
const STORE_COLORS = ['#1a56db', '#0e9f6e', '#e3a008', '#7e3af2', '#f05252', '#00bcd4', '#ff8c00'];

const SCREEN_WIDTH = Dimensions.get('window').width;

export default function ProductCompareScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const [product, setProduct] = useState<Product | null>(null);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [storeGroups, setStoreGroups] = useState<StoreGrouped[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Modais
  const [renameModal, setRenameModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [mergeModal, setMergeModal] = useState(false);
  const [mergeSearch, setMergeSearch] = useState('');
  const [merging, setSaving] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => { setNewName(product?.name ?? ''); setRenameModal(true); }}
          style={{ paddingRight: 4 }}
        >
          <Ionicons name="pencil-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, product]);

  async function load() {
    const all = await getAllProducts();
    setAllProducts(all);
    const normalized = normalizeProductName(params.productName);
    const found = all.find(
      (p) => p.normalizedName === normalized || p.name === params.productName
    );

    if (!found) { setLoading(false); return; }
    setProduct(found);

    buildGroups(found);
    setLoading(false);
  }

  function buildGroups(found: Product) {

    // agrupar por loja
    const map = new Map<string, ProductPrice[]>();
    for (const p of found.prices) {
      const list = map.get(p.storeId) ?? [];
      list.push(p);
      map.set(p.storeId, list);
    }

    let colorIdx = 0;
    const groups: StoreGrouped[] = [];
    map.forEach((prices, storeId) => {
      const sortedDesc = [...prices].sort((a, b) => b.date.toMillis() - a.date.toMillis());
      const sortedAsc = [...prices].sort((a, b) => a.date.toMillis() - b.date.toMillis());
      const priceValues = prices.map((p) => p.price);
      groups.push({
        storeId,
        storeName: prices[0].storeName,
        prices: sortedDesc,
        sortedPrices: sortedAsc,
        currentPrice: sortedDesc[0].price,
        lowestPrice: Math.min(...priceValues),
        highestPrice: Math.max(...priceValues),
        color: STORE_COLORS[colorIdx++ % STORE_COLORS.length],
      });
    });

    groups.sort((a, b) => a.currentPrice - b.currentPrice);
    setStoreGroups(groups);

    const events: TimelineEvent[] = found.prices.map((p) => {
      const g = groups.find((g) => g.storeId === p.storeId);
      return {
        date: p.date.toDate(),
        storeId: p.storeId,
        storeName: p.storeName,
        price: p.price,
        color: g?.color ?? colors.primary,
      };
    });
    events.sort((a, b) => b.date.getTime() - a.date.getTime());
    setTimeline(events);
  }

  useEffect(() => { load(); }, [params.productName]);

  async function handleRename() {
    if (!product || !newName.trim()) return;
    setSaving(true);
    try {
      await renameProduct(product.id, newName.trim());
      setProduct({ ...product, name: newName.trim() });
      setRenameModal(false);
    } catch (e: any) {
      Alert.alert('Erro', e.message);
    }
    setSaving(false);
  }

  async function handleMerge(target: Product) {
    if (!product) return;
    Alert.alert(
      'Mesclar produtos',
      `Unir "${product.name}" com "${target.name}"?\n\nTodo o histórico de preços será combinado e "${product.name}" será removido.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Mesclar',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await mergeProducts(product.id, target.id);
              setMergeModal(false);
              navigation.goBack();
            } catch (e: any) {
              Alert.alert('Erro', e.message);
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }

  if (!product || storeGroups.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Produto não encontrado no histórico.</Text>
      </View>
    );
  }

  const globalMin = storeGroups[0].currentPrice;
  const globalMax = storeGroups[storeGroups.length - 1].currentPrice;
  const diff = globalMax > 0 ? ((globalMax - globalMin) / globalMax) * 100 : 0;

  const chartData = buildChartData(storeGroups);

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* ── Card de resumo ─────────────────────────────────────────────── */}
      <View style={styles.summaryCard}>
        <Text style={styles.productName}>{product.name}</Text>
        {storeGroups.length > 1 && (
          <View style={styles.savingRow}>
            <Ionicons name="trending-down" size={16} color={colors.secondary} />
            <Text style={styles.savingText}>
              Economize até {diff.toFixed(0)}% comprando no lugar certo
            </Text>
          </View>
        )}
        <View style={styles.rangeRow}>
          <View style={styles.rangeItem}>
            <Text style={styles.rangeLabel}>Mais barato</Text>
            <Text style={styles.rangeMin}>{formatBRL(globalMin)}</Text>
            <Text style={styles.rangeStore}>{storeGroups[0].storeName}</Text>
          </View>
          {storeGroups.length > 1 && (
            <>
              <View style={styles.rangeDivider} />
              <View style={styles.rangeItem}>
                <Text style={styles.rangeLabel}>Mais caro</Text>
                <Text style={styles.rangeMax}>{formatBRL(globalMax)}</Text>
                <Text style={styles.rangeStore}>{storeGroups[storeGroups.length - 1].storeName}</Text>
              </View>
            </>
          )}
          {storeGroups.length > 1 && (
            <>
              <View style={styles.rangeDivider} />
              <View style={styles.rangeItem}>
                <Text style={styles.rangeLabel}>Registros</Text>
                <Text style={[styles.rangeMin, { color: colors.primary }]}>{timeline.length}</Text>
                <Text style={styles.rangeStore}>{storeGroups.length} lojas</Text>
              </View>
            </>
          )}
        </View>
      </View>

      {/* ── Gráfico de evolução ────────────────────────────────────────── */}
      {chartData && (
        <>
          <Text style={styles.sectionTitle}>Evolução do preço</Text>
          <View style={styles.chartCard}>
            {/* Legenda de cores */}
            <View style={styles.legend}>
              {storeGroups.map((g) => (
                <View key={g.storeId} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: g.color }]} />
                  <Text style={styles.legendText} numberOfLines={1}>{g.storeName}</Text>
                </View>
              ))}
            </View>

            <LineChart
              data={chartData}
              width={SCREEN_WIDTH - spacing.md * 2 - spacing.md * 2}
              height={200}
              yAxisLabel="R$"
              yAxisSuffix=""
              withDots={chartData.labels.length <= 6}
              withInnerLines={false}
              withOuterLines={false}
              withShadow={false}
              chartConfig={{
                backgroundColor: colors.card,
                backgroundGradientFrom: colors.card,
                backgroundGradientTo: colors.card,
                decimalPlaces: 2,
                color: (opacity = 1, index = 0) => {
                  const hex = storeGroups[index]?.color ?? colors.primary;
                  return hex + Math.round(opacity * 255).toString(16).padStart(2, '0');
                },
                labelColor: () => colors.textMuted,
                style: { borderRadius: radius.md },
                propsForLabels: { fontSize: 9 },
              }}
              bezier
              style={{ marginLeft: -spacing.md }}
            />
          </View>
        </>
      )}

      {/* ── Comparativo por loja (barras) ──────────────────────────────── */}
      <Text style={styles.sectionTitle}>Comparativo atual por loja</Text>
      {storeGroups.map((group, idx) => {
        const barWidth = globalMax > 0 ? (group.currentPrice / globalMax) * 100 : 100;
        const isCheapest = idx === 0;
        const isMostExpensive = idx === storeGroups.length - 1 && storeGroups.length > 1;

        return (
          <View key={group.storeId} style={styles.storeCard}>
            <View style={styles.storeHeader}>
              <View style={styles.storeNameRow}>
                <View style={[styles.storeDot, { backgroundColor: group.color }]} />
                <View style={{ flex: 1 }}>
                  {isCheapest && (
                    <View style={styles.cheapBadge}>
                      <Ionicons name="trophy" size={10} color={colors.secondary} />
                      <Text style={styles.cheapBadgeText}>+ barato</Text>
                    </View>
                  )}
                  {isMostExpensive && (
                    <View style={styles.expBadge}>
                      <Text style={styles.expBadgeText}>+ caro</Text>
                    </View>
                  )}
                  <Text style={styles.storeName}>{group.storeName}</Text>
                  <Text style={styles.storeRange}>
                    Mín {formatBRL(group.lowestPrice)} · Máx {formatBRL(group.highestPrice)}
                  </Text>
                </View>
              </View>
              <Text style={[
                styles.storePrice,
                isCheapest && styles.storePriceGreen,
                isMostExpensive && styles.storePriceRed,
              ]}>
                {formatBRL(group.currentPrice)}
              </Text>
            </View>

            <View style={styles.barBg}>
              <View
                style={[
                  styles.barFill,
                  { width: `${barWidth}%` as any, backgroundColor: group.color },
                ]}
              />
            </View>
          </View>
        );
      })}

      {/* ── Linha do tempo unificada ───────────────────────────────────── */}
      <Text style={[styles.sectionTitle, { marginTop: spacing.sm }]}>
        Linha do tempo — todas as compras
      </Text>
      <View style={styles.timelineCard}>
        {timeline.map((event, idx) => {
          const isLast = idx === timeline.length - 1;
          return (
            <View key={idx} style={styles.timelineRow}>
              {/* trilho vertical */}
              <View style={styles.timelineTrack}>
                <View style={[styles.timelineDot, { backgroundColor: event.color }]} />
                {!isLast && <View style={[styles.timelineLine, { backgroundColor: event.color + '40' }]} />}
              </View>

              <View style={styles.timelineContent}>
                {/* badge da loja */}
                <View style={[styles.storeBadge, { backgroundColor: event.color + '18' }]}>
                  <Text style={[styles.storeBadgeText, { color: event.color }]}>
                    {event.storeName}
                  </Text>
                </View>

                <View style={styles.timelineRow2}>
                  <Text style={styles.timelineDate}>
                    {format(event.date, "dd 'de' MMM 'de' yyyy", { locale: ptBR })}
                  </Text>
                  <Text style={[styles.timelinePrice, { color: event.color }]}>
                    {formatBRL(event.price)}
                  </Text>
                </View>

                {/* compara com o evento anterior */}
                {idx > 0 && (() => {
                  const prev = timeline[idx - 1];
                  if (prev.storeId !== event.storeId) return null;
                  const delta = event.price - prev.price;
                  if (delta === 0) return null;
                  const pct = Math.abs((delta / prev.price) * 100).toFixed(1);
                  return (
                    <View style={styles.deltaRow}>
                      <Ionicons
                        name={delta > 0 ? 'arrow-up' : 'arrow-down'}
                        size={10}
                        color={delta > 0 ? colors.danger : colors.secondary}
                      />
                      <Text style={[styles.deltaText, { color: delta > 0 ? colors.danger : colors.secondary }]}>
                        {delta > 0 ? '+' : ''}{formatBRL(delta)} ({pct}%) nesta loja
                      </Text>
                    </View>
                  );
                })()}
              </View>
            </View>
          );
        })}
      </View>

      {/* ── Botão mesclar ─────────────────────────────────────────────── */}
      <TouchableOpacity style={styles.mergeBtn} onPress={() => { setMergeSearch(''); setMergeModal(true); }}>
        <Ionicons name="git-merge-outline" size={16} color={colors.primary} />
        <Text style={styles.mergeBtnText}>Mesclar com outro produto</Text>
      </TouchableOpacity>

      </ScrollView>

      {/* ── Modal renomear ─────────────────────────────────────────────────── */}
      <Modal visible={renameModal} transparent animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Renomear produto</Text>
          <TextInput
            style={styles.modalInput}
            value={newName}
            onChangeText={setNewName}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleRename}
            placeholder="Nome do produto"
            placeholderTextColor={colors.textMuted}
          />
          <View style={styles.modalBtns}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setRenameModal(false)}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, (!newName.trim() || merging) && styles.saveBtnDisabled]}
              onPress={handleRename}
              disabled={!newName.trim() || merging}
            >
              <Text style={styles.saveBtnText}>{merging ? 'Salvando...' : 'Salvar'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal mesclar ──────────────────────────────────────────────────── */}
      <Modal visible={mergeModal} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { maxHeight: '80%' }]}>
          <Text style={styles.modalTitle}>Mesclar com...</Text>
          <Text style={styles.modalHint}>
            Escolha o produto que ficará com todo o histórico combinado.
          </Text>
          <TextInput
            style={[styles.modalInput, { marginBottom: spacing.sm }]}
            value={mergeSearch}
            onChangeText={setMergeSearch}
            placeholder="Buscar produto..."
            placeholderTextColor={colors.textMuted}
            autoFocus
          />
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {allProducts
              .filter((p) => p.id !== product?.id &&
                (mergeSearch.length < 2 ||
                  p.normalizedName.includes(normalizeProductName(mergeSearch))))
              .slice(0, 20)
              .map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.mergeOption}
                  onPress={() => handleMerge(p)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mergeOptionName} numberOfLines={1}>{p.name}</Text>
                    <Text style={styles.mergeOptionSub}>
                      {new Set(p.prices.map((pr) => pr.storeId)).size} {new Set(p.prices.map((pr) => pr.storeId)).size === 1 ? 'loja' : 'lojas'} · {p.prices.length} registros
                    </Text>
                  </View>
                  {p.cheapestPrice != null && (
                    <Text style={styles.mergeOptionPrice}>{formatBRL(p.cheapestPrice)}</Text>
                  )}
                </TouchableOpacity>
              ))}
          </ScrollView>
          <TouchableOpacity style={[styles.cancelBtn, { marginTop: spacing.sm }]} onPress={() => setMergeModal(false)}>
            <Text style={styles.cancelBtnText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </View>
      </Modal>
    </>
  );
}

// ── Monta os dados do gráfico alinhando datas entre lojas ────────────────────
function buildChartData(groups: StoreGrouped[]) {
  // Coleta todas as datas únicas (em millis) e ordena ascendente
  const allMillis = new Set<number>();
  for (const g of groups) {
    for (const p of g.sortedPrices) allMillis.add(p.date.toMillis());
  }

  const sortedMillis = Array.from(allMillis).sort((a, b) => a - b);
  if (sortedMillis.length < 2) return null;

  // Limita a 10 pontos no eixo X para legibilidade
  const step = Math.ceil(sortedMillis.length / 10);
  const sampledMillis = sortedMillis.filter((_, i) => i % step === 0 || i === sortedMillis.length - 1);

  const labels = sampledMillis.map((ms) =>
    format(new Date(ms), 'dd/MM', { locale: ptBR })
  );

  // Para cada loja, forward-fill: ao atingir uma data no eixo, usa o preço mais
  // recente que ela tinha até aquele ponto.
  const datasets = groups.map((group) => {
    const data = sampledMillis.map((ms) => {
      const available = group.sortedPrices.filter((p) => p.date.toMillis() <= ms);
      if (available.length > 0) return available[available.length - 1].price;
      // antes do primeiro registro: usa o primeiro preço disponível
      return group.sortedPrices[0]?.price ?? 0;
    });

    const hex = group.color;
    return {
      data,
      color: (opacity = 1) =>
        hex + Math.round(opacity * 255).toString(16).padStart(2, '0'),
      strokeWidth: 2,
    };
  });

  return { labels, datasets };
}

function formatBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  emptyText: { color: colors.textSecondary, fontSize: 15 },

  // Summary
  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.sm,
  },
  productName: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  savingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  savingText: { fontSize: 13, color: colors.secondary, fontWeight: '600' },
  rangeRow: { flexDirection: 'row', gap: spacing.md },
  rangeItem: { flex: 1 },
  rangeLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 2 },
  rangeMin: { fontSize: 18, fontWeight: '800', color: colors.secondary },
  rangeMax: { fontSize: 18, fontWeight: '800', color: colors.danger },
  rangeStore: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
  rangeDivider: { width: 1, backgroundColor: colors.border },

  sectionTitle: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Chart
  chartCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...shadow.sm,
  },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 140 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: colors.textSecondary, flex: 1 },

  // Store cards (barras)
  storeCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadow.sm,
  },
  storeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  storeNameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, flex: 1 },
  storeDot: { width: 10, height: 10, borderRadius: 5, marginTop: 3 },
  cheapBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.secondaryLight, borderRadius: radius.full,
    paddingHorizontal: 7, paddingVertical: 2, alignSelf: 'flex-start', marginBottom: 3,
  },
  cheapBadgeText: { fontSize: 10, fontWeight: '700', color: colors.secondary },
  expBadge: {
    backgroundColor: '#fde8e8', borderRadius: radius.full,
    paddingHorizontal: 7, paddingVertical: 2, alignSelf: 'flex-start', marginBottom: 3,
  },
  expBadgeText: { fontSize: 10, fontWeight: '700', color: colors.danger },
  storeName: { fontSize: 14, fontWeight: '600', color: colors.text },
  storeRange: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  storePrice: { fontSize: 16, fontWeight: '800', color: colors.text },
  storePriceGreen: { color: colors.secondary },
  storePriceRed: { color: colors.danger },
  barBg: {
    height: 6, backgroundColor: colors.border,
    borderRadius: radius.full, overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: radius.full },

  // Timeline
  timelineCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadow.sm,
  },
  timelineRow: { flexDirection: 'row', gap: spacing.sm },
  timelineTrack: { alignItems: 'center', width: 16 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
  timelineLine: { flex: 1, width: 2, marginVertical: 2 },
  timelineContent: { flex: 1, paddingBottom: spacing.md },
  storeBadge: {
    alignSelf: 'flex-start', borderRadius: radius.full,
    paddingHorizontal: 8, paddingVertical: 2, marginBottom: 3,
  },
  storeBadgeText: { fontSize: 11, fontWeight: '700' },
  timelineRow2: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timelineDate: { fontSize: 12, color: colors.textSecondary },
  timelinePrice: { fontSize: 15, fontWeight: '800' },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  deltaText: { fontSize: 10, fontWeight: '600' },

  mergeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, marginTop: spacing.md, padding: spacing.md,
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md,
  },
  mergeBtnText: { fontSize: 14, color: colors.primary, fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.xl, paddingBottom: 40,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  modalHint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md },
  modalInput: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, fontSize: 15, color: colors.text, marginBottom: spacing.md,
  },
  modalBtns: { flexDirection: 'row', gap: spacing.sm },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  cancelBtnText: { color: colors.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  saveBtnDisabled: { backgroundColor: colors.textMuted },
  saveBtnText: { color: '#fff', fontWeight: '700' },
  mergeOption: {
    flexDirection: 'row', alignItems: 'center', padding: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  mergeOptionName: { fontSize: 14, fontWeight: '600', color: colors.text },
  mergeOptionSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  mergeOptionPrice: { fontSize: 14, fontWeight: '700', color: colors.secondary, marginLeft: spacing.sm },
});
