export type SkippedUpdateState = {
  version: string;
  skippedAt: string;
};

function parseVersionParts(version: string): number[] {
  return version.split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

export function isVersionAtLeast(current: string, target: string): boolean {
  const currentParts = parseVersionParts(current);
  const targetParts = parseVersionParts(target);
  for (let index = 0; index < Math.max(currentParts.length, targetParts.length); index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const targetPart = targetParts[index] ?? 0;
    if (currentPart > targetPart) return true;
    if (currentPart < targetPart) return false;
  }
  return true;
}

export function isSameVersion(left: string, right: string): boolean {
  return isVersionAtLeast(left, right) && isVersionAtLeast(right, left);
}

export function shouldSuppressSkippedUpdate({
  availableVersion,
  interactive,
  skippedUpdate,
}: {
  availableVersion: string;
  interactive: boolean;
  skippedUpdate: SkippedUpdateState | null;
}): boolean {
  return !interactive && Boolean(skippedUpdate && isSameVersion(availableVersion, skippedUpdate.version));
}
