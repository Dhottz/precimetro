import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Product, RootStackParamList } from '../types';
import { getAllProducts } from '../services/receipts';
import { normalizeProductName } from '../services/sefaz';
import { colors, spacing, radius, shadow } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function CompareScreen() {
  const navigation = useNavigation<Nav>();
  const [products, setProducts] = useState<Product[]>([]);
  const [filtered, setFiltered] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const data = await getAllProducts();
    // ordena pelos que têm mais lojas comparadas
    data.sort((a, b) => b.prices.length - a.prices.length);
    setProducts(data);
    setFiltered(data);
    setLoading(false);
    setRefreshing(false);
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  useEffect(() => {
    if (!search.trim()) {
      setFiltered(products);
      return;
    }
    const term = normalizeProductName(search);
    setFiltered(products.filter((p) => p.normalizedName.includes(term)));
  }, [search, products]);

  function renderProduct({ item }: { item: Product }) {
    const storeCount = new Set(item.prices.map((p) => p.storeId)).size;
    const prices = item.prices.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const diff = max > 0 ? ((max - min) / max) * 100 : 0;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('ProductCompare', { productName: item.name })}
        activeOpacity={0.7}
      >
        <View style={styles.cardTop}>
          <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
          {storeCount > 1 && (
            <View style={styles.savingBadge}>
              <Text style={styles.savingText}>-{diff.toFixed(0)}%</Text>
            </View>
          )}
        </View>
        <View style={styles.priceRow}>
          <View style={styles.priceBlock}>
            <Text style={styles.priceLabel}>+ barato</Text>
            <Text style={styles.priceMin}>{formatBRL(min)}</Text>
            <Text style={styles.priceSub} numberOfLines={1}>{item.cheapestStore}</Text>
          </View>
          {storeCount > 1 && (
            <>
              <View style={styles.priceDivider} />
              <View style={styles.priceBlock}>
                <Text style={styles.priceLabel}>+ caro</Text>
                <Text style={styles.priceMax}>{formatBRL(max)}</Text>
              </View>
            </>
          )}
          <View style={{ flex: 1 }} />
          <View style={styles.storeCountBadge}>
            <Ionicons name="storefront-outline" size={12} color={colors.primary} />
            <Text style={styles.storeCountText}>{storeCount} {storeCount === 1 ? 'loja' : 'lojas'}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Comparativo</Text>
      </View>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar produto..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        renderItem={renderProduct}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bar-chart-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              {search ? 'Produto não encontrado' : 'Nenhum produto ainda'}
            </Text>
            <Text style={styles.emptySubtext}>Escaneie notas fiscais para comparar preços</Text>
          </View>
        }
      />
    </View>
  );
}

function formatBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  headerRow: { padding: spacing.md, paddingBottom: spacing.sm },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.text },
  list: { padding: spacing.md, paddingTop: spacing.sm, paddingBottom: 32 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadow.sm,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  productName: { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1, marginRight: spacing.sm },
  savingBadge: {
    backgroundColor: colors.secondaryLight,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  savingText: { fontSize: 11, fontWeight: '700', color: colors.secondary },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  priceBlock: { minWidth: 90 },
  priceLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 1 },
  priceMin: { fontSize: 16, fontWeight: '800', color: colors.secondary },
  priceMax: { fontSize: 16, fontWeight: '800', color: colors.danger },
  priceSub: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  priceDivider: { width: 1, height: 36, backgroundColor: colors.border },
  storeCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  storeCountText: { fontSize: 11, color: colors.primary, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 80, gap: spacing.sm },
  emptyText: { fontSize: 17, fontWeight: '600', color: colors.textSecondary },
  emptySubtext: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
});
