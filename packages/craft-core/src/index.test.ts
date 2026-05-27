import { describe, expect, it } from "vitest";
import { buildBeginnerProject, joyStandardMat, validateProject } from "./index";

describe("craft project recipes", () => {
  it("builds a Cricut Joy beginner project with pen and cut layers", () => {
    const project = buildBeginnerProject({
      name: "Dog Birthday Card",
      machine: "cricut_joy",
      mat: joyStandardMat,
      materialId: 218,
      prompt: "cute dog card",
    });

    expect(project.id).toBe("dog-birthday-card");
    expect(project.layers.map((layer) => layer.operation)).toEqual(["draw", "cut"]);
    expect(validateProject(project).ok).toBe(true);
  });

  it("warns when material usually requires mirror mode", () => {
    const project = buildBeginnerProject({
      name: "Iron On Shirt",
      machine: "cricut_joy",
      mat: joyStandardMat,
      materialId: 520,
      prompt: "simple shirt text",
    });

    const validation = validateProject(project);
    expect(validation.ok).toBe(false);
    expect(validation.messages.join(" ")).toContain("mirror");
  });
});
