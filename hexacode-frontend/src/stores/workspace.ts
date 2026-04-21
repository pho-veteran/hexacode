import { clamp } from "@/lib/utils";

export type CustomTestcase = {
  id: string;
  input: string;
  expected_output: string;
};

export type WorkspaceState = {
  runtimeKey: string;
  sourceCode: string;
  customTestcases: CustomTestcase[];
  editorTheme: string;
  editorFontSize: number;
  activeSideTab: "statement" | "problem" | "preferences" | "history";
  activeLowerTab: "testcase" | "testresult";
  sidebarVisible: boolean;
  sidebarWidthPercent: number;
  lowerPanelHeightRem: number;
};

export const DEFAULT_SOURCE = "// write your solution here\n";

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ct_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export function createCustomTestcase(input = "", expected_output = ""): CustomTestcase {
  return { id: makeId(), input, expected_output };
}

export function defaultWorkspace(runtimeKey = ""): WorkspaceState {
  return {
    runtimeKey,
    sourceCode: DEFAULT_SOURCE,
    customTestcases: [],
    editorTheme: "graphite",
    editorFontSize: 14,
    activeSideTab: "statement",
    activeLowerTab: "testcase",
    sidebarVisible: true,
    sidebarWidthPercent: 34,
    lowerPanelHeightRem: 19,
  };
}

export function workspaceKey(problemId: string) {
  return `hexacode.solve.workspace:${problemId}`;
}

type LegacyWorkspace = Partial<WorkspaceState> & { customInput?: string };

export function loadWorkspace(problemId: string, runtimeKey: string): WorkspaceState {
  if (typeof window === "undefined") return defaultWorkspace(runtimeKey);
  try {
    const raw = window.localStorage.getItem(workspaceKey(problemId));
    if (!raw) return defaultWorkspace(runtimeKey);
    const parsed = JSON.parse(raw) as LegacyWorkspace;
    const merged: WorkspaceState = { ...defaultWorkspace(runtimeKey), ...parsed };
    merged.editorFontSize = clamp(merged.editorFontSize || 14, 12, 22);
    merged.sidebarWidthPercent = clamp(merged.sidebarWidthPercent || 34, 26, 42);
    merged.lowerPanelHeightRem = clamp(merged.lowerPanelHeightRem || 19, 14, 30);
    if (merged.activeLowerTab !== "testcase" && merged.activeLowerTab !== "testresult") {
      merged.activeLowerTab = "testcase";
    }
    if (!Array.isArray(merged.customTestcases)) {
      merged.customTestcases = [];
    } else {
      merged.customTestcases = merged.customTestcases
        .filter((c): c is CustomTestcase => !!c && typeof c.input === "string")
        .map((c) => ({
          id: c.id || makeId(),
          input: c.input,
          expected_output: c.expected_output ?? "",
        }));
    }
    if (parsed.customInput && merged.customTestcases.length === 0) {
      merged.customTestcases = [createCustomTestcase(parsed.customInput, "")];
    }
    return merged;
  } catch {
    return defaultWorkspace(runtimeKey);
  }
}

export function saveWorkspace(problemId: string, state: WorkspaceState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(workspaceKey(problemId), JSON.stringify(state));
}
