import { Suspense } from "react";
import { GroupHistory } from "@/components/group-history";

export default function CycleHistoryPage() {
  return <Suspense fallback={<p role="status">Loading history…</p>}><GroupHistory kind="cycles" /></Suspense>;
}
