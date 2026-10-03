import type { Metadata, Viewport } from "next";
import "./globals.css";

const SITE_URL =
  process.env.SITE_URL ??
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : "https://happy-claude-production.up.railway.app");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "HAPPY CLAUDE",
  description: "a shared internet experiment. everyone online is fighting over the same Claude.",
  openGraph: {
    title: "HAPPY CLAUDE",
    description: "one Claude. one room. everyone online is fighting over him.",
    siteName: "HAPPY CLAUDE",
    url: "/",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "HAPPY CLAUDE",
    description: "one Claude. one room. everyone online is fighting over him.",
  },
  icons: {
    icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 shape-rendering=%22crispEdges%22><rect x=%223%22 y=%225%22 width=%2214%22 height=%228%22 fill=%22%23D97757%22/><rect x=%221%22 y=%228%22 width=%222%22 height=%222%22 fill=%22%23D97757%22/><rect x=%2217%22 y=%228%22 width=%222%22 height=%222%22 fill=%22%23D97757%22/><rect x=%224%22 y=%2213%22 width=%221%22 height=%223%22 fill=%22%23B65E40%22/><rect x=%227%22 y=%2213%22 width=%221%22 height=%223%22 fill=%22%23B65E40%22/><rect x=%2212%22 y=%2213%22 width=%221%22 height=%223%22 fill=%22%23B65E40%22/><rect x=%2215%22 y=%2213%22 width=%221%22 height=%223%22 fill=%22%23B65E40%22/><rect x=%226%22 y=%227%22 width=%221%22 height=%222%22 fill=%22%231D1D1F%22/><rect x=%2213%22 y=%227%22 width=%221%22 height=%222%22 fill=%22%231D1D1F%22/></svg>",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#F7F5F2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
