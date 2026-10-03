import type { Metadata } from "next";
import DailyClaude from "@/components/daily/DailyClaude";
import { dailySpec, decodeRun } from "@/lib/daily";

type Props = { searchParams: Promise<{ r?: string | string[] }> };

const DESCRIPTION = "KO him in as few moves as you can. New puzzle every day, same for everyone.";

async function sharedRun(searchParams: Props["searchParams"]) {
  const { r } = await searchParams;
  const code = typeof r === "string" ? r : null;
  const run = decodeRun(code);
  return run && code ? { run, code } : null;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const shared = await sharedRun(searchParams);

  let title = "Daily Claude";
  let description = DESCRIPTION;
  let image = "/daily/og";
  let url = "/daily";
  if (shared) {
    const { run, code } = shared;
    const spec = dailySpec(run.day);
    title = `Daily Claude #${run.day}: ${run.killed ? `KO in ${run.grid.length}/${spec.moves}` : "he survived"}`;
    description = `${spec.modifier.name}. Same puzzle for everyone today. Can you beat it?`;
    image = `/daily/og?r=${code}`;
    url = `/daily?r=${code}`;
  }

  const images = [{ url: image, width: 1200, height: 630, alt: title }];
  return {
    title,
    description,
    openGraph: { title, description, siteName: "HAPPY CLAUDE", url, type: "website", images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

export default async function Page({ searchParams }: Props) {
  const shared = await sharedRun(searchParams);
  return <DailyClaude challenge={shared?.run ?? null} />;
}
