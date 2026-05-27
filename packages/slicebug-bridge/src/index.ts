export interface PlanCommandInput {
  slicebugExecutable: string;
  inputSvgPath: string;
  outputPlanPath: string;
  materialId: number;
  matPreset?: string;
  matSize?: string;
  colorMap: Record<string, string>;
}

export interface CommandPreview {
  command: string;
  args: string[];
  sideEffect: "none" | "hardware";
}

export interface MaterialOption {
  id: number;
  name: string;
  beginnerCopy: string;
  default?: boolean;
}

export interface MatPresetOption {
  id: "joy-standard" | "joy-standard-short" | "joy-card";
  name: string;
  sizeCopy: string;
  beginnerCopy: string;
}

export type SlicebugActionKind =
  | "idle"
  | "load-tools"
  | "load-mat"
  | "press-go"
  | "replace-tool"
  | "finished"
  | "running"
  | "error";

export interface SlicebugActionState {
  kind: SlicebugActionKind;
  title: string;
  message: string;
  requiresContinue: boolean;
  canStop: boolean;
  tone: "neutral" | "waiting" | "running" | "success" | "error";
}

export const MATERIAL_OPTIONS: MaterialOption[] = [
  {
    id: 218,
    name: "Light Cardstock",
    beginnerCopy: "Best first choice for simple cards and test cuts.",
    default: true,
  },
  {
    id: 19,
    name: "Medium Cardstock",
    beginnerCopy: "A sturdier card paper for everyday projects.",
  },
  {
    id: 211,
    name: "Heavy Cardstock",
    beginnerCopy: "Thicker paper that may need a fresher blade.",
  },
  {
    id: 535,
    name: "Insert Card",
    beginnerCopy: "Use this for Cricut Joy insert card blanks.",
  },
  {
    id: 20,
    name: "Vinyl",
    beginnerCopy: "Use this for a simple adhesive vinyl design.",
  },
];

export const MAT_PRESETS: MatPresetOption[] = [
  {
    id: "joy-standard",
    name: "Joy standard mat",
    sizeCopy: "4.5 x 12 in",
    beginnerCopy: "The everyday Joy mat for most small projects.",
  },
  {
    id: "joy-standard-short",
    name: "Joy short mat",
    sizeCopy: "4.5 x 6.5 in",
    beginnerCopy: "Good for small scraps and tiny designs.",
  },
  {
    id: "joy-card",
    name: "Joy card mat",
    sizeCopy: "card mat",
    beginnerCopy: "Best for insert cards and folded card blanks.",
  },
];

export function getDefaultMaterialOption(): MaterialOption {
  const defaultMaterial = MATERIAL_OPTIONS.find((material) => material.default);
  if (!defaultMaterial) {
    throw new Error("At least one SliceBug material option must be marked as the default.");
  }
  return defaultMaterial;
}

export function buildPlanCommand(input: PlanCommandInput): CommandPreview {
  const args = ["plan", input.inputSvgPath, input.outputPlanPath, "--material", String(input.materialId)];

  if (input.matPreset) {
    args.push("--mat-preset", input.matPreset);
  }
  if (input.matSize) {
    args.push("--mat-size", input.matSize);
  }

  for (const [color, tool] of Object.entries(input.colorMap)) {
    args.push("--map", `${color.replace(/^#/, "")}:${tool}`);
  }

  return { command: input.slicebugExecutable, args, sideEffect: "none" };
}

export function buildCutCommand(input: {
  slicebugExecutable: string;
  planPath: string;
  softwareButtons?: boolean;
  machine?: "cricut_joy" | "unknown";
}): CommandPreview {
  const args = ["cut"];
  if (input.softwareButtons || input.machine === "cricut_joy") {
    args.push("--software-buttons");
  }
  args.push(input.planPath);
  return { command: input.slicebugExecutable, args, sideEffect: "hardware" };
}

export function parseSlicebugAction(text: string): SlicebugActionState {
  const normalized = text.toLowerCase();

  if (/\b(error|failed|failure|traceback|exception)\b/.test(normalized)) {
    return action("error", "Something needs attention", "SliceBug reported a problem. Stop here and check the details.", false);
  }

  if (/\b(finished|complete|completed|done|unload)\b/.test(normalized)) {
    return action("finished", "Cut is finished", "Unload the mat when the machine is quiet and the project is ready.", false);
  }

  if (/\b(replace|change|swap).*\b(tool|blade|pen|marker)\b/.test(normalized)) {
    return action("replace-tool", "Change the tool", "Put in the next tool, then press Continue here.", true);
  }

  if (/\b(press|push).*\b(go|start|button)\b/.test(normalized)) {
    return action("press-go", "Start when the machine is ready", "Press Go on the Cricut or continue when SliceBug asks.", true);
  }

  if (/\b(load|insert|place).*\b(mat|card)\b|\bmat\b.*\b(load|insert|ready)\b/.test(normalized)) {
    return action("load-mat", "Load the mat", "Place the material on the mat and load it into the Cricut, then press Continue.", true);
  }

  if (/\b(load|insert|install).*\b(tool|pen|blade|marker|clamp)\b|\bclamp\b/.test(normalized)) {
    return action("load-tools", "Load the tool", "Put the requested pen or blade in the clamp, then press Continue.", true);
  }

  if (/\b(cutting|running|progress|path\s+\d+)\b/.test(normalized)) {
    return action("running", "Cutting now", "The Cricut is working. Keep hands clear and wait for the next prompt.", false);
  }

  if (/\b(enter|continue|ready)\b/.test(normalized)) {
    return action("load-mat", "Ready for the next step", "Check the Cricut, then press Continue here when you are ready.", true);
  }

  return action("idle", "Waiting for SliceBug", "KindCut is listening for the next cutter step.", false);
}

function action(
  kind: SlicebugActionKind,
  title: string,
  message: string,
  requiresContinue: boolean,
): SlicebugActionState {
  return {
    kind,
    title,
    message,
    requiresContinue,
    canStop: kind !== "finished" && kind !== "error",
    tone:
      kind === "error"
        ? "error"
        : kind === "finished"
          ? "success"
          : kind === "running"
            ? "running"
            : requiresContinue
              ? "waiting"
              : "neutral",
  };
}
