import { describe, expect, it } from "vitest";
import { buildBeginnerProject, joyStandardMat } from "@cricut-companion/craft-core";
import { createDesignPrompt } from "./index";

describe("createDesignPrompt", () => {
  it("includes Cricut output constraints", () => {
    const project = buildBeginnerProject({ name: "Dog Card", machine: "cricut_joy", mat: joyStandardMat, materialId: 218, prompt: "dog" });
    const prompt = createDesignPrompt(project);
    expect(prompt.system).toContain("#ff0000");
    expect(prompt.system).toContain("Cricut Joy");
    expect(prompt.requiredOutput).toBe("svg");
  });
});
