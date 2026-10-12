import type { Metadata } from "next";
import localFont from "next/font/local";
import { Shell } from "../components/shell";
import { ToastProvider } from "../components/toast";
import { SessionProvider } from "../lib/session";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Time off",
  description: "Policies, requests and balances for a time off tracking API",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <SessionProvider>
          <ToastProvider>
            <Shell>{children}</Shell>
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
