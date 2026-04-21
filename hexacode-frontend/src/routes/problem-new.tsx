import { useNavigate } from "react-router-dom";
import { createProblem } from "@/lib/api";
import { AccessDenied, AuthRequired } from "@/components/shell";
import { Skeleton } from "@/components/ui/Feedback";
import { useAuth } from "@/lib/auth";
import { ProblemEditor, buildEditorInitial } from "@/features/problem-editor/ProblemEditor";

export function ProblemNewRoute() {
  const auth = useAuth();
  const navigate = useNavigate();
  if (auth.status !== "authenticated") return <AuthRequired />;
  if (auth.authzLoading) return <Skeleton className="h-96" />;
  if (!auth.hasPermission("problem.create")) {
    return (
      <AccessDenied
        title="Problem creation unavailable"
        message="This account does not have author permissions."
        backTo="/dashboard/problems"
        backLabel="Back to problems"
      />
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <div className="text-eyebrow">Author</div>
        <h1 className="mt-1 text-h1">New problem</h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
          Define the statement, limits, testset archive, and checker for a new problem.
        </p>
      </header>
      <ProblemEditor
        mode="create"
        initialData={buildEditorInitial()}
        accessToken={auth.accessToken}
        loginRedirectPath="/dashboard/problems/new"
        submitLabel="Create problem"
        submittingLabel="Creating…"
        onSubmit={async (form, _slug, _intent, opts) => {
          if (!auth.accessToken) throw new Error("Sign-in required.");
          const res = await createProblem(auth.accessToken, form, opts);
          navigate(`/dashboard/problems/${res.id}/edit`);
        }}
      />
    </div>
  );
}
