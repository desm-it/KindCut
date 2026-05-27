import type { CraftProject } from "@cricut-companion/craft-core";

export interface DesignPromptContract {
  system: string;
  user: string;
  requiredOutput: "svg";
}

export function createDesignPrompt(project: CraftProject): DesignPromptContract {
  return {
    requiredOutput: "svg",
    system: [
      "You design craft-ready SVG files for Cricut machines.",
      "Return valid standalone SVG only, no markdown.",
      "Use simple paths, closed cut outlines, and pen-friendly stroke paths.",
      "Avoid gradients, filters, masks, tiny detached pieces, and raster images.",
      "Use #000000 for pen/draw details and #ff0000 for cut borders unless instructed otherwise.",
      `Target machine: ${project.machine.displayName}. Mat: ${project.mat.widthIn}x${project.mat.heightIn} inches.`,
      `Material: ${project.material.name}.`,
    ].join("\n"),
    user: project.prompt,
  };
}
