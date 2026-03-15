import React, { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import CartIcon from "../CartIcon";
import { useAuth } from "../context/AuthContext";

const WEB_CLIENT_ID = "49266329932-3kn7a61im5hc7pd9qhcc27hlq1m8bgk3.apps.googleusercontent.com";

GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const tokens = await GoogleSignin.getTokens();
      const user = userInfo.data?.user;
      if (user && tokens.idToken) {
        await signIn(
          { id: user.id, name: user.name ?? "", email: user.email, picture: user.photo ?? "" },
          tokens.idToken
        );
      }
    } catch (error: any) {
      Alert.alert("שגיאה", `קוד: ${error.code ?? "none"}\n${error.message ?? ""}`);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <CartIcon size={100} />
      <Text style={styles.title}>סלבדור</Text>
      <Text style={styles.subtitle}>פשוט, לקנות!</Text>

      <TouchableOpacity
        style={[styles.googleBtn, loading && styles.googleBtnDisabled]}
        onPress={handleGoogleSignIn}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Text style={styles.googleIcon}>G</Text>
            <Text style={styles.googleBtnText}>התחבר עם Google</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f8ff", alignItems: "center", justifyContent: "center", padding: 32 },
  logo: { marginBottom: 16 },
  title: { fontSize: 28, fontWeight: "800", color: "#0262A0", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#888", marginBottom: 48 },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0262A0",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 30,
    elevation: 4,
    shadowColor: "#0262A0",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    gap: 12,
  },
  googleBtnDisabled: { opacity: 0.6 },
  googleIcon: { color: "#fff", fontSize: 18, fontWeight: "900" },
  googleBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
