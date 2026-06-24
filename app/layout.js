import localFont from "next/font/local";
import "./globals.css";

const geist = localFont({
  src: [
    {
      path: "./fonts/GeistVF.woff",
      weight: "100 900",
      style: "normal",
    },
  ],
  variable: "--font-geist",
  display: "swap",
});

export const metadata = {
  title: "Magic Leaves Command Center",
  description: "Unified Magic Leaves dashboard for sales, stock, and supplier debt.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
