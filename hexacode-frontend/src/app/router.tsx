import { createBrowserRouter, Navigate } from "react-router-dom";
import { lazy, Suspense, type ComponentType } from "react";
import { PublicShell } from "@/components/shell/PublicShell";
import { AuthShell } from "@/components/shell/AuthShell";
import { DashboardShell } from "@/components/shell/DashboardShell";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { HomeRoute } from "@/routes/home";
import { LoginRoute } from "@/routes/login";
import { SignupRoute } from "@/routes/signup";
import { ForgotPasswordRoute } from "@/routes/forgot-password";
import { NewPasswordRoute } from "@/routes/new-password";
import { AuthCallbackRoute } from "@/routes/auth-callback";
import { ProblemsRoute } from "@/routes/problems";
import { ProblemDetailRoute } from "@/routes/problem-detail";
import { SubmissionsRoute } from "@/routes/submissions";
import { SubmissionDetailRoute } from "@/routes/submission-detail";
import { DashboardHomeRoute } from "@/routes/dashboard-home";
import { DashboardProblemsRoute } from "@/routes/dashboard-problems";
import { DashboardTagsRoute } from "@/routes/dashboard-tags";
import { DashboardUsersRoute } from "@/routes/dashboard-users";
import { DashboardOperationsRoute } from "@/routes/dashboard-operations";
import { DashboardStorageRoute } from "@/routes/dashboard-storage";
import { NotFoundRoute } from "@/routes/not-found";
import { RootErrorBoundary } from "@/app/RootErrorBoundary";
import { Skeleton } from "@/components/ui/Feedback";

function lazyNamed<T extends string>(
  loader: () => Promise<Record<T, ComponentType<unknown>>>,
  name: T,
) {
  return lazy(() =>
    loader().then((m) => ({ default: m[name] as ComponentType<unknown> })),
  );
}

const ProblemSolveRoute = lazyNamed(
  () => import("@/routes/problem-solve"),
  "ProblemSolveRoute",
);
const ProblemNewRoute = lazyNamed(() => import("@/routes/problem-new"), "ProblemNewRoute");
const ProblemEditRoute = lazyNamed(() => import("@/routes/problem-edit"), "ProblemEditRoute");
const ProblemTestsetsRoute = lazyNamed(
  () => import("@/routes/problem-testsets"),
  "ProblemTestsetsRoute",
);

function LazyFallback() {
  return (
    <div className="p-6 space-y-3">
      <Skeleton className="h-10 w-1/3" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}

const lazyEl = (El: ComponentType<unknown>) => (
  <Suspense fallback={<LazyFallback />}>
    <El />
  </Suspense>
);

export const router = createBrowserRouter([
  {
    element: <PublicShell />,
    errorElement: <RootErrorBoundary />,
    children: [
      { index: true, element: <HomeRoute /> },
      { path: "problems", element: <ProblemsRoute /> },
      { path: "problems/:slug", element: <ProblemDetailRoute /> },
      { path: "submissions", element: <SubmissionsRoute /> },
      { path: "submissions/:submissionId", element: <SubmissionDetailRoute /> },
    ],
  },
  {
    element: <AuthShell />,
    errorElement: <RootErrorBoundary />,
    children: [
      { path: "login", element: <LoginRoute /> },
      { path: "signup", element: <SignupRoute /> },
      { path: "forgot-password", element: <ForgotPasswordRoute /> },
      { path: "new-password", element: <NewPasswordRoute /> },
      { path: "auth/callback", element: <AuthCallbackRoute /> },
    ],
  },
  {
    element: <WorkspaceShell />,
    errorElement: <RootErrorBoundary />,
    children: [{ path: "problems/:slug/solve", element: lazyEl(ProblemSolveRoute) }],
  },
  {
    path: "dashboard",
    element: <DashboardShell />,
    errorElement: <RootErrorBoundary />,
    children: [
      { index: true, element: <DashboardHomeRoute /> },
      { path: "problems", element: <DashboardProblemsRoute /> },
      { path: "problems/new", element: lazyEl(ProblemNewRoute) },
      { path: "problems/:problemId/edit", element: lazyEl(ProblemEditRoute) },
      { path: "problems/:problemId/testsets", element: lazyEl(ProblemTestsetsRoute) },
      { path: "tags", element: <DashboardTagsRoute /> },
      { path: "users", element: <DashboardUsersRoute /> },
      { path: "operations", element: <DashboardOperationsRoute /> },
      { path: "storage", element: <DashboardStorageRoute /> },
    ],
  },
  { path: "*", element: <NotFoundRoute /> },
  { path: "index.html", element: <Navigate to="/" replace /> },
]);
