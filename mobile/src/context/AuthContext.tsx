import AsyncStorage from "@react-native-async-storage/async-storage";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const WEB_CLIENT_ID = "49266329932-3kn7a61im5hc7pd9qhcc27hlq1m8bgk3.apps.googleusercontent.com";

GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signIn: (user: AuthUser, token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("auth_user");
        if (raw) {
          setUser(JSON.parse(raw));
          // Silently refresh the token so it never expires between sessions
          const userInfo = await GoogleSignin.signInSilently();
          const tokens = await GoogleSignin.getTokens();
          if (tokens.idToken) {
            await AsyncStorage.setItem("auth_token", tokens.idToken);
          }
        }
      } catch {
        // signInSilently failed (e.g. no network) — keep existing user/token
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(async (u: AuthUser, token: string) => {
    await AsyncStorage.setItem("auth_user", JSON.stringify(u));
    await AsyncStorage.setItem("auth_token", token);
    setUser(u);
  }, []);

  const signOut = useCallback(async () => {
    await AsyncStorage.removeItem("auth_user");
    await AsyncStorage.removeItem("auth_token");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
