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

export function buildCutCommand(input: { slicebugExecutable: string; planPath: string; softwareButtons: boolean }): CommandPreview {
  const args = ["cut"];
  if (input.softwareButtons) {
    args.push("--software-buttons");
  }
  args.push(input.planPath);
  return { command: input.slicebugExecutable, args, sideEffect: "hardware" };
}
