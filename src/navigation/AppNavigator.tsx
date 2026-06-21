import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { BottomTabParamList, RootStackParamList } from '../types';
import { colors } from '../theme';

import ScannerScreen from '../screens/ScannerScreen';
import HistoryScreen from '../screens/HistoryScreen';
import CompareScreen from '../screens/CompareScreen';
import ShoppingListScreen from '../screens/ShoppingListScreen';
import StoresScreen from '../screens/StoresScreen';
import ReceiptDetailScreen from '../screens/ReceiptDetailScreen';
import ProductCompareScreen from '../screens/ProductCompareScreen';
import ShoppingListDetailScreen from '../screens/ShoppingListDetailScreen';
import ManualItemsScreen from '../screens/ManualItemsScreen';

const Tab = createBottomTabNavigator<BottomTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          paddingBottom: 4,
          height: 60,
        },
        tabBarIcon: ({ focused, color, size }) => {
          const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
            Scanner: focused ? 'qr-code' : 'qr-code-outline',
            History: focused ? 'receipt' : 'receipt-outline',
            Compare: focused ? 'bar-chart' : 'bar-chart-outline',
            Shopping: focused ? 'cart' : 'cart-outline',
            Stores: focused ? 'storefront' : 'storefront-outline',
          };
          return <Ionicons name={icons[route.name]} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Scanner" component={ScannerScreen} options={{ title: 'Escanear' }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ title: 'Notas' }} />
      <Tab.Screen name="Compare" component={CompareScreen} options={{ title: 'Comparar' }} />
      <Tab.Screen name="Shopping" component={ShoppingListScreen} options={{ title: 'Lista' }} />
      <Tab.Screen name="Stores" component={StoresScreen} options={{ title: 'Mercados' }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.primary,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen
          name="ReceiptDetail"
          component={ReceiptDetailScreen}
          options={{ title: 'Nota Fiscal' }}
        />
        <Stack.Screen
          name="ProductCompare"
          component={ProductCompareScreen}
          options={({ route }) => ({ title: route.params.productName })}
        />
        <Stack.Screen
          name="ShoppingListDetail"
          component={ShoppingListDetailScreen}
          options={{ title: 'Lista de Compras' }}
        />
        <Stack.Screen
          name="ManualItems"
          component={ManualItemsScreen}
          options={{ title: 'Adicionar Itens' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
