import "./globals.css";
import WeeklySummaryGate from "./components/weekly-summary/WeeklySummaryGate";

export const metadata = {
  title: "Pool NFL",
  description: "Application de pool NFL",

  manifest: "/manifest.json",

  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pool NFL",
  },
};

export const viewport = {
  themeColor: "#020617",
};

export default function RootLayout({
  children,
}) {
  return (
    <html lang="fr">
      <body>{children}<WeeklySummaryGate /></body>
    </html>
  );
}
