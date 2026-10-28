"use client";

import { createContext, useContext } from "react";
import { CurrentUser } from "@/lib/api";

export const CurrentUserContext = createContext<CurrentUser | null>(null);
export function useCurrentUser() {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error("Authenticated layout required");
  return user;
}
