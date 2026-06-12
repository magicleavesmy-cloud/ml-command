import "./globals.css";

export const metadata = {
  title: "Magic Leaves Command Center",
  description: "Unified Magic Leaves dashboard for sales, stock, and supplier debt.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
