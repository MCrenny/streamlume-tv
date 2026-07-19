import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HomeScreen } from './src/screens/HomeScreen';
import { FavoritesScreen } from './src/screens/FavoritesScreen';
import { PlayerScreen } from './src/screens/PlayerScreen';
import { useStore } from './src/store/useStore';
import { Audio } from 'expo-av';
import { isTVDevice } from './src/utils/TVLayoutManager';
import { TVHomeScreen } from './src/tv/TVHomeScreen';

// Enable audio even in silent mode
Audio.setAudioModeAsync({
  allowsRecordingIOS: false,
  staysActiveInBackground: true,
  interruptionModeIOS: 1, // interruptionModeIOS.DoNotMix
  playsInSilentModeIOS: true,
  shouldDuckAndroid: true,
  interruptionModeAndroid: 1, // interruptionModeAndroid.DoNotMix
  playThroughEarpieceAndroid: false,
});

// Removed cleanCache function to prevent Web crashes on older TVs
const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const MainTabs = ({ isPro }: { isPro: boolean }) => {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#1c1c1e',
          borderTopColor: '#3a3a3c',
        },
        tabBarActiveTintColor: '#0A84FF',
        tabBarInactiveTintColor: '#8E8E93',
      }}
    >
      <Tab.Screen 
        name="Все каналы" 
        component={HomeScreen} 
        options={{ tabBarIcon: () => null, tabBarLabelStyle: { fontSize: 14, paddingBottom: 5 } }}
      />
      {isPro && (
        <Tab.Screen 
          name="Избранное" 
          component={FavoritesScreen} 
          options={{ tabBarIcon: () => null, tabBarLabelStyle: { fontSize: 14, paddingBottom: 5 } }}
        />
      )}
    </Tab.Navigator>
  );
};

import { View, ActivityIndicator } from 'react-native';

import { ErrorBoundary } from './src/components/ErrorBoundary';

const MainScreen = ({ navigation }: any) => {
  if (isTVDevice()) {
    return (
      <ErrorBoundary>
        <TVHomeScreen navigation={navigation} />
      </ErrorBoundary>
    );
  }
  return <MainTabs isPro={true} />;
};

export default function App() {
  const [isReady, setIsReady] = React.useState(false);

  React.useEffect(() => {
    // Fallback: if hydration fails or hangs, force ready state after 1.5s
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 1500);
    
    // Subscribe to store changes to detect hydration
    const unsub = useStore.subscribe((state) => {
      if (state.hasHydrated) {
        setIsReady(true);
      }
    });
    
    // Initial check
    if (useStore.getState().hasHydrated) {
      setIsReady(true);
    }
    
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);

  const customDarkTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: '#000000',
      card: '#1c1c1e',
      text: '#ffffff',
    },
  };

  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#0A84FF" />
      </View>
    );
  }

  // Динамический URL — работает на любом домене (Vercel, Amvera, локально)
  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://streamlume-tv.vercel.app';
  
  const linking = {
    prefixes: [appUrl],
    config: {
      screens: {
        Auth: 'auth',
        Main: 'main',
        Player: 'player',
      },
    },
  };

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={customDarkTheme} linking={linking}>
        <StatusBar style="light" />
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <>
              <Stack.Screen 
                name="Main" 
                component={MainScreen} 
              />

              <Stack.Screen name="Player" component={PlayerScreen} />
            </>
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
