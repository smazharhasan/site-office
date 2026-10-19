import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type Role = "owner" | "owner_supervisor" | "builder" | "site_supervisor" | "store_keeper" | "supplier" | "consultant";
export interface Membership { project_id: string; role: Role; person_id: string | null; projects: { name: string; address: string | null } | null }
export interface Me { full_name: string; status: string; type: string }

interface Ctx {
  session: Session | null; ready: boolean;
  memberships: Membership[]; current: Membership | null; me: Me | null;
  choose: (projectId: string) => void; reload: () => Promise<void>;
}
const C = createContext<Ctx>({ session: null, ready: false, memberships: [], current: null, me: null, choose: () => {}, reload: async () => {} });
export const useProject = () => useContext(C);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    if (!session) { setMemberships([]); return; }
    const { data } = await supabase.from("project_members").select("project_id, role, person_id, projects(name, address)").eq("user_id", session.user.id).eq("active", true);
    const ms = (data ?? []) as unknown as Membership[];
    setMemberships(ms);
    const cur = ms.find((m) => m.project_id === currentId) ?? (ms.length === 1 ? ms[0] : null);
    setCurrentId(cur?.project_id ?? null);
    if (cur?.person_id) {
      const { data: p } = await supabase.from("people").select("full_name, status, type").eq("id", cur.person_id).maybeSingle();
      setMe((p as Me) ?? null);
    } else setMe(null);
  }, [session, currentId]);
  useEffect(() => { reload(); }, [reload]);

  const current = memberships.find((m) => m.project_id === currentId) ?? null;
  return <C.Provider value={{ session, ready, memberships, current, me, choose: setCurrentId, reload }}>{children}</C.Provider>;
}

/** Which field screens each role may open. */
export const SCREENS: Record<string, Role[]> = {
  attendance: ["owner", "owner_supervisor", "site_supervisor", "store_keeper"],
  release: ["owner", "owner_supervisor", "site_supervisor", "store_keeper", "builder"],
  receive: ["owner", "owner_supervisor", "site_supervisor", "store_keeper", "builder"],
  tanker: ["owner", "owner_supervisor", "site_supervisor", "store_keeper"],
  count: ["owner", "owner_supervisor", "site_supervisor", "store_keeper"],
  "daily-log": ["owner", "owner_supervisor", "site_supervisor", "builder"],
  stock: ["owner", "owner_supervisor", "site_supervisor", "store_keeper", "builder"],
  review: ["owner", "owner_supervisor"],
  people: ["owner", "owner_supervisor"],
  team: ["owner"],
};
