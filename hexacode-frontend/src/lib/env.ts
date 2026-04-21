export type PublicEnv = {
  apiBaseUrl: string;
  cognitoDomain: string;
  cognitoClientId: string;
  cognitoRegion: string;
  cognitoScopes: string;
};

declare global {
  interface Window {
    __HEXACODE_ENV__?: PublicEnv;
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function inferCognitoRegion(cognitoDomain: string) {
  if (!cognitoDomain) return "";
  try {
    const url = cognitoDomain.startsWith("http")
      ? new URL(cognitoDomain)
      : new URL(`https://${cognitoDomain}`);
    const match = url.hostname.match(/\.auth\.([a-z0-9-]+)\.amazoncognito\.com$/i);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}

const DEFAULT_API = "http://127.0.0.1:8080";

export function getPublicEnv(): PublicEnv {
  if (typeof window !== "undefined" && window.__HEXACODE_ENV__) {
    return window.__HEXACODE_ENV__;
  }

  const meta = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
  const cognitoDomain = trimTrailingSlash(meta.VITE_COGNITO_DOMAIN ?? meta.PUBLIC_COGNITO_DOMAIN ?? "");

  return {
    apiBaseUrl: trimTrailingSlash(
      meta.VITE_API_BASE_URL ?? meta.PUBLIC_API_BASE_URL ?? DEFAULT_API,
    ),
    cognitoDomain,
    cognitoClientId: meta.VITE_COGNITO_CLIENT_ID ?? meta.PUBLIC_COGNITO_CLIENT_ID ?? "",
    cognitoRegion:
      meta.VITE_COGNITO_REGION ??
      meta.PUBLIC_COGNITO_REGION ??
      meta.AWS_REGION ??
      inferCognitoRegion(cognitoDomain),
    cognitoScopes:
      meta.VITE_COGNITO_SCOPES ?? meta.PUBLIC_COGNITO_SCOPES ?? "openid email profile",
  };
}
