// Recently opened or saved projects, shown on the welcome screen. Only the
// file locations are remembered (in this app's local storage), newest first.

export type RecentProject = { path: string; openedAt: string };

const STORAGE_KEY = 'kindcutRecentProjects';
export const RECENT_PROJECT_LIMIT = 5;

export function addRecentProject(
  list: RecentProject[],
  path: string,
  now: Date = new Date(),
): RecentProject[] {
  return [
    { path, openedAt: now.toISOString() },
    ...list.filter((entry) => entry.path !== path),
  ].slice(0, RECENT_PROJECT_LIMIT);
}

export function removeRecentProject(list: RecentProject[], path: string): RecentProject[] {
  return list.filter((entry) => entry.path !== path);
}

/** "Verjaardagskaart" for "/Users/oma/Documents/Verjaardagskaart.kindcut". */
export function recentProjectName(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  return fileName.replace(/\.kindcut$/i, '') || fileName;
}

/** The folder a project is in, e.g. "Documents". */
export function recentProjectFolder(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? (parts[parts.length - 2] ?? '') : '';
}

export function loadRecentProjects(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): RecentProject[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is RecentProject =>
          Boolean(entry) && typeof entry.path === 'string' && typeof entry.openedAt === 'string',
      )
      .slice(0, RECENT_PROJECT_LIMIT);
  } catch {
    return [];
  }
}

export function saveRecentProjects(
  list: RecentProject[],
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // The list just isn't remembered.
  }
}
