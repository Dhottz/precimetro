import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  Modal, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, ScrollView, Pressable,
} from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList, ShoppingList, ShoppingListItem, Product } from '../types';
import { getShoppingLists, updateShoppingList, estimateShoppingList, getAllProducts } from '../services/receipts';
import { normalizeProductName } from '../services/sefaz';
import { colors, spacing, radius, shadow } from '../theme';

type Route = RouteProp<RootStackParamList, 'ShoppingListDetail'>;

const UNITS = ['UN', 'KG', 'G', 'L', 'ML', 'PCT', 'CX', 'DZ', 'M', 'CM'];

export default function ShoppingListDetailScreen() {
  const { params } = useRoute<Route>();
  const [list, setList] = useState<ShoppingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [estimating, setEstimating] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemQty, setNewItemQty] = useState('1');
  const [newItemUnit, setNewItemUnit] = useState('UN');

  const [unitDropdownOpen, setUnitDropdownOpen] = useState(false);

  // Autocomplete
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [selectedFromHistory, setSelectedFromHistory] = useState(false);

  useEffect(() => {
    async function load() {
      const all = await getShoppingLists();
      const found = all.find((l) => l.id === params.listId);
      setList(found ?? null);
      setLoading(false);
    }
    load();
  }, [params.listId]);

  // Carrega produtos ao abrir o modal
  useEffect(() => {
    if (addModal && allProducts.length === 0) {
      getAllProducts().then(setAllProducts);
    }
  }, [addModal]);

  // Filtra sugestões conforme o usuário digita
  useEffect(() => {
    if (!newItemName.trim() || selectedFromHistory) {
      setSuggestions([]);
      return;
    }
    const term = normalizeProductName(newItemName);
    if (term.length < 2) { setSuggestions([]); return; }
    const matches = allProducts
      .filter((p) => p.normalizedName.includes(term))
      .slice(0, 6);
    setSuggestions(matches);
  }, [newItemName, allProducts, selectedFromHistory]);

  function handleSelectSuggestion(product: Product) {
    const lastPrice = product.prices[product.prices.length - 1];
    const unit = (lastPrice?.unit || 'UN').toUpperCase();
    setNewItemName(product.name);
    setNewItemUnit(UNITS.includes(unit) ? unit : 'UN');
    setNewItemQty('1');
    setSelectedFromHistory(true);
    setUnitDropdownOpen(false);
    setSuggestions([]);
  }

  function resetModal() {
    setAddModal(false);
    setNewItemName('');
    setNewItemQty('1');
    setNewItemUnit('UN');
    setUnitDropdownOpen(false);
    setSelectedFromHistory(false);
    setSuggestions([]);
  }

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
      unit: newItemUnit,
      checked: false,
    };
    const updated = { ...list, items: [...list.items, newItem] };
    resetModal();

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
  const itemsWithoutEstimate = list.items.filter((i) => i.estimatedPrice == null).length;

  return (
    <View style={styles.container}>
      <FlatList
        data={list.items}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <View>
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

      <TouchableOpacity style={styles.fab} onPress={() => setAddModal(true)}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      <Modal visible={addModal} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <Pressable style={styles.modalOverlay} onPress={resetModal}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Adicionar item</Text>
            <Text style={styles.modalLabel}>Produto</Text>

            {/* Input com autocomplete */}
            <View style={styles.autocompleteWrapper}>
              <TextInput
                style={styles.input}
                value={newItemName}
                onChangeText={(t) => { setNewItemName(t); setSelectedFromHistory(false); }}
                placeholder="Ex: Leite integral, Arroz 5kg..."
                placeholderTextColor={colors.textMuted}
                autoFocus
              />
              {suggestions.length > 0 && (
                <View style={styles.suggestionBox}>
                  {suggestions.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.suggestionRow}
                      onPress={() => handleSelectSuggestion(p)}
                    >
                      <View style={styles.suggestionLeft}>
                        <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                        <Text style={styles.suggestionName} numberOfLines={1}>{p.name}</Text>
                      </View>
                      {p.cheapestPrice != null && (
                        <Text style={styles.suggestionPrice}>{formatBRL(p.cheapestPrice)}</Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

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
                <TouchableOpacity
                  style={styles.unitBtn}
                  onPress={() => setUnitDropdownOpen((v) => !v)}
                >
                  <Text style={styles.unitBtnText}>{newItemUnit}</Text>
                  <Ionicons
                    name={unitDropdownOpen ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
                {unitDropdownOpen && (
                  <View style={styles.unitDropdown}>
                    {UNITS.map((u) => (
                      <TouchableOpacity
                        key={u}
                        style={[styles.unitOption, u === newItemUnit && styles.unitOptionSelected]}
                        onPress={() => { setNewItemUnit(u); setUnitDropdownOpen(false); }}
                      >
                        <Text style={[styles.unitOptionText, u === newItemUnit && styles.unitOptionTextSelected]}>
                          {u}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </View>

            <Text style={styles.estimateHint}>
              {selectedFromHistory
                ? 'Produto do seu histórico — preço estimado automaticamente'
                : 'O preço será estimado com base no seu histórico de compras'}
            </Text>

            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={resetModal}>
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
          </Pressable>
          </Pressable>
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
  autocompleteWrapper: { marginBottom: spacing.sm },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    color: colors.text,
  },
  suggestionBox: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  suggestionLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  suggestionName: { fontSize: 13, color: colors.text, flex: 1 },
  suggestionPrice: { fontSize: 13, fontWeight: '700', color: colors.secondary, marginLeft: 8 },
  qtyRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  unitBtn: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
  },
  unitBtnText: { fontSize: 15, color: colors.text, fontWeight: '600' },
  unitDropdown: {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, overflow: 'hidden', ...shadow.sm,
  },
  unitOption: {
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  unitOptionSelected: { backgroundColor: colors.primaryLight },
  unitOptionText: { fontSize: 14, color: colors.text },
  unitOptionTextSelected: { color: colors.primary, fontWeight: '700' },
  estimateHint: { fontSize: 11, color: colors.textMuted, marginBottom: spacing.md, textAlign: 'center' },
  modalBtns: { flexDirection: 'row', gap: spacing.sm },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  cancelBtnText: { color: colors.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  saveBtnDisabled: { backgroundColor: colors.textMuted },
  saveBtnText: { color: '#fff', fontWeight: '700' },
});
