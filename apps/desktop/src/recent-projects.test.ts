import { describe, expect, it } from "vitest";
import {
  RECENT_PROJECT_LIMIT,
  addRecentProject,
  loadRecentProjects,
  recentProjectFolder,
  recentProjectName,
  removeRecentProject,
} from "./recent-projects";

describe("recent projects", () => {
  it("puts the newest first, without duplicates, and keeps only a few", () => {
    let list = addRecentProject([], "/a/one.kindcut", new Date("2026-01-01"));
    list = addRecentProject(list, "/a/two.kindcut", new Date("2026-01-02"));
    list = addRecentProject(list, "/a/one.kindcut", new Date("2026-01-03"));
    expect(list.map((entry) => entry.path)).toEqual(["/a/one.kindcut", "/a/two.kindcut"]);
    for (let index = 0; index < 10; index += 1) list = addRecentProject(list, `/a/${index}.kindcut`);
    expect(list).toHaveLength(RECENT_PROJECT_LIMIT);
    expect(removeRecentProject(list, "/a/9.kindcut").some((entry) => entry.path === "/a/9.kindcut")).toBe(false);
  });

  it("shows a friendly name and folder for Mac and Windows paths", () => {
    expect(recentProjectName("/Users/oma/Documents/Verjaardagskaart.kindcut")).toBe("Verjaardagskaart");
    expect(recentProjectFolder("/Users/oma/Documents/Verjaardagskaart.kindcut")).toBe("Documents");
    expect(recentProjectName("C:\\Users\\oma\\Desktop\\Kerst.KINDCUT")).toBe("Kerst");
    expect(recentProjectFolder("C:\\Users\\oma\\Desktop\\Kerst.KINDCUT")).toBe("Desktop");
  });

  it("ignores broken saved data", () => {
    expect(loadRecentProjects({ getItem: () => "not json" })).toEqual([]);
    expect(loadRecentProjects({ getItem: () => JSON.stringify([{ path: 3 }, { path: "/a/b.kindcut", openedAt: "2026-01-01" }]) }))
      .toEqual([{ path: "/a/b.kindcut", openedAt: "2026-01-01" }]);
  });
});
