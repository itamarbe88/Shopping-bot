import { useNavigation } from "@react-navigation/native";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fetchShoppingList } from "../api";

export default function ShoppingListScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchShoppingList(false);
      navigation.navigate("Purchase", { items: result.shopping_list });
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
        <Text style={styles.cardTitle}>רשימת קניות</Text>
        <Text style={styles.cardDesc}>
          לחץ כדי לחשב את מה שחסר, לעדכן את המלאי ולפתוח את רשימת הקנייה
        </Text>
        <TouchableOpacity style={styles.button} onPress={handleGenerate} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>  יצר לי רשימת קניות 🛒</Text>
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
