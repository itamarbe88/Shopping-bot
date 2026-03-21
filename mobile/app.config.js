require("dotenv").config();

module.exports = {
  expo: {
    name: "salvador",
    slug: "salvador",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundColor: "#E6F4FE",
      },
      predictiveBackGestureEnabled: false,
      package: "com.itamarbenezra.salvador",
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            {
              scheme:
                "com.googleusercontent.apps.49266329932-oo7c9ciqupvjdqui8u23c4920n795brk",
              host: "oauth2redirect",
              pathPrefix: "/google",
            },
          ],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-web-browser",
      [
        "@react-native-google-signin/google-signin",
        {
          googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./android/app/google-services.json",
          iosUrlScheme: "com.googleusercontent.apps.49266329932-oo7c9ciqupvjdqui8u23c4920n795brk",
        },
      ],
    ],
    extra: {
      googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID,
      eas: {
        projectId: "f0abd7b9-52fc-4a9a-8181-52c206caf880",
      },
    },
  },
};
