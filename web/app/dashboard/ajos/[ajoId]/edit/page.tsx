"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { GroupForm } from "@/components/group-form";
import { useCurrentUser } from "@/components/current-user";
import { useResource } from "@/hooks/use-resource";
import { AjoGroup } from "@/lib/ajo";

export default function EditGroupPage() {
  const { ajoId } = useParams<{ ajoId: string }>();
  const user = useCurrentUser();
  const { data: group, error, retry } = useResource<AjoGroup>(`/ajo-groups/${ajoId}`);
  return <>
    <Link className="back-link" href={`/dashboard/ajos/${ajoId}`}>← Group overview</Link>
    <section className="dashboard-card form-card">
      <h1>Edit draft group</h1>
      {error ? <><p className="error" role="alert">{error}</p><button onClick={retry}>Try again</button></>
        : !group ? <p role="status">Loading group settings…</p>
        : group.status !== "DRAFT" || group.created_by !== user.id ? <p role="alert">Only the owner can edit a draft group.</p>
        : <GroupForm key={group.id} group={group} />}
    </section>
  </>;
}
