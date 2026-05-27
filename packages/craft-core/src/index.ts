export type MachineId = "cricut_joy" | "cricut_joy_xtra" | "cricut_explore" | "cricut_maker";
export type OperationKind = "draw" | "cut" | "score" | "print" | "ignore";
export type ToolId = "pen" | "fine_point_blade" | "scoring_stylus" | "printer";

export interface MachineProfile {
  id: MachineId;
  displayName: string;
  maxMaterialWidthIn: number;
  notes: string[];
}

export interface MatPreset {
  id: string;
  name: string;
  widthIn: number;
  heightIn: number;
  machineIds: MachineId[];
}

export interface MaterialRecipe {
  id: number;
  name: string;
  category: "cardstock" | "vinyl" | "iron_on" | "sticker" | "paper";
  defaultTool: ToolId;
  requiresMirror: boolean;
  supportsMatlessJoy: boolean;
}

export interface CraftLayer {
  id: string;
  name: string;
  operation: OperationKind;
  color: string;
  tool: ToolId;
  svgPath?: string;
}

export interface CraftProject {
  schemaVersion: 1;
  id: string;
  name: string;
  prompt: string;
  machine: MachineProfile;
  mat: MatPreset;
  material: MaterialRecipe;
  layers: CraftLayer[];
  createdAt: string;
}

export const cricutJoy: MachineProfile = {
  id: "cricut_joy",
  displayName: "Cricut Joy",
  maxMaterialWidthIn: 4.5,
  notes: ["No physical Load/Unload or Go buttons", "Use software-button flow via SliceBug experiments"],
};

export const joyStandardMat: MatPreset = {
  id: "joy-standard",
  name: "Cricut Joy StandardGrip Mat",
  widthIn: 4.5,
  heightIn: 12,
  machineIds: ["cricut_joy"],
};

export const joyCardMat: MatPreset = {
  id: "joy-card",
  name: "Cricut Joy Card Mat",
  widthIn: 4.5,
  heightIn: 6.25,
  machineIds: ["cricut_joy"],
};

export const materials: MaterialRecipe[] = [
  { id: 218, name: "Light Cardstock - 65 lb", category: "cardstock", defaultTool: "fine_point_blade", requiresMirror: false, supportsMatlessJoy: false },
  { id: 19, name: "Medium Cardstock - 80 lb", category: "cardstock", defaultTool: "fine_point_blade", requiresMirror: false, supportsMatlessJoy: false },
  { id: 524, name: "Smart Vinyl Permanent", category: "vinyl", defaultTool: "fine_point_blade", requiresMirror: false, supportsMatlessJoy: true },
  { id: 520, name: "Smart Iron-On", category: "iron_on", defaultTool: "fine_point_blade", requiresMirror: true, supportsMatlessJoy: true },
];

export function findMaterialRecipe(id: number): MaterialRecipe {
  const material = materials.find((candidate) => candidate.id === id);
  if (!material) {
    throw new Error(`Unknown material recipe: ${id}`);
  }
  return material;
}

export function buildBeginnerProject(input: {
  name: string;
  machine: MachineId;
  mat: MatPreset;
  materialId: number;
  prompt: string;
}): CraftProject {
  if (input.machine !== "cricut_joy") {
    throw new Error("Only Cricut Joy recipe scaffolding is implemented in the foundation.");
  }

  return {
    schemaVersion: 1,
    id: slugify(input.name),
    name: input.name,
    prompt: input.prompt,
    machine: cricutJoy,
    mat: input.mat,
    material: findMaterialRecipe(input.materialId),
    layers: [
      { id: "pen-details", name: "Black pen details", operation: "draw", color: "#000000", tool: "pen" },
      { id: "cut-border", name: "Red cut border", operation: "cut", color: "#ff0000", tool: "fine_point_blade" },
    ],
    createdAt: new Date().toISOString(),
  };
}

export function validateProject(project: CraftProject): { ok: boolean; messages: string[] } {
  const messages: string[] = [];

  if (!project.mat.machineIds.includes(project.machine.id)) {
    messages.push(`${project.mat.name} is not compatible with ${project.machine.displayName}.`);
  }

  if (project.mat.widthIn > project.machine.maxMaterialWidthIn) {
    messages.push(`Mat width ${project.mat.widthIn} exceeds ${project.machine.displayName} max width ${project.machine.maxMaterialWidthIn}.`);
  }

  if (project.material.requiresMirror) {
    messages.push(`${project.material.name} usually requires mirror mode.`);
  }

  if (!project.layers.some((layer) => layer.operation === "cut")) {
    messages.push("Project has no cut layer.");
  }

  return { ok: messages.length === 0, messages: messages.length ? messages : ["Project recipe is internally consistent."] };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
