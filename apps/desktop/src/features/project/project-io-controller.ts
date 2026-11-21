import {
  parseProjectFile,
  serializeProjectFile,
  getSafeProjectFileName,
  type KindCutProjectFile,
} from '../../project-file';
import type { createTranslator } from '../../i18n';
type ProjectApi = NonNullable<Window['cricutCompanion']>['project'];
export interface ProjectIoPorts {
  getApi(): ProjectApi | undefined;
  document: {
    snapshot(): KindCutProjectFile;
    signature(): string;
    apply(project: KindCutProjectFile, path: string): void;
  };
  view: {
    message(message: string | null): void;
    saving(value: boolean): void;
    opening(value: boolean): void;
    enter(): void;
  };
  session: {
    path(): string | null;
    setPath(path: string | null): void;
    saved(signature: string): void;
  };
  recent: { record(path: string): void; forget(path: string): void; error(path: string): void };
  translate: ReturnType<typeof createTranslator>['t'];
  debug: boolean;
}
/** Project IO orchestration only; editor mutation, desktop dialogs and recent storage are ports. */
export function createProjectIoController(p: ProjectIoPorts) {
  async function save(options: { saveAs?: boolean } = {}): Promise<boolean> {
    const api = p.getApi();
    if (!api) {
      p.view.message(p.translate('project.saveInDesktop'));
      p.view.enter();
      return false;
    }
    const project = p.document.snapshot(),
      signature = p.document.signature();
    p.view.saving(true);
    try {
      const result = await api.save({
        content: serializeProjectFile(project),
        defaultFileName: `${getSafeProjectFileName(project.name)}.kindcut`,
        currentPath: options.saveAs ? null : p.session.path(),
      });
      if (result.canceled) return false;
      p.session.setPath(result.path);
      if (result.path) p.recent.record(result.path);
      p.view.message(p.debug ? p.translate('project.saved', { path: result.path }) : null);
      p.session.saved(signature);
      p.view.enter();
      return true;
    } catch (error) {
      p.view.message(error instanceof Error ? error.message : p.translate('project.saveError'));
      p.view.enter();
      return false;
    } finally {
      p.view.saving(false);
    }
  }
  async function open(): Promise<void> {
    const api = p.getApi();
    if (!api) {
      p.view.message(p.translate('project.openInDesktop'));
      p.view.enter();
      return;
    }
    p.view.opening(true);
    try {
      const result = await api.open();
      if (result.canceled) return;
      if (!result.content) throw Error(p.translate('project.openEmpty'));
      p.document.apply(parseProjectFile(result.content), result.path);
      if (result.path) p.recent.record(result.path);
      p.view.message(p.debug ? p.translate('project.opened', { path: result.path }) : null);
      p.view.enter();
    } catch (error) {
      p.view.message(error instanceof Error ? error.message : p.translate('project.openError'));
      p.view.enter();
    } finally {
      p.view.opening(false);
    }
  }
  async function openRecent(projectPath: string): Promise<void> {
    const api = p.getApi();
    if (!api?.openPath) {
      p.view.message(p.translate('project.openInDesktop'));
      return;
    }
    p.view.opening(true);
    try {
      const result = await api.openPath(projectPath);
      if (result.canceled || !result.content) throw Error(p.translate('project.openEmpty'));
      p.document.apply(parseProjectFile(result.content), projectPath);
      p.recent.record(projectPath);
      p.view.message(null);
      p.view.enter();
    } catch {
      p.recent.forget(projectPath);
      p.recent.error(projectPath);
    } finally {
      p.view.opening(false);
    }
  }
  return { save, open, openRecent };
}
