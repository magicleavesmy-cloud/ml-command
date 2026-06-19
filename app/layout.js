import { Ubuntu } from "next/font/google";
import "./globals.css";

const ubuntu = Ubuntu({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-ubuntu",
  display: "swap",
});

export const metadata = {
  title: "Magic Leaves Command Center",
  description: "Unified Magic Leaves dashboard for sales, stock, and supplier debt.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={ubuntu.variable}>
      <body>{children}</body>
    </html>
  );
}
