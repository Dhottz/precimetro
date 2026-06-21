import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  Modal, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Timestamp } from 'firebase/firestore';
import { RootStackParamList, ShoppingList, ShoppingListItem } from '../types';
import { getShoppingLists, updateShoppingList, estimateShoppingList } from '../services/receipts';
import { colors, spacing, radius, shadow } from '../theme';

type Route = RouteProp<RootStackParamList, 'ShoppingListDetail'>;

export default function ShoppingListDetailScreen() {
  const { params } = useRoute<Route>();
  const [list, setList] = useState<ShoppingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [estimating, setEstimating] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemQty, setNewItemQty] = useState('1');
  const [newItemUnit, setNewItemUnit] = useState('un');

  useEffect(() => {
    async function load() {
      const all = await getShoppingLists();
      const found = all.find((l) => l.id === params.listId);
      setList(found ?? null);
      setLoading(false);
    }
    load();
  }, [params.listId]);

  async function persist(updated: ShoppingList) {
    setList(updated);
    await updateShoppingList(updated.id, {
      items: updated.items,
      totalEstimate: updated.totalEstimate,
    });
  }

  async function handleAddItem() {
    if (!list || !newItemName.trim()) return;
    const qty = parseFloat(newItemQty.replace(',', '.')) || 1;
    const newItem: ShoppingListItem = {
      id: Date.now().toString(),
      productName: newItemName.trim(),
      quantity: qty,
      unit: newItemUnit.trim() || 'un',
      checked: false,
    };
    const updated = { ...list, items: [...list.items, newItem] };
    setAddModal(false);
    setNewItemName('');
    setNewItemQty('1');

    // estimar preço imediatamente
    const enriched = await estimateShoppingList(updated.items);
    const total = enriched.reduce((sum, i) => sum + (i.estimatedPrice ?? 0), 0);
    await persist({ ...updated, items: enriched, totalEstimate: total });
  }

  async function handleRefreshEstimates() {
    if (!list) return;
    setEstimating(true);
    const enriched = await estimateShoppingList(list.items);
    const total = enriched.reduce((sum, i) => sum + (i.estimatedPrice ?? 0), 0);
    await persist({ ...list, items: enriched, totalEstimate: total });
    setEstimating(false);
  }

  async function toggleCheck(itemId: string) {
    if (!list) return;
    const items = list.items.map((i) =>
      i.id === itemId ? { ...i, checked: !i.checked } : i
    );
    await persist({ ...list, items });
  }

  async function removeItem(itemId: string) {
    if (!list) return;
    Alert.alert('Remover item?', undefined, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          const items = list.items.filter((i) => i.id !== itemId);
          const total = items.reduce((sum, i) => sum + (i.estimatedPrice ?? 0), 0);
          await persist({ ...list, items, totalEstimate: total });
        },
      },
    ]);
  }

  function renderItem({ item }: { item: ShoppingListItem }) {
    return (
      <View style={[styles.itemCard, item.checked && styles.itemChecked]}>
        <TouchableOpacity onPress={() => toggleCheck(item.id)} style={styles.checkbox}>
          <View style={[styles.checkboxInner, item.checked && styles.checkboxChecked]}>
            {item.checked && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
        </TouchableOpacity>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemName, item.checked && styles.itemNameDone]}>
            {item.productName}
          </Text>
          <Text style={styles.itemQty}>{item.quantity} {item.unit}</Text>
          {item.cheapestStoreName && (
            <Text style={styles.itemStore}>
              <Ionicons name="storefront-outline" size={10} color={colors.secondary} /> {item.cheapestStoreName}
            </Text>
          )}
        </View>
        <View style={styles.itemRight}>
          {item.estimatedPrice != null && (
            <Text style={styles.itemPrice}>{formatBRL(item.estimatedPrice)}</Text>
          )}
          <TouchableOpacity onPress={() => removeItem(item.id)} style={styles.deleteBtn}>
            <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (loading || !list) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }

  const checkedCount = list.items.filter((i) => i.checked).length;
  const hasEstimates = list.items.some((i) => i.estimatedPrice != null);
  const itemsWithoutEstimate = list.items.filter((i) => i.estimatedPrice == null).length;

  return (
    <View style={styles.container}>
      <FlatList
        data={list.items}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            {/* Summary */}
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{list.items.length}</Text>
                  <Text style={styles.summaryLabel}>itens</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{checkedCount}</Text>
                  <Text style={styles.summaryLabel}>no carrinho</Text>
                </View>
                {list.totalEstimate > 0 && (
                  <>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryItem}>
                      <Text style={[styles.summaryValue, { color: colors.primary }]}>
                        {formatBRL(list.totalEstimate)}
                      </Text>
                      <Text style={styles.summaryLabel}>estimativa</Text>
                    </View>
                  </>
                )}
              </View>

              {itemsWithoutEstimate > 0 && (
                <TouchableOpacity
                  style={styles.estimateBtn}
                  onPress={handleRefreshEstimates}
                  disabled={estimating}
                >
                  {estimating
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <Ionicons name="refresh" size={14} color={colors.primary} />}
                  <Text style={styles.estimateBtnText}>
                    {estimating ? 'Estimando...' : `Estimar ${itemsWithoutEstimate} ${itemsWithoutEstimate === 1 ? 'item' : 'itens'} sem preço`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.sectionTitle}>Itens</Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="add-circle-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>Lista vazia</Text>
            <Text style={styles.emptySubtext}>Toque em + para adicionar itens</Text>
          </View>
        }
      />

      {/* Botão de adicionar item */}
      <TouchableOpacity style={styles.fab} onPress={() => setAddModal(true)}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Modal de novo item */}
      <Modal visible={addModal} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Adicionar item</Text>
            <Text style={styles.modalLabel}>Produto</Text>
            <TextInput
              style={styles.input}
              value={newItemName}
              onChangeText={setNewItemName}
              placeholder="Ex: Leite integral, Arroz 5kg..."
              placeholderTextColor={colors.textMuted}
              autoFocus
            />
            <View style={styles.qtyRow}>
              <View style={{ flex: 2 }}>
                <Text style={styles.modalLabel}>Quantidade</Text>
                <TextInput
                  style={styles.input}
                  value={newItemQty}
                  onChangeText={setNewItemQty}
                  keyboardType="decimal-pad"
                  placeholder="1"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalLabel}>Unidade</Text>
                <TextInput
                  style={styles.input}
                  value={newItemUnit}
                  onChangeText={setNewItemUnit}
                  placeholder="un"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            </View>
            <Text style={styles.estimateHint}>
              O preço será estimado automaticamente com base no seu histórico
            </Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => { setAddModal(false); setNewItemName(''); }}
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, !newItemName.trim() && styles.saveBtnDisabled]}
                onPress={handleAddItem}
                disabled={!newItemName.trim()}
              >
                <Text style={styles.saveBtnText}>Adicionar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function formatBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  listContent: { padding: spacing.md, paddingBottom: 100 },
  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadow.sm,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: spacing.sm },
  summaryItem: { alignItems: 'center' },
  summaryValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  summaryLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  summaryDivider: { width: 1, backgroundColor: colors.border },
  estimateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.sm,
    justifyContent: 'center',
  },
  estimateBtnText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  sectionTitle: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm },
  itemCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadow.sm,
  },
  itemChecked: { opacity: 0.6 },
  checkbox: { marginRight: spacing.sm },
  checkboxInner: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.secondary, borderColor: colors.secondary },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 14, fontWeight: '600', color: colors.text },
  itemNameDone: { textDecorationLine: 'line-through', color: colors.textMuted },
  itemQty: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  itemStore: { fontSize: 11, color: colors.secondary, marginTop: 2 },
  itemRight: { alignItems: 'flex-end', gap: 4 },
  itemPrice: { fontSize: 14, fontWeight: '700', color: colors.primary },
  deleteBtn: { padding: 4 },
  empty: { alignItems: 'center', paddingTop: 60, gap: spacing.sm },
  emptyText: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
  emptySubtext: { fontSize: 13, color: colors.textMuted },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.md,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: 40,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  modalLabel: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.xs },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  qtyRow: { flexDirection: 'row', gap: spacing.sm },
  estimateHint: { fontSize: 11, color: colors.textMuted, marginBottom: spacing.md, textAlign: 'center' },
  modalBtns: { flexDirection: 'row', gap: spacing.sm },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  cancelBtnText: { color: colors.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  saveBtnDisabled: { backgroundColor: colors.textMuted },
  saveBtnText: { color: '#fff', fontWeight: '700' },
});
