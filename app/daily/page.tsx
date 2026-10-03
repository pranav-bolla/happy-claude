import type { Metadata } from "next";
import DailyClaude from "@/components/daily/DailyClaude";

export const metadata: Metadata = {
  title: "Daily Claude",
  description: "One Claude a day. Same for everyone. How few moves does it take you?",
};

export default function Page() {
  return <DailyClaude />;
}
