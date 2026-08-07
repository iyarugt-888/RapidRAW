import { type RefObject, type PointerEvent as ReactPointerEvent, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ChevronDown, ChevronUp } from 'lucide-react';

import Editor from '../panel/Editor';
import BottomBar from '../panel/BottomBar';
import Resizer from '../ui/Resizer';
import { PANEL_ICONS, PANEL_TITLES } from '../panel/PanelSwitcher';

import { useEditorStore } from '../../store/useEditorStore';
import { useUIStore } from '../../store/useUIStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';

import { ImageFile, Orientation, Panel, PanelRegion, ThumbnailAspectRatio } from '../ui/AppProperties';

// Panels that are relevant in the editor (exclude FolderTree / Export for mobile bar)
const MOBILE_EDITOR_PANELS: Panel[] = [
  Panel.Adjustments,
  Panel.Crop,
  Panel.Masks,
  Panel.Ai,
  Panel.Presets,
  Panel.Metadata,
];

interface MobileEditingPanelProps {
  compactPanelHeight: number;
  collapsedHeight: number;
  renderPanel: (panel: Panel) => React.ReactNode;
}

function MobileEditingPanel({ compactPanelHeight, collapsedHeight, renderPanel }: MobileEditingPanelProps) {
  const { t } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { activePanels, panelLayout, setActivePanel } = useUIStore(
    useShallow((s) => ({
      activePanels: s.activePanels,
      panelLayout: s.panelLayout,
      setActivePanel: s.setActivePanel,
    })),
  );

  // Determine visible panels from rightTop layout, filtered to mobile-relevant ones
  const visiblePanels = panelLayout.rightTop.filter((p) => MOBILE_EDITOR_PANELS.includes(p));
  const activePanel = activePanels.rightTop ?? visiblePanels[0] ?? Panel.Adjustments;

  const panelHeight = isCollapsed ? collapsedHeight : compactPanelHeight;

  return (
    <div
      className="flex flex-col shrink-0 overflow-hidden bg-bg-secondary rounded-lg border border-surface transition-all duration-300 ease-in-out"
      style={{ height: panelHeight }}
    >
      {/* Tab bar */}
      <div className="flex items-center shrink-0 border-b border-surface bg-bg-secondary">
        <div className="flex items-center flex-1 overflow-x-auto px-1 gap-0.5 py-1">
          {visiblePanels.map((panel) => {
            const Icon = PANEL_ICONS[panel];
            const isActive = activePanel === panel;
            return (
              <button
                key={panel}
                onClick={() => setActivePanel('rightTop' as PanelRegion, panel)}
                className={clsx(
                  'flex items-center justify-center w-9 h-8 rounded-md transition-colors shrink-0',
                  isActive
                    ? 'bg-accent text-button-text'
                    : 'text-text-secondary hover:bg-surface hover:text-text-primary',
                )}
                title={t(PANEL_TITLES[panel] as any)}
              >
                <Icon size={16} />
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setIsCollapsed((v) => !v)}
          className="shrink-0 flex items-center justify-center w-9 h-9 text-text-tertiary hover:text-text-primary border-l border-surface"
          title={isCollapsed ? t('ui.panel.expand') : t('ui.panel.collapse')}
        >
          {isCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {/* Panel content */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            key={activePanel}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex-1 overflow-y-auto custom-scrollbar"
          >
            {renderPanel(activePanel)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface EditorViewProps {
  transformWrapperRef: RefObject<any>;
  isResizing: boolean;
  isCompactPortrait: boolean;
  isAndroid: boolean;
  compactEditorPanelHeight: number;
  compactEditorPanelCollapsedHeight: number;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  sortedImageList: ImageFile[];
  createResizeHandler: (stateKey: string, startSize: number) => (e: ReactPointerEvent<HTMLDivElement>) => void;
  handleBackToLibrary: () => void;
  handleEditorContextMenu: (...args: any) => void;
  handleThumbnailContextMenu: (...args: any) => void;
  handleMainLibraryContextMenu?: (...args: any) => void;
  handleImageClick: (...args: any) => void;
  handleClearSelection: () => void;
  handleCopyAdjustments: () => void;
  handlePasteAdjustments: () => void;
  handleRate: (...args: any) => void;
  handleZoomChange: (zoom: number) => void;
  handleRightPanelSelect: (panelId: any) => void;
  requestThumbnails: any;
  renderPanel?: (panel: Panel) => React.ReactNode;
}

export default function EditorView({
  transformWrapperRef,
  isResizing,
  isCompactPortrait,
  isAndroid,
  compactEditorPanelHeight,
  compactEditorPanelCollapsedHeight,
  thumbnailAspectRatio,
  sortedImageList,
  createResizeHandler,
  handleBackToLibrary,
  handleEditorContextMenu,
  handleThumbnailContextMenu,
  handleMainLibraryContextMenu,
  handleImageClick,
  handleClearSelection,
  handleCopyAdjustments,
  handlePasteAdjustments,
  handleRate,
  handleZoomChange,
  requestThumbnails,
  renderPanel,
}: EditorViewProps) {
  const { selectedImage } = useEditorStore(
    useShallow((state) => ({
      selectedImage: state.selectedImage,
    })),
  );

  const { isFullScreen, isInstantTransition, uiVisibility, bottomPanelHeight, setUI } = useUIStore(
    useShallow((state) => ({
      isFullScreen: state.isFullScreen,
      isInstantTransition: state.isInstantTransition,
      uiVisibility: state.uiVisibility,
      bottomPanelHeight: state.bottomPanelHeight,
      setUI: state.setUI,
    })),
  );

  const { multiSelectedPaths, imageRatings, isViewLoading } = useLibraryStore(
    useShallow((state) => ({
      multiSelectedPaths: state.multiSelectedPaths,
      imageRatings: state.imageRatings,
      isViewLoading: state.isViewLoading,
    })),
  );

  const { isCopied, isPasted } = useProcessStore(
    useShallow((state) => ({
      isCopied: state.isCopied,
      isPasted: state.isPasted,
    })),
  );

  const isMobileLayout = isAndroid || isCompactPortrait;

  const editorNode = (
    <Editor
      onBackToLibrary={handleBackToLibrary}
      onContextMenu={handleEditorContextMenu}
      onImageSelect={handleImageClick}
      transformWrapperRef={transformWrapperRef}
    />
  );

  const editorBottomBarComponent = (
    <BottomBar
      filmstripHeight={bottomPanelHeight}
      imageList={sortedImageList}
      imageRatings={imageRatings}
      isCopied={isCopied}
      isCopyDisabled={!selectedImage}
      isFilmstripVisible={uiVisibility.filmstrip}
      isLoading={isViewLoading}
      isPasted={isPasted}
      isPasteDisabled={useEditorStore.getState().copiedAdjustments === null}
      isRatingDisabled={!selectedImage}
      isResizing={isResizing}
      multiSelectedPaths={multiSelectedPaths}
      onClearSelection={handleClearSelection}
      onContextMenu={handleThumbnailContextMenu}
      onEmptyAreaContextMenu={handleMainLibraryContextMenu}
      onCopy={handleCopyAdjustments}
      onOpenCopyPasteSettings={() => setUI({ isCopyPasteSettingsModalOpen: true })}
      onImageSelect={handleImageClick}
      onPaste={() => handlePasteAdjustments()}
      onRate={handleRate}
      onRequestThumbnails={requestThumbnails}
      onZoomChange={handleZoomChange}
      rating={imageRatings[selectedImage?.path || ''] || 0}
      selectedImage={selectedImage ?? undefined}
      setIsFilmstripVisible={(value: boolean) =>
        setUI((state) => ({ uiVisibility: { ...state.uiVisibility, filmstrip: value } }))
      }
      showFilmstrip={!isMobileLayout}
      showZoomControls={!isAndroid}
      thumbnailAspectRatio={thumbnailAspectRatio}
      totalImages={sortedImageList.length}
    />
  );

  const editorBottomBarNode = (
    <div
      className={clsx(
        'flex flex-col w-full overflow-hidden shrink-0',
        !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
      )}
      style={{
        maxHeight: isFullScreen ? '0px' : '500px',
        opacity: isFullScreen ? 0 : 1,
      }}
    >
      {!isMobileLayout && (
        <Resizer direction={Orientation.Horizontal} onMouseDown={createResizeHandler('bottom', bottomPanelHeight)} />
      )}
      {editorBottomBarComponent}
    </div>
  );

  if (isMobileLayout) {
    return (
      <div className="flex flex-col grow h-full min-h-0 gap-2">
        <div className="flex-1 flex flex-col min-w-0 min-h-0">{editorNode}</div>
        {renderPanel && (
          <MobileEditingPanel
            compactPanelHeight={compactEditorPanelHeight}
            collapsedHeight={compactEditorPanelCollapsedHeight}
            renderPanel={renderPanel}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col grow h-full min-h-0">
      <div className="flex-1 flex flex-col min-w-0">{editorNode}</div>
      {editorBottomBarNode}
    </div>
  );
}
