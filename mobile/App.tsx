import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, I18nManager, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import HouseholdScreen from "./src/screens/HouseholdScreen";
import InventoryScreen from "./src/screens/InventoryScreen";
import LoginScreen from "./src/screens/LoginScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import PurchaseScreen from "./src/screens/PurchaseScreen";
import ShoppingListScreen from "./src/screens/ShoppingListScreen";
import SimulationScreen from "./src/screens/SimulationScreen";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { fetchHousehold, setOnUnauthorized } from "./src/api";

// Force RTL layout for Hebrew
I18nManager.forceRTL(true);

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function ShoppingStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerTitleAlign: "center",
        headerStyle: { backgroundColor: "#0262A0" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "700", fontSize: 18 },
      }}
    >
      <Stack.Screen name="Purchase" component={PurchaseScreen} options={{ title: "רשימת קניות", headerBackVisible: false, headerLeft: () => null }} />
      <Stack.Screen name="Shopping" component={ShoppingListScreen} options={{ title: "קניות" }} />
    </Stack.Navigator>
  );
}

function AppTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      initialRouteName="ShoppingTab"
      screenOptions={{
        tabBarActiveTintColor: "#fff",
        tabBarInactiveTintColor: "rgba(255,255,255,0.55)",
        tabBarStyle: {
          backgroundColor: "#0262A0",
          height: 60 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom,
          borderTopWidth: 0,
          elevation: 12,
          shadowColor: "#0262A0",
          shadowOpacity: 0.4,
          shadowRadius: 8,
        },
        tabBarLabelStyle: { fontSize: 13, fontWeight: "700" },
        tabBarActiveBackgroundColor: "rgba(255,255,255,0.18)",
        tabBarItemStyle: { borderRadius: 12, margin: 4 },
        headerStyle: { backgroundColor: "#0262A0" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "700", fontSize: 18 },
        headerTitleAlign: "center",
      }}
    >
      <Tab.Screen
        name="ShoppingTab"
        component={ShoppingStack}
        options={{
          title: "קניות",
          headerShown: false,
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>🛒</Text>,
        }}
      />
      <Tab.Screen
        name="SimulationTab"
        component={SimulationScreen}
        options={{
          title: "סימולציה",
          headerTitle: "סימולציית קנייה",
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>📊</Text>,
        }}
      />
      <Tab.Screen
        name="InventoryTab"
        component={InventoryScreen}
        options={{
          title: "מלאי",
          headerTitle: "מלאי הבית",
          tabBarIcon: () => <Text style={{ fontSize: 22 }}>📦</Text>,
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          title: "פרופיל",
          headerTitle: "פרופיל",
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  const { user, loading, signOut } = useAuth();
  const [household, setHousehold] = React.useState<string | null | undefined>(undefined);

  React.useEffect(() => {
    setOnUnauthorized(() => { signOut(); });
  }, [signOut]);

  React.useEffect(() => {
    if (user) {
      fetchHousehold().then(setHousehold).catch(() => setHousehold(null));
    } else {
      setHousehold(undefined);
    }
  }, [user]);

  if (loading || (user && household === undefined)) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f0f8ff" }}>
        <ActivityIndicator size="large" color="#0262A0" />
      </View>
    );
  }

  if (!user) return <LoginScreen />;
  if (!household) return <HouseholdScreen onHouseholdReady={(id) => setHousehold(id)} />;
  return <AppTabs />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
