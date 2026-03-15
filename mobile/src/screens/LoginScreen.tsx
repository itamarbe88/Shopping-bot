import React, { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import Constants from "expo-constants";
import CartIcon from "../CartIcon";
import { useAuth } from "../context/AuthContext";

const WEB_CLIENT_ID: string = Constants.expoConfig?.extra?.googleWebClientId ?? "";

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
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        // user cancelled
      } else if (error.code === statusCodes.IN_PROGRESS) {
        Alert.alert("שגיאה", "כניסה כבר בתהליך.");
      } else {
        Alert.alert("שגיאה", "ההתחברות נכשלה. נסה שוב.");
        console.error(error);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <CartIcon size={100} />
      <Text style={styles.title}>מנהל המכולת</Text>
      <Text style={styles.subtitle}>התחבר כדי להמשיך</Text>

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
