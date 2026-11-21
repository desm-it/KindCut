import { useEffect, useMemo, useRef, useState } from 'react';
import { type KindCutProjectFile } from '../../project-file';
import {
  type RecentProject,
  addRecentProject,
  loadRecentProjects,
  removeRecentProject,
  saveRecentProjects,
} from '../../recent-projects';
import type { createTranslator } from '../../i18n';
import {
  createProjectDocument,
  projectDocumentSignature,
  type ProjectDocumentState,
} from './project-document';
import { createProjectIoController } from './project-io-controller';
export interface ProjectPersistenceOptions {
  document: ProjectDocumentState;
  apply(project: KindCutProjectFile, path: string): void;
  enter(): void;
  translate: ReturnType<typeof createTranslator>['t'];
  debug: boolean;
}
/** Owns project IO state, recent metadata, dirty baseline and guarded navigation. */
export function useProjectPersistence(options: ProjectPersistenceOptions) {
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null),
    [savedToast, setSavedToast] = useState(0),
    [projectMessage, setProjectMessage] = useState<string | null>(null),
    [projectSaving, setProjectSaving] = useState(false),
    [projectOpening, setProjectOpening] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() => loadRecentProjects()),
    [recentProjectError, setRecentProjectError] = useState<string | null>(null);
  const document = options.document;
  const currentSignature = useMemo(
    () => projectDocumentSignature(document),
    [
      document.importedSvgs,
      document.selectedMaterialId,
      document.selectedMatPreset,
      document.measurementUnit,
      document.tools,
      document.paperColor,
      document.cardSize,
      document.insertSlots,
    ],
  );
  const [savedSignature, setSavedSignature] = useState(''),
    [cleanRevision, setCleanRevision] = useState(0),
    [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  const signatureRef = useRef(currentSignature);
  signatureRef.current = currentSignature;
  useEffect(() => {
    setSavedSignature(signatureRef.current);
  }, [cleanRevision]);
  const hasUnsavedChanges = currentSignature !== savedSignature;
  function markProjectClean() {
    setCleanRevision((n) => n + 1);
  }
  function updateRecentProjects(change: (list: RecentProject[]) => RecentProject[]) {
    setRecentProjects((list) => {
      const next = change(list);
      saveRecentProjects(next);
      return next;
    });
  }
  const io = createProjectIoController({
    getApi: () => window.cricutCompanion?.project,
    document: {
      snapshot: () => createProjectDocument(document),
      signature: () => currentSignature,
      apply: options.apply,
    },
    view: {
      message: setProjectMessage,
      saving: setProjectSaving,
      opening: setProjectOpening,
      enter: options.enter,
    },
    session: {
      path: () => currentProjectPath,
      setPath: setCurrentProjectPath,
      saved: (signature) => {
        setSavedToast((n) => n + 1);
        setSavedSignature(signature);
      },
    },
    recent: {
      record: (path) => updateRecentProjects((list) => addRecentProject(list, path)),
      forget: (path) => updateRecentProjects((list) => removeRecentProject(list, path)),
      error: setRecentProjectError,
    },
    translate: options.translate,
    debug: options.debug,
  });
  function guardNavigation(action: () => void) {
    if (hasUnsavedChanges) setPendingNav(() => action);
    else action();
  }
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && (event.key === 'r' || event.key === 'R')) {
        event.preventDefault();
        guardNavigation(() => window.location.reload());
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasUnsavedChanges]);
  function handleUnsavedSave() {
    void io.save().then((saved) => {
      const next = pendingNav;
      setPendingNav(null);
      if (saved) next?.();
    });
  }
  function handleUnsavedDiscard() {
    const next = pendingNav;
    setPendingNav(null);
    markProjectClean();
    next?.();
  }
  function handleUnsavedCancel() {
    setPendingNav(null);
  }
  return {
    currentProjectPath,
    setCurrentProjectPath,
    savedToast,
    projectMessage,
    setProjectMessage,
    projectSaving,
    projectOpening,
    recentProjects,
    recentProjectError,
    setRecentProjectError,
    hasUnsavedChanges,
    pendingNav,
    guardNavigation,
    markProjectClean,
    handleUnsavedSave,
    handleUnsavedDiscard,
    handleUnsavedCancel,
    handleOpenProject: () => guardNavigation(() => void io.open()),
    handleOpenRecentProject: (path: string) => guardNavigation(() => void io.openRecent(path)),
    handleSaveProject: io.save,
  };
}
