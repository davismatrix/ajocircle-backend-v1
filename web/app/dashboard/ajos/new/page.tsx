"use client";

import Link from "next/link";
import { GroupForm } from "@/components/group-form";

export default function CreateGroupPage() {
  return <>
    <Link className="back-link" href="/dashboard">← My Ajos</Link>
    <section className="dashboard-card form-card">
      <h1>Create a savings group</h1><p className="muted">Set the contribution and schedule. Your group starts as a draft.</p>
      <GroupForm />
    </section>
  </>;
}
