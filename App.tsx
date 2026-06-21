import React from 'react';
import { StatusBar } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { colors } from './src/theme';

export default function App() {
  return (
    <>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <AppNavigator />
    </>
  );
}
