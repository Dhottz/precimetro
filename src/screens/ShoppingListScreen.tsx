import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ShoppingList, RootStackParamList } from '../types';
import { getShoppingLists, saveShoppingList } from '../services/receipts';
import { colors, spacing, radius, shadow } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ShoppingListScreen() {
  const navigation = useNavigation<Nav>();
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newListModal, setNewListModal] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const data = await getShoppingLists();
    setLists(data);
    setLoading(false);
    setRefreshing(false);
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  async function handleCreateList() {
    if (!newListName.trim() || saving) return;
    setSaving(true);
    const now = Timestamp.now();
    const id = await saveShoppingList({
      name: newListName.trim(),
      items: [],
      totalEstimate: 0,
      createdAt: now,
      updatedAt: now,
    });
    setSaving(false);
    setNewListModal(false);
    setNewListName('');
    navigation.navigate('ShoppingListDetail', { listId: id });
  }

  function renderList({ item }: { item: ShoppingList }) {
    const checked = item.items.filter((i) => i.checked).length;
    const total = item.items.length;
    const progress = total > 0 ? checked / total : 0;
    const hasEstimate = item.totalEstimate > 0;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('ShoppingListDetail', { listId: item.id })}
        activeOpacity={0.7}
      >
        <View style={styles.cardLeft}>
          <View style={[styles.iconBox, checked === total && total > 0 && styles.iconBoxDone]}>
            <Ionicons
              name={checked === total && total > 0 ? 'checkmark-circle' : 'cart'}
              size={20}
              color={checked === total && total > 0 ? colors.secondary : colors.primary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.listName}>{item.name}</Text>
            <Text style={styles.listMeta}>
              {total} {total === 1 ? 'item' : 'itens'}
              {total > 0 && ` · ${checked}/${total} marcados`}
            </Text>
            {total > 0 && (
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
              </View>
            )}
          </View>
        </View>
        <View style={styles.cardRight}>
          {hasEstimate && (
            <Text style={styles.estimate}>{formatBRL(item.totalEstimate)}</Text>
          )}
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Listas de Compras</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setNewListModal(true)}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={lists}
        keyExtractor={(l) => l.id}
        renderItem={renderList}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="cart-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyText}>Nenhuma lista ainda</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => setNewListModal(true)}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.emptyBtnText}>Criar lista</Text>
            </TouchableOpacity>
          </View>
        }
      />

      <Modal visible={newListModal} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nova lista de compras</Text>
            <TextInput
              style={styles.input}
              value={newListName}
              onChangeText={setNewListName}
              placeholder="Ex: Compras do mês, Churrasco..."
              placeholderTextColor={colors.textMuted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreateList}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => { setNewListModal(false); setNewListName(''); }}
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, !newListName.trim() && styles.saveBtnDisabled]}
                onPress={handleCreateList}
                disabled={!newListName.trim() || saving}
              >
                <Text style={styles.saveBtnText}>Criar</Text>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  addBtn: {
    backgroundColor: colors.primary,
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { padding: spacing.md, paddingTop: 0, paddingBottom: 32 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shadow.sm,
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBoxDone: { backgroundColor: colors.secondaryLight },
  listName: { fontSize: 15, fontWeight: '600', color: colors.text },
  listMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2, marginBottom: 4 },
  progressBg: { height: 4, backgroundColor: colors.border, borderRadius: radius.full, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.secondary, borderRadius: radius.full },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: spacing.sm },
  estimate: { fontSize: 14, fontWeight: '700', color: colors.primary },
  empty: { alignItems: 'center', paddingTop: 80, gap: spacing.md },
  emptyText: { fontSize: 17, fontWeight: '600', color: colors.textSecondary },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: 40,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    color: colors.text,
    marginBottom: spacing.md,
  },
  modalBtns: { flexDirection: 'row', gap: spacing.sm },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  cancelBtnText: { color: colors.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  saveBtnDisabled: { backgroundColor: colors.textMuted },
  saveBtnText: { color: '#fff', fontWeight: '700' },
});
