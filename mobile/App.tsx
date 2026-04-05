import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, I18nManager, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import HouseholdScreen from "./src/screens/HouseholdScreen";
import InventoryScreen from "./src/screens/InventoryScreen";
import LoginScreen from "./src/screens/LoginScreen";
import OnboardingWizardScreen from "./src/screens/OnboardingWizardScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import AboutScreen from "./src/screens/AboutScreen";
import PurchaseScreen from "./src/screens/PurchaseScreen";
import SimulationScreen from "./src/screens/SimulationScreen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { AuthError, fetchHousehold, setOnUnauthorized } from "./src/api";

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
      <Stack.Screen name="Purchase" component={PurchaseScreen} options={{ title: "קניות", headerBackVisible: false, headerLeft: () => null }} />
    </Stack.Navigator>
  );
}

function AppTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      initialRouteName="SimulationTab"
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
        headerStyle: { backgroundColor: "#0262A0" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "700", fontSize: 18 },
        headerTitleAlign: "center",
      }}
    >
      <Tab.Screen
        name="AboutTab"
        component={AboutScreen}
        options={{
          title: "אודות",
          headerTitle: "אודות",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "information-circle" : "information-circle-outline"} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          title: "פרופיל",
          headerTitle: "פרופיל",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "person" : "person-outline"} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="InventoryTab"
        component={InventoryScreen}
        options={{
          title: "מלאי",
          headerTitle: "מלאי",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "cube" : "cube-outline"} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="SimulationTab"
        component={SimulationScreen}
        options={{
          title: "הכן רשימה",
          headerTitle: "הכן רשימה",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "create" : "create-outline"} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ShoppingTab"
        component={ShoppingStack}
        options={{
          title: "קניות",
          headerShown: false,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "cart" : "cart-outline"} size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const onboardingKey = (householdId: string) => `onboarding_done_${householdId}`;

function RootNavigator() {
  const { user, loading, signOut } = useAuth();
  const [household, setHousehold] = React.useState<string | null | undefined>(undefined);
  const [needsOnboarding, setNeedsOnboarding] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    setOnUnauthorized(() => { signOut(); });
  }, [signOut]);

  React.useEffect(() => {
    if (!user) { setHousehold(undefined); setNeedsOnboarding(undefined); return; }
    fetchHousehold()
      .then(async (id) => {
        setHousehold(id);
        if (id) {
          // Existing household found on startup — mark onboarding done (wizard only triggers via HouseholdScreen for new households)
          await AsyncStorage.setItem(onboardingKey(id), "true");
          setNeedsOnboarding(false);
        } else {
          setNeedsOnboarding(false);
        }
      })
      .catch(async (err) => {
        if (err instanceof AuthError) {
          await new Promise((r) => setTimeout(r, 2000));
          fetchHousehold().then(async (id) => {
            setHousehold(id);
            if (id) {
              await AsyncStorage.setItem(onboardingKey(id), "true");
              setNeedsOnboarding(false);
            } else {
              setNeedsOnboarding(false);
            }
          }).catch(() => { setHousehold(null); setNeedsOnboarding(false); });
        } else {
          setHousehold(null);
        }
      });
  }, [user]);

  const completeOnboarding = async () => {
    if (household) await AsyncStorage.setItem(onboardingKey(household), "true");
    setNeedsOnboarding(false);
  };

  if (loading || (user && (household === undefined || needsOnboarding === undefined))) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f0f8ff" }}>
        <ActivityIndicator size="large" color="#0262A0" />
      </View>
    );
  }

  if (!user) return <LoginScreen />;
  if (!household) return (
    <HouseholdScreen onHouseholdReady={async (id, isNew) => {
      setHousehold(id);
      if (isNew) {
        setNeedsOnboarding(true);
      } else {
        // Joining an existing household — skip wizard, mark as done
        await AsyncStorage.setItem(onboardingKey(id), "true");
        setNeedsOnboarding(false);
      }
    }} />
  );
  if (needsOnboarding) return (
    <OnboardingWizardScreen onComplete={completeOnboarding} />
  );
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
