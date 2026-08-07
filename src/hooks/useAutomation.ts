import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'react-toastify';
import { useSettingsStore } from '../store/useSettingsStore';
import { useEditorStore } from '../store/useEditorStore';
import {
  AutomationAction,
  AutomationRule,
  GeminiAnalysisResult,
  Invokes,
} from '../components/ui/AppProperties';
import { Adjustments } from '../utils/adjustments';
import { debouncedSave } from './useEditorActions';

async function executeAction(action: AutomationAction, paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  switch (action.type) {
    case 'add_tag':
      await invoke(Invokes.AddTagForPaths, { paths, tag: action.tag });
      break;

    case 'remove_tag':
      await invoke(Invokes.RemoveTagForPaths, { paths, tag: action.tag });
      break;

    case 'set_color_label':
      await invoke(Invokes.SetColorLabelForPaths, { paths, color: action.value });
      break;

    case 'set_rating':
      await invoke(Invokes.SetRatingForPaths, { paths, rating: action.value });
      break;

    case 'apply_preset': {
      // Apply the named preset to the currently open image (single-path only)
      const { selectedImage, adjustments } = useEditorStore.getState();
      if (!selectedImage || !paths.includes(selectedImage.path)) break;

      const settings = useSettingsStore.getState().appSettings;
      const presets = (settings as any)?.__presetsCache ?? [];
      const preset = presets.find((p: any) => p.name === action.presetName);
      if (!preset) {
        toast.warn(`Automation: preset "${action.presetName}" not found`);
        break;
      }

      const newAdj: Adjustments = { ...adjustments, ...preset.adjustments };
      useEditorStore.getState().setEditor(() => ({ adjustments: newAdj }));
      debouncedSave(selectedImage.path, newAdj);
      break;
    }

    case 'add_to_album': {
      // Add each path to the named album (creates album if it doesn't exist)
      const albums: any[] = await invoke(Invokes.GetAlbums);
      const albumItem = albums
        .flatMap((g: any) => g.albums ?? [])
        .find((a: any) => a.name === action.albumName);
      if (!albumItem) {
        toast.warn(`Automation: album "${action.albumName}" not found`);
        break;
      }
      await invoke(Invokes.AddToAlbum, { albumId: albumItem.id, paths });
      break;
    }
  }
}

function getEnabledRules(): AutomationRule[] {
  return (useSettingsStore.getState().appSettings?.automationRules ?? []).filter((r) => r.enabled);
}

// ── Standalone triggers (callable from non-hook contexts) ──────────────────

export async function runAutomationForRatingSet(paths: string[], rating: number): Promise<void> {
  const rules = getEnabledRules().filter(
    (r) => r.trigger.type === 'rating_set' && r.trigger.value === rating,
  );
  for (const rule of rules) {
    await executeAction(rule.action, paths).catch((err) =>
      toast.error(`Automation "${rule.name}" failed: ${err}`),
    );
  }
}

export async function runAutomationForColorLabelSet(paths: string[], color: string): Promise<void> {
  const rules = getEnabledRules().filter(
    (r) => r.trigger.type === 'color_label_set' && r.trigger.value === color,
  );
  for (const rule of rules) {
    await executeAction(rule.action, paths).catch((err) =>
      toast.error(`Automation "${rule.name}" failed: ${err}`),
    );
  }
}

export async function runAutomationForTagAdded(paths: string[], tag: string): Promise<void> {
  const rules = getEnabledRules().filter(
    (r) => r.trigger.type === 'tag_added' && r.trigger.tag === tag,
  );
  for (const rule of rules) {
    await executeAction(rule.action, paths).catch((err) =>
      toast.error(`Automation "${rule.name}" failed: ${err}`),
    );
  }
}

export async function runAutomationForAiScore(path: string, result: GeminiAnalysisResult): Promise<void> {
  const rules = getEnabledRules().filter((r) => {
    if (r.trigger.type !== 'ai_score_above') return false;
    const score = result[r.trigger.metric as keyof GeminiAnalysisResult] as number | undefined;
    return typeof score === 'number' && score > r.trigger.threshold;
  });
  for (const rule of rules) {
    await executeAction(rule.action, [path]).catch((err) =>
      toast.error(`Automation "${rule.name}" failed: ${err}`),
    );
  }
}

// ── React hook wrapper (for use inside components) ────────────────────────

/**
 * Returns helpers to trigger automation rule evaluation.
 * Call the appropriate helper after the triggering event has been persisted.
 */
export function useAutomation() {
  const runRulesForRatingSet = useCallback(
    (paths: string[], rating: number) => runAutomationForRatingSet(paths, rating),
    [],
  );

  const runRulesForColorLabelSet = useCallback(
    (paths: string[], color: string) => runAutomationForColorLabelSet(paths, color),
    [],
  );

  const runRulesForTagAdded = useCallback(
    (paths: string[], tag: string) => runAutomationForTagAdded(paths, tag),
    [],
  );

  const runRulesForAiScore = useCallback(
    (path: string, result: GeminiAnalysisResult) => runAutomationForAiScore(path, result),
    [],
  );

  return {
    runRulesForRatingSet,
    runRulesForColorLabelSet,
    runRulesForTagAdded,
    runRulesForAiScore,
  };
}

