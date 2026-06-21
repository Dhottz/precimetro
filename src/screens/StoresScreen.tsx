import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Store, Receipt, StoreRanking } from '../types';
import { getAllStores, updateStoreNickname, getAllReceipts } from '../services/receipts';
import { colors, spacing, radius, shadow } from '../theme';

export default function StoresScreen() {
  const [rankings, setRankings] = useState<StoreRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editModal, setEditModal] = useState<{ visible: boolean; store: Store | null }>({
    visible: false, store: null,
  });
  const [newNickname, setNewNickname] = useState('');

  async function load() {
    const [stores, receipts] = await Promise.all([getAllStores(), getAllReceipts()]);

    const rankMap = new Map<string, StoreRanking>();
    for (const store of stores) {
      rankMap.set(store.id, {
        store,
        averagePrice: 0,
        totalReceipts: 0,
        cheapestItems: 0,
        totalSpent: 0,
      });
    }

    // calcular totais por loja
    for (const receipt of receipts) {
      const rank = rankMap.get(receipt.storeId);
      if (!rank) continue;
      rank.totalReceipts++;
      rank.totalSpent += receipt.total;
    }

    const list = Array.from(rankMap.values())
      .filter((r) => r.totalReceipts > 0)
      .sort((a, b) => b.totalSpent - a.totalSpent);

    setRankings(list);
    setLoading(false);
    setRefreshing(false);
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  async function handleSaveNickname() {
    if (!editModal.store || !newNickname.trim()) return;
    await updateStoreNickname(editModal.store.id, newNickname.trim());
    setEditModal({ visible: false, store: null });
    load();
  }

  function openEdit(store: Store) {
    setNewNickname(store.nickname);
    setEditModal({ visible: true, store });
  }

  function renderStore({ item, index }: { item: StoreRanking; index: number }) {
    const medals = ['🥇', '🥈', '🥉'];
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.rankRow}>
            {index < 3 && <Text style={styles.medal}>{medals[index]}</Text>}
            <View style={styles.iconBox}>
              <Ionicons name="storefront" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.nickname}>{item.store.nickname}</Text>
              {item.store.nickname !== item.store.officialName && (
                <Text style={styles.officialName} numberOfLines={1}>{item.store.officialName}</Text>
              )}
            </View>
          </View>
          <TouchableOpacity onPress={() => openEdit(item.store)} style={styles.editBtn}>
            <Ionicons name="pencil" size={15} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{item.totalReceipts}</Text>
            <Text style={styles.statLabel}>{item.totalReceipts === 1 ? 'visita' : 'visitas'}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatBRL(item.totalSpent)}</Text>
            <Text style={styles.statLabel}>gasto total</Text>
          </View>
          {item.totalReceipts > 0 && (
            <>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatBRL(item.totalSpent / item.totalReceipts)}</Text>
                <Text style={styles.statLabel}>ticket médio</Text>
              </View>
            </>
          )}
        </View>

        <Text style={styles.cnpjText}>CNPJ: {item.store.cnpj}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Meus Mercados</Text>
        <Text style={styles.count}>{rankings.length} {rankings.length === 1 ? 'loja' : 'lojas'}</Text>
      </View>

      <FlatList
        data={rankings}
        keyExtractor={(r) => r.store.id}
        renderItem={renderStore}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="storefront-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyText}>Nenhum mercado ainda</Text>
            <Text style={styles.emptySubtext}>Escaneie uma nota fiscal para adicionar um mercado</Text>
          </View>
        }
      />

      {/* Modal de edição de apelido */}
      <Modal visible={editModal.visible} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Editar apelido</Text>
            {editModal.store && (
              <Text style={styles.modalOfficial}>{editModal.store.officialName}</Text>
            )}
            <Text style={styles.modalLabel}>Apelido:</Text>
            <TextInput
              style={styles.input}
              value={newNickname}
              onChangeText={setNewNickname}
              placeholder="Nome que você quer ver no app"
              placeholderTextColor={colors.textMuted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSaveNickname}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setEditModal({ visible: false, store: null })}
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, !newNickname.trim() && styles.saveBtnDisabled]}
                onPress={handleSaveNickname}
                disabled={!newNickname.trim()}
              >
                <Text style={styles.saveBtnText}>Salvar</Text>
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
  count: { fontSize: 13, color: colors.textMuted },
  list: { padding: spacing.md, paddingTop: 0, paddingBottom: 32 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadow.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.md },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  medal: { fontSize: 20 },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nickname: { fontSize: 15, fontWeight: '700', color: colors.text },
  officialName: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  editBtn: { padding: 4 },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  statDivider: { width: 1, height: 30, backgroundColor: colors.border },
  cnpjText: { fontSize: 10, color: colors.textMuted, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 80, gap: spacing.sm },
  emptyText: { fontSize: 17, fontWeight: '600', color: colors.textSecondary },
  emptySubtext: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: 40,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 4 },
  modalOfficial: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md },
  modalLabel: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm },
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
