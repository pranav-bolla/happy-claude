import type { Metadata } from "next";
import DailyClaude from "@/components/daily/DailyClaude";

export const metadata: Metadata = {
  title: "Daily Claude",
  description: "One Claude a day. Same for everyone. How few moves does it take you?",
  openGraph: {
    title: "Daily Claude",
    description: "KO him in as few moves as you can. New puzzle every day, same for everyone.",
    siteName: "WHIP CLAUDE",
    url: "/daily",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Daily Claude",
    description: "KO him in as few moves as you can. New puzzle every day, same for everyone.",
  },
};

export default function Page() {
  return <DailyClaude />;
}
