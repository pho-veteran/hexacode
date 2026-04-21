import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  GlobalSignOutCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { PublicEnv } from "@/lib/env";

type JwtClaimValue = string | number | boolean | string[] | null | undefined;

export type AuthSession = {
  accessToken: string;
  idToken: string;
  expiresAt: number;
  claims: Record<string, JwtClaimValue>;
};

export type CodeDeliveryDetails = { destination?: string; medium?: string };

export type PendingNewPasswordChallenge = {
  username: string;
  session: string;
  requiredAttributes: string[];
};

export type PasswordLoginResult =
  | { status: "authenticated"; session: AuthSession }
  | { status: "new_password_required"; challenge: PendingNewPasswordChallenge };

export const SESSION_STORAGE_KEY = "hexacode.auth.session";
export const NEW_PASSWORD_CHALLENGE_STORAGE_KEY = "hexacode.auth.new-password-challenge";

function decodeJwtPayload(token: string) {
  const [, payload = ""] = token.split(".");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return JSON.parse(atob(`${normalized}${padding}`)) as Record<string, JwtClaimValue>;
}

export function readStoredSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as AuthSession;
    if (s.expiresAt <= Date.now()) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return s;
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}
function writeStoredSession(s: AuthSession) {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s));
}
export function clearStoredSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  window.sessionStorage.removeItem(NEW_PASSWORD_CHALLENGE_STORAGE_KEY);
}

function createClient(env: PublicEnv) {
  return new CognitoIdentityProviderClient({ region: env.cognitoRegion });
}

export function isCognitoConfigured(env: PublicEnv) {
  return Boolean(env.cognitoClientId && env.cognitoRegion);
}

function buildSession(tokens: { AccessToken?: string; IdToken?: string; ExpiresIn?: number }) {
  if (!tokens.AccessToken || !tokens.IdToken) {
    throw new Error("Cognito did not return the expected access and identity tokens.");
  }
  return {
    accessToken: tokens.AccessToken,
    idToken: tokens.IdToken,
    expiresAt: Date.now() + (tokens.ExpiresIn ?? 3600) * 1000,
    claims: decodeJwtPayload(tokens.IdToken),
  } satisfies AuthSession;
}

function normalizeAttributeName(a: string) {
  return a.replace(/^userAttributes\./, "");
}
function parseAttributeList(raw: string | undefined) {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    if (Array.isArray(p)) return p.map((v) => normalizeAttributeName(String(v)));
  } catch {}
  return raw
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((v) => v.trim().replace(/^"+|"+$/g, ""))
    .filter(Boolean)
    .map(normalizeAttributeName);
}

export function readPendingNewPasswordChallenge(): PendingNewPasswordChallenge | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(NEW_PASSWORD_CHALLENGE_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingNewPasswordChallenge;
  } catch {
    window.sessionStorage.removeItem(NEW_PASSWORD_CHALLENGE_STORAGE_KEY);
    return null;
  }
}
function writePendingChallenge(c: PendingNewPasswordChallenge) {
  window.sessionStorage.setItem(NEW_PASSWORD_CHALLENGE_STORAGE_KEY, JSON.stringify(c));
}
function clearPendingChallenge() {
  if (typeof window !== "undefined")
    window.sessionStorage.removeItem(NEW_PASSWORD_CHALLENGE_STORAGE_KEY);
}

function describeChallenge(name: string) {
  switch (name) {
    case "SMS_MFA":
    case "SOFTWARE_TOKEN_MFA":
    case "MFA_SETUP":
      return `Cognito requested ${name}, but this custom form does not support MFA yet.`;
    default:
      return `Cognito requested the ${name} challenge, which this custom login flow does not support yet.`;
  }
}

export function normalizeCognitoError(
  error: unknown,
  overrides: Record<string, string> = {},
  fallback = "Cognito request failed.",
) {
  if (!(error instanceof Error)) return fallback;
  if (error.message.includes("SECRET_HASH")) {
    return "This Cognito app client requires a client secret. Use a public app client without a secret for browser sign-in.";
  }
  const common: Record<string, string> = {
    CodeMismatchException: "The confirmation code is invalid.",
    ExpiredCodeException: "That confirmation code has expired. Request a fresh one.",
    InvalidPasswordException: error.message || "The new password does not satisfy the Cognito password policy.",
    LimitExceededException: "Cognito rate-limited this action. Wait a moment and try again.",
    TooManyRequestsException: "Cognito rate-limited this request. Wait a moment and try again.",
    UserNotConfirmedException: "This Cognito user is not confirmed yet.",
    UserNotFoundException: "No Cognito user was found for that username.",
    UsernameExistsException: "This username already exists in Cognito.",
  };
  if (error.name === "InvalidParameterException")
    return error.message || "The Cognito login request is invalid.";
  return overrides[error.name] ?? common[error.name] ?? error.message ?? fallback;
}

export function getSessionUsername(s: AuthSession | null) {
  if (!s) return null;
  if (typeof s.claims.email === "string") return s.claims.email;
  if (typeof s.claims["cognito:username"] === "string") return s.claims["cognito:username"] as string;
  if (typeof s.claims.preferred_username === "string") return s.claims.preferred_username as string;
  return null;
}

export function getSessionGroups(s: AuthSession | null): string[] {
  if (!s) return [];
  const g = s.claims["cognito:groups"];
  if (Array.isArray(g)) return g.map(String).map((v) => v.toLowerCase());
  if (typeof g === "string")
    return g
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  return [];
}

export function isReviewerSession(s: AuthSession | null) {
  const groups = getSessionGroups(s);
  return groups.includes("admin") || groups.includes("reviewer");
}

export function isAdminSession(s: AuthSession | null) {
  return getSessionGroups(s).includes("admin");
}

export function getApiBearerToken(s: AuthSession | null) {
  if (!s) return null;
  return s.idToken || s.accessToken || null;
}

export function formatUserAttributeLabel(n: string) {
  return n
    .replace(/^custom:/, "custom ")
    .replace(/[_:]+/g, " ")
    .replace(/\b\w/g, (v) => v.toUpperCase());
}

export async function loginWithPassword(
  env: PublicEnv,
  credentials: { username: string; password: string },
): Promise<PasswordLoginResult> {
  if (!isCognitoConfigured(env)) {
    throw new Error(
      "Cognito is not configured. Set PUBLIC_COGNITO_CLIENT_ID and PUBLIC_COGNITO_REGION.",
    );
  }
  const username = credentials.username.trim();
  if (!username || !credentials.password) throw new Error("Username and password are required.");

  try {
    const response = await createClient(env).send(
      new InitiateAuthCommand({
        ClientId: env.cognitoClientId,
        AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: { USERNAME: username, PASSWORD: credentials.password },
      }),
    );

    if (response.ChallengeName === "NEW_PASSWORD_REQUIRED") {
      const challenge: PendingNewPasswordChallenge = {
        username:
          response.ChallengeParameters?.USER_ID_FOR_SRP ??
          response.ChallengeParameters?.USERNAME ??
          username,
        session: response.Session ?? "",
        requiredAttributes: parseAttributeList(response.ChallengeParameters?.requiredAttributes),
      };
      if (!challenge.session)
        throw new Error("Cognito requested a new password challenge but did not return a session token.");
      writePendingChallenge(challenge);
      return { status: "new_password_required", challenge };
    }

    if (response.ChallengeName) throw new Error(describeChallenge(response.ChallengeName));

    const session = buildSession(response.AuthenticationResult ?? {});
    clearPendingChallenge();
    writeStoredSession(session);
    return { status: "authenticated", session };
  } catch (error) {
    throw new Error(
      normalizeCognitoError(
        error,
        {
          NotAuthorizedException: "Incorrect username or password.",
          PasswordResetRequiredException:
            "This account must reset its password before signing in.",
          UserNotFoundException: "Incorrect username or password.",
        },
        "Cognito sign-in failed.",
      ),
    );
  }
}

export async function signUpWithPassword(
  env: PublicEnv,
  input: { username: string; email: string; password: string },
) {
  const username = input.username.trim();
  const email = input.email.trim();
  if (!username || !email || !input.password)
    throw new Error("Username, email, and password are required.");
  try {
    const response = await createClient(env).send(
      new SignUpCommand({
        ClientId: env.cognitoClientId,
        Username: username,
        Password: input.password,
        UserAttributes: [{ Name: "email", Value: email }],
      }),
    );
    return {
      username,
      userConfirmed: Boolean(response.UserConfirmed),
      codeDelivery: {
        destination: response.CodeDeliveryDetails?.Destination,
        medium: response.CodeDeliveryDetails?.DeliveryMedium,
      } satisfies CodeDeliveryDetails,
    };
  } catch (e) {
    throw new Error(normalizeCognitoError(e, {}, "Cognito sign-up failed."));
  }
}

export async function confirmSignUp(env: PublicEnv, input: { username: string; code: string }) {
  const username = input.username.trim();
  const code = input.code.trim();
  if (!username || !code) throw new Error("Username and confirmation code are required.");
  try {
    await createClient(env).send(
      new ConfirmSignUpCommand({
        ClientId: env.cognitoClientId,
        Username: username,
        ConfirmationCode: code,
      }),
    );
  } catch (e) {
    throw new Error(normalizeCognitoError(e, {}, "Cognito sign-up confirmation failed."));
  }
}

export async function resendSignUpCode(env: PublicEnv, username: string) {
  const u = username.trim();
  if (!u) throw new Error("Username is required before resending the confirmation code.");
  try {
    const r = await createClient(env).send(
      new ResendConfirmationCodeCommand({ ClientId: env.cognitoClientId, Username: u }),
    );
    return {
      destination: r.CodeDeliveryDetails?.Destination,
      medium: r.CodeDeliveryDetails?.DeliveryMedium,
    } satisfies CodeDeliveryDetails;
  } catch (e) {
    throw new Error(normalizeCognitoError(e, {}, "Cognito could not resend the confirmation code."));
  }
}

export async function requestPasswordReset(env: PublicEnv, username: string) {
  const u = username.trim();
  if (!u) throw new Error("Username or email is required.");
  try {
    const r = await createClient(env).send(
      new ForgotPasswordCommand({ ClientId: env.cognitoClientId, Username: u }),
    );
    return {
      destination: r.CodeDeliveryDetails?.Destination,
      medium: r.CodeDeliveryDetails?.DeliveryMedium,
    } satisfies CodeDeliveryDetails;
  } catch (e) {
    throw new Error(normalizeCognitoError(e, {}, "Cognito password reset failed."));
  }
}

export async function confirmPasswordReset(
  env: PublicEnv,
  input: { username: string; code: string; newPassword: string },
) {
  const username = input.username.trim();
  const code = input.code.trim();
  if (!username || !code || !input.newPassword)
    throw new Error("Username, confirmation code, and new password are required.");
  try {
    await createClient(env).send(
      new ConfirmForgotPasswordCommand({
        ClientId: env.cognitoClientId,
        Username: username,
        ConfirmationCode: code,
        Password: input.newPassword,
      }),
    );
  } catch (e) {
    throw new Error(normalizeCognitoError(e, {}, "Cognito could not confirm the password reset."));
  }
}

export async function completeNewPasswordChallenge(
  env: PublicEnv,
  input: { newPassword: string; attributeValues: Record<string, string> },
) {
  const pending = readPendingNewPasswordChallenge();
  if (!pending) throw new Error("There is no pending new-password challenge in this browser.");
  if (!input.newPassword) throw new Error("A new password is required.");

  const responses: Record<string, string> = {
    USERNAME: pending.username,
    NEW_PASSWORD: input.newPassword,
  };
  for (const a of pending.requiredAttributes) {
    const v = input.attributeValues[a]?.trim();
    if (!v) throw new Error(`${formatUserAttributeLabel(a)} is required.`);
    responses[`userAttributes.${a}`] = v;
  }
  try {
    const response = await createClient(env).send(
      new RespondToAuthChallengeCommand({
        ClientId: env.cognitoClientId,
        ChallengeName: "NEW_PASSWORD_REQUIRED",
        Session: pending.session,
        ChallengeResponses: responses,
      }),
    );
    if (response.ChallengeName) throw new Error(describeChallenge(response.ChallengeName));
    const session = buildSession(response.AuthenticationResult ?? {});
    clearPendingChallenge();
    writeStoredSession(session);
    return session;
  } catch (e) {
    throw new Error(
      normalizeCognitoError(e, {}, "Cognito could not complete the new-password challenge."),
    );
  }
}

export async function performGlobalSignOut(env: PublicEnv, session: AuthSession | null) {
  if (!session?.accessToken || !isCognitoConfigured(env)) return;
  try {
    await createClient(env).send(new GlobalSignOutCommand({ AccessToken: session.accessToken }));
  } catch {
    // best-effort; local session is cleared regardless
  }
}
