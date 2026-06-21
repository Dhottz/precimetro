import React, { useEffect, useState, useLayoutEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Alert,
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Receipt, ReceiptItem, RootStackParamList } from '../types';
import { getReceipt, deleteReceipt } from '../services/receipts';
import { colors, spacing, radius, shadow } from '../theme';

type Route = RouteProp<RootStackParamList, 'ReceiptDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ReceiptDetailScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getReceipt(params.receiptId).then((r) => {
      setReceipt(r);
      setLoading(false);
    });
  }, [params.receiptId]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={handleDelete} style={{ paddingRight: 4 }}>
          <Ionicons name="trash-outline" size={22} color={colors.danger} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, receipt]);

  function handleDelete() {
    if (!receipt) return;
    Alert.alert(
      'Excluir nota',
      `Excluir a nota do ${receipt.storeName}? Os preços cadastrados por ela também serão removidos.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteReceipt(receipt);
              navigation.goBack();
            } catch (err: any) {
              Alert.alert('Erro', err.message);
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }

  if (!receipt) {
    return <View style={styles.center}><Text style={styles.errorText}>Nota não encontrada.</Text></View>;
  }

  const date = receipt.date.toDate();

  function renderItem({ item }: { item: ReceiptItem }) {
    return (
      <TouchableOpacity
        style={styles.itemCard}
        onPress={() => navigation.navigate('ProductCompare', { productName: item.name })}
        activeOpacity={0.7}
      >
        <View style={styles.itemLeft}>
          <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
          <Text style={styles.itemQty}>
            {item.quantity} {item.unit} × {formatBRL(item.unitPrice)}
          </Text>
        </View>
        <View style={styles.itemRight}>
          <Text style={styles.itemTotal}>{formatBRL(item.totalPrice)}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <FlatList
      data={receipt.items}
      keyExtractor={(_, i) => String(i)}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View>
          <View style={styles.header}>
            <View style={styles.storeRow}>
              <Ionicons name="storefront" size={22} color={colors.primary} />
              <Text style={styles.storeName}>{receipt.storeName}</Text>
            </View>
            {receipt.storeName !== receipt.officialStoreName && (
              <Text style={styles.officialName}>{receipt.officialStoreName}</Text>
            )}
            <Text style={styles.dateText}>
              {format(date, "dd 'de' MMMM 'de' yyyy, HH:mm", { locale: ptBR })}
            </Text>
            <View style={styles.totalBox}>
              <Text style={styles.totalLabel}>Total da nota</Text>
              <Text style={styles.totalValue}>{formatBRL(receipt.total)}</Text>
            </View>
          </View>
          <Text style={styles.sectionTitle}>
            {receipt.items.length} itens — toque para comparar preços
          </Text>
        </View>
      }
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

function formatBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  errorText: { color: colors.textSecondary, fontSize: 15 },
  list: { padding: spacing.md, paddingBottom: 32, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.sm,
  },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  storeName: { fontSize: 18, fontWeight: '700', color: colors.text, flex: 1 },
  officialName: { fontSize: 12, color: colors.textMuted, marginBottom: 4, marginLeft: 30 },
  dateText: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.md },
  totalBox: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  totalValue: { fontSize: 20, fontWeight: '800', color: colors.primary },
  sectionTitle: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm, paddingHorizontal: 4 },
  itemCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadow.sm,
  },
  itemLeft: { flex: 1, marginRight: spacing.sm },
  itemName: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 2 },
  itemQty: { fontSize: 12, color: colors.textSecondary },
  itemRight: { alignItems: 'flex-end', flexDirection: 'row', gap: 4 },
  itemTotal: { fontSize: 15, fontWeight: '700', color: colors.text },
  separator: { height: 8 },
});
