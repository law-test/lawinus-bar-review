import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { User } from "@supabase/supabase-js";
import { supabase, clearMaterialUrls, setMaterialUser } from "./backend";
import ReviewWorkspace from "./review-workspace";
import {RecordTransfer,takeRecordTransfer} from "./record-transfer";
import "./login.css";

const recordTransferToken=takeRecordTransfer();

function sessionUserId(value: unknown): string | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid session response");
  const user = (value as { user?: unknown }).user;
  if (!user || typeof user !== "object" || Array.isArray(user)) throw Error("Invalid session user");
  const id = (user as { id?: unknown }).id;
  if (typeof id !== "string" || !id) throw Error("Invalid session identity");
  return id;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const [retry, setRetry] = useState(0);
  const verifiedIdentity = useRef<string | null>(null);
  const reviewUser = useMemo(() => user ? { id: user.id, name: "내 기록", email: "" } : null, [user?.id]);

  useEffect(() => {
    let alive = true, running = false, repeat = false, generation = 0;

    async function openWorkspace() {
      if (!alive) return;
      if (running) { repeat = true; return; }
      running = true;
      const attempt = ++generation;
      const current = () => alive && attempt === generation;
      if (!verifiedIdentity.current) { setReady(false); setFailure(""); }
      try {
        const stored = await supabase.auth.getSession();
        if (!current()) return;
        // Preserve an existing session even if its network refresh fails.
        if (stored.error) throw stored.error;
        let expectedUserId = sessionUserId(stored.data?.session);
        if (expectedUserId === null) {
          const created = await supabase.auth.signInAnonymously();
          if (!current()) return;
          if (created.error) throw created.error;
          expectedUserId = sessionUserId(created.data?.session);
          if (expectedUserId === null) throw Error("Session unavailable");
        }
        const verified = await supabase.auth.getUser();
        if (!current()) return;
        if (verified.error || !verified.data.user || verified.data.user.id !== expectedUserId) {
          throw verified.error ?? Error("Session identity changed");
        }
        verifiedIdentity.current = verified.data.user.id;
        setMaterialUser(verified.data.user.id);
        setUser(verified.data.user); setFailure(""); setReady(true);
      } catch {
        if (!current()) return;
        verifiedIdentity.current = null; clearMaterialUrls();
        setUser(null); setReady(true);
        setFailure("연결 상태를 확인한 뒤 다시 시도해 주세요. 이 브라우저에 보관한 기록은 유지됩니다.");
      } finally {
        running = false;
        if (alive && repeat) { repeat = false; window.setTimeout(() => void openWorkspace(), 0); }
      }
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      generation++;
      if ((session?.user.id ?? null) !== verifiedIdentity.current) {
        verifiedIdentity.current = null; clearMaterialUrls(); setUser(null); setReady(false);
      }
      // Auth work runs outside the callback lock. Single-flight startup prevents
      // duplicate anonymous registrations during initial-session events.
      window.setTimeout(() => void openWorkspace(), 0);
    });
    void openWorkspace();
    return () => {
      alive = false; generation++; verifiedIdentity.current = null;
      data.subscription.unsubscribe(); clearMaterialUrls();
    };
  }, [retry]);

  if (user && reviewUser) return <RecordTransfer token={recordTransferToken} userId={user.id}><ReviewWorkspace key={user.id} initialUser={reviewUser} /></RecordTransfer>;
  if (!ready) return <main className="auth-shell"><p role="status">검토실을 여는 중…</p></main>;
  return <main className="auth-shell"><section className="auth-card">
    <p className="auth-eyebrow">LAW IN US</p><h1>검토실을 열지 못했습니다.</h1>
    <p role="alert">{failure}</p><button type="button" onClick={() => setRetry(value => value + 1)}>다시 시도</button>
  </section></main>;
}

createRoot(document.getElementById("root")!).render(<App />);
