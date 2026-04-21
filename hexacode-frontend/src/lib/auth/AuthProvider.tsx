import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCurrentActor, type AuthMe, type PermissionCode, type RoleCode } from "@/lib/api";
import { setAccessToken } from "@/lib/api/client";
import { getPublicEnv, type PublicEnv } from "@/lib/env";
import {
  clearStoredSession,
  getApiBearerToken,
  getSessionGroups,
  isAdminSession,
  isCognitoConfigured,
  isReviewerSession,
  loginWithPassword,
  performGlobalSignOut,
  readStoredSession,
  SESSION_STORAGE_KEY,
  type AuthSession,
  type PasswordLoginResult,
} from "./cognito";

type Status = "loading" | "anonymous" | "authenticated";

type AuthContextValue = {
  env: PublicEnv;
  isConfigured: boolean;
  status: Status;
  authzLoading: boolean;
  session: AuthSession | null;
  profile: AuthMe | null;
  roles: RoleCode[];
  permissions: PermissionCode[];
  userStatusCode: "active" | "disabled" | null;
  isDisabled: boolean;
  isReviewer: boolean;
  isAdmin: boolean;
  canAccessDashboard: boolean;
  accessToken: string | null;
  hasRole: (role: RoleCode) => boolean;
  hasPermission: (permission: PermissionCode) => boolean;
  hasAnyPermission: (permissions: PermissionCode[]) => boolean;
  login: (c: { username: string; password: string }) => Promise<PasswordLoginResult>;
  logout: () => void;
  refreshFromStorage: () => void;
  setSession: (s: AuthSession | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const env = useMemo(() => getPublicEnv(), []);
  const [session, setSessionState] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [authzLoading, setAuthzLoading] = useState(false);
  const [profile, setProfile] = useState<AuthMe | null>(null);
  const requestIdRef = useRef(0);

  const apply = useCallback(async (s: AuthSession | null) => {
    const requestId = ++requestIdRef.current;
    setSessionState(s);
    setAccessToken(getApiBearerToken(s));
    setProfile(null);

    if (!s) {
      setAuthzLoading(false);
      setStatus("anonymous");
      return;
    }

    setStatus("authenticated");
    setAuthzLoading(true);
    try {
      const nextProfile = await getCurrentActor();
      if (requestIdRef.current !== requestId) return;
      setProfile(nextProfile);
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      const statusCode = (error as Error & { status?: number }).status;
      if (statusCode === 401) {
        clearStoredSession();
        setSessionState(null);
        setAccessToken(null);
        setProfile(null);
        setStatus("anonymous");
      }
    } finally {
      if (requestIdRef.current === requestId) setAuthzLoading(false);
    }
  }, []);

  useEffect(() => {
    void apply(readStoredSession());
  }, [apply]);

  useEffect(() => {
    const onStorage = (ev: StorageEvent) => {
      if (ev.key && ev.key !== SESSION_STORAGE_KEY) return;
      void apply(readStoredSession());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [apply]);

  const login = useCallback<AuthContextValue["login"]>(
    async (c) => {
      const r = await loginWithPassword(env, c);
      if (r.status === "authenticated") await apply(r.session);
      return r;
    },
    [env, apply],
  );

  const logout = useCallback(() => {
    const active = session;
    clearStoredSession();
    void apply(null);
    void performGlobalSignOut(env, active);
  }, [env, session, apply]);

  const refreshFromStorage = useCallback(() => {
    void apply(readStoredSession());
  }, [apply]);

  const fallbackRoles = useMemo<RoleCode[]>(() => {
    if (!session) return [];
    const roles = new Set<RoleCode>(["contestant"]);
    const groups = getSessionGroups(session);
    if (groups.includes("author") || groups.includes("authors")) roles.add("author");
    if (groups.includes("reviewer")) roles.add("reviewer");
    if (groups.includes("moderator")) roles.add("moderator");
    if (groups.includes("admin")) roles.add("admin");
    return Array.from(roles).sort();
  }, [session]);

  const roles = profile?.roles?.length ? profile.roles : fallbackRoles;
  const permissions = profile?.permissions ?? [];

  const hasRole = useCallback((role: RoleCode) => roles.includes(role), [roles]);
  const hasPermission = useCallback(
    (permission: PermissionCode) => permissions.includes("admin.full") || permissions.includes(permission),
    [permissions],
  );
  const hasAnyPermission = useCallback(
    (codes: PermissionCode[]) => codes.some((code) => hasPermission(code)),
    [hasPermission],
  );

  const canAccessDashboard = hasAnyPermission([
    "problem.read_own_dashboard",
    "problem.read_review_queue",
    "tag.read_dashboard",
    "user.read_directory",
    "ops.read_dashboard",
    "ops.manage_storage_orphans",
  ]);

  const value: AuthContextValue = {
    env,
    isConfigured: isCognitoConfigured(env),
    status,
    authzLoading,
    session,
    profile,
    roles,
    permissions,
    userStatusCode: profile?.status_code ?? null,
    isDisabled: profile?.is_disabled ?? false,
    isReviewer: hasRole("reviewer") || hasRole("admin") || isReviewerSession(session),
    isAdmin: hasRole("admin") || isAdminSession(session),
    canAccessDashboard,
    accessToken: getApiBearerToken(session),
    hasRole,
    hasPermission,
    hasAnyPermission,
    login,
    logout,
    refreshFromStorage,
    setSession: (s) => {
      void apply(s);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an AuthProvider.");
  return ctx;
}
