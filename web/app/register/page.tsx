import { authReturnPath } from "@/lib/auth-return";
import { AuthForm } from "@/components/auth-form";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <AuthForm mode="register" returnTo={authReturnPath(next)} />;
}
