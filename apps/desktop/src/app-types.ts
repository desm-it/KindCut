export type LibraryImage = { name: string; path: string; isAi: boolean; svg: string };

export type SlicebugPlanResult = {
  ok: boolean;
  executable: string;
  inputSvgPath: string;
  outputPlanPath: string;
  stdout: string;
  stderr: string;
  message: string;
  plan: null | {
    mat: { width: number; height: number };
    material: { width: number; height: number; type: number };
    pathCount: number;
    tools: string[];
  };
};

export type CutSessionSnapshot = {
  id: string;
  status: "idle" | "running" | "waiting" | "finished" | "error" | "stopped" | "blocked";
  action: {
    kind: string;
    code?: string;
    title: string;
    message: string;
    requiresContinue: boolean;
    canStop: boolean;
    tone: "neutral" | "waiting" | "running" | "success" | "error";
  };
  transcript: string;
  command: string;
  args: string[];
  planPath: string;
};
