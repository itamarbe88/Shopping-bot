import { useNavigation } from "@react-navigation/native";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fetchLastShoppingList, fetchShoppingList } from "../api";

export default function ShoppingListScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Warm the cache whenever this screen is visible and online
  useEffect(() => {
    fetchLastShoppingList().catch(() => {});
  }, []);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const last = await fetchLastShoppingList();
      if (last.offline) {
        if (!last.shopping_list.length) {
          setError("אין חיבור לאינטרנט ואין רשימה שמורה במכשיר.");
          return;
        }
        if (last.cacheExpired) {
          setError("אין חיבור לאינטרנט — הרשימה השמורה ישנה מ-24 שעות. ייתכן שאינה מעודכנת.");
          return;
        }
        navigation.navigate("Purchase", { items: last.shopping_list, offline: true });
        return;
      }
      const items = last.shopping_list.length > 0 ? last.shopping_list : (await fetchShoppingList(false)).shopping_list;
      navigation.navigate("Purchase", { items });
    } catch {
      setError("לא ניתן להתחבר לשרת.");
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useEffect(() => {
    navigation.setOptions({ headerBackVisible: false, headerRight: undefined });
  }, [navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <TouchableOpacity style={styles.button} onPress={handleGenerate} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}> אני בדרך לקניות... 🛒</Text>
          }
        </TouchableOpacity>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f8ff", justifyContent: "center", padding: 20 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    elevation: 4,
    shadowColor: "#0288D1",
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a1a1a",
    textAlign: "center",
    marginBottom: 10,
  },
  cardDesc: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  button: {
    backgroundColor: "#0288D1",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    elevation: 2,
    shadowColor: "#0288D1",
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  error: { color: "#c62828", textAlign: "center", marginTop: 12 },
});
