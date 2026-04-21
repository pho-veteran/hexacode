import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { getPublicEnv } from "@/lib/env";
import type { ApiEnvelope, UploadProgress } from "./types";

const NETWORK_503_MESSAGE =
  "Hexacode backend is unavailable. Start `docker compose -f docker-compose.local.yml up -d --build` and try again.";

let currentToken: string | null = null;
export function setAccessToken(token: string | null) {
  currentToken = token;
}
export function getAccessToken() {
  return currentToken;
}

const client = axios.create({
  timeout: 60_000,
});

client.interceptors.request.use((config) => {
  const env = getPublicEnv();
  const url = config.url ?? "";
  if (!/^https?:/i.test(url)) {
    config.baseURL = env.apiBaseUrl;
  }
  config.headers = config.headers ?? {};
  if (!config.headers["Accept"]) config.headers["Accept"] = "application/json";
  if (currentToken && !config.headers["Authorization"]) {
    config.headers["Authorization"] = `Bearer ${currentToken}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response) {
      const data = error.response.data;
      const message =
        data?.error?.message ??
        data?.message ??
        (typeof data === "string" ? data : null) ??
        error.response.statusText ??
        "Request failed.";
      const err = new Error(message) as Error & { status: number };
      err.status = error.response.status;
      return Promise.reject(err);
    }
    const err = new Error(NETWORK_503_MESSAGE) as Error & { status: number };
    err.status = 503;
    return Promise.reject(err);
  },
);

export async function apiGet<T>(path: string, config?: AxiosRequestConfig) {
  const res = await client.get<ApiEnvelope<T>>(path, config);
  return res.data.data;
}
export async function apiPost<T>(path: string, body?: unknown, config?: AxiosRequestConfig) {
  const res = await client.post<ApiEnvelope<T>>(path, body, config);
  return res.data.data;
}
export async function apiPut<T>(path: string, body?: unknown, config?: AxiosRequestConfig) {
  const res = await client.put<ApiEnvelope<T>>(path, body, config);
  return res.data.data;
}
export async function apiDelete<T>(path: string, config?: AxiosRequestConfig) {
  const res = await client.delete<ApiEnvelope<T>>(path, config);
  return res.data.data;
}

export async function apiMultipart<T>(
  method: "POST" | "PUT",
  path: string,
  form: FormData,
  opts?: { accessToken?: string | null; onUploadProgress?: (p: UploadProgress) => void },
) {
  const res = await client.request<ApiEnvelope<T>>({
    method,
    url: path,
    data: form,
    headers: {
      ...(opts?.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
    },
    onUploadProgress: (e) => {
      const total = typeof e.total === "number" && e.total > 0 ? e.total : null;
      opts?.onUploadProgress?.({
        loaded: e.loaded ?? 0,
        total,
        percent: total ? Math.round(((e.loaded ?? 0) / total) * 100) : null,
      });
    },
  });
  return res.data.data as T;
}

export async function downloadAuthenticatedFile(path: string, accessToken: string) {
  const env = getPublicEnv();
  const url = new URL(path, `${env.apiBaseUrl}/`).toString();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {
    throw new Error(NETWORK_503_MESSAGE);
  });
  const resp = res as Response;
  if (!resp.ok) {
    throw new Error(`Download failed with status ${resp.status}.`);
  }
  const blob = await resp.blob();
  const disposition = resp.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] ?? path.split("/").pop() ?? "download.bin";
  const obj = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = obj;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(obj);
}

export function buildApiUrl(path: string) {
  const env = getPublicEnv();
  return new URL(path, `${env.apiBaseUrl}/`).toString();
}
