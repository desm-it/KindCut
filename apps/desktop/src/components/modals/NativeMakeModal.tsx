import type { CardSize } from '../../workspace-utils';
import { NativeMakeMaterialPicker } from './native-make-material-picker';
import { useState } from 'react';
import type { NativeMakePreviewSource } from './native-make-design';
import { NativeJoySetupPanel } from '../panels/NativeJoySetupPanel';
import type { Language } from '../../i18n';
import type {
  NativeConfigurationSource,
  NativeJoyConfigurationApi,
} from '../../native-joy-configuration-types';

export function NativeMakeModal({
  language,
  onClose,
  visible = true,
  showAdvancedInfo = false,
  configurationApi,
  source,
  previewSource,
  workspaceMaterial,
  onWorkspaceMaterialChange,
  workspaceCard,
  onOpenSettings,
}: {
  language: Language;
  onClose: () => void;
  visible?: boolean;
  showAdvancedInfo?: boolean;
  configurationApi?: NativeJoyConfigurationApi;
  source?: () => Promise<NativeConfigurationSource>;
  previewSource?: () => Promise<NativeMakePreviewSource>;
  workspaceMaterial?: { id: number; name: string };
  nativeMaterials?: Array<{ id: number; name: string }>;
  onWorkspaceMaterialChange?: (id: number) => void;
  onOpenSettings?: () => void;
  workspaceCard?: {
    size: CardSize | null;
    slots: boolean;
    onSize: (size: CardSize) => void;
    onSlots: (enabled: boolean) => void;
  };
}) {
  const nl = language === 'nl';
  const [actionContainer, setActionContainer] = useState<HTMLDivElement | null>(null);
  return (
    <div
      hidden={!visible}
      aria-hidden={!visible}
      style={{ display: visible ? undefined : 'none' }}
      className="cut-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cut-modal native-make"
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="native-make-title"
      >
        <div className="cut-modal__header">
          <h2 id="native-make-title" className="cut-modal__title">
            {nl ? 'Klaar om te maken' : 'Ready to make'}
          </h2>
          <button
            type="button"
            className="cut-modal__close"
            onClick={onClose}
            aria-label={nl ? 'Sluiten' : 'Close'}
          >
            ×
          </button>
        </div>
        <div className="cut-modal__body native-make__body">
          <NativeJoySetupPanel
            mode="make"
            onOpenSettings={onOpenSettings}
            showAdvancedInfo={showAdvancedInfo}
            previewSource={previewSource}
            language={language}
            configurationApi={configurationApi}
            source={source}
            workspaceMaterial={workspaceMaterial}
            makeVisible={visible}
            actionContainer={actionContainer}
            materialControl={
              <NativeMakeMaterialPicker
                materialId={workspaceMaterial?.id}
                language={language}
                onChange={onWorkspaceMaterialChange}
                cardSize={workspaceCard?.size}
                insertSlots={workspaceCard?.slots}
                onCardSizeChange={workspaceCard?.onSize}
                onInsertSlotsChange={workspaceCard?.onSlots}
              />
            }
          />
        </div>
        <div className="cut-modal__footer native-make__footer">
          {showAdvancedInfo && (
            <details>
              <summary>{nl ? 'Veiligheid & werkwijze' : 'Safety & workflow notes'}</summary>
              <p>
                Frozen draw-then-cut jobs use the saved pen and fine-point blade recipes for all
                planned paths. For a blade job remove both the pen and blade housing before loading.
                Each tool requires a separate Go.
              </p>
              <p>
                A non-drawing return to job origin (0,0) follows each completed tool after all
                passes. This is not firmware homing or unloading; physical clearance and stopping
                are unverified.
              </p>
            </details>
          )}
          <div className="native-make__footer-actions">
            <button
              type="button"
              className="cut-modal__btn cut-modal__btn--secondary"
              onClick={onClose}
            >
              {nl ? 'Sluiten' : 'Close'}
            </button>
            <div className="native-make__footer-action" ref={setActionContainer} />
          </div>
        </div>
      </div>
    </div>
  );
}
