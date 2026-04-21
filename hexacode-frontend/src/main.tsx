import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "@/styles/index.css";
import { router } from "@/app/router";
import { Providers } from "@/app/Providers";

(() => {
  try {
    const stored = window.localStorage.getItem("hexacode.theme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const theme = stored === "light" || stored === "dark" ? stored : prefersDark ? "dark" : "light";
    if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  } catch {}
})();

const el = document.getElementById("root");
if (!el) throw new Error("Missing #root element.");

createRoot(el).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
