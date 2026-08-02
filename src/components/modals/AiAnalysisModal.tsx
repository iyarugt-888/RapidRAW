import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Sparkles, X, ChevronDown, ChevronUp, Info } from 'lucide-react';
import {
  Invokes,
  GeminiAnalysisResult,
  GeminiBatchAnalysisItem,
} from '../ui/AppProperties';
import Button from '../ui/Button';
import Text from '../ui/Text';
import { TextColors, TextVariants } from '../../types/typography';

interface AiAnalysisModalProps {
  isOpen: boolean;
  onClose(): void;
  targetPaths: string[];
  thumbnails: Record<string, string>;
}

// ---- Score badge --------------------------------------------------------

function ScoreBadge({ value, max = 10 }: { value: number; max?: number }) {
  const pct = value / max;
  const color =
    pct >= 0.75
      ? 'text-green-400'
      : pct >= 0.5
        ? 'text-yellow-400'
        : 'text-red-400';
  return (
    <span className={`font-bold tabular-nums ${color}`}>
      {value}
      <span className="text-text-tertiary font-normal">/{max}</span>
    </span>
  );
}

// ---- Score Card ---------------------------------------------------------

function ScoreCard({ result }: { result: GeminiAnalysisResult }) {
  const { t } = useTranslation();
  const scores = [
    { label: t('modals.aiAnalysis.scoreQuality'), value: result.quality },
    { label: t('modals.aiAnalysis.scoreAesthetic'), value: result.aestheticAppeal },
    { label: t('modals.aiAnalysis.scoreClarity'), value: result.subjectClarity },
    { label: t('modals.aiAnalysis.scoreSharpness'), value: result.technicalSharpness },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent font-medium">
          {result.albumName}
        </span>
      </div>
      <p className="text-sm text-text-secondary leading-relaxed">{result.summary}</p>
      <div className="grid grid-cols-2 gap-2 mt-2">
        {scores.map((s) => (
          <div key={s.label} className="flex items-center justify-between bg-bg-primary rounded-lg px-3 py-2">
            <Text variant={TextVariants.small} color={TextColors.secondary}>
              {s.label}
            </Text>
            <ScoreBadge value={s.value} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Image overlay (crop box + focus pins) ------------------------------

function FocusPinTooltip({ comment, visible }: { comment: string; visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 4 }}
          transition={{ duration: 0.15 }}
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-48 z-30 pointer-events-none"
        >
          <div className="bg-bg-overlay border border-border-color text-text-primary text-xs rounded-lg px-2.5 py-1.5 shadow-lg">
            {comment}
          </div>
          <div className="w-2 h-2 bg-bg-overlay border-r border-b border-border-color rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const FOCUS_COLORS: Record<string, string> = {
  good: '#22c55e',
  bad: '#ef4444',
  neutral: '#eab308',
};

function ImageOverlay({ result, imageUrl }: { result: GeminiAnalysisResult; imageUrl: string }) {
  const { t } = useTranslation();
  const [activePin, setActivePin] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { x, y, width, height } = result.cropSuggestion;

  return (
    <div ref={containerRef} className="relative rounded-lg overflow-hidden bg-black select-none">
      <img src={imageUrl} alt="" className="w-full h-auto block" draggable={false} />

      {/* Crop suggestion overlay */}
      <div
        className="absolute border-2 border-white/80 shadow-lg pointer-events-none"
        style={{
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          width: `${width * 100}%`,
          height: `${height * 100}%`,
        }}
      >
        {/* Corner handles */}
        {[
          ['top-0 left-0 border-t-2 border-l-2', '-translate-x-px -translate-y-px'],
          ['top-0 right-0 border-t-2 border-r-2', 'translate-x-px -translate-y-px'],
          ['bottom-0 left-0 border-b-2 border-l-2', '-translate-x-px translate-y-px'],
          ['bottom-0 right-0 border-b-2 border-r-2', 'translate-x-px translate-y-px'],
        ].map(([pos], i) => (
          <div key={i} className={`absolute w-3 h-3 border-accent ${pos}`} />
        ))}
        <span className="absolute top-1 left-1 text-[10px] bg-black/60 text-white px-1 rounded">
          {t('modals.aiAnalysis.cropLabel')}
        </span>
      </div>

      {/* Dark vignette outside crop */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(rgba(0,0,0,0.3),rgba(0,0,0,0.3))`,
          clipPath: `polygon(
            0% 0%, 100% 0%, 100% 100%, 0% 100%,
            0% 0%,
            ${x * 100}% ${y * 100}%,
            ${(x + width) * 100}% ${y * 100}%,
            ${(x + width) * 100}% ${(y + height) * 100}%,
            ${x * 100}% ${(y + height) * 100}%,
            ${x * 100}% ${y * 100}%
          )`,
        }}
      />

      {/* Focus points */}
      {result.focusPoints.map((fp, i) => {
        const color = FOCUS_COLORS[fp.type] ?? FOCUS_COLORS.neutral;
        const isActive = activePin === i;
        return (
          <div
            key={i}
            className="absolute z-20 cursor-pointer"
            style={{
              left: `${fp.x * 100}%`,
              top: `${fp.y * 100}%`,
              transform: 'translate(-50%, -50%)',
            }}
            onClick={() => setActivePin(isActive ? null : i)}
          >
            <div
              className="w-4 h-4 rounded-full border-2 border-white/80 shadow-md transition-transform hover:scale-125"
              style={{
                backgroundColor: color,
                opacity: 0.7 + fp.intensity * 0.3,
              }}
            />
            <FocusPinTooltip comment={fp.comment} visible={isActive} />
          </div>
        );
      })}
    </div>
  );
}

// ---- Single result view -------------------------------------------------

function SingleResultView({
  result,
  imageUrl,
}: {
  result: GeminiAnalysisResult;
  imageUrl: string;
}) {
  return (
    <div className="flex flex-col gap-4 overflow-y-auto max-h-[70vh] pr-1">
      <ImageOverlay result={result} imageUrl={imageUrl} />
      <ScoreCard result={result} />
    </div>
  );
}

// ---- Batch result view --------------------------------------------------

type RatingBucket = 'high' | 'medium' | 'low' | 'unrated';

function getBucket(item: GeminiBatchAnalysisItem): RatingBucket {
  if (!item.result) return 'unrated';
  const score = item.result.aestheticAppeal;
  if (score >= 8) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

const BUCKET_LABELS: Record<RatingBucket, string> = {
  high: 'modals.aiAnalysis.bucketHigh',
  medium: 'modals.aiAnalysis.bucketMedium',
  low: 'modals.aiAnalysis.bucketLow',
  unrated: 'modals.aiAnalysis.bucketUnrated',
};

const BUCKET_COLORS: Record<RatingBucket, string> = {
  high: 'text-green-400',
  medium: 'text-yellow-400',
  low: 'text-red-400',
  unrated: 'text-text-tertiary',
};

function BatchBucketSection({
  bucket,
  items,
  thumbnails,
}: {
  bucket: RatingBucket;
  items: GeminiBatchAnalysisItem[];
  thumbnails: Record<string, string>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  if (items.length === 0) return null;

  const selectedItem = selectedPath ? items.find((i) => i.path === selectedPath) : null;

  return (
    <div className="border border-border-color rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-secondary hover:bg-bg-tertiary transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <Text variant={TextVariants.label} className={BUCKET_COLORS[bucket]}>
          {t(BUCKET_LABELS[bucket])} ({items.length})
        </Text>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-3 grid grid-cols-4 gap-2">
              {items.map((item) => {
                const thumb = thumbnails[item.path];
                const name = item.path.split(/[\\/]/).pop() ?? item.path;
                const isSelected = selectedPath === item.path;
                return (
                  <div
                    key={item.path}
                    className={`relative rounded-lg overflow-hidden cursor-pointer border-2 transition-colors ${
                      isSelected ? 'border-accent' : 'border-transparent hover:border-surface'
                    }`}
                    onClick={() => setSelectedPath(isSelected ? null : item.path)}
                    title={name}
                  >
                    {thumb ? (
                      <img src={thumb} alt={name} className="w-full aspect-square object-cover" />
                    ) : (
                      <div className="w-full aspect-square bg-bg-primary flex items-center justify-center">
                        <Info size={14} className="text-text-tertiary" />
                      </div>
                    )}
                    {item.result && (
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-center py-0.5">
                        <span className="text-[10px] font-semibold text-white">
                          {item.result.aestheticAppeal}/10
                        </span>
                      </div>
                    )}
                    {item.error && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <X size={16} className="text-red-400" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Detail panel for selected item */}
            <AnimatePresence>
              {selectedItem?.result && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-t border-border-color overflow-hidden"
                >
                  <div className="p-4">
                    <ScoreCard result={selectedItem.result} />
                  </div>
                </motion.div>
              )}
              {selectedItem?.error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-t border-border-color overflow-hidden"
                >
                  <div className="p-4">
                    <Text color={TextColors.error}>{selectedItem.error}</Text>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BatchResultView({
  items,
  thumbnails,
}: {
  items: GeminiBatchAnalysisItem[];
  thumbnails: Record<string, string>;
}) {
  const buckets: Record<RatingBucket, GeminiBatchAnalysisItem[]> = {
    high: [],
    medium: [],
    low: [],
    unrated: [],
  };
  for (const item of items) {
    buckets[getBucket(item)].push(item);
  }

  return (
    <div className="flex flex-col gap-3 overflow-y-auto max-h-[65vh] pr-1">
      {(['high', 'medium', 'low', 'unrated'] as RatingBucket[]).map((b) => (
        <BatchBucketSection
          key={b}
          bucket={b}
          items={buckets[b]}
          thumbnails={thumbnails}
        />
      ))}
    </div>
  );
}

// ---- Modal root ---------------------------------------------------------

export default function AiAnalysisModal({
  isOpen,
  onClose,
  targetPaths,
  thumbnails,
}: AiAnalysisModalProps) {
  const { t } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [singleResult, setSingleResult] = useState<GeminiAnalysisResult | null>(null);
  const [batchResults, setBatchResults] = useState<GeminiBatchAnalysisItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSingle = targetPaths.length === 1;
  const firstPath = targetPaths[0] ?? '';

  useEffect(() => {
    if (isOpen) {
      setIsMounted(true);
      requestAnimationFrame(() => setShow(true));
      // Reset state on open
      setSingleResult(null);
      setBatchResults(null);
      setError(null);
      setIsProcessing(false);
    } else {
      setShow(false);
      const t = setTimeout(() => setIsMounted(false), 250);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  const handleAnalyze = useCallback(async () => {
    setIsProcessing(true);
    setError(null);
    setSingleResult(null);
    setBatchResults(null);

    try {
      if (isSingle) {
        const result = await invoke<GeminiAnalysisResult>(Invokes.AnalyzeImageWithGemini, {
          path: firstPath,
        });
        setSingleResult(result);
      } else {
        const results = await invoke<GeminiBatchAnalysisItem[]>(
          Invokes.AnalyzeImagesBatchWithGemini,
          { paths: targetPaths },
        );
        setBatchResults(results);
      }
    } catch (e: unknown) {
      setError(typeof e === 'string' ? e : String(e));
    } finally {
      setIsProcessing(false);
    }
  }, [isSingle, firstPath, targetPaths]);

  if (!isMounted) return null;

  const hasResult = singleResult !== null || batchResults !== null;
  const imageUrl = thumbnails[firstPath] ?? '';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${show ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: show ? 1 : 0.96, opacity: show ? 1 : 0 }}
        transition={{ duration: 0.2 }}
        className="relative z-10 bg-bg-secondary border border-border-color rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-color flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-accent" />
            <Text variant={TextVariants.heading}>{t('modals.aiAnalysis.title')}</Text>
          </div>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary transition-colors p-1 rounded-lg hover:bg-bg-tertiary"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1">
          {/* Start state */}
          {!hasResult && !isProcessing && !error && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <Sparkles size={40} className="text-accent opacity-60" />
              <Text variant={TextVariants.heading}>
                {isSingle
                  ? t('modals.aiAnalysis.startSingle')
                  : t('modals.aiAnalysis.startBatch', { count: targetPaths.length })}
              </Text>
              <Text color={TextColors.secondary} className="max-w-xs">
                {t('modals.aiAnalysis.startDesc')}
              </Text>
              {isSingle && imageUrl && (
                <img
                  src={imageUrl}
                  alt=""
                  className="rounded-xl max-h-48 object-contain shadow-md"
                />
              )}
            </div>
          )}

          {/* Loading */}
          {isProcessing && (
            <div className="flex flex-col items-center gap-4 py-10">
              <Loader2 size={36} className="text-accent animate-spin" />
              <Text color={TextColors.secondary}>{t('modals.aiAnalysis.analyzing')}</Text>
            </div>
          )}

          {/* Error */}
          {error && !isProcessing && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Text color={TextColors.error} className="text-center">
                {error}
              </Text>
              <Button onClick={handleAnalyze}>{t('modals.aiAnalysis.retry')}</Button>
            </div>
          )}

          {/* Single result */}
          {singleResult && !isProcessing && (
            <SingleResultView result={singleResult} imageUrl={imageUrl} />
          )}

          {/* Batch results */}
          {batchResults && !isProcessing && (
            <BatchResultView items={batchResults} thumbnails={thumbnails} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border-color flex-shrink-0 gap-3">
          <Button variant="ghost" onClick={onClose} className="bg-surface">
            {t('modals.aiAnalysis.close')}
          </Button>
          <Button
            onClick={handleAnalyze}
            disabled={isProcessing}
            className="flex items-center gap-2"
          >
            {isProcessing ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t('modals.aiAnalysis.analyzing')}
              </>
            ) : hasResult ? (
              t('modals.aiAnalysis.reanalyze')
            ) : (
              t('modals.aiAnalysis.analyze')
            )}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
