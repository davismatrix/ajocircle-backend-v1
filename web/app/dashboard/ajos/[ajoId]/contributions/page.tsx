import { Suspense } from "react";
import { GroupHistory } from "@/components/group-history";

export default function ContributionHistoryPage() {
  return <Suspense fallback={<p role="status">Loading history…</p>}><GroupHistory kind="contributions" /></Suspense>;
}
