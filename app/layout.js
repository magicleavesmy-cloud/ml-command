import "@fontsource/bebas-neue";
import "@fontsource/barlow-condensed";
import "@fontsource/ubuntu";
import "./globals.css";

export const metadata = {
  title: "ML Command",
  description: "Unified Magic Leaves dashboard for sales, stock, and supplier debt.",
  applicationName: "ML Command",
  manifest: "/manifest.json",
  themeColor: "#ff8a1f",
  appleWebApp: {
    capable: true,
    title: "ML Command",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "default",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ff8a1f",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
