import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Bake Sale", template: "%s · Bake Sale" },
  description: "Checkout and fundraising records for the youth bake sale",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-stone-50 text-stone-900">{children}</body>
    </html>
  );
}
