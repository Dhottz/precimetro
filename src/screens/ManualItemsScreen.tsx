import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, Alert, ScrollView,
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Timestamp } from 'firebase/firestore';
import { RootStackParamList, ReceiptItem } from '../types';
import { saveReceipt } from '../services/receipts';
import { colors, spacing, radius, shadow } from '../theme';

type Route = RouteProp<RootStackParamList, 'ManualItems'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ManualItemsScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();

  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [total, setTotal] = useState(String(params.total || ''));
  const [saving, setSaving] = useState(false);

  // Campos do novo item
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('un');
  const [price, setPrice] = useState('');

  function addItem() {
    const parsedQty = parseFloat(qty.replace(',', '.')) || 1;
    const parsedPrice = parseFloat(price.replace(',', '.').replace(/[^\d.]/g, '')) || 0;
    if (!name.trim() || parsedPrice <= 0) {
      Alert.alert('Preencha o nome e o preço do item.');
      return;
    }
    const newItem: ReceiptItem = {
      code: '',
      name: name.trim().toUpperCase(),
      quantity: parsedQty,
      unit: unit.trim() || 'un',
      unitPrice: parsedPrice,
      totalPrice: parsedPrice * parsedQty,
    };
    setItems((prev) => [...prev, newItem]);
    setName('');
    setQty('1');
    setPrice('');
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (items.length === 0) {
      Alert.alert('Adicione pelo menos um item.');
      return;
    }
    setSaving(true);
    const parsedTotal = parseFloat(total.replace(',', '.').replace(/[^\d.]/g, ''))
      || items.reduce((s, i) => s + i.totalPrice, 0);

    try {
      const receiptId = await saveReceipt(
        {
          storeName: params.store.nickname || params.store.officialName,
          cnpj: params.store.cnpj,
          address: params.store.address || '',
          city: params.store.city || '',
          state: '',
          date: params.date,
          accessKey: '',
          total: parsedTotal,
          items,
        },
        params.store
      );
      navigation.replace('ReceiptDetail', { receiptId });
    } catch (err: any) {
      Alert.alert('Erro ao salvar', err.message);
      setSaving(false);
    }
  }

  const estimatedTotal = items.reduce((s, i) => s + i.totalPrice, 0);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Aviso */}
        <View style={styles.warningCard}>
          <Ionicons name="information-circle" size={20} color={colors.warning} />
          <Text style={styles.warningText}>
            O portal desta nota não permitiu leitura automática. Adicione os itens manualmente.
          </Text>
        </View>

        {/* Info da nota */}
        <View style={styles.infoCard}>
          <Text style={styles.storeName}>{params.store.nickname || params.store.officialName}</Text>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total da nota</Text>
            <TextInput
              style={styles.totalInput}
              value={total}
              onChangeText={setTotal}
              keyboardType="decimal-pad"
              placeholder="0,00"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        </View>

        {/* Formulário de novo item */}
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Adicionar item</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Nome do produto"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
          />
          <View style={styles.row}>
            <View style={{ flex: 2 }}>
              <Text style={styles.inputLabel}>Qtd</Text>
              <TextInput
                style={styles.input}
                value={qty}
                onChangeText={setQty}
                keyboardType="decimal-pad"
                placeholder="1"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Un</Text>
              <TextInput
                style={styles.input}
                value={unit}
                onChangeText={setUnit}
                placeholder="un"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
              />
            </View>
            <View style={{ flex: 3 }}>
              <Text style={styles.inputLabel}>Preço unit. (R$)</Text>
              <TextInput
                style={styles.input}
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
                placeholder="0,00"
                placeholderTextColor={colors.textMuted}
              />
            </View>
          </View>
          <TouchableOpacity
            style={[styles.addBtn, (!name.trim() || !price) && styles.addBtnDisabled]}
            onPress={addItem}
            disabled={!name.trim() || !price}
          >
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.addBtnText}>Adicionar</Text>
          </TouchableOpacity>
        </View>

        {/* Lista de itens adicionados */}
        {items.length > 0 && (
          <View style={styles.itemsCard}>
            <Text style={styles.formTitle}>{items.length} {items.length === 1 ? 'item' : 'itens'}</Text>
            {items.map((item, idx) => (
              <View key={idx} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemSub}>
                    {item.quantity} {item.unit} × {formatBRL(item.unitPrice)}
                  </Text>
                </View>
                <Text style={styles.itemTotal}>{formatBRL(item.totalPrice)}</Text>
                <TouchableOpacity onPress={() => removeItem(idx)} style={{ padding: 4 }}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>Subtotal</Text>
              <Text style={styles.subtotalValue}>{formatBRL(estimatedTotal)}</Text>
            </View>
          </View>
        )}

        {/* Botão salvar */}
        <TouchableOpacity
          style={[styles.saveBtn, (saving || items.length === 0) && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving || items.length === 0}
        >
          <Ionicons name="checkmark" size={20} color="#fff" />
          <Text style={styles.saveBtnText}>{saving ? 'Salvando...' : 'Salvar nota'}</Text>
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function formatBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: 48, gap: spacing.md },
  warningCard: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
    backgroundColor: colors.warningLight, borderRadius: radius.md, padding: spacing.md,
  },
  warningText: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 18 },
  infoCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, ...shadow.sm,
  },
  storeName: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { fontSize: 14, color: colors.textSecondary },
  totalInput: {
    fontSize: 18, fontWeight: '800', color: colors.primary,
    borderBottomWidth: 1.5, borderBottomColor: colors.primary, minWidth: 80, textAlign: 'right',
  },
  formCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, ...shadow.sm,
  },
  formTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  input: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, fontSize: 14, color: colors.text, marginBottom: spacing.sm,
  },
  inputLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  row: { flexDirection: 'row', gap: spacing.sm },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md,
  },
  addBtnDisabled: { backgroundColor: colors.textMuted },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  itemsCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, ...shadow.sm,
  },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  itemName: { fontSize: 13, fontWeight: '600', color: colors.text },
  itemSub: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  itemTotal: { fontSize: 14, fontWeight: '700', color: colors.text },
  subtotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm,
  },
  subtotalLabel: { fontSize: 13, color: colors.textMuted },
  subtotalValue: { fontSize: 15, fontWeight: '800', color: colors.primary },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.secondary, borderRadius: radius.md, padding: spacing.md,
  },
  saveBtnDisabled: { backgroundColor: colors.textMuted },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
